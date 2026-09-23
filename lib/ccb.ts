/**
 * Pushpay ChMS (Church Community Builder) API v1 client.
 *
 * Server side "brain." Calls attendance_profile for one event (room) and one
 * occurrence (date), parses the XML, and optionally enriches each checked-in
 * child with a parent/guardian contact pulled from individual_profile_from_id.
 * Credentials come from environment variables and never reach the browser.
 *
 * Today's occurrence is not just guessed as a bare date: event_profile is
 * asked what occurrence(s) actually exist for today (cached briefly) and
 * every one found is queried and merged, so an ad hoc occurrence added to
 * test on a non-Sunday (which CCB may key with a specific time) still shows
 * up, not just the normal weekly meeting. The bare-date guess is always
 * included too, so this only ever adds coverage, never loses it.
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
 * Note: individual_profile_from_id takes "individual_id", not "id" (unlike
 * attendance_profile and event_profile, which do use "id").
 *
 * Confirmed individual_profile_from_id response shape (a child's own record):
 *   <ccb_api><response><individuals count="1"><individual id="661">
 *     <phones><phone type="mobile"></phone>...</phones>   -- always empty, minors have none
 *     <family_members>
 *       <family_member><individual id="659">Wayne Aaland</individual>
 *         <family_position>Primary Contact</family_position></family_member>
 *       ...
 *     </family_members>
 *   </individual></individuals></response></ccb_api>
 * A family member's name is the TEXT of its <individual> tag as one combined
 * string, with that tag's id attribute being THEIR OWN individual_id -- not
 * separate first_name/last_name fields. Their phone lives on THEIR OWN
 * profile (a second individual_profile_from_id call using that id), never on
 * the child's, so finding a parent to page is a two-step lookup.
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

export type RosterError = { error: string; code?: string };

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

// A ChMS <error> node may be plain text, or an object when it carries
// attributes (<error type="..">text</error>) or child elements
// (<error><message>..</message></error>). Pull a readable string from any shape
// so the display never shows a bare "[object Object]".
function extractErrorMessage(node: unknown): string {
  const direct = nodeText(node);
  if (direct) return direct;
  if (node && typeof node === 'object') {
    const o = node as Record<string, unknown>;
    return nodeText(o.message) || nodeText(o.error) || nodeText(o.description) || '';
  }
  return '';
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

const WEEKDAY_NUM: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

// 0 (Sunday) .. 6 (Saturday), in the church's own timezone rather than the
// server's (Vercel runs in UTC, which can be a different calendar day).
function todayWeekdayInChurchTz(): number {
  const tz = process.env.CHURCH_TIMEZONE || 'America/Chicago';
  const short = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(new Date());
  return WEEKDAY_NUM[short] ?? new Date().getDay();
}

function weekdayOf(dateStr: string): number {
  const [y, m, d] = dateStr.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay(); // noon UTC avoids day rollover
}

export function normalizeOccurrence(value: string | undefined): string {
  const v = String(value ?? '').trim();
  return isValidOccurrence(v) ? v : todayInChurchTz();
}

// An empty room: connection is fine, nobody is checked in yet. The display
// falls back to the configured room name, so leaving it blank here is fine.
function emptyRoster(occurrence: string): RosterOk {
  return {
    room: '',
    occurrence,
    updated: new Date().toISOString(),
    count: 0,
    checkedIn: [],
  };
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

  const api = parsed?.ccb_api;
  const response = api?.response;
  if (!response) {
    // When there are simply no check-ins for the event/occurrence, ChMS omits
    // <response> and returns a <messages> note ("There are no attendance
    // records..."). That is an empty room, not an error.
    if (api?.messages) {
      return emptyRoster(occurrence);
    }
    return { error: 'ChMS returned an unexpected response.' };
  }

  // ChMS reports problems as <errors><error>...</error></errors>.
  if (response.errors) {
    const errs = toArray<any>(response.errors.error);
    const msg = errs.length ? extractErrorMessage(errs[0]) : '';
    return { error: msg || 'ChMS returned an error.' };
  }

  const events = toArray<any>(response.events?.event);
  if (!events.length) {
    // No event for this date usually means the room has not met yet today.
    return emptyRoster(occurrence);
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

export type GuardianCandidate = { id: string; name: string };

function candidateFromMember(m: any): GuardianCandidate | null {
  // A family member's name is the text of its <individual> tag as one
  // combined string (e.g. "Wayne Aaland"), with that same tag's id attribute
  // being the person's own individual_id, not separate first_name/last_name
  // fields. Split the name on the first space so the usual
  // first-name-plus-last-initial privacy formatting still applies.
  const idAttr = m?.individual?.['@_id'];
  const id = idAttr != null ? String(idAttr) : '';
  const fullName = nodeText(m?.individual);
  if (!id && !fullName) return null;
  const [first, ...rest] = fullName.split(/\s+/).filter(Boolean);
  return { id, name: formatName(first ?? '', rest.join(' ')) };
}

/**
 * List the adults on a CHILD's individual_profile_from_id response, in
 * contact priority order: Primary Contact, then Spouse, then any other
 * non-Child member. Each candidate's phone lives on THEIR OWN profile, not
 * this one (a child's own <phones> block is always empty), so a caller
 * fetches individual_profile_from_id again for whichever candidate's id it
 * wants to try. Returns [] when the profile is unreadable or has no family.
 */
