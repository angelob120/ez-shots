/**
 * EZ Shots bookings into this Google Sheet and your Google Calendar.
 *
 * The website POSTs every paid booking here, and again whenever it changes
 * (accepted, declined, refunded, cancelled). This script keeps one row per
 * booking on a tab called "Bookings" and one event per shoot on your calendar.
 *
 * SET UP, once:
 *   1. Make a new Google Sheet. Extensions, Apps Script. Delete what is there
 *      and paste this whole file. Save.
 *   2. Project Settings (the gear), Script properties, Add script property:
 *        SECRET        the same value as GOOGLE_SCRIPT_SECRET in Railway
 *        CALENDAR_ID   optional. Leave it out to use your main calendar.
 *   3. Back in the editor pick "authorize" in the function menu and press Run.
 *      Google asks for permission to use your sheet and calendar. Allow it.
 *   4. Deploy, New deployment, type Web app.
 *        Execute as: Me
 *        Who has access: Anyone
 *      Deploy, and copy the Web app URL into GOOGLE_SCRIPT_URL in Railway.
 *
 * "Anyone" only means the website can reach it without signing in to Google.
 * Nothing happens without the SECRET, and the script only ever writes.
 *
 * If you edit this file later: Deploy, Manage deployments, edit the existing
 * one and pick "New version". A brand new deployment gets a new URL.
 */

var HEADERS = [
  "Booking", "Status", "Shoot date", "Time", "Address", "Package", "Paid", "Refunded",
  "Name", "Email", "Phone", "Brokerage", "Size", "Occupancy", "Access", "Access notes",
  "Client notes", "Admin", "Calendar event", "Updated (ms)"
];
var COL_EVENT = 19;   // 1 based, "Calendar event"
var COL_UPDATED = 20; // 1 based, "Updated (ms)"

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var body = JSON.parse(e.postData.contents);
    var props = PropertiesService.getScriptProperties();
    var secret = props.getProperty("SECRET");
    if (!secret || !body || body.secret !== secret) return reply({ ok: false, error: "bad secret" });

    var b = body.booking;
    var sheet = bookingsSheet();
    var row = findRow(sheet, b.id);
    var eventId = "";
    if (row) {
      var have = sheet.getRange(row, 1, 1, HEADERS.length).getValues()[0];
      if (Number(have[COL_UPDATED - 1] || 0) > Number(b.updatedMs || 0)) {
        return reply({ ok: true, skipped: "older than the row" });
      }
      eventId = String(have[COL_EVENT - 1] || "");
    }

    eventId = syncCalendar(props, b, eventId);

    var values = [
      b.id, b.statusLabel, b.date, b.time, text(b.address), text(b.packageName), b.amount, b.refunded,
      text(b.name), text(b.email), text(b.phone), text(b.brokerage), text(b.size), text(b.occupancy),
      text(b.access), text(b.accessNotes), text(b.notes), b.adminUrl, eventId, b.updatedMs
    ];
    if (row) sheet.getRange(row, 1, 1, values.length).setValues([values]);
    else sheet.appendRow(values);
    return reply({ ok: true, eventId: eventId });
  } catch (err) {
    return reply({ ok: false, error: String((err && err.message) || err) });
  } finally {
    lock.releaseLock();
  }
}

// Run this once from the editor so Google asks for permission.
function authorize() {
  bookingsSheet();
  CalendarApp.getDefaultCalendar().getName();
}

function syncCalendar(props, b, eventId) {
  var calId = props.getProperty("CALENDAR_ID");
  var cal = calId ? CalendarApp.getCalendarById(calId) : CalendarApp.getDefaultCalendar();
  var ev = null;
  if (eventId) {
    try { ev = cal.getEventById(eventId); } catch (x) { ev = null; }
  }

  // Declined or cancelled: take it off the calendar so the time reads free.
  if (!b.onCalendar) {
    if (ev) ev.deleteEvent();
    return "";
  }

  var title = (b.accepted ? "" : "[Needs OK] ") + "EZ Shots: " + b.address;
  var start = new Date(b.startsAt);
  var end = new Date(b.endsAt);
  var description = [
    b.packageName + ", paid $" + b.amount + (b.refunded ? ", refunded $" + b.refunded : ""),
    "Status: " + b.statusLabel,
    "",
    "Client: " + b.name,
    "Phone: " + b.phone,
    "Email: " + b.email,
    b.brokerage ? "Brokerage: " + b.brokerage : "",
    b.size ? "Size: " + b.size : "",
    b.occupancy ? "Occupancy: " + b.occupancy : "",
    b.access ? "Access: " + b.access : "",
    b.accessNotes ? "Access notes: " + b.accessNotes : "",
    b.notes ? "Notes: " + b.notes : "",
    "",
    "Booking " + b.id,
    b.adminUrl
  ].filter(function (line, i, all) { return line !== "" || (all[i - 1] !== ""); }).join("\n");

  if (ev) {
    ev.setTitle(title);
    ev.setTime(start, end);
    ev.setLocation(b.address);
    ev.setDescription(description);
  } else {
    ev = cal.createEvent(title, start, end, { location: b.address, description: description });
  }
  return ev.getId();
}

function bookingsSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("Bookings");
  if (!sheet) {
    sheet = ss.insertSheet("Bookings");
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight("bold");
  }
  return sheet;
}

function findRow(sheet, id) {
  var hit = sheet.getRange("A:A").createTextFinder(id).matchEntireCell(true).findNext();
  return hit ? hit.getRow() : 0;
}

// A client can type anything into notes. A cell that starts with = + - or @
// would run as a formula, so it is stored as plain text instead.
function text(v) {
  v = String(v == null ? "" : v);
  return /^[=+\-@]/.test(v) ? "'" + v : v;
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
