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
on today's weekday (see `roomMeetsOnWeekday` below); unchanged since it was
first built, per Wayne's explicit 2026-09-23 instruction to leave the main
page exactly as-is. `/?all=1` is a SEPARATE, richer page (see below), not a
"same page, bypass the filter" toggle anymore.

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
  `discoverChildrensMinistryRooms(targetDate, excludeIds)` — the main
  picker's Children's Ministry (grouping id 6) discovery, unchanged, see the
  2026-09-23 sections below — and `discoverExtraRooms(excludeIds)` — the
  richer `?all=1`-only discovery covering every grouping, see the layout
  section below — both build on `evaluateDateEligibility` (grouping-agnostic
  start_date/recurrence_description logic) and `fetchAllEventProfiles`
  (cached 5 min list of all events).
- `lib/rooms.ts` — room config (ids arrays). `lib/paging.ts` — Clearstream send
  (`api.getclearstream.com/v1/messages`, X-Api-Key, form fields
  `message_header`, `message_body`, `subscribers[]` — plural array, NOT
  `to`/`subscriber`/`contacts`; the alternative to `subscribers` is `lists`,
  unused here), confirm-tap gated (no PIN), dry-run until key present.
  `lib/phone.ts` — E.164.
- `app/api/roster/route.ts` — GET roster JSON. Temporary diagnostics (counts/
  dates only, no names — re-verified safe 2026-09-23, see security section
  below): `?debug=1` (date scan, weekday-labeled, `&days=<n>` up to 31,
  default 8), `?debug=2` (event_profile occurrence dump, needs that service
  permission), `?debug=3` (attendance_profile with no occurrence).
  `?debugGuardian=` REMOVED 2026-09-23 (it dumped a real name + phone number,
  unauthenticated — see security section below).
  `app/api/page/route.ts` — POST paging, returns `messageId` on a real send.
  `app/api/page/status/route.ts` — GET `?id=<messageId>`, polled by the
  display for delivery confirmation; returns ONLY `{found, status, delivered,
  failed, optedOut, reason}`, never Clearstream's raw contact data.
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
- Remaining TEMPORARY diagnostics, all re-verified 2026-09-23 to return only
  counts/dates/decision-reasons, never names/phones/contact data:
  `/api/roster?debug=1/2/3`, `/api/discover?debug=2`. Fine to leave as-is.
- **Confirmed 2026-09-23 by Wayne, live, end to end**: checked his son into a
  real test event (160), `/room/160` showed him live, and "Text parent"
  actually sent ("Text sent to Wayne A."). Texting works; the room-name bug
  and delivery-confirmation feature below are both now resolved/built.

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

Implementation (`lib/ccb.ts`): `discoverChildrensMinistryRooms(targetDate,
excludeIds)` fetches the full list (cached 5 min, `fetchAllEventProfiles`),
then `evaluateDiscoveredEvent` decides each candidate -- fails CLOSED, unlike
`roomMeetsOnWeekday`'s fail-OPEN default for admin-configured rooms, since
adding an unverified discovered event is a bad outcome, the opposite of
hiding a known-good room. `targetDate: null` skips the day check entirely
(used for `/?all=1`). `app/page.tsx` appends discovered rooms after
rooms.json's own (which keep their friendly names and order).

## Fixed: two discovery bugs found live, one after the other (2026-09-23)
Both found by Wayne actually testing `?debug=2` against real CCB data, not
by inspection. Neither touched `roomMeetsOnWeekday`/`occurrencesForToday`
(rooms.json's own 6 rooms) -- those were never reported broken.

**Bug 1 -- a one-time event wrongly recurring every week.** On Wed
2026-09-23 the picker showed exactly one room, "Lunch with the Pastors"
(events 132/138), a ONE-TIME Children's Ministry event on Sun 2026-04-26.
Root cause: the first `discoverChildrensMinistryRooms` swept every
date-shaped string out of the event's raw XML (built for classroom check-in
events, where every date in the document really is a meeting occurrence).
A general CCB event carries other dates too (`created`, `modified`, etc.)
that have nothing to do with when it meets -- one of "Lunch with the
Pastors"'s happened to land on a Wednesday, so it matched every Wednesday
forever.

