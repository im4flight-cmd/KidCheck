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
  combined rooms). Guardian contact is a TWO-STEP lookup via
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
  `?debug=1` (date scan), `?debug=2` (event_profile occurrence dump, needs
  that service permission), `?debug=3` (attendance_profile with no
  occurrence), `?debugGuardian=<individual id>` (runs the real two-step
  guardian lookup, reports every attempt).
  `app/api/page/route.ts` — POST paging.
- `app/room/[room]/page.tsx`, `components/RoomBoard.tsx` — the display (auto
  refresh 20s, "Text parent" button, "Rooms" back link, auto-reload on deploy).
- `app/page.tsx` room picker, `app/error.tsx` boundary, `app/globals.css`
  (CFC navy/gold, Lato/Lora fonts). `reference/apps-script/` is the old prototype.

## Known behavior, not bugs
- No service today (e.g. a weekday) = "No one checked in yet" is correct.
  A mid-week test check-in files under the NEXT meeting occurrence, not today.
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

## Coordination
User switches between separate Claude accounts to save tokens, never two at
once. Always push so the next account is current. Be concise to stretch tokens.
