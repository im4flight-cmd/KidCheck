# KidCheck, project handoff for Claude

Read this first. It exists so any Claude session (the user works across several
accounts to stretch tokens, one at a time) can pick up without the user
re-explaining. Keep it updated when state changes.

## What this is
A live per-classroom children's check-in display for Country Faith Church (CFC),
reading Pushpay ChMS (Church Community Builder / CCB) API v1. Next.js app on
Vercel. Live at **kid-check-ashen.vercel.app**.

## Deploy / repo
- **Push to `main` = auto-deploy** on Vercel (project "kid-check", org AalandInc,
  Hobby/free plan). `main` is the production branch. Also mirror pushes to the
  feature branch `claude/classroom-roster-live-display-mr3t4v`.
- Verify locally before pushing: `npm run build` and `npm test` (Node's test
  runner via type-stripping; needs Node 22.18+).
- This sandbox CANNOT reach CCB, Clearstream, or the vercel.app site (egress is
  firewalled). So live verification is always the user's to do; build/tests/
  screenshots are ours.

## Env vars (set in Vercel → Production)
- `CCB_SUBDOMAIN`, `CCB_API_USER`, `CCB_API_PASS` — CCB API user (set).
- `PARENT_CONTACT_MODE` — full (default) | name | off. Shows parent contact.
- Paging (set): `PAGING_ENABLED=true`, `CLEARSTREAM_API_KEY`. No in-app PIN;
  the iPad's own Guided Access passcode plus a confirm tap is the gate (Wayne's
  call). Optional: `PAGING_TEST`, `PAGE_SENDER`, `PAGE_MESSAGE`.
- `DEMO_MODE` and `ROOMS` were REMOVED so `rooms.json` is the source of truth
  and real check-ins show. Do not re-add unless previewing.
- Never commit secret values; env var NAMES only.

## Rooms (rooms.json, committed = source of truth)
Schema is combined: `{ "ids": ["..."], "name": "..." }`. One display merges
several ChMS events. Current:
- Nursery [103] — Sundays
- 3-5 Year Olds [125,114,115] — Sundays
- K-1st Grade [116,117] — Sundays
- 2nd-4th Grade [118,112,119] — Sundays
- 5th-6th Grade [120,121] — Sundays
- Bible Study Kids [158] — Fridays 8:30-11am, physical room "Classroom 2" in
  ChMS, grouping "Children's Ministry". Added 2026-09-23. Event id 156 was
  its one-off predecessor (2026-09-11 only, superseded by 158) — not tracked,
  since it will never have another occurrence. No Monday event exists yet
  (Wayne checked; Women's Bible Study meets Friday and Monday, but only
  Friday has childcare check-in set up in CCB so far).
Room URL param is the ids comma-joined (e.g. `118,112,119`); the browser
%2C-encodes the comma and the route decodes it. Edit rooms here, not in Vercel.
The room PICKER (`/`) only shows a room if its event has a meeting scheduled
on today's weekday (see `roomMeetsOnWeekday` below) — `/?all=1` always shows
every configured room regardless, as a manual override.

## How it works (key files)
- `lib/ccb.ts` — CCB client. `attendance_profile` per event id (merged for
  combined rooms). The occurrence for "today" is not just guessed as a bare
  date: `event_profile` is asked what occurrence(s) actually exist for today
  (cached ~3 min) and every one found is queried and merged, so an ad hoc
  occurrence added to test on a non-Sunday (CCB may key it with a specific
  time) shows up too, not just the normal weekly meeting. The bare-date guess
  is always included in the set, so this only ever adds coverage. An explicit
  `?occurrence=` (diagnostics, a deliberate past-date lookup) bypasses this
  and is used exactly as given. Guardian contact is a TWO-STEP lookup via
  `individual_profile_from_id` (param is `individual_id`, not `id`): fetch the
  child's profile for `family_members` (each is
  `<individual id="X">Full Name</individual>`, one combined name, not
  first_name/last_name), then fetch THAT adult's own profile for their phone
  (a child's own `<phones>` is always empty). Falls back Primary Contact →
  Spouse → other if the first has no phone on file. Cached ~6h per child.
  Occurrence defaults to today in America/Chicago. `roomMeetsOnWeekday(ids,
  weekday)` (added 2026-09-23) shares the same event_profile cache: does any
  id's event_profile list an occurrence on that weekday? Fails OPEN (true,
  shown) when event_profile can't be read for ANY of the room's ids — hiding
  a room a teacher needs is worse than showing one extra. `currentChurchWeekday()`
  gives today's weekday (0=Sun) in America/Chicago, not the server's UTC day.
  Deliberately NOT implemented: auto-discovering a Children's Ministry event
  not yet in rooms.json. No CCB "list/search events" service has been
  confirmed to exist in this project; guessing at one risks the same kind of
  wrong-field-name churn the Clearstream integration went through. Adding a
  newly created recurring class/program stays a manual `rooms.json` edit.
