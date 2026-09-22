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
- Nursery [103]
- 3-5 Year Olds [125,114,115]
- K-1st Grade [116,117]
- 2nd-4th Grade [118,112,119]
- 5th-6th Grade [120,121]
Room URL param is the ids comma-joined (e.g. `118,112,119`); the browser
%2C-encodes the comma and the route decodes it. Edit rooms here, not in Vercel.

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
  Occurrence defaults to today in America/Chicago.
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
  refresh 20s, "Text parent" button, "Rooms" back link, auto-reload on deploy).
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

## Open question: Women's Bible Study childcare (asked 2026-09-22)
Wayne runs childcare Friday mornings and Monday nights for Women's Bible
Study and wants the display to show those too. Unresolved because I have no
CCB access from this sandbox (never have — every fact here has always come
from Wayne pasting back a live URL's JSON, there is no way around this):
- **Ruled out**: room 103 (Nursery). `?room=103&debug=1&days=15` on
  2026-09-22 showed zero records on both checked Fridays (9/11, 9/18) and
  both checked Mondays (9/14, 9/21) — only the two Sundays had records (9 and
  13). So Bible study childcare is not filed under the Sunday nursery event.
- Wayne confirmed (2026-09-22): Women's Bible Study childcare uses
  **"Classroom 4"**, a physical room name in ChMS. Unknown whether that maps
  to a CCB event id already in `rooms.json` (physical rooms and named age
  group events don't necessarily correspond 1:1) or a distinct event with its
  own id.
- **Still needed from Wayne**: open ChMS's check-in screen for a Friday or
  Monday Bible study session and get the event id "Classroom 4" is tied to
  from the URL, the same way the other room ids were originally found. If
  it's a new id, add it to `rooms.json` with a name (e.g. "Women's Bible
  Study") — a couple minutes of work once the id is known.
- Also confirmed: Wayne's 2026-09-22 test check-in was not scheduled to any
  tracked classroom at all (same root cause as the earlier "Mikes Test
  event" incident) — not a bug, nothing to fix for that specific case.
- If a real event id turns up, it just needs adding to `rooms.json` with a
  name; the 2026-09-22 occurrence-resolution fix (event_profile-backed, see
  above) should then make same-day check-ins show up with no further change.
- Do not guess or invent a CCB "list all events" service; none has been
  confirmed to exist in this project. If a listing service turns out to be
  needed, it requires either real API docs or a live trial against Wayne's
  account, not speculation.

## Coordination
User switches between separate Claude accounts to save tokens, never two at
once. Always push so the next account is current. Be concise to stretch tokens.
