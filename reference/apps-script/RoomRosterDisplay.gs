/**
 * Room Roster Live Display for Pushpay ChMS (Church Community Builder) Check-In
 * ============================================================================
 *
 * Deploy this as a Google Apps Script Web App. It fetches live check-in
 * attendance data from Pushpay ChMS (the classic Church Community Builder
 * "api.php" v1 API) for ONE event/room and renders a big, simple,
 * auto-refreshing list, meant to be locked open on a classroom iPad.
 *
 * WHY THIS SHAPE
 *   The Apps Script project is both the API proxy and the page. The iPad
 *   only ever talks to this script, never to ChMS, so the API username and
 *   password stay server side (in Script Properties) and never reach the
 *   browser, page source, or network tab. The room is fixed per URL by an
 *   ?event_id= parameter, so there are no filters to lose on refresh.
 *
 * FILES IN THIS PROJECT
 *   RoomRosterDisplay.gs  This file. Server side logic.
 *   Index.html            The classroom display page.
 *   appsscript.json       Manifest (timezone, web app access, scopes).
 *
 * SETUP STEPS
 *   1. In ChMS: Settings > API Admin (a Master Administrator may need to
 *      generate these, or ask Pushpay support to enable API access first).
 *      Create an API username and password.
 *   2. In this Apps Script project: Project Settings (gear icon) >
 *      Script Properties > add three properties:
 *        CCB_SUBDOMAIN = yourchurch      (the x in x.ccbchurch.com)
 *        CCB_API_USER  = your-api-username
 *        CCB_API_PASS  = your-api-password
 *   3. Find each classroom's EVENT ID in ChMS. Open the recurring check-in
 *      event, the numeric id is in the URL (e.g. .../events/view/12345).
 *      This id is stable across weeks, you set it once per room. What
 *      changes weekly is the "occurrence" (the date), which this script
 *      computes automatically as today's date in the church timezone.
 *   4. Deploy > New deployment > Web app > Execute as: Me >
 *      Who has access: Anyone. Copy the URL.
 *   5. On each iPad, open that URL with ?event_id=12345 appended (that
 *      room's id), then turn on Guided Access to lock the iPad to this page.
 *
 * VERIFYING SETUP (run these once from the editor, no iPad needed)
 *   showConfigStatus()          Confirms the three properties are set.
 *   debugFetch('12345')         Logs the raw ChMS XML and the parsed result
 *                               for event 12345, so you can confirm the API
 *                               credentials and event id work before wiring
 *                               up an iPad. Optionally pass a date:
 *                               debugFetch('12345', '2026-09-07').
 *
 * API REFERENCE (confirmed shape this parser targets)
 *   Service: srv=attendance_profile
 *   Params:  id=<event id>, occurrence=<yyyy-MM-dd>
 *   Note:    the ChMS parameter for the event is "id", not "event_id".
 *   Response:
 *     <ccb_api><response>
 *       <events count="1">
 *         <event id="12345">
 *           <name>Room / event name</name>
 *           <occurrence>2026-09-07 00:00:00</occurrence>
 *           <did_not_meet>false</did_not_meet>
 *           <attendees>
 *             <attendee id="10"><first_name>Ben</first_name><last_name>Bolton</last_name></attendee>
 *             ...
 *           </attendees>
 *           <head_count></head_count>
 *         </event>
 *       </events>
 *     </response></ccb_api>
 *   Errors come back as:
 *     <ccb_api><response><errors><error>message</error></errors></response></ccb_api>
 */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

// How often the page asks the server for fresh data, in milliseconds.
var REFRESH_MS = 30000;

// Short server side cache so several iPads showing the same room, and the
// repeated polls from one iPad, do not each hit ChMS. Kept well under the
// refresh interval so data still feels live. Seconds.
var SERVER_CACHE_SECONDS = 20;

// Privacy: show "Ben B." instead of "Ben Bolton". Teachers who know their
// kids can still tell them apart, but a full last name is not left sitting
// on a screen anyone in the room can read. Set to false for full names.
var SHOW_LAST_INITIAL_ONLY = true;

// ---------------------------------------------------------------------------
// Web app entry point
// ---------------------------------------------------------------------------