- `lib/rooms.ts` — room config (ids arrays). `lib/paging.ts` — Clearstream send
  (`api.getclearstream.com/v1/messages`, X-Api-Key, form fields
  `message_header`, `message_body`, `subscribers[]` — plural array, NOT
  `to`/`subscriber`/`contacts`; the alternative to `subscribers` is `lists`,
  unused here), confirm-tap gated (no PIN), dry-run until key present.
  `lib/phone.ts` — E.164.
- `app/api/roster/route.ts` — GET roster JSON. Temporary diagnostics:
  `?debug=1` (date scan, weekday-labeled, `&days=<n>` up to 31, default 8),
  `?debug=2` (event_profile occurrence dump, needs that service permission),
  `?debug=3` (attendance_profile with no occurrence), `?debugGuardian=
  <individual id>` (runs the real two-step guardian lookup, reports every
  attempt).
  `app/api/page/route.ts` — POST paging.
- `app/room/[room]/page.tsx`, `components/RoomBoard.tsx` — the display (auto
  refresh 20s, "Text parent" button, "Rooms" back link, auto-reload on deploy,
  a date picker in the footer to look up a different day — picking one pauses
  polling and hides paging, "Back to today" restores live mode).
- `app/page.tsx` room picker, `app/error.tsx` boundary, `app/globals.css`
  (CFC navy/gold, Lato/Lora fonts). `reference/apps-script/` is the old prototype.

## Known behavior, not bugs
- As of 2026-09-22, an occurrence CCB actually has scheduled for today (any
  time of day, not just a bare midnight date) is queried automatically, so
  testing a check-in on a non-Sunday works as long as it was added as a real
  occurrence on one of the tracked event ids (see rooms.json). If a same-day
  test check-in still doesn't show, the likely cause reverts to the earlier
  known failure mode: it was checked into a DIFFERENT, disconnected ChMS
  event/object entirely, not one of the ids this app tracks (this happened
  once before, a generic "Mikes Test event" with no Event Room, unrelated to
  any real classroom). Confirm which event id the check-in actually landed
  on with `?debugGuardian=` (for the child) or by checking ChMS's own
  Check-In Status Report, not by assuming the app is broken.
- CCB has no send-text API; UniFi Talk has none either; Clearstream is the sender.

## CCB API v1 gotchas (confirmed against the church's live account)
- Parameter is `id` for `attendance_profile` and `event_profile`, but
  `individual_id` for `individual_profile_from_id`. Not consistent, verify per
  service before assuming.
- Each API user has its own PER-SERVICE permission checklist (ChMS Settings >
  API). A service you haven't checked returns HTTP 200 with an error body
  (`Service Permission`, number 110), not a 401/403 — parse the XML, don't
  trust the status code alone.
- `family_member`'s name is `<individual id="X">Full Name</individual>`, one
  string with the id as an attribute. Not first_name/last_name fields (that
  was my first wrong guess).
- A child's own profile never has a phone (they're minors) — the parent's
  phone is only on THAT adult's own profile. Two fetches, not one.
- "No attendance records for event X occurrence Y" is CCB's way of saying an
  empty room, not an error — no `<response>`, just a top-level `<messages>`.
- The CCB Edit-API-user screen with the service checkboxes may not be
  reachable by clicking the user in Settings > API > Users; the direct URL
  pattern was `.../api_user_privileges.php?ax=edit&api_user_id=<n>`.

## Clearstream API gotchas
- Endpoint `POST https://api.getclearstream.com/v1/messages`, header
  `X-Api-Key`. It's list-based (built for texting a saved subscriber list), so
  a one-off send needs `subscribers[]` (array, one or more numbers) as the
  alternative to `lists` (array of saved list ids) — never `to`.