**Bug 2 -- `start_date` truncated to garbage.** The bug 1 fix introduced a
new one: CCB's `start_date` is NOT a fixed 10-character ISO date, it is a
VARIABLE-length human string ("Mar 8, 2026", "Apr 26, 2026" -- different
lengths). Slicing it to 10 characters (what the bug 1 fix originally did)
truncated it into garbage ("Mar 8, 202"), which then failed validation and
reported "no usable start_date" for literally every discovered event.
`resolveStartDate` now prefers `start_datetime` ("2026-03-08 18:30:00",
fixed-width, first 10 characters), falling back to `parseHumanDate`
(a small `new Date(...)`-based parser) on `start_date`'s free text only
when `start_datetime` is unusable.

Also surfaced while fixing bug 2: event 90 "Prophetic Ministry Night" uses
"Every day until Mar 10, 2026 ...", a DAILY recurrence (any weekday) with an
explicit end bound, not weekly. `recurrenceKind(text)` now returns
`'none' | 'daily' | 'weekly'` (only trusting CCB's own confirmed wording;
anything ambiguous is `'none'`, the safer default), and
`recurrenceUntilDate(text)` reads an optional "until <date>" bound so a
recurring series that already ended is never eligible again, however long
ago. `evaluateDiscoveredEvent`: one-time matches only its own exact date;
daily matches any weekday within its start/until bounds; weekly matches its
own weekday, from its start date onward and up to its until date if any.

`GET /api/discover?debug=2[&date=YYYY-MM-DD]` (`diagnoseDiscoveryEligibility`)
remains: every grouping-6 event's start_date/start_datetime/
recurrence_description and its exact decision + reason. The empty-state
heading is "No classrooms scheduled today" with the "Show all classrooms"
link always available there.

Regression tests cover both bugs directly: a human-readable ("Mar 8, 2026"
style) `start_date` parses correctly and is not truncated (bug 2, with and
without `start_datetime` present); a daily-until-date event (90-style) is
eligible within range and excluded long after its until date and before its
start; plus the original 132/138 one-time and 158 weekly regression tests.
34 tests pass total.

**Confirmed 2026-09-23 by Wayne**: picker correctly shows "No classrooms
scheduled today" on a day nothing meets.
**Confirmed 2026-09-23 by Wayne**: `?debug=2&date=2026-09-25` now shows real
`start_date` values throughout.

## Resolved: main page layout split, ?all=1 redesigned, live header bug (2026-09-23)
Change of plan mid-build: Wayne's first ask was to put the pinned-Sunday +
folder layout directly on `/`. He then asked to revert `/` to exactly how it
already worked, and put the new layout on `/?all=1` instead. Current state:

- **`/` (main page): UNCHANGED**, byte-for-byte the same logic as before this
  whole layout conversation (today-eligible rooms.json entries + today-
  eligible Children's Ministry discovery via `discoverChildrensMinistryRooms`,
  "No classrooms scheduled today" when none qualify). Never touch this
  without Wayne asking again specifically.
- **`/?all=1` (separate page, not a "same page, unfiltered" toggle)**: three
  sections. (1) "today's classrooms" -- identical computation to `/`. (2)
  "Sunday Service Classrooms" -- the 5 pinned rooms (`SUNDAY_ROOM_NAMES` in
  `app/page.tsx`), always, in rooms.json's order, MINUS whichever are
  already in section 1 (so Sundays don't show the same 5 twice). (3) a
  `<details>` "Weekday & Special Events" folder (native HTML, no client JS)
  containing `lib/ccb.ts`'s new `discoverExtraRooms(excludeIds)`: every OTHER
  rooms.json room (currently just Bible Study Kids, `isToday` via
  `roomMeetsOnWeekday`) plus every Children's Ministry event (persistent --
  recurring ones always listed, tagged `isToday` only when it applies; a
  ONE-TIME CM event only listed on its own day, so "Lunch with the Pastors"
  does not clutter forever) plus any OTHER-grouping event that is BOTH
  scheduled today (by `evaluateDateEligibility`, grouping-agnostic) AND has a
  real check-in recorded today (`eventHasCheckInsToday`, reuses
  `occurrencesForToday`/`fetchRoster`) -- this is what surfaces an ad hoc
  test/special event like Wayne's 159/160 (grouping "Regular Events", not
  Children's Ministry). Sorted `isToday`-first; the folder auto-expands
  (`open={folderHasToday}`) only when something inside applies today.

