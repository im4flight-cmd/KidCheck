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
- Paging (set): `PAGING_ENABLED=true`, `PAGE_PIN`, `CLEARSTREAM_API_KEY`.
  Optional: `PAGING_TEST`, `PAGE_SENDER`, `PAGE_MESSAGE`.
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
  combined rooms), `individual_profile_from_id` for the guardian name+phone
  (cached ~6h). Occurrence defaults to today in America/Chicago.
- `lib/rooms.ts` — room config (ids arrays). `lib/paging.ts` — Clearstream send
  (`api.getclearstream.com/v1/messages`, X-Api-Key, message_header/body/to),
  PIN-gated, dry-run until key present. `lib/phone.ts` — E.164.
- `app/api/roster/route.ts` — GET roster JSON (+ temporary `?debug=1`).
  `app/api/page/route.ts` — POST paging.
- `app/room/[room]/page.tsx`, `components/RoomBoard.tsx` — the display (auto
  refresh 20s, "Text parent" button, "Rooms" back link, auto-reload on deploy).
- `app/page.tsx` room picker, `app/error.tsx` boundary, `app/globals.css`
  (CFC navy/gold, Lato/Lora fonts). `reference/apps-script/` is the old prototype.

## Known behavior, not bugs
- No service today (e.g. a weekday) = "No one checked in yet" is correct.
  A mid-week test check-in files under the NEXT meeting occurrence, not today.
- CCB has no send-text API; UniFi Talk has none either; Clearstream is the sender.

## TODO / temporary
- `?debug=1` date-scan diagnostic in `app/api/roster/route.ts` is TEMPORARY.
  Remove it after Sunday's live check-in is verified working.

## Coordination
User switches between separate Claude accounts to save tokens, never two at
once. Always push so the next account is current. Be concise to stretch tokens.
