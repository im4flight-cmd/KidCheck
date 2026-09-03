/**
 * Pushpay ChMS (Church Community Builder) API v1 client.
 *
 * Server side "brain." Calls attendance_profile for one event (room) and one
 * occurrence (date), parses the XML, and optionally enriches each checked-in
 * child with a parent/guardian contact pulled from individual_profile.
 * Credentials come from environment variables and never reach the browser.
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
 *
 * Parent contact (individual_profile) shape is coded to the documented CCB
 * shape below and must be confirmed on the first live call (Phase 0). Because
 * it degrades gracefully (a child simply shows without contact), an imperfect
 * match never breaks the roster.
 *   <ccb_api><response><individuals count="1"><individual id="122">
 *     <phones><phone type="mobile">2105550142</phone>...</phones>
 *     <family_members>
 *       <family_member id="120"><first_name>Sarah</first_name><last_name>Bolton</last_name>
 *         <family_position>Primary Contact</family_position></family_member>
 *       ...
 *     </family_members>
 *   </individual></individuals></response></ccb_api>
 */

import { XMLParser } from 'fast-xml-parser';

export type Attendee = {
  id: string;
  name: string;
  guardian?: string; // parent/guardian display name
  phone?: string; // parent/guardian phone (only sent in "full" contact mode)
};

export type Guardian = { guardian: string; phone: string };

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
  parseTagValue: false, // keep names, ids, and phone numbers as strings
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