function doGet(e) {
  var params = (e && e.parameter) ? e.parameter : {};
  var eventId = String(params.event_id || '').trim();

  // ChMS event ids are numeric. Reject anything else, both to catch typos
  // and so nothing arbitrary from the URL is ever placed into the page or
  // the outgoing API request.
  if (!/^\d+$/.test(eventId)) {
    return renderSetupPage(String(params.event_id || ''));
  }

  // Optional occurrence override for the rare room that meets more than once
  // on the same day. Accepts a date, or a full date and time. Anything that
  // does not match is ignored and the script falls back to today's date.
  var occurrence = String(params.occurrence || '').trim();
  if (!isValidOccurrence(occurrence)) {
    occurrence = '';
  }

  var tmpl = HtmlService.createTemplateFromFile('Index');
  tmpl.eventId = eventId;
  tmpl.occurrence = occurrence;
  tmpl.refreshMs = REFRESH_MS;

  return tmpl.evaluate()
    .setTitle('Room Roster')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// ---------------------------------------------------------------------------
// Server function called from the page via google.script.run
// ---------------------------------------------------------------------------

function getRoster(eventId, occurrence) {
  // Never trust values coming back from the page. Re-validate here.
  eventId = String(eventId || '').trim();
  if (!/^\d+$/.test(eventId)) {
    return { error: 'Invalid room id.' };
  }
  occurrence = normalizeOccurrence(occurrence);

  var cache = CacheService.getScriptCache();
  var cacheKey = 'roster_' + eventId + '_' + occurrence;

  var cached = cache.get(cacheKey);
  if (cached) {
    var hit = JSON.parse(cached);
    hit.cached = true;
    return hit;
  }

  var result = fetchRoster(eventId, occurrence);

  // Only cache good results. Errors should retry on the next poll.
  if (!result.error) {
    cache.put(cacheKey, JSON.stringify(result), SERVER_CACHE_SECONDS);
  }
  return result;
}

// ---------------------------------------------------------------------------
// ChMS fetch and parse
// ---------------------------------------------------------------------------

function fetchRoster(eventId, occurrence) {
  var props = PropertiesService.getScriptProperties();
  var subdomain = props.getProperty('CCB_SUBDOMAIN');
  var user = props.getProperty('CCB_API_USER');
  var pass = props.getProperty('CCB_API_PASS');

  if (!subdomain || !user || !pass) {
    return { error: 'Server is not configured yet. Set CCB_SUBDOMAIN, CCB_API_USER, and CCB_API_PASS in Script Properties.' };
  }

  var url = 'https://' + encodeURIComponent(subdomain) + '.ccbchurch.com/api.php' +
    '?srv=attendance_profile' +
    '&id=' + encodeURIComponent(eventId) +
    '&occurrence=' + encodeURIComponent(occurrence);

  var response;
  try {
    response = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: { Authorization: 'Basic ' + Utilities.base64Encode(user + ':' + pass) },
      muteHttpExceptions: true,
      followRedirects: true
    });
  } catch (err) {
    return { error: 'Could not reach ChMS. Check the network and try again.' };
  }

  var code = response.getResponseCode();
  var body = response.getContentText();

  if (code === 401 || code === 403) {
    return { error: 'ChMS rejected the API credentials (HTTP ' + code + '). Check CCB_API_USER and CCB_API_PASS.' };
  }
  if (code === 404) {
    return { error: 'ChMS API not found (HTTP 404). Check the CCB_SUBDOMAIN value.' };
  }
  if (code >= 500) {
    return { error: 'ChMS is temporarily unavailable (HTTP ' + code + ').' };
  }
  if (code !== 200) {
    return { error: 'Unexpected response from ChMS (HTTP ' + code + ').' };
  }

  return parseAttendance(body, occurrence);
}

/**
 * Parse the attendance_profile XML into a small, page friendly object:
 *   { room, checked_in: [names], count, occurrence, updated }
 * or { error: message } if ChMS reported an error.
 */
function parseAttendance(xmlText, occurrence) {
  var doc;
  try {
    doc = XmlService.parse(xmlText);
  } catch (err) {
    return { error: 'ChMS returned something this display could not read.' };
  }

  var root = doc.getRootElement();          // ccb_api
  var response = root ? root.getChild('response') : null;
  if (!response) {
    return { error: 'ChMS returned an unexpected response.' };
  }

  // ChMS reports problems as <errors><error>...</error></errors>.
  var errorsEl = response.getChild('errors');
  if (errorsEl) {
    var errList = errorsEl.getChildren('error');
    var msg = errList.length ? errList[0].getText().trim() : 'ChMS returned an error.';
    return { error: msg || 'ChMS returned an error.' };
  }

  var events = response.getChild('events');
  var eventEls = events ? events.getChildren('event') : [];

  // No event for this date usually means the room has not met yet today.
  if (!eventEls.length) {
    return { room: '', checked_in: [], count: 0, occurrence: occurrence, updated: nowStr() };
  }

  var roomName = textOf(eventEls[0].getChild('name'));
  var occ = textOf(eventEls[0].getChild('occurrence')) || occurrence;

  // Collect attendees across any returned event elements, de-duplicated by
  // attendee id (guards against a child listed twice, or a date matching
  // more than one occurrence).
  var seen = {};
  var names = [];
  for (var e = 0; e < eventEls.length; e++) {
    var attendeesEl = eventEls[e].getChild('attendees');
    if (!attendeesEl) {
      continue;
    }
    var attendees = attendeesEl.getChildren('attendee');
    for (var i = 0; i < attendees.length; i++) {
      var a = attendees[i];
      var idAttr = a.getAttribute('id');
      var id = idAttr ? idAttr.getValue() : '';
      if (id && seen[id]) {
        continue;
      }
      if (id) {
        seen[id] = true;
      }
      names.push(formatName(textOf(a.getChild('first_name')), textOf(a.getChild('last_name'))));
    }
  }

  names.sort(function(x, y) { return x.localeCompare(y); });

  return {
    room: roomName,
    checked_in: names,
    count: names.length,
    occurrence: occ,
    updated: nowStr()
  };
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function textOf(el) {
  return el ? el.getText().trim() : '';
}

function formatName(first, last) {
  first = capitalizeFirst(first || '');
  last = last || '';
  if (SHOW_LAST_INITIAL_ONLY && last) {
    return (first + ' ' + last.charAt(0).toUpperCase() + '.').trim();
  }
  return (first + ' ' + last).trim();
}

// Uppercase just the first character, so a name entered as "ben" shows as
// "Ben" without disturbing names like "McKay" or "de'Andre".
function capitalizeFirst(s) {
  s = String(s || '');
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function nowStr() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'h:mm:ss a');
}

