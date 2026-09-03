# CFC Classroom Check-In

A live, per classroom display of who has been checked into children's ministry
at Country Faith Church, backed by Pushpay ChMS. Each classroom iPad shows only
that room's checked-in kids and refreshes itself automatically, so a teacher
always sees a current list without touching anything.

Built as a Next.js app that deploys free on Vercel. It is both the display and
a small secure backend, so the ChMS API credentials stay on the server and
never reach the iPad.

## Screens

- **Room picker** (`/`): a tap to open list of classrooms. No typing event ids.
- **Classroom display** (`/room/<eventId>`): the big, auto refreshing roster for
  one room, styled in CFC navy and gold with the church logo.

## How it works

- `GET /api/roster?room=<eventId>` calls the ChMS `attendance_profile` service
  server side, parses the XML, and returns clean JSON. Credentials come from
  environment variables.
- The display polls that route every 20 seconds, keeps the last good roster on
  screen through a brief network blip, and refreshes the moment the iPad wakes.
- The ChMS request parameter for the event is `id` (not `event_id`), and the
  occurrence defaults to today's date in the church timezone.

## Quick start (local)

```bash
npm install
cp .env.example .env.local     # then fill in the values, or set DEMO_MODE=true
npm run dev                    # http://localhost:3000
```

Set `DEMO_MODE=true` in `.env.local` to preview the look with sample names, no
ChMS needed. Set some rooms too, for example:

```
DEMO_MODE=true
ROOMS=[{"id":"101","name":"Nursery"},{"id":"102","name":"Preschool"}]
```

## Deploy to Vercel

New to this? **[DEPLOY.md](DEPLOY.md)** is a plain, click by click, five minute
guide from signing up to a live link, including a demo-mode-first path so you can
see it working before the ChMS credentials arrive. The short version:

1. Import this repository at https://vercel.com/new. The framework is detected
   automatically, no build settings to change.
2. Add the environment variables below under Project Settings > Environment
   Variables.
3. Deploy, then open the URL. Add rooms and you are live.

Vercel's free Hobby tier is enough for this. If the non commercial terms of the
free tier ever matter for the church, the same app also deploys free on
Cloudflare Pages.

### Environment variables

| Name | Required | Purpose |
| --- | --- | --- |
| `CCB_SUBDOMAIN` | yes | The `x` in `x.ccbchurch.com`. |
| `CCB_API_USER` | yes | ChMS API username (Settings > API Admin). |
| `CCB_API_PASS` | yes | ChMS API password. |
| `CHURCH_TIMEZONE` | no | Defaults to `America/Chicago`. |
| `SHOW_FULL_NAMES` | no | `true` shows full last names instead of "Ben B.". |
| `PARENT_CONTACT_MODE` | no | `full` (default) shows parent name and phone, `name` shows the parent name only, `off` shows neither. |
| `PAGING_ENABLED` | no | `true` adds the "Text parent" button. Off by default. |
| `PAGE_PIN` | no | Staff PIN required before a text sends. |
| `CLEARSTREAM_API_KEY` | no | Clearstream API key. Present = real texts; blank = test mode. |
| `PAGING_TEST` | no | `true` forces test mode even with a key set. |
| `PAGE_SENDER` | no | Sender label on the text (default "Country Faith Church"). |
| `PAGE_MESSAGE` | no | Message body. `{room}` is replaced with the room name. |
| `ROOMS` | no | Room list as JSON. Overrides `rooms.json` when set. |
| `DEMO_MODE` | no | `true` serves sample data instead of calling ChMS. |

### Parent contact on the chart