export function parseGuardianCandidates(xmlText: string): GuardianCandidate[] {
  let parsed: any;
  try {
    parsed = parser.parse(xmlText);
  } catch {
    return [];
  }
  const response = parsed?.ccb_api?.response;
  if (!response || response.errors) return [];

  const indiv = toArray<any>(response.individuals?.individual)[0];
  if (!indiv) return [];

  const position = (m: any) => String(m?.family_position ?? '').trim().toLowerCase();
  const members = toArray<any>(indiv.family_members?.family_member);
  const ordered = [
    ...members.filter((m) => position(m) === 'primary contact'),
    ...members.filter((m) => position(m) === 'spouse'),
    ...members.filter(
      (m) => position(m) && position(m) !== 'child' && position(m) !== 'primary contact' && position(m) !== 'spouse',
    ),
  ];
  return ordered.map(candidateFromMember).filter((c): c is GuardianCandidate => c !== null);
}

/**
 * Pull the best phone off ANY individual's own individual_profile_from_id
 * response (an adult's, typically). Prefers a mobile, then contact/home/work.
 */
export function parseOwnPhone(xmlText: string): string {
  let parsed: any;
  try {
    parsed = parser.parse(xmlText);
  } catch {
    return '';
  }
  const response = parsed?.ccb_api?.response;
  if (!response || response.errors) return '';
  const indiv = toArray<any>(response.individuals?.individual)[0];
  return indiv ? bestPhone(indiv.phones) : '';
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
      code: 'not_configured',
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
      signal: AbortSignal.timeout(CCB_TIMEOUT_MS),
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

// event_profile's own occurrence dates for one event, cached briefly so
// neither the 20s roster poll nor the room picker re-fetches it constantly.
// null means "could not be determined" (no permission, ChMS hiccup, or CCB
// not configured yet) -- distinct from an empty match list -- so callers can
// fail open (assume a room is relevant) rather than wrongly hide something.
const EVENT_PROFILE_TTL_MS = 3 * 60 * 1000;
const eventProfileCache = new Map<string, { at: number; dates: string[] | null }>();

async function fetchEventProfileDates(eventId: string): Promise<string[] | null> {
  const hit = eventProfileCache.get(eventId);
  if (hit && Date.now() - hit.at < EVENT_PROFILE_TTL_MS) return hit.dates;

  let dates: string[] | null = null;
  const base = apiBase();
  if (base) {
    try {
      const url = `${base.url}?srv=event_profile&id=${encodeURIComponent(eventId)}`;
      const res = await fetch(url, {
        headers: { Authorization: `Basic ${base.auth}` },
        cache: 'no-store',
        signal: AbortSignal.timeout(CCB_TIMEOUT_MS),
      });
      if (res.status === 200) {
        const body = await res.text();
        if (!/<error\b/i.test(body)) {
          dates = [...new Set(body.match(/\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2}:\d{2})?/g) ?? [])];
        }
      }
    } catch {
      // event_profile not permitted, or a ChMS hiccup: leave dates as null.
    }
  }

  if (eventProfileCache.size > 500) eventProfileCache.clear();
  eventProfileCache.set(eventId, { at: Date.now(), dates });
  return dates;
}