function todayStr() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

// Accepts a date (yyyy-MM-dd) or a full date and time (yyyy-MM-dd HH:mm:ss).
function isValidOccurrence(value) {
  return /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}:\d{2})?$/.test(String(value || '').trim());
}

// Returns a valid occurrence string, defaulting to today when the input is
// blank or malformed.
function normalizeOccurrence(occurrence) {
  occurrence = String(occurrence || '').trim();
  return isValidOccurrence(occurrence) ? occurrence : todayStr();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, function(c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

// Friendly page shown when the URL has no valid event_id.
function renderSetupPage(badValue) {
  var note = '';
  if (badValue) {
    note = '<p style="color:#ff8a80">"' + escapeHtml(badValue) +
      '" is not a valid event id. ChMS event ids are numbers.</p>';
  }
  var html =
    '<!DOCTYPE html><html><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<style>body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;' +
    'background:#111;color:#fff;margin:0;padding:48px;line-height:1.5}' +
    'code{background:#222;padding:2px 6px;border-radius:4px}' +
    'h1{margin:0 0 12px}</style></head><body>' +
    '<h1>Room Roster Display</h1>' +
    '<p>Add a classroom event id to this page URL, like ' +
    '<code>?event_id=12345</code></p>' +
    note +
    '<p style="color:#888;margin-top:32px">Find a room\'s event id in ChMS by opening its recurring ' +
    'check-in event. The id is the number in the event URL.</p>' +
    '</body></html>';
  return HtmlService.createHtmlOutput(html).setTitle('Room Roster');
}

// ---------------------------------------------------------------------------
// Setup and diagnostics. Run these from the editor while configuring.
// ---------------------------------------------------------------------------

/**
 * Logs whether the three required properties are present. Does not print the
 * values, so it is safe to run and share the log.
 */
function showConfigStatus() {
  var props = PropertiesService.getScriptProperties();
  var report = {
    CCB_SUBDOMAIN: props.getProperty('CCB_SUBDOMAIN') ? 'set' : 'MISSING',
    CCB_API_USER: props.getProperty('CCB_API_USER') ? 'set' : 'MISSING',
    CCB_API_PASS: props.getProperty('CCB_API_PASS') ? 'set' : 'MISSING',
    timezone: Session.getScriptTimeZone(),
    today: todayStr()
  };
  Logger.log(JSON.stringify(report, null, 2));
  return report;
}

/**
 * One test call for a given event id. Logs the raw ChMS XML and the parsed
 * result so you can confirm credentials, the event id, and the occurrence
 * format all work before setting up an iPad.
 *
 * Usage from the editor:
 *   debugFetch('12345')                 uses today's date
 *   debugFetch('12345', '2026-09-07')   uses a specific date
 */
function debugFetch(eventId, occurrence) {
  eventId = String(eventId || '').trim();
  if (!/^\d+$/.test(eventId)) {
    Logger.log('Pass a numeric event id, e.g. debugFetch("12345").');
    return;
  }
  occurrence = normalizeOccurrence(occurrence);

  var props = PropertiesService.getScriptProperties();
  var subdomain = props.getProperty('CCB_SUBDOMAIN');
  var user = props.getProperty('CCB_API_USER');
  var pass = props.getProperty('CCB_API_PASS');
  if (!subdomain || !user || !pass) {
    Logger.log('Set CCB_SUBDOMAIN, CCB_API_USER, and CCB_API_PASS first (see showConfigStatus).');
    return;
  }

  var url = 'https://' + encodeURIComponent(subdomain) + '.ccbchurch.com/api.php' +
    '?srv=attendance_profile&id=' + encodeURIComponent(eventId) +
    '&occurrence=' + encodeURIComponent(occurrence);

  var response = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: { Authorization: 'Basic ' + Utilities.base64Encode(user + ':' + pass) },
    muteHttpExceptions: true
  });

  Logger.log('HTTP ' + response.getResponseCode() + ' for occurrence ' + occurrence);
  Logger.log('--- RAW XML ---');
  Logger.log(response.getContentText());
  Logger.log('--- PARSED ---');
  Logger.log(JSON.stringify(parseAttendance(response.getContentText(), occurrence), null, 2));
}