Each child's card can show the parent/guardian to reach, pulled live from CCB
(the family's primary contact and their best phone, preferring a mobile). CCB
has no API to send a text, so this surfaces who to contact and a teacher texts
or calls them from the church's own phone (for example UniFi Talk). Two setup
notes:

- The API user needs the **`individual_profile_from_id`** service enabled in ChMS, in
  addition to `attendance_profile`.
- Parent phone numbers on a room-visible screen are sensitive. Default is
  `full`; set `PARENT_CONTACT_MODE=name` or `off` to dial that back. Lookups are
  cached for hours, so this adds almost no API load.

### Parent paging (optional, via Clearstream)

CCB has no API to send a text, so paging routes through Clearstream (the church
texting service), which the church already uses and which handles carrier
compliance. A teacher taps "Text parent" on a child, confirms, and the server
looks up that child's guardian phone from CCB and sends a one-off text through
Clearstream. It is off until you set `PAGING_ENABLED=true`.

- Set `PAGING_ENABLED=true`, a `PAGE_PIN`, and `CLEARSTREAM_API_KEY` (Clearstream:
  Settings > API Keys, requires their paid plan).
- Until a key is present, or with `PAGING_TEST=true`, the button runs in test
  mode: it shows what it would send and logs it, but sends nothing. Try it that
  way first, then add the key.
- The send hits `POST https://api.getclearstream.com/v1/messages` with the
  `X-Api-Key` header and `message_header`/`message_body`/`to` fields. Confirm the
  first real send reaches a staff phone; Clearstream's response is logged if it
  rejects anything.
- Safety: PIN gated, a deliberate confirm step, phone numbers are masked in the
  UI, and a 60 second guard prevents double texting the same child.

## Configuring classrooms

Two ways, whichever is easier. The `ROOMS` variable wins when set.

- **Vercel variable:** set `ROOMS` to a JSON array, for example
  `[{"id":"12345","name":"Nursery"}]`.
- **In the repo:** edit `rooms.json` and redeploy. See `rooms.example.json`.

The `id` is the room's ChMS event id, the number in the event URL inside ChMS.
It is set once per room and does not change week to week.

### Combining several classes into one display

To show more than one ChMS event on a single screen (for example, the 3, 4, and
5 year old classes sharing one room), give that room an `ids` array instead of a
single `id`. Its display merges the check-ins from every listed event and
removes any duplicates:

```json
[
  { "id": "103", "name": "Nursery" },
  { "ids": ["125", "114", "115"], "name": "3-5 Year Olds" }
]
```

## Set up an iPad

1. Open the room's display URL in Safari, for example
   `https://your-app.vercel.app/room/12345`.
2. Share, then Add to Home Screen, so it installs with the CFC icon and opens
   full screen.
3. Open it from the home screen, then turn on Guided Access to lock the iPad to
   this one page. Settings > Accessibility > Guided Access.

## Privacy

- The display shows first name and last initial by default. No allergy or
  security notes are ever shown on a room facing screen.
- ChMS credentials live only on the server, never in the page or network tab.

## Regenerating brand assets

The app icons and trimmed logos in `public/` are generated from the CFC logos:

```bash
npm run gen-icons
```

The outputs are committed, so Vercel does not run this at build time.

## Roadmap

- **Phase 0:** confirm with real ChMS credentials that the roster loads and that
  a checked-in child's parent contact is reachable through the API.
- **Phase 2:** parent messaging. Let a teacher tap a child and send that child's
  parent a "please come to the classroom" text, gated so only staff can trigger
  it. Pushpay already stores the family contacts and can text parents, so this
  builds on what is there.

## Project layout

```
app/                     Next.js routes (picker, room display, roster API, manifest)
components/RoomBoard.tsx  The live display, client side polling
lib/ccb.ts                ChMS client: fetch, XML parse, name formatting, cache
lib/rooms.ts              Room configuration
public/                   Fonts, CFC logos, generated icons
scripts/gen-icons.mjs     One time brand asset generator
reference/apps-script/    The earlier Google Apps Script version, kept for reference
```

The original Google Apps Script prototype lives in `reference/apps-script/`. Its
attendance parsing and API notes were ported into `lib/ccb.ts`.