- **Fixed: live header showed "Classroom" instead of the real event name**
  (e.g. `/room/160`), while a PAST-date view of the same event correctly
  showed its real name. Root cause: `getSingleRoster`'s occurrence-guessing
  (`occurrencesForToday`) can return MULTIPLE candidate occurrence times for
  ONE event id (a one-off/ad hoc event's `event_profile` sweep can match more
  than one date-shaped string for "today"); when that happens the results
  were combined with `mergeRosters`, which always blanks `room` -- correct
  for `getRoster`'s OTHER use of the same function (genuinely different
  event ids combined into one room), wrong here (same underlying event, just
  multiple occurrence-guesses of it, so any successful guess's real `<name>`
  is authoritative). Fixed by patching `.room` back in after merging, using
  whichever guess actually returned one. This matters most for a discovered
  room with no rooms.json entry to fall back on for its display name.

**Not yet verified by Wayne**: reload `/` (unchanged, should look exactly as
before) and `/?all=1` (new 3-section layout); open a discovered/ad hoc
event's live display and confirm the header now shows its real name instead
of "Classroom".

## Resolved: Clearstream delivery confirmation + a critical privacy fix (2026-09-23)
Wayne wanted to know not just that Clearstream ACCEPTED a send, but whether
the parent's phone actually got it. Evidence-first, same as the CCB
discovery work: a read-only probe (`?debug=1`'s in-memory log, then
`?debug=2` querying Clearstream's own message list directly) confirmed the
real field shapes before anything was built on top of them.

**Confirmed live (2026-09-23), Clearstream `GET /v1/messages` response
shape**: 200 with `{data:[...]}`; each message has `id`, `status` ("SENT"),
`type` ("SMS"), `number`, `sent_at`, `completed_at`, `text{full,header,body}`,
`subscribers[phone]`, `contacts[...]`, `stats{recipients,successful,failures,
throughput,replies,opt_outs,credits_used}`, `details_url`.

**CRITICAL, now fixed: `/api/page?debug=2` was a live, unauthenticated
privacy leak.** It returned Clearstream's raw message list -- names, phone
numbers, emails, and signed URLs of unrelated people (other REACH
recipients, not just this church's families) -- to anyone who opened the
URL, no auth at all. Wayne caught it himself and asked for immediate
removal. Fix (his call: remove entirely rather than gate-and-redact) --
deleted every raw-passthrough debug route, not just this one, since the
same mistake (probe returns an upstream API's response verbatim without
considering it carries OTHER people's data) had been made more than once:
- `app/api/page/route.ts` — removed `?debug=1` and `?debug=2` (both raw
  Clearstream dumps). POST-only now.
- `app/api/discover/route.ts` — removed `?debug=1` (raw `event_profiles`
  dump; also carried an organizer phone number field). Kept `?debug=2`
  (`diagnoseDiscoveryEligibility`: id/name/dates/reason only, no contact data).
- `app/api/roster/route.ts` — removed `?debugGuardian=` (raw guardian
  name + phone dump). Kept `?debug=1/2/3` (counts/dates only, re-verified
  safe by inspection).
- `lib/ccb.ts` — deleted `diagnoseGuardianRaw` and `diagnoseEventProfiles`
  (their only callers were the two removed routes above; confirmed via grep
  before deleting).
- `lib/paging.ts` — deleted the old raw-dump plumbing (`recordSend`,
  `recentSendDebugLog`, `lookupClearstreamStatus`, `listRecentClearstreamMessages`).

**Rule going forward**: any endpoint that reads Clearstream (or CCB) on
behalf of the live display must be a narrow, sanitizing proxy from the
start. Raw upstream responses stay in server memory only and never reach an
HTTP response unfiltered — `checkClearstreamMessageStatus` (below) carries
an explicit doc comment saying so, precisely because this is the mistake
that caused the leak.

**The real feature, built once field names were confirmed**: `sendPage`
(`lib/paging.ts`) now returns `messageId` (pulled from the send response via
`extractMessageId`) alongside the existing `guardian`/`toMasked`/`dryRun`
fields. The display polls the new `GET /api/page/status?id=<messageId>`
(`app/api/page/status/route.ts`) every ~3s for up to 60s
(`checkClearstreamMessageStatus` in `lib/paging.ts` — tries `GET
/v1/messages/<id>` first, falls back to searching the list). That function
returns ONLY `{found, status, delivered, failed, optedOut, reason}`:
`delivered` is `stats.successful >= 1 AND completed_at` set; `failed` is
`stats.failures >= 1 OR stats.opt_outs >= 1` (`reason` is "parent has opted
out of texts" for the opt-out case, else "the number could not receive
texts"). Never touches subscriber/contact fields.

**RoomBoard.tsx toast sequence** (`components/RoomBoard.tsx`, per Wayne's
exact corrected spec — no amber state, no child-card badge, ever):
- Right after a real send: `Text sent to {who}. Checking delivery...`
  (neutral toast, spinner).
- Delivered: `Delivered. {who} received the text.` (green, fades after ~8s).
- Failed: `Not delivered. {reason}. Please find the parent another way.`
  (red, stays until the operator taps its × to dismiss).
- No status after 60s: ends quietly on `Text sent to {who}.` (same wording/
  color as the no-messageId, dry-run, and throttled paths — no amber state,
  ever).
`{who}` is `guardian` from the send response, falling back to the child's
own name — never a generic "the parent" string. A `pollTokenRef`
cancellation token means a second send (or navigating away) stops a still-
running poll from clobbering a newer toast.

Verified this round: `npm run build` clean (new `/api/page/status` route
registered, every removed debug route gone from the route list), `npm test`
(34 passing), and all four toast states screenshotted in a headless browser
against the app's real CSS (checking spinner, green delivered, red failed
with its dismiss button, quiet green sent — all render as designed). Live
Clearstream delivery itself can't be exercised from this sandbox (no
egress) — that part is Wayne's to trigger.

**Not yet verified by Wayne**: trigger a real "Text parent" send and watch
the checking → delivered (or failed) toast sequence live; confirm
`/api/page?debug=1`, `/api/page?debug=2`, `/api/discover?debug=1`, and
`/api/roster?debugGuardian=` are all gone (400/404) on the live site.

## Fixed: outgoing text (and display header) could name an empty room (2026-09-23)
Same root cause as the earlier header fix, but not fully covered by it: a
real text Wayne received today for an ad hoc test event named no room at
all. `attendance_profile`'s own `<name>` (the check-in's assigned CCB Room
Name, e.g. "Classroom 2" for event 158 -- confirmed live) can be genuinely
BLANK at the source, not just lost to the earlier occurrence-merge bug: an
ad hoc/test event (159/160) whose check-in was never assigned a room shows
"Not specified" in ChMS's own admin UI, meaning `<name>` itself is empty.

RoomBoard sends this same value as the paged message's `{room}`, so this
was one bug with two symptoms (blank header, blank text), fixed once at the
source: `getSingleRoster` (`lib/ccb.ts`) now falls back to the underlying
calendar event's own name (`fallbackEventName`, via the already-cached
`event_profiles` list) whenever `attendance_profile`'s room name is blank.
Combined with the existing fallback chain, the full order is: CCB check-in
Room Name → the event's own name → rooms.json's configured label
(`initialName`, already handled on the display) → `buildMessage`'s own
"the classroom" (`lib/message.ts`, extracted from `lib/paging.ts` so it has
zero dependencies and is directly unit-tested; the same extraction fixed a
`@/` path-alias resolution issue for the test runner).

**Exact message template** (`PAGE_MESSAGE` env var, this is the default if
unset): `Please come to {room} for your child at Country Faith Church.`
`{room}` is replaced by the fallback chain above; never blank now, tested
directly (`buildMessage never sends a blank room`).

**Not yet verified by Wayne**: re-check into an ad hoc/test event and
confirm both the live header and a real "Text parent" send now name the
real room, never blank.

## Coordination
User switches between separate Claude accounts to save tokens, never two at
once. Always push so the next account is current. Be concise to stretch tokens.