// Whether CCB has more than one occurrence today for an event -- its normal
// weekly meeting, plus perhaps an ad hoc one added to test on a non-Sunday --
// so the roster fetch checks every one found, not just a bare-date guess.
// Today's plain date is always included in the result too, so this can only
// ever ADD occurrences CCB confirms exist; it never loses the guess that
// already worked for a normal Sunday meeting.
async function occurrencesForToday(eventId: string, today: string): Promise<string[]> {
  const result = new Set<string>([today]);
  const dates = await fetchEventProfileDates(eventId);
  if (dates) {
    for (const d of dates) if (d.startsWith(today)) result.add(d);
  }
  return [...result];
}

/**
 * Whether a room (one or more combined event ids) has a class scheduled on
 * the given weekday (0=Sun..6=Sat), based on event_profile's own occurrence
 * dates -- used to decide which rooms the picker shows for today (Sundays
 * show the age group rooms, Fridays show Bible Study Kids, etc). Defaults to
 * true (shown) when event_profile could not be read for ANY of the room's
 * ids, since hiding a room a teacher actually needs would be a worse failure
 * than showing one extra.
 */
export async function roomMeetsOnWeekday(ids: string[], weekday: number): Promise<boolean> {
  let anyReadable = false;
  for (const id of ids) {
    const dates = await fetchEventProfileDates(id);
    if (dates === null) continue;
    anyReadable = true;
    if (dates.some((d) => weekdayOf(d) === weekday)) return true;
  }
  return !anyReadable;
}

export function currentChurchWeekday(): number {
  return todayWeekdayInChurchTz();
}

// Confirmed live 2026-09-23 via the event_profiles discovery probe:
// "Children's Ministry" is event_grouping id 6 in this church's CCB account.
// Overridable in case the grouping is ever deleted and recreated (CCB would
// then assign it a new id).
function childrensMinistryGroupingId(): string {
  return String(process.env.CHILDRENS_MINISTRY_GROUPING_ID ?? '6');
}

// The full event_profiles (plural) listing -- confirmed live to need no
// extra params -- refetched at most every 5 minutes, since the room picker
// can be opened repeatedly across a service and this is a heavier call than
// a single event_profile lookup.
const EVENT_PROFILES_LIST_TTL_MS = 5 * 60 * 1000;
let eventProfilesListCache: { at: number; events: unknown[] } | null = null;

async function fetchAllEventProfiles(): Promise<any[]> {
  if (eventProfilesListCache && Date.now() - eventProfilesListCache.at < EVENT_PROFILES_LIST_TTL_MS) {
    return eventProfilesListCache.events as any[];
  }

  let events: any[] = [];
  const base = apiBase();
  if (base) {
    try {
      const url = `${base.url}?srv=event_profiles`;
      const res = await fetch(url, {
        headers: { Authorization: `Basic ${base.auth}` },
        cache: 'no-store',
        signal: AbortSignal.timeout(CCB_TIMEOUT_MS),
      });
      if (res.status === 200) {
        const body = await res.text();
        if (!/<error\b/i.test(body)) {
          const parsed = parser.parse(body);
          events = toArray<any>(parsed?.ccb_api?.response?.events?.event);
        }
      }
    } catch {
      // Leave events empty: discovery simply finds nothing extra this time,
      // the same fail-open-by-omission behavior as the rest of this file.
    }
  }

  eventProfilesListCache = { at: Date.now(), events };
  return events;
}

export type DiscoveredRoom = { id: string; name: string };

/**
 * Any Children's Ministry event (event_grouping id 6) not already tracked in
 * `excludeIds` (rooms.json's own ids), so a newly created recurring
 * class/program shows up on the picker without a manual rooms.json edit.
 * `weekday` null skips the day check entirely (used for the ?all=1 override);
 * otherwise only events with a real event_profile occurrence on that weekday
 * are included.
 *
 * Some adult events share this same grouping (childcare offered alongside an
 * adult program, e.g. a leaders' meeting) -- confirmed live, a known and
 * accepted residual. The day-occurrence check is the only guard, per intent:
 * matching by name or keyword would just be a different kind of guessing.
 *
 * Unlike rooms.json entries (which fail OPEN when unreadable, since an admin
 * already vouched for them), a discovered event that cannot be confirmed is
 * left OUT here: adding an unverified event is itself a bad outcome for
 * discovery, the opposite of hiding a known-good configured room.
 */
