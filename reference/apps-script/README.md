# Classroom Roster Live Display

An always-current, per classroom display of who has been checked into a
children's ministry room through Pushpay ChMS. It runs as a Google Apps
Script Web App, shows one room's checked-in kids, refreshes itself about
every 30 seconds, and is meant to be locked open on an iPad in the room.

Because the room is fixed by the page URL, there are no filters to reset on
refresh. Because the Apps Script runs the ChMS call server side, no API
credentials are ever visible in the page, the browser dev tools, or the
network tab on the iPad.

## Files

| File | What it is |
| --- | --- |
| `RoomRosterDisplay.gs` | Server side logic: the ChMS call, XML parsing, validation, caching, and setup helpers. |
| `Index.html` | The classroom display page that the iPad shows. |
| `appsscript.json` | Project manifest: church timezone, web app access, API scope. |
| `.clasp.json.example` | Template for pushing with clasp. Copy to `.clasp.json` and add your script id. |

## How it fits together

1. One Apps Script project is both the API proxy and the page. No separate
   server or hosting is needed.
2. Every classroom iPad opens the same Web App URL with a different
   `?event_id=` for its room.
3. The page calls the server function `getRoster()` every 30 seconds through
   `google.script.run`. There is no page reload, so nothing resets.
4. The server reads the API credentials from Script Properties, calls ChMS,
   parses the attendance, and returns only names plus a count and timestamp.

## What church staff need to provide before setup

- API credentials from ChMS. In ChMS go to Settings > API Admin. A Master
  Administrator may need to generate the username and password, or contact
  Pushpay support if the API Admin section is not visible.
- The church ChMS subdomain, meaning the `x` in `x.ccbchurch.com`.
- The `event_id` for each classroom's recurring check-in event. Open the
  event in ChMS and read the number from the event URL.
- A decision on whether to host on a Google Workspace account or a personal
  Google account. See Open Item 4 below.
- iPad access to set up Guided Access once each room's URL is ready.

## Setup

### 1. Create the Apps Script project

Option A, copy and paste in the browser:

1. Go to https://script.google.com and start a new project.
2. Replace the default `Code.gs` with the contents of `RoomRosterDisplay.gs`.
3. Add a file, choose HTML, name it `Index`, and paste in `Index.html`.
4. Open Project Settings and, under General settings, check
   "Show appsscript.json manifest file in editor," then paste in the
   contents of `appsscript.json`.

Option B, push with clasp:

1. `npm install -g @google/clasp` and `clasp login`.
2. `clasp create --type webapp --title "Classroom Roster Live Display"`.
3. Copy `.clasp.json.example` to `.clasp.json` and confirm the script id.
4. `clasp push`.

### 2. Add the credentials

In the Apps Script editor open Project Settings (the gear icon), scroll to
Script Properties, and add three properties:

| Property | Value |
| --- | --- |
| `CCB_SUBDOMAIN` | your church subdomain, the `x` in `x.ccbchurch.com` |
| `CCB_API_USER` | the API username from ChMS |
| `CCB_API_PASS` | the API password from ChMS |

### 3. Verify before touching an iPad

From the editor, run these functions and read the execution log:

- `showConfigStatus()` confirms the three properties are set and shows the
  timezone the script will use for "today."
- `debugFetch('12345')` runs one real call for event 12345 and logs both the
  raw ChMS XML and the parsed result. Use a real classroom event id. You can
  pass a date as a second argument, for example
  `debugFetch('12345', '2026-09-07')`.

If `debugFetch` shows names, the credentials, event id, and occurrence format
all work.

### 4. Deploy the Web App

1. Deploy > New deployment > select type Web app.
2. Execute as: Me. This is required so the server side credentials are used.
3. Who has access: Anyone. See Open Item 4 for restricting to your church.
4. Copy the Web App URL.

### 5. Set up each classroom iPad

1. Open the Web App URL with that room's id appended, for example
   `https://.../exec?event_id=12345`.
2. Turn on Guided Access on the iPad so teachers cannot navigate away.
   Settings > Accessibility > Guided Access, then triple click the side
   button on the page to lock it.

Adding a new room later needs only that room's `event_id` and the same URL
with a different number. No code changes.

## Open items from the handoff, resolved

