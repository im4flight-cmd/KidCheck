/**
 * Pushpay ChMS (Church Community Builder) API v1 client.
 *
 * This is the server side "brain" ported from the original Google Apps Script
 * version. It calls the attendance_profile service for one event (room) and
 * one occurrence (date), parses the XML, and returns a small JSON friendly
 * object. Credentials come from environment variables and never reach the
 * browser.
 *
 * Confirmed attendance_profile response shape:
 *   <ccb_api><response>
 *     <events count="1">
 *       <event id="12345">
 *         <name>Room name</name>
 *         <occurrence>2026-09-07 00:00:00</occurrence>
 *         <attendees>
 *           <attendee id="10"><first_name>Ben</first_name><last_name>Bolton</last_name></attendee>
 *         </attendees>
 *       </event>
 *     </events>
 *   </response></ccb_api>
 * Errors: <ccb_api><response><errors><error>message</error></errors></response></ccb_api>
 *
 * Note: the ChMS request parameter for the event is "id", not "event_id".
 */

import { XMLParser } from 'fast-xml-parser';

export type Attendee = { id: string; name: string };

export type RosterOk = {
  room: string;
  occurrence: string;
  updated: string; // ISO timestamp
  count: number;
  checkedIn: Attendee[];
  cached?: boolean;
};

export type RosterError = { error: string };

export type RosterResult = RosterOk | RosterError;

export function isError(r: RosterResult): r is RosterError {
  return (r as RosterError).error !== undefined;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false, // keep names and ids as strings
  parseAttributeValue: false,
  trimValues: true,
});

function toArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function capitalizeFirst(s: string): string {
  s = String(s ?? '');
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function codePoint(n: number): string {
  return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
}

// The XML parser already decodes the named entities (& < > ' "). Numeric
// character references like &#225; are rarer but decoded here for safety.
function decodeNumericEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, d) => codePoint(parseInt(d, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => codePoint(parseInt(h, 16)));
}

/**
 * Format a display name. Defaults to first name plus last initial ("Ben B.")
 * so a full last name is not left sitting on a classroom screen. Set
 * SHOW_FULL_NAMES=true to show full names.
 */
export function formatName(first: string, last: string): string {
  const showFull = process.env.SHOW_FULL_NAMES === 'true';
  first = capitalizeFirst((first ?? '').trim());
  last = (last ?? '').trim();
  if (!showFull && last) {
    return `${first} ${last.charAt(0).toUpperCase()}.`.trim();
  }
  return `${first} ${last}`.trim();
}

export function isValidOccurrence(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}:\d{2})?$/.test(String(value ?? '').trim());
}