export async function discoverChildrensMinistryRooms(
  weekday: number | null,
  excludeIds: Set<string>,
): Promise<DiscoveredRoom[]> {
  const events = await fetchAllEventProfiles();
  const groupingId = childrensMinistryGroupingId();
  const found: DiscoveredRoom[] = [];

  for (const e of events) {
    const id = String(e?.['@_id'] ?? e?.id ?? '');
    if (!id || excludeIds.has(id)) continue;
    const gid = e?.event_grouping?.['@_id'];
    if (String(gid ?? '') !== groupingId) continue;

    if (weekday !== null) {
      const dates = await fetchEventProfileDates(id);
      if (!dates || !dates.some((d) => weekdayOf(d) === weekday)) continue;
    }

    found.push({ id, name: nodeText(e?.name) || `Event ${id}` });
  }

  return found;
}

/**
 * Temporary setup diagnostic: for one event, scan recent dates and report how
 * many attendance records ChMS holds for each (counts only, never names), so a
 * check-in filed under an unexpected occurrence date can be located.
 */
export async function diagnoseEventDates(
  eventId: string,
  days = 8,
): Promise<Record<string, unknown>> {
  const base = apiBase();
  if (!base) return { configured: false };
  if (!/^\d+$/.test(String(eventId))) return { configured: true, invalidEventId: String(eventId) };

  const today = todayInChurchTz(); // YYYY-MM-DD
  const [y, m, d] = today.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1, d, 12)); // noon UTC avoids day rollover

  const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const results: Array<{ date: string; weekday: string; records: number; note: string }> = [];
  for (let i = 0; i < days; i++) {
    const day = new Date(start);
    day.setUTCDate(start.getUTCDate() - i);
    const date = day.toISOString().slice(0, 10);
    const weekday = WEEKDAYS[day.getUTCDay()];
    const url =
      `${base.url}?srv=attendance_profile&id=${encodeURIComponent(eventId)}` +
      `&occurrence=${date}`;
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Basic ${base.auth}` },
        cache: 'no-store',
        signal: AbortSignal.timeout(CCB_TIMEOUT_MS),
      });
      const body = await res.text();
      const records = (body.match(/<attendee\b/gi) || []).length;
      results.push({ date, weekday, records, note: /no attendance records/i.test(body) ? 'no records' : '' });
    } catch {
      results.push({ date, weekday, records: -1, note: 'fetch error' });
    }
  }
  return { eventId, today, results };
}

/**
 * Temporary setup diagnostic: asks CCB directly what occurrences (schedule
 * entries) exist for an event via event_profile, and pulls out every
 * date/time-looking string in the raw reply. No names, no attendee data.
 * Used to find the exact occurrence (date, and time if the schedule is a
 * custom one-off) a check-in was actually filed under, when attendance_profile
 * with a date-only occurrence comes back empty.
 */
export async function diagnoseEventOccurrences(
  eventId: string,
): Promise<Record<string, unknown>> {
  const base = apiBase();
  if (!base) return { configured: false };
  if (!/^\d+$/.test(String(eventId))) return { configured: true, invalidEventId: String(eventId) };

  const url = `${base.url}?srv=event_profile&id=${encodeURIComponent(eventId)}`;
  let body: string;
  let status: number;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Basic ${base.auth}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(CCB_TIMEOUT_MS),
    });
    status = res.status;
    body = await res.text();
  } catch (err) {
    return { eventId, status: 0, error: String((err as Error)?.message ?? err) };
  }

  const errorMatch = body.match(/<error\b[^>]*>([^<]*)<\/error>/i);
  if (errorMatch) return { eventId, status, ccbError: errorMatch[1].trim() };

  // Pull every date, or date+time, looking string out of the raw XML.
  const dateTimes = [...new Set(body.match(/\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2}:\d{2})?/g) ?? [])].sort();
  // Also grab any element that looks like it names a day/schedule, for context.
  const nameTag = body.match(/<name>([^<]*)<\/name>/i);

  // If nothing useful was found, this event_profile response is about the
  // event/schedule configuration, not individual children, so it is safe to
  // hand back as-is to see exactly what CCB actually returned.
  const raw = dateTimes.length === 0 ? body.slice(0, 4000) : undefined;

  return {
    eventId,
    status,
    name: nameTag ? nameTag[1].trim() : undefined,
    dateTimesFound: dateTimes,
    raw,
  };
}

/**
 * Temporary setup diagnostic: calls attendance_profile with NO occurrence
 * parameter at all. CCB sometimes defaults an omitted occurrence to the
 * event's current/next scheduled meeting, which can reveal a custom or
 * one-off schedule occurrence without needing the event_profile permission.
 * Counts and dates only, never names.
 */
export async function diagnoseNoOccurrence(eventId: string): Promise<Record<string, unknown>> {
  const base = apiBase();
  if (!base) return { configured: false };
  if (!/^\d+$/.test(String(eventId))) return { configured: true, invalidEventId: String(eventId) };

  const url = `${base.url}?srv=attendance_profile&id=${encodeURIComponent(eventId)}`;
  let body: string;
  let status: number;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Basic ${base.auth}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(CCB_TIMEOUT_MS),
    });
    status = res.status;
    body = await res.text();
  } catch (err) {
    return { eventId, status: 0, error: String((err as Error)?.message ?? err) };
  }

  const errorMatch = body.match(/<error\b[^>]*>([^<]*)<\/error>/i);
  if (errorMatch) return { eventId, status, ccbError: errorMatch[1].trim() };

  const occTag = [...new Set(body.match(/<occurrence>([^<]*)<\/occurrence>/gi) ?? [])].map((s) =>
    s.replace(/<\/?occurrence>/gi, ''),
  );
  const records = (body.match(/<attendee\b/gi) || []).length;

  return {
    eventId,
    status,
    occurrencesReturned: occTag,
    records,
    note: /no attendance records/i.test(body) ? 'no records' : '',
  };
}

// One individual_profile_from_id call, by individual_id (not "id" -- that is
// the one service that uses a differently named parameter).
async function fetchProfileXml(base: { url: string; auth: string }, individualId: string): Promise<string> {
  const url = `${base.url}?srv=individual_profile_from_id&individual_id=${encodeURIComponent(individualId)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Basic ${base.auth}` },
    cache: 'no-store',
    signal: AbortSignal.timeout(CCB_TIMEOUT_MS),
  });
  if (res.status !== 200) throw new Error('individual_profile_from_id HTTP ' + res.status);
  return res.text();
}

// A child's own profile never carries a phone (they are minors), so finding
// the parent to contact takes two calls: read the child's profile for the
// family, then read whichever adult's OWN profile for their phone. If the
// top-priority adult (normally Primary Contact) has none on file, try the
// next one (Spouse, then anyone else) rather than come back empty.
async function fetchIndividualGuardian(childId: string): Promise<Guardian | null> {
  const base = apiBase();
  if (!base || !/^\d+$/.test(String(childId))) return null;

  const candidates = parseGuardianCandidates(await fetchProfileXml(base, childId));
  if (!candidates.length) return null;

  let guardian = candidates[0].name;
  let phone = '';
  for (const c of candidates) {
    if (!c.id) continue;
    try {
      const found = parseOwnPhone(await fetchProfileXml(base, c.id));
      if (found) {
        guardian = c.name;
        phone = found;
        break;
      }
    } catch {
      // This adult's profile did not load; try the next candidate.
    }
  }

  if (!guardian && !phone) return null;
  return { guardian, phone };
}

/**
 * Temporary setup diagnostic: runs the same two-step guardian lookup
 * (child's family list, then each adult's own phone) as production, but
 * reports every step, since a real-world shape mismatch (a family_position
 * label or phone type not expected) is worth seeing directly instead of
 * guessed at. Only call with an id the caller already knows, since a
 * family's name/phone is real personal data.
 */
export async function diagnoseGuardianRaw(childId: string): Promise<Record<string, unknown>> {
  const base = apiBase();
  if (!base) return { configured: false };
  if (!/^\d+$/.test(String(childId))) return { configured: true, invalidChildId: String(childId) };

  let childBody: string;
  try {
    childBody = await fetchProfileXml(base, childId);
  } catch (err) {
    return { childId, error: String((err as Error)?.message ?? err) };
  }

  const errorMatch = childBody.match(/<error\b[^>]*>([^<]*)<\/error>/i);
  if (errorMatch) return { childId, ccbError: errorMatch[1].trim() };

  const candidates = parseGuardianCandidates(childBody);
  const attempts: Array<Record<string, unknown>> = [];
  let guardian = candidates[0]?.name ?? '';
  let phone = '';

  for (const c of candidates) {
    if (!c.id) {
      attempts.push({ ...c, note: 'no id on this family_member' });
      continue;
    }
    try {
      const body = await fetchProfileXml(base, c.id);
      const found = parseOwnPhone(body);
      attempts.push({ ...c, phoneFound: found || null });
      if (found && !phone) {
        guardian = c.name;
        phone = found;
      }
    } catch (err) {
      attempts.push({ ...c, error: String((err as Error)?.message ?? err) });
    }
  }

  return { childId, candidates, attempts, finalResult: { guardian, phone } };
}

/**
 * Temporary discovery probe: tries the hypothesized event_profiles (plural)
 * LIST service, to see whether CCB can report every Children's Ministry
 * event and its grouping/room/recurrence without every id being known and
 * hard-coded in rooms.json first. Strictly read-only (a GET listing call);
 * never anything that could send a notification or message through CCB.
 *
 * We do not yet know the real element/attribute names CCB uses for
 * grouping, room, or recurrence, so this deliberately does NOT guess at
 * them in code -- it returns the full raw parsed shape for two known
 * reference events (103 Nursery, 158 Bible Study Kids) plus every event's
 * raw fields, so the actual tag names are read directly off CCB's own
 * response, not assumed.
 *
 * `extraParams` is forwarded straight through to the CCB call untouched
 * (e.g. modified_since, page, per_page), since it is not yet known whether
 * this service requires any filter/paging params -- if it does, CCB's own
 * error will name it, the same way individual_id and occurrence were found.
 */
export async function diagnoseEventProfiles(
  extraParams: Record<string, string>,
): Promise<Record<string, unknown>> {
  const base = apiBase();
  if (!base) return { configured: false };

  const qs = new URLSearchParams({ srv: 'event_profiles', ...extraParams });
  const url = `${base.url}?${qs.toString()}`;

  let body: string;
  let status: number;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Basic ${base.auth}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(CCB_TIMEOUT_MS),
    });
    status = res.status;
    body = await res.text();
  } catch (err) {
    return { url, status: 0, error: String((err as Error)?.message ?? err) };
  }

  const errorMatch = body.match(/<error\b[^>]*>([^<]*)<\/error>/i);
  if (errorMatch) {
    return { url, status, ccbError: errorMatch[1].trim(), rawSnippet: body.slice(0, 4000) };
  }

  let parsed: any;
  try {
    parsed = parser.parse(body);
  } catch {
    return { url, status, note: 'XML did not parse', rawSnippet: body.slice(0, 4000) };
  }

  const response = parsed?.ccb_api?.response;
  if (!response) {
    return {
      url,
      status,
      note: 'No <response> element (possibly a <messages> reply, or a different wrapper entirely)',
      topLevelKeys: parsed?.ccb_api ? Object.keys(parsed.ccb_api) : [],
      rawSnippet: body.slice(0, 6000),
    };
  }

  // We do not know the real wrapper/list element names yet, so try every
  // plausible shape rather than assuming "events.event" like the singular
  // event_profile call uses.
  const container = response.events ?? response.event_profiles ?? response;
  const rawList = container?.event ?? container?.event_profile ?? container;
  const events = toArray<any>(rawList);

  const idOf = (e: any): string => String(e?.['@_id'] ?? e?.id ?? '');
  const ANCHOR_IDS = ['103', '158'];
  const anchors = events.filter((e) => ANCHOR_IDS.includes(idOf(e)));
  const compact = events.slice(0, 60).map((e) => ({ id: idOf(e), name: nodeText(e?.name), raw: e }));

  return {
    url,
    status,
    responseTopLevelKeys: Object.keys(response),
    totalEventsFound: events.length,
    anchors, // full raw shape for events 103 and 158, wherever they fall
    compact, // id, name, and full raw fields for the first 60 events found
    rawSnippet: body.slice(0, 8000),
  };
}

// A child's guardian rarely changes, so cache lookups for hours. Each child is
// then looked up at most once per service, keeping API load tiny.
const GUARDIAN_TTL_MS = 6 * 60 * 60 * 1000;
const guardianCache = new Map<string, { at: number; data: Guardian | null }>();

export async function fetchGuardian(childId: string): Promise<Guardian | null> {
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
// Fail fast rather than hang the serverless function if ChMS is slow.
const CCB_TIMEOUT_MS = 10000;
// Cap the number of cached room/occurrence entries so a long-lived warm
// instance cannot grow the map without bound.
const CACHE_MAX = 500;
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

async function getSingleRoster(eventId: string, occ: string, explicit: boolean): Promise<RosterResult> {
  // Preview without ChMS. Off unless DEMO_MODE=true.
  if (process.env.DEMO_MODE === 'true') {
    return demoRoster(eventId, occ);
  }

  // A caller-specified occurrence (a diagnostic, or a deliberate past-date
  // lookup) is used exactly as given. Otherwise today's plain date is only a
  // guess, so also ask CCB what occurrence(s) it actually has scheduled for
  // today, in case this event's meeting -- the normal one, or an ad hoc one
  // set up to test on a non-Sunday -- is keyed with a specific time.
  const occs = explicit ? [occ] : await occurrencesForToday(eventId, occ.slice(0, 10));

  const key = `${eventId}_${occs.join('|')}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return { ...hit.data, cached: true };
  }

  const fetched = await Promise.all(occs.map((o) => fetchRoster(eventId, o)));
  const oks = fetched.filter((r): r is RosterOk => !isError(r));
  if (!oks.length) {
    return (fetched.find((r) => isError(r)) as RosterError) ?? { error: 'ChMS returned an error.' };
  }
  const data = oks.length === 1 ? oks[0] : mergeRosters(oks, occ);

  await enrichWithGuardians(data);
  // Guard against unbounded growth in a long-lived warm instance.
  if (cache.size > CACHE_MAX) cache.clear();
  cache.set(key, { at: Date.now(), data });
  return data;
}