**1. Real XML shape and parsing.** Resolved. The `attendance_profile` service
returns this shape, and `parseAttendance()` reads it directly with the
built in `XmlService`:

```xml
<ccb_api><response>
  <events count="1">
    <event id="12345">
      <name>Room name</name>
      <occurrence>2026-09-07 00:00:00</occurrence>
      <attendees>
        <attendee id="10"><first_name>Ben</first_name><last_name>Bolton</last_name></attendee>
      </attendees>
    </event>
  </events>
</response></ccb_api>
```

The placeholder that returned raw XML is gone. The server now returns a small
object, `{ room, checked_in, count, occurrence, updated }`, and reports ChMS
error responses in plain language instead.

Worth noting: the original skeleton sent the event as `&event_id=` to ChMS.
The ChMS parameter is `&id=`. That is fixed here. The `event_id` name is kept
only for the page URL, which is separate from the API call.

**2. Occurrence format.** The `occurrence` parameter is sent as a date,
`yyyy-MM-dd`, computed as today in the church timezone, which is set to
`America/Chicago` in the manifest for Schertz. This is correct for the common
case of one service per room per day. For the rare room that meets twice on
the same day, the page accepts an override in the URL,
`?event_id=12345&occurrence=2026-09-07`, and the code also accepts a full date
and time, `2026-09-07 09:00:00`, if a live test shows ChMS needs the exact
start time to tell two same day services apart. Confirm this against your own
events with `debugFetch` before relying on it for a two service room.

**3. Fields available per child.** The `attendance_profile` service provides
`first_name` and `last_name` per checked-in child, and nothing more. It does
not carry allergy or security notes, so those are not shown. This is a good
thing for a screen that sits in view of a room. By default the display shows
first name and last initial, for example "Ben B.," which is enough for a
teacher who knows the kids without leaving full last names on a public screen.
To show full names, set `SHOW_LAST_INITIAL_ONLY = false` near the top of
`RoomRosterDisplay.gs`. If allergy or security notes are ever needed in the
room, that should be a separate, access controlled tool, not this display.

**4. Access control.** The manifest ships with access set to Anyone, which is
low risk because the URL is not public or searchable, but is not access
controlled. If the church hosts this on a Google Workspace account, restrict
it to church accounts by changing the manifest `webapp.access` from
`ANYONE_ANONYMOUS` to `DOMAIN`, or by choosing "Anyone within your
organization" when deploying. The tradeoff is that each iPad would then need
to be signed into a church Google account, which is more to manage on a kiosk.
Pick based on whether the hosting account is Workspace or personal.

**5. Custom Reports builder.** Not used, and not needed for this to work. If
you still want to ask Pushpay support whether the separate Custom Reports
builder can be pointed at check-in data with per room settings that survive a
refresh, that question stands on its own and does not block this display.

## How this meets the acceptance criteria

- A teacher sees an accurate, current list for their room only. Each iPad is
  pinned to one `event_id`.
- The display updates automatically about every 30 seconds with no manual
  refresh and no filters to reset.
- No API credentials appear in the page source, dev tools, or network
  requests. The ChMS call happens server side and only names are returned.
- Adding a classroom needs only that room's `event_id` on the same URL.
- The iPad can be locked to the display with Guided Access.

## Notes on reliability

- A short server side cache of about 20 seconds means several iPads showing
  the same room, and the repeated polls from one iPad, do not each hit ChMS.
- If a refresh fails, the last good roster stays on screen and a small warning
  shows in the footer while the page keeps retrying, so a brief network blip
  does not blank the room's display.
- The page refreshes the moment an asleep iPad wakes, so it is current as soon
  as anyone looks at it.

## Troubleshooting

| What you see | Likely cause |
| --- | --- |
| "Server is not configured yet" | One of the three Script Properties is missing. Run `showConfigStatus()`. |
| "ChMS rejected the API credentials" | Wrong `CCB_API_USER` or `CCB_API_PASS`, or API access not enabled in ChMS. |
| "ChMS API not found (HTTP 404)" | Wrong `CCB_SUBDOMAIN`. |
| "No one checked in yet" all service | Right room, no check-ins yet, or the occurrence date does not match. Try `debugFetch` with the exact date. |
| Wrong room's kids | The iPad's `event_id` points at the wrong event. |