function todayInChurchTz(): string {
  const tz = process.env.CHURCH_TIMEZONE || 'America/Chicago';
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export function normalizeOccurrence(value: string | undefined): string {
  const v = String(value ?? '').trim();
  return isValidOccurrence(v) ? v : todayInChurchTz();
}

/**
 * Parse the attendance_profile XML into a RosterResult.
 */
export function parseAttendance(xmlText: string, occurrence: string): RosterResult {
  let parsed: any;
  try {
    parsed = parser.parse(xmlText);
  } catch {
    return { error: 'ChMS returned something this display could not read.' };
  }

  const response = parsed?.ccb_api?.response;
  if (!response) {
    return { error: 'ChMS returned an unexpected response.' };
  }

  // ChMS reports problems as <errors><error>...</error></errors>.
  if (response.errors) {
    const errs = toArray<any>(response.errors.error);
    const msg = errs.length ? String(errs[0]).trim() : 'ChMS returned an error.';
    return { error: msg || 'ChMS returned an error.' };
  }

  const events = toArray<any>(response.events?.event);
  if (!events.length) {
    // No event for this date usually means the room has not met yet today.
    return {
      room: '',
      occurrence,
      updated: new Date().toISOString(),
      count: 0,
      checkedIn: [],
    };
  }

  const roomName = decodeNumericEntities(String(events[0].name ?? '').trim());
  const occ = String(events[0].occurrence ?? '').trim() || occurrence;

  const seen = new Set<string>();
  const checkedIn: Attendee[] = [];
  for (const ev of events) {
    const attendees = toArray<any>(ev.attendees?.attendee);
    for (const a of attendees) {
      const id = a?.['@_id'] != null ? String(a['@_id']) : '';
      if (id && seen.has(id)) continue;
      if (id) seen.add(id);
      const first = decodeNumericEntities(String(a?.first_name ?? '').trim());
      const last = decodeNumericEntities(String(a?.last_name ?? '').trim());
      checkedIn.push({ id, name: formatName(first, last) });
    }
  }

  checkedIn.sort((x, y) => x.name.localeCompare(y.name));

  return {
    room: roomName,
    occurrence: occ,
    updated: new Date().toISOString(),
    count: checkedIn.length,
    checkedIn,
  };
}

/**
 * Fetch and parse the roster for one event id and occurrence.
 */
export async function fetchRoster(eventId: string, occurrence: string): Promise<RosterResult> {
  const subdomain = process.env.CCB_SUBDOMAIN;
  const user = process.env.CCB_API_USER;
  const pass = process.env.CCB_API_PASS;

  if (!subdomain || !user || !pass) {
    return {
      error:
        'Server is not configured yet. Set CCB_SUBDOMAIN, CCB_API_USER, and CCB_API_PASS.',
    };
  }
  if (!/^\d+$/.test(String(eventId))) {
    return { error: 'Invalid room id.' };
  }

  const occ = normalizeOccurrence(occurrence);
  const url =
    `https://${encodeURIComponent(subdomain)}.ccbchurch.com/api.php` +
    `?srv=attendance_profile&id=${encodeURIComponent(eventId)}` +
    `&occurrence=${encodeURIComponent(occ)}`;
  const auth = Buffer.from(`${user}:${pass}`).toString('base64');

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Basic ${auth}` },
      cache: 'no-store',
      // Fail fast rather than hang the serverless function if ChMS is slow.
      signal: AbortSignal.timeout(10000),
    });
  } catch (err) {
    const timedOut = (err as { name?: string })?.name === 'TimeoutError';
    return {
      error: timedOut
        ? 'ChMS did not respond in time. It will retry shortly.'
        : 'Could not reach ChMS. Check the network and try again.',
    };
  }

  if (res.status === 401 || res.status === 403) {
    return { error: 'ChMS rejected the API credentials (HTTP ' + res.status + ').' };
  }
  if (res.status === 404) {
    return { error: 'ChMS API not found (HTTP 404). Check the subdomain.' };
  }
  if (res.status >= 500) {
    return { error: 'ChMS is temporarily unavailable (HTTP ' + res.status + ').' };
  }
  if (res.status !== 200) {
    return { error: 'Unexpected response from ChMS (HTTP ' + res.status + ').' };
  }

  const body = await res.text();
  return parseAttendance(body, occ);
}

// Short in-memory cache so many iPads showing one room, and the repeated polls
// from one iPad, do not each hit ChMS. Lives only inside a warm serverless
// instance, which is exactly the burst we want to smooth out.
const CACHE_TTL_MS = 15000;
const cache = new Map<string, { at: number; data: RosterOk }>();

// Sample names for DEMO_MODE, so the display can be previewed before ChMS
// credentials are wired up.
const DEMO_NAMES: Array<[string, string]> = [
  ['Olivia', 'Bennett'], ['Liam', 'Carter'], ['Emma', 'Diaz'], ['Noah', 'Foster'],
  ['Ava', 'Grant'], ['Mason', 'Hayes'], ['Sophia', 'Ingram'], ['Ethan', 'James'],
  ['Isabella', 'Knox'], ['Lucas', 'Reyes'], ['Mia', 'Sullivan'], ['Henry', 'Walsh'],
  ['Amelia', 'Young'], ['Jack', 'Zimmer'],
];

function demoRoster(eventId: string, occ: string): RosterOk {
  const n = 6 + (Number(eventId) % 7); // vary a little per room
  const checkedIn: Attendee[] = DEMO_NAMES.slice(0, n).map((p, i) => ({
    id: `demo-${i}`,
    name: formatName(p[0], p[1]),
  }));
  checkedIn.sort((x, y) => x.name.localeCompare(y.name));
  return {
    room: '',
    occurrence: occ,
    updated: new Date().toISOString(),
    count: checkedIn.length,
    checkedIn,
  };
}

export async function getRoster(eventId: string, occurrence?: string): Promise<RosterResult> {
  const occ = normalizeOccurrence(occurrence);

  // Preview without ChMS. Off unless DEMO_MODE=true.
  if (process.env.DEMO_MODE === 'true') {
    return demoRoster(eventId, occ);
  }

  const key = `${eventId}_${occ}`;

  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return { ...hit.data, cached: true };
  }

  const data = await fetchRoster(eventId, occ);
  if (!isError(data)) {
    // Guard against unbounded growth in a long-lived warm instance.
    if (cache.size > 500) cache.clear();
    cache.set(key, { at: Date.now(), data });
  }
  return data;
}