/**
 * Merge several event rosters into one combined room, deduping children who
 * appear in more than one and sorting by name.
 */
export function mergeRosters(rosters: RosterOk[], occurrence: string): RosterOk {
  const seen = new Set<string>();
  const checkedIn: Attendee[] = [];
  for (const r of rosters) {
    for (const a of r.checkedIn) {
      const key = a.id || a.name;
      if (seen.has(key)) continue;
      seen.add(key);
      checkedIn.push(a);
    }
  }
  checkedIn.sort((x, y) => x.name.localeCompare(y.name));
  return {
    room: '',
    occurrence,
    updated: new Date().toISOString(),
    count: checkedIn.length,
    checkedIn,
  };
}

/**
 * Roster for one room. `roomParam` is a single event id, or several joined by
 * commas for a combined room, in which case their check-ins are merged.
 */
export async function getRoster(roomParam: string, occurrence?: string): Promise<RosterResult> {
  const explicit = isValidOccurrence(String(occurrence ?? '').trim());
  const occ = normalizeOccurrence(occurrence);
  const ids = String(roomParam)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (ids.length <= 1) {
    return getSingleRoster(ids[0] ?? String(roomParam), occ, explicit);
  }

  const results = await Promise.all(ids.map((id) => getSingleRoster(id, occ, explicit)));
  const oks = results.filter((r): r is RosterOk => !isError(r));
  if (!oks.length) {
    // Every combined event errored (e.g. bad credentials); surface the first.
    return (results.find((r) => isError(r)) as RosterError) ?? { error: 'ChMS returned an error.' };
  }
  return mergeRosters(oks, occ);
}