// Text of an XML node that fast-xml-parser may render as a string, or as an
// object with attributes plus a "#text" child.
function nodeText(v: unknown): string {
  if (v === undefined || v === null) return '';
  if (typeof v === 'object') return decodeNumericEntities(String((v as any)['#text'] ?? '').trim());
  return decodeNumericEntities(String(v).trim());
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

// Pretty-print a US phone number, leaving anything unusual untouched.
export function formatPhone(raw: string): string {
  const d = String(raw ?? '').replace(/\D/g, '');
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  if (d.length === 11 && d[0] === '1') return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  return String(raw ?? '').trim();
}

// How much parent contact to include on the chart.
//   off  = none, name = guardian name only, full = name and phone (default).
export function parentContactMode(): 'off' | 'name' | 'full' {
  const m = String(process.env.PARENT_CONTACT_MODE ?? 'full').trim().toLowerCase();
  return m === 'off' || m === 'name' ? m : 'full';
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
 * Extract a parent/guardian contact from an individual_profile response.
 * Guardian name comes from the family's Primary Contact (then Spouse, then any
 * non-child member). Phone prefers a mobile, then home/contact/work.
 * Returns null when the profile is readable but has no usable contact.
 */
export function parseIndividualGuardian(xmlText: string): Guardian | null {
  let parsed: any;
  try {
    parsed = parser.parse(xmlText);
  } catch {
    return null;
  }
  const response = parsed?.ccb_api?.response;
  if (!response || response.errors) return null;

  const indiv = toArray<any>(response.individuals?.individual)[0];
  if (!indiv) return null;

  const position = (m: any) => String(m?.family_position ?? '').trim().toLowerCase();
  const members = toArray<any>(indiv.family_members?.family_member);
  const adult =
    members.find((m) => position(m) === 'primary contact') ||
    members.find((m) => position(m) === 'spouse') ||
    members.find((m) => position(m) && position(m) !== 'child');
  const guardian = adult ? formatName(nodeText(adult.first_name), nodeText(adult.last_name)) : '';

  const phone = bestPhone(indiv.phones);

  if (!guardian && !phone) return null;
  return { guardian, phone };
}

function bestPhone(phonesNode: any): string {
  const phones = toArray<any>(phonesNode?.phone).map((p) => {
    if (p && typeof p === 'object') {
      return { type: String(p['@_type'] ?? '').toLowerCase(), num: nodeText(p) };
    }
    return { type: '', num: nodeText(p) };
  }).filter((p) => p.num);

  const order = ['mobile', 'cell', 'contact', 'home', 'work'];
  for (const t of order) {
    const hit = phones.find((p) => p.type === t);
    if (hit) return formatPhone(hit.num);
  }
  return phones.length ? formatPhone(phones[0].num) : '';
}

function apiBase(): { url: string; auth: string } | null {
  const subdomain = process.env.CCB_SUBDOMAIN;
  const user = process.env.CCB_API_USER;
  const pass = process.env.CCB_API_PASS;
  if (!subdomain || !user || !pass) return null;
  return {
    url: `https://${encodeURIComponent(subdomain)}.ccbchurch.com/api.php`,
    auth: Buffer.from(`${user}:${pass}`).toString('base64'),
  };
}

/**
 * Fetch and parse the roster for one event id and occurrence.
 */
export async function fetchRoster(eventId: string, occurrence: string): Promise<RosterResult> {
  const base = apiBase();
  if (!base) {
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
    `${base.url}?srv=attendance_profile&id=${encodeURIComponent(eventId)}` +
    `&occurrence=${encodeURIComponent(occ)}`;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Basic ${base.auth}` },
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

async function fetchIndividualGuardian(childId: string): Promise<Guardian | null> {
  const base = apiBase();
  if (!base || !/^\d+$/.test(String(childId))) return null;
  const url = `${base.url}?srv=individual_profile&id=${encodeURIComponent(childId)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Basic ${base.auth}` },
    cache: 'no-store',
    signal: AbortSignal.timeout(10000),
  });
  if (res.status !== 200) throw new Error('individual_profile HTTP ' + res.status);
  return parseIndividualGuardian(await res.text());
}

// A child's guardian rarely changes, so cache lookups for hours. Each child is
// then looked up at most once per service, keeping API load tiny.
const GUARDIAN_TTL_MS = 6 * 60 * 60 * 1000;
const guardianCache = new Map<string, { at: number; data: Guardian | null }>();

async function fetchGuardian(childId: string): Promise<Guardian | null> {
  const hit = guardianCache.get(childId);
  if (hit && Date.now() - hit.at < GUARDIAN_TTL_MS) return hit.data;

  let data: Guardian | null = null;
  let ok = false;
  try {
    data = await fetchIndividualGuardian(childId);
    ok = true;
  } catch {
    ok = false; // network or HTTP problem: do not cache, retry next time
  }
  if (ok) {
    if (guardianCache.size > 2000) guardianCache.clear();
    guardianCache.set(childId, { at: Date.now(), data });
  }
  return data;
}

// Enrich a roster in place with parent contact, with limited concurrency so a
// full room does not fire dozens of API calls at once.
async function enrichWithGuardians(roster: RosterOk): Promise<void> {
  const mode = parentContactMode();
  if (mode === 'off') return;

  const CONCURRENCY = 5;
  const items = roster.checkedIn.filter((a) => /^\d+$/.test(a.id));
  for (let i = 0; i < items.length; i += CONCURRENCY) {
    const batch = items.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (a) => {
        const g = await fetchGuardian(a.id);
        if (!g) return;
        if (g.guardian) a.guardian = g.guardian;
        if (mode === 'full' && g.phone) a.phone = g.phone;
      }),
    );
  }
}

// Short in-memory cache so many iPads showing one room, and the repeated polls
// from one iPad, do not each hit ChMS. Lives only inside a warm serverless
// instance, which is exactly the burst we want to smooth out.
const CACHE_TTL_MS = 15000;
const cache = new Map<string, { at: number; data: RosterOk }>();

// Sample data for DEMO_MODE, so the display can be previewed before ChMS
// credentials are wired up. The phone numbers use the 555-01xx range that is
// reserved for fiction, so they can never reach a real person.
const DEMO_NAMES: Array<[string, string]> = [
  ['Olivia', 'Bennett'], ['Liam', 'Carter'], ['Emma', 'Diaz'], ['Noah', 'Foster'],
  ['Ava', 'Grant'], ['Mason', 'Hayes'], ['Sophia', 'Ingram'], ['Ethan', 'James'],
  ['Isabella', 'Knox'], ['Lucas', 'Reyes'], ['Mia', 'Sullivan'], ['Henry', 'Walsh'],
  ['Amelia', 'Young'], ['Jack', 'Zimmer'],
];
const DEMO_GUARDIANS = ['Sarah', 'Mark', 'Rachel', 'David', 'Hannah', 'Paul', 'Grace', 'Caleb', 'Rebecca', 'Aaron', 'Leah', 'Seth', 'Naomi', 'Josh'];
const DEMO_PHONES = ['(210) 555-0142', '(210) 555-0168', '(210) 555-0113', '(210) 555-0177', '(210) 555-0129', '(210) 555-0154', '(210) 555-0186', '(210) 555-0101', '(210) 555-0139', '(210) 555-0162'];

function demoRoster(eventId: string, occ: string): RosterOk {
  const mode = parentContactMode();
  const n = 6 + (Number(eventId) % 7); // vary a little per room
  const checkedIn: Attendee[] = DEMO_NAMES.slice(0, n).map((p, i) => {
    const a: Attendee = { id: `demo-${i}`, name: formatName(p[0], p[1]) };
    if (mode !== 'off') {
      a.guardian = formatName(DEMO_GUARDIANS[i % DEMO_GUARDIANS.length], p[1]);
      if (mode === 'full') a.phone = DEMO_PHONES[i % DEMO_PHONES.length];
    }
    return a;
  });
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
    await enrichWithGuardians(data);
    // Guard against unbounded growth in a long-lived warm instance.
    if (cache.size > 500) cache.clear();
    cache.set(key, { at: Date.now(), data });
  }
  return data;
}