- Its 422 validation errors are structured JSON and name the exact field:
  `{"error":{"message":"...","fields":{"lists":["..."],"subscribers":["The
  subscribers field is required when lists is not present."]}}}`. Surface
  that text back to the caller (it holds no secret), it will tell you the fix
  directly rather than needing another guess.

## TODO / temporary
- The four `debug=`/`debugGuardian=` diagnostics in `app/api/roster/route.ts`
  are TEMPORARY. Remove them once Sunday's live check-in and a real page send
  are both confirmed working.
- Texting: last confirmed state is the `subscribers[]` fix (commit 39ce1d7),
  but Wayne has not yet confirmed a real text actually arrived on a phone.
  Pick this back up once he reports the result of trying "Text parent" again.

## Resolved: Women's Bible Study childcare (2026-09-22 → 2026-09-23)
Wayne found it himself in ChMS's browser UI (I have no CCB access to have
found it any other way): event id **158**, "Friday Women's Bible Study Kid
Check", Fridays 8:30-11am, room "Classroom 2", grouping "Children's
Ministry", 15 check-ins confirmed on 2026-09-18. Added as room "Bible Study
Kids" in `rooms.json`. Predecessor id 156 (one-off, 2026-09-11, superseded by
158) intentionally not tracked. No Monday event exists. Wayne's 2026-09-22
test check-in (event 159) was confirmed to have no room and grouping
"Regular Events" — same root cause as the earlier "Mikes Test event"
incident, not a bug.

On top of adding the room, the picker (`/`) now filters which rooms it shows
by today's weekday (`roomMeetsOnWeekday`, see above), so Sundays show the 5
age rooms and Fridays show Bible Study Kids automatically, without Wayne
having to know which rooms apply which day.

**Confirmed 2026-09-23 by Wayne**: `?room=158&debug=1&days=15` shows
2026-09-18 Fri with 15 records. Live and working.

## Resolved: auto-discovery of new Children's Ministry events (2026-09-23)
Wayne asked for the room list to include ANY Children's Ministry event
occurring that day automatically, not just ones already in `rooms.json`.
Done evidence-first: Step 1 (`GET /api/discover?debug=1`, still there,
harmless to keep) confirmed `srv=event_profiles` (plural) works with no
extra params. Confirmed live facts:
- Top-level `response` keys: `service, service_action, availability, events`.
  List is `response.events.event`, 106 total (a probe MUST read all of them,
  no cap -- an earlier 60-item cap in the diagnostic missed real ids and
  Wayne caught it).
- Per-event fields include: `name, start_datetime, recurrence_description,
  exceptions, group, location, event_grouping, ...` plus more.
  `event_grouping` is `{"#text":"Children's Ministry","@_id":"6"}` -- **match
  by the `@_id` "6", never the text** (`CHILDRENS_MINISTRY_GROUPING_ID` env
  var overrides it if the grouping is ever recreated with a new id).
  There is no room/location field usable for a physical room name (event
  158's `location` is just "Country Faith Church"); a discovered event's
  display name is its own `name` field, e.g. "Friday Women's Bible Study Kid
  Check", not a made-up room label.
- **Known, accepted residual**: some ADULT events share grouping id 6 too
  (childcare offered alongside them: Prophetic Ministry Night, Lunch with
  the Pastors, Financial Peace, Life Group Leaders Meeting, Lift Night). The
  day-occurrence check is the only guard (per Wayne's own instruction, not a
  name/keyword heuristic) -- if one of these coincides on the same day as a
  real kids class, both would show. Not fixed unless Wayne reports it as an
  actual problem.

Implementation (`lib/ccb.ts`): `discoverChildrensMinistryRooms(weekday,
excludeIds)` fetches the full list (cached 5 min, `fetchAllEventProfiles`),
filters to grouping id 6 minus anything already in rooms.json, then --
unlike `roomMeetsOnWeekday`'s fail-OPEN default for admin-configured rooms
-- fails CLOSED per candidate: an event whose own `event_profile` occurrence
can't be confirmed on the target weekday is left out, since adding an
unverified discovered event is itself a bad outcome, the opposite of hiding
a known-good room. `weekday: null` skips the day check entirely (used for
`/?all=1`). `app/page.tsx` appends discovered rooms after rooms.json's own
(which keep their friendly names and order).

## Coordination
User switches between separate Claude accounts to save tokens, never two at
once. Always push so the next account is current. Be concise to stretch tokens.
