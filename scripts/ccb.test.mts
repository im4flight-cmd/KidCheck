/**
 * Tests for the ChMS parsing logic. Run with: npm test
 * Uses Node's built-in test runner with type stripping (Node 22.18+).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAttendance,
  parseIndividualGuardian,
  formatName,
  formatPhone,
  isValidOccurrence,
  normalizeOccurrence,
  isError,
  fetchRoster,
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

test('parseIndividualGuardian picks the primary contact and best phone', () => {
  const body = `<?xml version="1.0"?><ccb_api><response><individuals count="1"><individual id="122">
    <first_name>Ben</first_name><last_name>Bolton</last_name>
    <phones>
      <phone type="home">210-555-0101</phone>
      <phone type="mobile">2105550142</phone>
    </phones>
    <family_members>
      <family_member id="120"><first_name>Sarah</first_name><last_name>Bolton</last_name><family_position>Primary Contact</family_position></family_member>
      <family_member id="121"><first_name>Mark</first_name><last_name>Bolton</last_name><family_position>Spouse</family_position></family_member>
      <family_member id="122"><first_name>Ben</first_name><last_name>Bolton</last_name><family_position>Child</family_position></family_member>
    </family_members>
  </individual></individuals></response></ccb_api>`;
  const g = parseIndividualGuardian(body);
  assert.ok(g);
  assert.equal(g!.guardian, 'Sarah B.'); // primary contact
  assert.equal(g!.phone, '(210) 555-0142'); // mobile preferred over home
});

test('parseIndividualGuardian returns null when nothing is usable', () => {
  const body = `<ccb_api><response><individuals count="1"><individual id="9">
    <first_name>Sam</first_name><last_name>Ng</last_name></individual></individuals></response></ccb_api>`;
  assert.equal(parseIndividualGuardian(body), null);
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

test('toE164 normalizes US numbers and passes international through', () => {
  assert.equal(toE164('(210) 555-0142'), '+12105550142');
  assert.equal(toE164('2105550142'), '+12105550142');
  assert.equal(toE164('1-210-555-0142'), '+12105550142');
  assert.equal(toE164('+44 20 7946 0958'), '+442079460958');
  assert.equal(toE164(''), '');
});
