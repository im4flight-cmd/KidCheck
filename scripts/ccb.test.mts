/**
 * Tests for the ChMS parsing logic. Run with: npm test
 * Uses Node's built-in test runner with type stripping (Node 22.18+).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAttendance,
  parseGuardianCandidates,
  parseOwnPhone,
  formatName,
  formatPhone,
  isValidOccurrence,
  normalizeOccurrence,
  isError,
  fetchRoster,
  getRoster,
  mergeRosters,
  roomMeetsOnWeekday,
  currentChurchWeekday,
  diagnoseEventProfiles,
  discoverChildrensMinistryRooms,
  evaluateDiscoveredEvent,
  recurrenceKind,
  recurrenceUntilDate,
} from '../lib/ccb.ts';
import { toE164 } from '../lib/phone.ts';

const xml = (body: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><ccb_api><response>${body}</response></ccb_api>`;

test('parses a normal roster: sorted, deduped, last-initial', () => {
  const body = xml(`
    <events count="1"><event id="101">
      <name>Nursery</name>
      <occurrence>2026-09-07 00:00:00</occurrence>
      <attendees>
        <attendee id="3"><first_name>zoe</first_name><last_name>adams</last_name></attendee>
        <attendee id="1"><first_name>Ben</first_name><last_name>Bolton</last_name></attendee>
        <attendee id="3"><first_name>zoe</first_name><last_name>adams</last_name></attendee>
        <attendee id="2"><first_name>Max</first_name><last_name></last_name></attendee>
      </attendees>
    </event></events>`);
  const r = parseAttendance(body, '2026-09-07');
  assert.ok(!isError(r));
  if (isError(r)) return;
  assert.equal(r.room, 'Nursery');
  assert.equal(r.count, 3); // duplicate id 3 collapsed
  assert.deepEqual(
    r.checkedIn.map((a) => a.name),
    ['Ben B.', 'Max', 'Zoe A.'],
  );
});

test('surfaces a ChMS error message', () => {
  const r = parseAttendance(xml('<errors><error>Invalid credentials.</error></errors>'), '2026-09-07');
  assert.ok(isError(r));
  if (isError(r)) assert.match(r.error, /Invalid credentials/);
});

test('surfaces a ChMS error that carries attributes, never "[object Object]"', () => {
  const r = parseAttendance(
    xml('<errors><error type="attendance_profile">The service is not enabled for this API user.</error></errors>'),
    '2026-09-07',
  );
  assert.ok(isError(r));
  if (isError(r)) {
    assert.doesNotMatch(r.error, /\[object Object\]/);
    assert.match(r.error, /not enabled/);
  }
});

test('surfaces a ChMS error given as a nested <message> element', () => {
  const r = parseAttendance(
    xml('<errors><error><type>1</type><message>Invalid password.</message></error></errors>'),
    '2026-09-07',
  );
  assert.ok(isError(r));
  if (isError(r)) {
    assert.doesNotMatch(r.error, /\[object Object\]/);
    assert.match(r.error, /Invalid password/);
  }
});

test('empty room (no event) returns zero, not an error', () => {
  const r = parseAttendance(xml('<events count="0"></events>'), '2026-09-07');
  assert.ok(!isError(r));
  if (!isError(r)) assert.equal(r.count, 0);
});

test('a "no attendance records" message is an empty room, not an error', () => {
  // ChMS returns this shape (no <response>, a <messages> note) when nobody is
  // checked into the event/occurrence yet.
  const body = `<?xml version="1.0" encoding="UTF-8"?><ccb_api>
    <request><parameters></parameters></request>
    <messages count="1"><message>There are no attendance records for the event id:103 and occurrence:2026-09-03.</message></messages>
  </ccb_api>`;
  const r = parseAttendance(body, '2026-09-03');
  assert.ok(!isError(r));
  if (!isError(r)) assert.equal(r.count, 0);
});

test('handles a single attendee that is not an array', () => {
  const body = xml(`<events><event id="5"><name>Preschool</name>
    <attendees><attendee id="9"><first_name>Sam</first_name><last_name>Ng</last_name></attendee></attendees>
    </event></events>`);
  const r = parseAttendance(body, '2026-09-07');
  assert.ok(!isError(r));
  if (!isError(r)) assert.deepEqual(r.checkedIn.map((a) => a.name), ['Sam N.']);
});

test('preserves accented, punctuated, and ampersand names', () => {
  const body = xml(`<events><event id="5"><name>K</name><attendees>
    <attendee id="9"><first_name>Se&#225;n</first_name><last_name>O'Brien</last_name></attendee>
    <attendee id="10"><first_name>A&amp;J</first_name><last_name>Twins</last_name></attendee>
    </attendees></event></events>`);
  const r = parseAttendance(body, '2026-09-07');
  assert.ok(!isError(r));
  if (!isError(r)) {
    assert.deepEqual(
      r.checkedIn.map((a) => a.name).sort(),
      ['A&J T.', 'Seán O.'].sort(),
    );
  }
});

test('garbage input is a clean error, not a crash', () => {
  const r = parseAttendance('not xml at all <<<', '2026-09-07');
  assert.ok(isError(r));
});

test('mergeRosters combines events, dedupes shared children, sorts by name', () => {
  const roomA = {
    room: '', occurrence: '2026-09-07', updated: '', count: 2,
    checkedIn: [{ id: '1', name: 'Zoe A.' }, { id: '2', name: 'Ben B.' }],
  };
  const roomB = {
    room: '', occurrence: '2026-09-07', updated: '', count: 2,
    checkedIn: [{ id: '2', name: 'Ben B.' }, { id: '3', name: 'Max C.' }],
  };
  const merged = mergeRosters([roomA, roomB], '2026-09-07');
  assert.equal(merged.count, 3); // id "2" is in both events, counted once
  assert.deepEqual(merged.checkedIn.map((a) => a.name), ['Ben B.', 'Max C.', 'Zoe A.']);
});

test('formatName basics', () => {
  assert.equal(formatName('ben', 'bolton'), 'Ben B.');
  assert.equal(formatName('Ann', ''), 'Ann');
  assert.equal(formatName('  jo  ', ' king '), 'Jo K.');
});

test('occurrence validation and normalization', () => {
  assert.equal(isValidOccurrence('2026-09-07'), true);
  assert.equal(isValidOccurrence('2026-09-07 09:00:00'), true);
  assert.equal(isValidOccurrence('tomorrow'), false);
  assert.equal(normalizeOccurrence('2026-09-07'), '2026-09-07');
  assert.match(normalizeOccurrence('junk'), /^\d{4}-\d{2}-\d{2}$/);
});

test('formatPhone normalizes US numbers, leaves oddities alone', () => {
  assert.equal(formatPhone('2105550142'), '(210) 555-0142');
  assert.equal(formatPhone('12105550142'), '(210) 555-0142');
  assert.equal(formatPhone('210-555-0142'), '(210) 555-0142');
  assert.equal(formatPhone('ext 5'), 'ext 5');
});

// Real confirmed shape: a child's own profile never carries a phone (minors
// have none), and a family member's name is the TEXT of its <individual> tag
// as one combined string ("Sarah Bolton"), with that tag's id attribute
// being their own individual_id -- not separate first_name/last_name fields.
// So this is a two-step lookup: candidates come from the CHILD's profile,
// and the phone comes from whichever adult's OWN profile.
test('parseGuardianCandidates orders primary contact, then spouse, then others', () => {
  const childBody = `<?xml version="1.0"?><ccb_api><response><individuals count="1"><individual id="122">
    <phones><phone type="mobile"></phone></phones>
    <family_members>
      <family_member><individual id="121">Mark Bolton</individual><family_position>Spouse</family_position></family_member>
      <family_member><individual id="120">Sarah Bolton</individual><family_position>Primary Contact</family_position></family_member>
      <family_member><individual id="122">Ben Bolton</individual><family_position>Child</family_position></family_member>
    </family_members>
  </individual></individuals></response></ccb_api>`;
  const candidates = parseGuardianCandidates(childBody);
  assert.deepEqual(
    candidates.map((c) => [c.id, c.name]),
    [
      ['120', 'Sarah B.'], // primary contact first, regardless of document order
      ['121', 'Mark B.'],
    ],
  );
});

test('parseGuardianCandidates handles a multi-word last name', () => {
  const childBody = `<ccb_api><response><individuals count="1"><individual id="661">
    <family_members>
      <family_member><individual id="659">Wayne Aaland IV</individual><family_position>Primary Contact</family_position></family_member>
    </family_members>
  </individual></individuals></response></ccb_api>`;
  const candidates = parseGuardianCandidates(childBody);
  assert.deepEqual(candidates, [{ id: '659', name: 'Wayne A.' }]);
});

test('parseOwnPhone reads an adult\'s own profile, mobile preferred over home', () => {
  const adultBody = `<ccb_api><response><individuals count="1"><individual id="120">
    <phones>
      <phone type="home">210-555-0101</phone>
      <phone type="mobile">2105550142</phone>
    </phones>
  </individual></individuals></response></ccb_api>`;
  assert.equal(parseOwnPhone(adultBody), '(210) 555-0142');
});

test('parseOwnPhone is blank on a child\'s own (phone-less) profile', () => {
  const childBody = `<ccb_api><response><individuals count="1"><individual id="661">
    <phones><phone type="mobile"></phone><phone type="home"></phone></phones>
  </individual></individuals></response></ccb_api>`;
  assert.equal(parseOwnPhone(childBody), '');
});

test('parseGuardianCandidates is empty with no family_members', () => {
  const body = `<ccb_api><response><individuals count="1"><individual id="9">
    <first_name>Sam</first_name><last_name>Ng</last_name></individual></individuals></response></ccb_api>`;
  assert.deepEqual(parseGuardianCandidates(body), []);
});

test('fetchRoster reports a not_configured code when credentials are missing', async () => {
  delete process.env.CCB_SUBDOMAIN;
  delete process.env.CCB_API_USER;
  delete process.env.CCB_API_PASS;
  const r = await fetchRoster('101', '2026-09-07');
  assert.ok(isError(r));
  if (isError(r)) {
    assert.equal(r.code, 'not_configured');
    assert.match(r.error, /CCB_SUBDOMAIN/);
  }
});

test('getRoster reports a not_configured error when credentials are missing (single room)', async () => {
  delete process.env.CCB_SUBDOMAIN;
  delete process.env.CCB_API_USER;
  delete process.env.CCB_API_PASS;
  const r = await getRoster('101');
  assert.ok(isError(r));
  if (isError(r)) assert.equal(r.code, 'not_configured');
});

test('getRoster reports an error when credentials are missing (combined room)', async () => {
  delete process.env.CCB_SUBDOMAIN;
  delete process.env.CCB_API_USER;
  delete process.env.CCB_API_PASS;
  const r = await getRoster('101,102,103');
  assert.ok(isError(r));
});

test('getRoster respects an explicit occurrence without guessing today', async () => {
  delete process.env.CCB_SUBDOMAIN;
  delete process.env.CCB_API_USER;
  delete process.env.CCB_API_PASS;
  const r = await getRoster('101', '2026-01-04');
  assert.ok(isError(r));
  if (isError(r)) assert.equal(r.code, 'not_configured');
});

test('roomMeetsOnWeekday fails open (shown) when CCB is not configured', async () => {
  delete process.env.CCB_SUBDOMAIN;
  delete process.env.CCB_API_USER;
  delete process.env.CCB_API_PASS;
  assert.equal(await roomMeetsOnWeekday(['103'], 0), true);
  assert.equal(await roomMeetsOnWeekday(['125', '114', '115'], 5), true);
});

test('currentChurchWeekday returns a weekday number', () => {
  const wd = currentChurchWeekday();
  assert.ok(Number.isInteger(wd) && wd >= 0 && wd <= 6);
});

test('diagnoseEventProfiles reports not configured without CCB creds', async () => {
  delete process.env.CCB_SUBDOMAIN;
  delete process.env.CCB_API_USER;
  delete process.env.CCB_API_PASS;
  const r = await diagnoseEventProfiles({});
  assert.deepEqual(r, { configured: false });
});

// Unlike roomMeetsOnWeekday (which fails OPEN, showing a room it can't
// verify, since an admin already vouched for it in rooms.json), discovery
// fails CLOSED: nothing is added when CCB cannot be reached at all, since an
// unverified discovered event is itself a bad outcome, not a safe default.
test('discoverChildrensMinistryRooms finds nothing when CCB is not configured', async () => {
  delete process.env.CCB_SUBDOMAIN;
  delete process.env.CCB_API_USER;
  delete process.env.CCB_API_PASS;
  const found = await discoverChildrensMinistryRooms('2026-09-25', new Set(['158']));
  assert.deepEqual(found, []);
});

test('recurrenceKind classifies CCB\'s own confirmed wordings', () => {
  assert.equal(recurrenceKind('Every week on Friday from 8:30am to 11:00am'), 'weekly');
  assert.equal(recurrenceKind('Every week on Sunday from 10:00am to 12:00pm'), 'weekly');
  assert.equal(recurrenceKind('Every day until Mar 10, 2026 from 6:00pm to 8:00pm'), 'daily');
  assert.equal(recurrenceKind(''), 'none');
  assert.equal(recurrenceKind('One time event on April 26, 2026 from 12:00pm to 1:00pm'), 'none');
});

test('recurrenceUntilDate reads the "until <date>" clause, and is absent without one', () => {
  assert.equal(recurrenceUntilDate('Every day until Mar 10, 2026 from 6:00pm to 8:00pm'), '2026-03-10');
  assert.equal(recurrenceUntilDate('Every week on Friday from 8:30am to 11:00am'), undefined);
  assert.equal(recurrenceUntilDate(''), undefined);
});

// Reproduces the live bug found 2026-09-23: CCB's start_date is a
// VARIABLE-length human string ("Mar 8, 2026", "Apr 26, 2026"), not a fixed
// 10-character ISO date. Slicing it to 10 characters truncated it into
// garbage ("Mar 8, 202"), which failed validation and reported "no usable
// start_date" for every single discovered event. start_datetime
// ("2026-03-08 18:30:00") is fixed-width and used first; start_date is only
// a parsed-in-full fallback.
test('a human-readable start_date ("Mar 8, 2026" style) is parsed correctly, not truncated', () => {
  const noDatetimeAtAll = evaluateDiscoveredEvent(
    {
      '@_id': '132',
      name: 'Lunch with the Pastors',
      start_date: 'Apr 26, 2026', // CCB's real format -- 12 characters, not 10
      recurrence_description: 'One time event on April 26, 2026 from 12:00pm to 1:00pm',
      event_grouping: { '#text': "Children's Ministry", '@_id': '6' },
    },
    '2026-04-26',
    new Set(),
    '6',
  );
  assert.equal(noDatetimeAtAll.startDate, '2026-04-26');
  assert.equal(noDatetimeAtAll.eligible, true);

  // start_datetime, when present, is preferred over parsing start_date.
  const withDatetime = evaluateDiscoveredEvent(
    {
      '@_id': '132',
      name: 'Lunch with the Pastors',
      start_datetime: '2026-04-26 12:00:00',
      start_date: 'Apr 26, 2026',
      recurrence_description: 'One time event on April 26, 2026 from 12:00pm to 1:00pm',
      event_grouping: { '#text': "Children's Ministry", '@_id': '6' },
    },
    '2026-09-23',
    new Set(),
    '6',
  );
  assert.equal(withDatetime.startDate, '2026-04-26');
  assert.equal(withDatetime.eligible, false); // correctly excluded five months later
  assert.doesNotMatch(withDatetime.reason, /no usable start_date/);
});

// Event 90 "Prophetic Ministry Night", confirmed live: "Every day until Mar
// 10, 2026 ..." -- a DAILY recurrence (any weekday) with an explicit end
// bound. It must show within its range, and never again once that range has
// passed, however long ago.
test('a daily recurring event with an "until" date stops being eligible after it', () => {
  const propheticMinistryNight = {
    '@_id': '90',
    name: 'Prophetic Ministry Night',
    start_date: 'Feb 10, 2026',
    recurrence_description: 'Every day until Mar 10, 2026 from 6:00pm to 8:00pm',
    event_grouping: { '#text': "Children's Ministry", '@_id': '6' },
  };

  // Within range, on a weekday that is not its start weekday -- daily means
  // any day counts, unlike weekly.
  const withinRange = evaluateDiscoveredEvent(propheticMinistryNight, '2026-03-04', new Set(), '6');
  assert.equal(withinRange.eligible, true);

  // Wayne's actual test date, many months after the series ended.
  const longAfterItEnded = evaluateDiscoveredEvent(propheticMinistryNight, '2026-09-25', new Set(), '6');
  assert.equal(longAfterItEnded.eligible, false);
  assert.match(longAfterItEnded.reason, /ended 2026-03-10/);

  // Before it even started.
  const beforeItStarted = evaluateDiscoveredEvent(propheticMinistryNight, '2026-01-01', new Set(), '6');
  assert.equal(beforeItStarted.eligible, false);
  assert.match(beforeItStarted.reason, /has not started yet/);
});

// Reproduces the live bug found 2026-09-23: "Lunch with the Pastors" (events
// 132/138), a one-time Children's Ministry event on Sun 2026-04-26, showed
// up on Wed 2026-09-23 -- five months later, on an entirely different
// weekday. Root cause: the old check swept every date-shaped string out of
// the event's raw XML (created/modified timestamps and the like), not just
// its real occurrence, so an unrelated date happening to fall on a
// Wednesday made it match. evaluateDiscoveredEvent uses only the event's
// own structured start_date and recurrence_description instead.
test('a one-time event only matches its own exact start date, never by weekday', () => {
  const lunchWithPastors = {
    '@_id': '132',
    name: 'Lunch with the Pastors',
    start_date: '2026-04-26', // a Sunday
    recurrence_description: 'One time event on April 26, 2026 from 12:00pm to 1:00pm',
    event_grouping: { '#text': "Children's Ministry", '@_id': '6' },
  };

  // The exact reported failure: five months later, a Wednesday.
  const onReportedDate = evaluateDiscoveredEvent(lunchWithPastors, '2026-09-23', new Set(), '6');
  assert.equal(onReportedDate.eligible, false);

  // Not even a LATER Sunday should match -- weekday alone is not enough for
  // a one-time event, only its own exact date counts.
  const onLaterSunday = evaluateDiscoveredEvent(lunchWithPastors, '2026-09-27', new Set(), '6');
  assert.equal(onLaterSunday.eligible, false);

  // Its own actual date does match.
  const onItsOwnDate = evaluateDiscoveredEvent(lunchWithPastors, '2026-04-26', new Set(), '6');
  assert.equal(onItsOwnDate.eligible, true);
});

test('a weekly recurring event matches every occurrence of its weekday, not just its start date', () => {
  const bibleStudyKids = {
    '@_id': '158',
    name: 'Friday Women\'s Bible Study Kid Check',
    start_date: '2026-09-04', // a Friday, 3 weeks before the target dates below
    recurrence_description: 'Every week on Friday from 8:30am to 11:00am',
    event_grouping: { '#text': "Children's Ministry", '@_id': '6' },
  };

  // A later Friday (not the start date itself) still matches.
  const laterFriday = evaluateDiscoveredEvent(bibleStudyKids, '2026-09-25', new Set(), '6');
  assert.equal(laterFriday.eligible, true);

  // A Wednesday does not (this is Wayne's exact reported day).
  const wednesday = evaluateDiscoveredEvent(bibleStudyKids, '2026-09-23', new Set(), '6');
  assert.equal(wednesday.eligible, false);

  // Before its own start date, even on the right weekday, it has not begun.
  const notStartedYet = evaluateDiscoveredEvent(
    { ...bibleStudyKids, start_date: '2026-10-02' },
    '2026-09-25',
    new Set(),
    '6',
  );
  assert.equal(notStartedYet.eligible, false);
  assert.match(notStartedYet.reason, /has not started yet/);
});

test('evaluateDiscoveredEvent excludes rooms.json ids and the wrong grouping', () => {
  const e = {
    '@_id': '158',
    name: 'Friday Women\'s Bible Study Kid Check',
    start_date: '2026-09-04',
    recurrence_description: 'Every week on Friday from 8:30am to 11:00am',
    event_grouping: { '#text': "Children's Ministry", '@_id': '6' },
  };
  const alreadyTracked = evaluateDiscoveredEvent(e, '2026-09-25', new Set(['158']), '6');
  assert.equal(alreadyTracked.eligible, false);
  assert.equal(alreadyTracked.excluded, true);

  const wrongGrouping = evaluateDiscoveredEvent(e, '2026-09-25', new Set(), '99');
  assert.equal(wrongGrouping.eligible, false);
});

test('toE164 normalizes US numbers and passes international through', () => {
  assert.equal(toE164('(210) 555-0142'), '+12105550142');
  assert.equal(toE164('2105550142'), '+12105550142');
  assert.equal(toE164('1-210-555-0142'), '+12105550142');
  assert.equal(toE164('+44 20 7946 0958'), '+442079460958');
  assert.equal(toE164(''), '');
});
