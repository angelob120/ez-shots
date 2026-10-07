// Postgres: the one place the business's state lives.
//
// Two things are kept here. The live config (packages, prices, availability),
// which used to be a JSON file in DATA_DIR that Railway wiped on every deploy
// because nobody had added the volume. And the bookings, which are what stops
// two agents picking the same 1:00 PM.
//
// WHY THIS AND NOT A FILE
// A file needs a volume, and a volume is one more thing to forget. The Railway
// Postgres has its own, and a database is the right tool for "is this slot
// free, and if so take it" under two requests at once. hold() below runs in a
// transaction behind an advisory lock on the slot, so the second request for
// the same time waits for the first and then finds it gone. A partial unique
// index in the migration guarantees two confirmed bookings can never share a
// slot even if every line of this file is wrong.
//
// Schema changes are SQL files in server/migrations, applied in name order on
// boot and recorded in schema_migrations. Never edit an applied one, add the
// next number.
//
// The booking object the rest of the server sees is camelCase; the columns are
// snake_case. row() and col() translate, nothing else knows the difference.
"use strict";

const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { Pool, types } = require("pg");

// A DATE column comes back as the "YYYY-MM-DD" it was stored as, not as a JS
// Date at local midnight that then has to be turned back into a string.
types.setTypeParser(1082, v => v);

const MIGRATIONS = path.join(__dirname, "migrations");

function snake(k) { return k.replace(/[A-Z]/g, c => "_" + c.toLowerCase()); }
function camel(k) { return k.replace(/_([a-z])/g, (m, c) => c.toUpperCase()); }

function fromRow(r) {
  if (!r) return null;
  const out = {};
  for (const [k, v] of Object.entries(r)) out[camel(k)] = v instanceof Date ? v.toISOString() : v;
  out.number = Number(out.number);
  return out;
}

// bigint and numeric come back from pg as strings, so they are turned into
// numbers here; a photo's size is never near 2^53.
const PHOTO_NUMS = ["id", "originalSize", "editedSize", "highResSize", "lowResSize", "derivedSize", "aiCostEstimate"];
function photoRow(r) {
  const p = fromRow(r);
  if (!p) return null;
  delete p.number;
  for (const k of PHOTO_NUMS) p[k] = Number(p[k] || 0);
  return p;
}

function changeRow(r) {
  if (!r) return null;
  return {
    id: r.id, bookingId: r.booking_id, photoIds: (r.photo_ids || []).map(Number), photos: r.photo_labels, message: r.message,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
    resolvedAt: r.resolved_at instanceof Date ? r.resolved_at.toISOString() : r.resolved_at
  };
}

function fromFile(r) {
  return {
    id: r.id, bookingId: r.booking_id, kind: r.kind, name: r.name, mime: r.mime, size: r.size,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at
  };
}

class Db {
  constructor(url) {
    // The public proxy URL carries sslmode=require and the image's certificate
    // is self signed, so that is the one case the certificate is not checked.
    // Inside Railway the private network is used with no TLS at all.
    this.pool = new Pool({
      connectionString: url,
      ssl: /sslmode=require/.test(url) ? { rejectUnauthorized: false } : undefined,
      max: 5
    });
    this.pool.on("error", e => console.error("[ez-shots] postgres:", e.message));
  }

  query(text, params) { return this.pool.query(text, params); }

  async migrate() {
    const c = await this.pool.connect();
    try {
      // One instance runs the migrations while any other waits.
      await c.query("SELECT pg_advisory_lock(7220)");
      await c.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
      const done = new Set((await c.query("SELECT name FROM schema_migrations")).rows.map(r => r.name));
      const files = (await fsp.readdir(MIGRATIONS)).filter(f => f.endsWith(".sql")).sort();
      for (const f of files) {
        if (done.has(f)) continue;
        const sql = await fsp.readFile(path.join(MIGRATIONS, f), "utf8");
        await c.query("BEGIN");
        try {
          await c.query(sql);
          await c.query("INSERT INTO schema_migrations (name) VALUES ($1)", [f]);
          await c.query("COMMIT");
          console.log("[ez-shots] applied migration " + f);
        } catch (e) {
          await c.query("ROLLBACK");
          throw e;
        }
      }
      await c.query("SELECT pg_advisory_unlock(7220)");
    } finally {
      c.release();
    }
  }

  // ---- config -----------------------------------------------------------
  async getConfig() {
    const r = await this.query("SELECT value FROM settings WHERE key = 'config'");
    return r.rowCount ? r.rows[0].value : null;
  }

  async setConfig(cfg) {
    await this.query(
      "INSERT INTO settings (key, value, updated_at) VALUES ('config', $1, now()) " +
      "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()",
      [JSON.stringify(cfg)]);
  }

  // ---- bookings ---------------------------------------------------------
  // The SQL for "this booking owns its slot": confirmed, or held with time left.
  static get ACTIVE() { return "(status = 'confirmed' OR (status = 'held' AND expires_at > $NOW))"; }

  active(nowParam) { return Db.ACTIVE.replace("$NOW", nowParam); }

  // Map of "YYYY-MM-DD" to the Set of slots taken that day, for the window.
  async takenByDate(from, to, now = new Date()) {
    const r = await this.query(
      `SELECT date, time FROM bookings WHERE date >= $1 AND date <= $2 AND ${this.active("$3")}`,
      [from, to, now]);
    const out = new Map();
    for (const row of r.rows) {
      if (!out.has(row.date)) out.set(row.date, new Set());
      out.get(row.date).add(row.time);
    }
    return out;
  }

  // Take the slot, or return null if someone else has it. The advisory lock is
  // keyed on the slot, so two holds for the same time run one after the other
  // and holds for different times do not wait on each other.
  async hold(fields, ttlMs, now = new Date()) {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [fields.date + "|" + fields.time]);
      const clash = await c.query(
        `SELECT id FROM bookings WHERE date = $1 AND time = $2 AND ${this.active("$3")} LIMIT 1`,
        [fields.date, fields.time, now]);
      if (clash.rowCount) { await c.query("ROLLBACK"); return null; }

      const n = Number((await c.query("SELECT nextval('bookings_number_seq') AS n")).rows[0].n);
      const row = Object.assign({}, fields, {
        number: n,
        id: "EZ-" + String(n).padStart(6, "0"),
        status: "held",
        paid: false,
        token: crypto.randomBytes(16).toString("hex"),
        expiresAt: new Date(now.getTime() + ttlMs),
        createdAt: now,
        updatedAt: now
      });
      const keys = Object.keys(row);
      const r = await c.query(
        `INSERT INTO bookings (${keys.map(snake).join(", ")}) VALUES (${keys.map((k, i) => "$" + (i + 1)).join(", ")}) RETURNING *`,
        keys.map(k => row[k]));
      await c.query("COMMIT");
      return fromRow(r.rows[0]);
    } catch (e) {
      await c.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }

  async find(id) {
    const r = await this.query("SELECT * FROM bookings WHERE id = $1", [id]);
    return fromRow(r.rows[0]);
  }

  async bySession(sid) {
    if (!sid) return null;
    const r = await this.query("SELECT * FROM bookings WHERE stripe_session_id = $1", [sid]);
    return fromRow(r.rows[0]);
  }

  async byToken(tok) {
    if (!tok) return null;
    const r = await this.query("SELECT * FROM bookings WHERE token = $1", [tok]);
    return fromRow(r.rows[0]);
  }

  async update(id, patch, now = new Date()) {
    const keys = Object.keys(patch);
    if (!keys.length) return this.find(id);
    const sets = keys.map((k, i) => `${snake(k)} = $${i + 2}`);
    sets.push(`updated_at = $${keys.length + 2}`);
    const r = await this.query(
      `UPDATE bookings SET ${sets.join(", ")} WHERE id = $1 RETURNING *`,
      [id, ...keys.map(k => patch[k]), now]);
    return fromRow(r.rows[0]);
  }

  // Paid at booking, the old model, kept for a hold that was taken before the
  // switch and is paid for after it. Idempotent: the webhook and the success page can both call it, and
  // the unique index refuses a second confirmed booking on the slot, which
  // surfaces here as an error rather than a silent double booking.
  async confirm(id, payment = {}, now = new Date()) {
    const b = await this.find(id);
    if (!b) return null;
    if (b.status === "confirmed") return b;
    return this.update(id, Object.assign({ status: "confirmed", paid: true, paidAt: now, expiresAt: null }, payment), now);
  }

  // Paid after the shoot. Conditional on not being paid yet, so the webhook
  // and the success page, or Stripe sending the same event twice, can only
  // turn it into paid once. Returns the row only to the caller that did it;
  // everyone else gets null and sends no delivery email.
  async markPaid(id, payment = {}, now = new Date()) {
    const keys = Object.keys(payment);
    const sets = keys.map((k, i) => `${snake(k)} = $${i + 3}`);
    const r = await this.query(
      "UPDATE bookings SET paid = true, paid_at = $2, stage = 'delivered', delivered_at = $2, updated_at = $2, " +
      "downloads_unlocked_at = COALESCE(downloads_unlocked_at, $2)" +
      (sets.length ? ", " + sets.join(", ") : "") +
      " WHERE id = $1 AND paid = false AND status = 'confirmed' RETURNING *",
      [id, now, ...keys.map(k => payment[k])]);
    return fromRow(r.rows[0]);
  }

  // Stamp a one off email as sent, once. Same trick as claimNotify: whoever
  // wins the update sends.
  async claim(id, column, now = new Date()) {
    if (!["reminded_at", "review_sent_at"].includes(column)) throw new Error("bad claim column");
    const r = await this.query(`UPDATE bookings SET ${column} = $2 WHERE id = $1 AND ${column} IS NULL RETURNING id`, [id, now]);
    return r.rowCount === 1;
  }

  async unclaim(id, column) {
    if (!["reminded_at", "review_sent_at"].includes(column)) throw new Error("bad claim column");
    await this.query(`UPDATE bookings SET ${column} = NULL WHERE id = $1`, [id]);
  }

  // Shoots starting within the next day that have not had their reminder.
  // Booked from the site only up to a day ahead is not possible (the notice
  // window), so one reminder is enough; an owner booking for tomorrow still
  // gets one.
  async dueReminders(now = new Date(), aheadMs = 24 * 3600 * 1000) {
    const r = await this.query(
      "SELECT * FROM bookings WHERE status = 'confirmed' AND stage = 'booked' AND flagged_at IS NULL " +
      "AND reminded_at IS NULL AND email <> '' AND starts_at > $1 AND starts_at <= $2 ORDER BY starts_at",
      [now, new Date(now.getTime() + aheadMs)]);
    return r.rows.map(fromRow);
  }

  // Paid, delivered a day ago, not flagged, nothing refunded, no review asked.
  async dueReviews(now = new Date(), afterMs = 24 * 3600 * 1000) {
    const r = await this.query(
      "SELECT * FROM bookings WHERE status = 'confirmed' AND paid = true AND stage = 'delivered' " +
      "AND flagged_at IS NULL AND refunded_cents = 0 AND review_sent_at IS NULL AND email <> '' " +
      "AND delivered_at IS NOT NULL AND delivered_at <= $1 ORDER BY delivered_at",
      [new Date(now.getTime() - afterMs)]);
    return r.rows.map(fromRow);
  }

  // Claim the right to send the confirmation emails for this booking. The
  // webhook and the success page both reach confirmFromSession, and on a fast
  // redirect both get there; whichever wins this update sends, and the other
  // gets no row back and sends nothing. It has to be claimed BEFORE the emails
  // go out, not after, or the race is still open for the length of two HTTP
  // emails going out.
  async claimNotify(id, now = new Date()) {
    const r = await this.query(
      "UPDATE bookings SET notified_at = $2 WHERE id = $1 AND notified_at IS NULL RETURNING id",
      [id, now]);
    return r.rowCount === 1;
  }

  // Give the claim back, so a send that failed outright can be retried by the
  // next caller rather than being silently swallowed for good.
  async releaseNotify(id) {
    await this.query("UPDATE bookings SET notified_at = NULL WHERE id = $1", [id]);
  }

  // Money that went back, added once per Stripe refund id. Two clicks that reach
  // Stripe with the same idempotency key get the same refund back, and the
  // second update here finds that id already recorded and changes nothing.
  async recordRefund(id, refundId, cents, now = new Date()) {
    const r = await this.query(
      "UPDATE bookings SET refunded_cents = refunded_cents + $3, refunded_at = $4, updated_at = $4, " +
      "stripe_refund_ids = CASE WHEN stripe_refund_ids = '' THEN $2::text ELSE stripe_refund_ids || ',' || $2::text END " +
      "WHERE id = $1 AND position(',' || $2::text || ',' IN ',' || stripe_refund_ids || ',') = 0 RETURNING *",
      [id, refundId, cents, now]);
    return fromRow(r.rows[0]);
  }

  async cancel(id, by, now = new Date()) {
    return this.update(id, { status: "cancelled", cancelledAt: now, cancelledBy: by || "owner" }, now);
  }

  // Let a hold go early: the Stripe session expired, or the customer went back
  // and picked another time.
  async release(id, now = new Date()) {
    const b = await this.find(id);
    if (!b || b.status !== "held") return b;
    return this.update(id, { expiresAt: now }, now);
  }

  // Whoever else holds this slot right now, for the owner marking an old hold
  // paid by hand after the slot may have gone to someone else.
  async clash(date, time, exceptId, now = new Date()) {
    const r = await this.query(
      `SELECT id FROM bookings WHERE date = $1 AND time = $2 AND id <> $3 AND ${this.active("$4")} LIMIT 1`,
      [date, time, exceptId || "", now]);
    return r.rowCount ? r.rows[0].id : null;
  }

  // Move a booking to another date and time, for the owner rescheduling from
  // admin. Same lock and clash check as hold(), so a move cannot land on a slot
  // somebody is paying for right now. Returns null when the slot is taken.
  async move(id, date, time, startsAt, now = new Date()) {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [date + "|" + time]);
      const clash = await c.query(
        `SELECT id FROM bookings WHERE date = $1 AND time = $2 AND id <> $3 AND ${this.active("$4")} LIMIT 1`,
        [date, time, id, now]);
      if (clash.rowCount) { await c.query("ROLLBACK"); return null; }
      const r = await c.query(
        "UPDATE bookings SET date = $2, time = $3, starts_at = $4, updated_at = $5 WHERE id = $1 RETURNING *",
        [id, date, time, startsAt, now]);
      await c.query("COMMIT");
      return fromRow(r.rows[0]);
    } catch (e) {
      await c.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }

  // How many confirmed bookings each client has ever had, by lowercased email.
  // The admin page uses it to spot a returning client who took the first shoot
  // price, which nothing else checks.
  // ---- how much has been booked from the site lately ---------------------
  // What the booking limits in server.js are worked out from. Cancelled ones
  // count for the address and the total, so booking and cancelling over and
  // over is no way around them.
  async bookingPressure(ip, email, phone, now = new Date()) {
    const day = new Date(now.getTime() - 24 * 3600 * 1000);
    const r = await this.query(
      "SELECT " +
      "count(*) FILTER (WHERE client_ip = $1 AND client_ip <> '') AS by_ip, " +
      "count(*) AS total " +
      "FROM bookings WHERE source = 'site' AND created_at > $2",
      [ip, day]);
    const c = await this.query(
      "SELECT count(*) AS n FROM bookings WHERE source = 'site' AND status = 'confirmed' AND starts_at > $1 " +
      "AND (lower(email) = $2 OR ($3 <> '' AND regexp_replace(phone, '\\D', '', 'g') = $3))",
      [now, String(email).toLowerCase(), String(phone).replace(/\D/g, "")]);
    return { byIp: Number(r.rows[0].by_ip), total: Number(r.rows[0].total), upcoming: Number(c.rows[0].n) };
  }

  // ---- the client's watermark and reference photos ----------------------
  // Everything but the bytes, for lists. The bytes only leave in file().
  static get FILE_META() { return "f.id, f.booking_id, f.kind, f.name, f.mime, f.size, f.created_at"; }

  async addFile(bookingId, kind, name, mime, data) {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      // A booking has one watermark; a new one replaces it.
      if (kind === "watermark") await c.query("DELETE FROM booking_files WHERE booking_id = $1 AND kind = 'watermark'", [bookingId]);
      const r = await c.query(
        `INSERT INTO booking_files AS f (booking_id, kind, name, mime, size, data) VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${Db.FILE_META}`,
        [bookingId, kind, name, mime, data.length, data]);
      await c.query("COMMIT");
      return fromFile(r.rows[0]);
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }

  async deleteFile(bookingId, id) {
    const r = await this.query("DELETE FROM booking_files WHERE booking_id = $1 AND id = $2", [bookingId, id]);
    return r.rowCount > 0;
  }

  async file(id) {
    const r = await this.query(`SELECT ${Db.FILE_META}, f.data FROM booking_files f WHERE f.id = $1`, [id]);
    return r.rowCount ? Object.assign(fromFile(r.rows[0]), { data: r.rows[0].data }) : null;
  }

  // The files of these bookings, plus the newest watermark each of their
  // clients has added to any booking. A brokerage logo does not change
  // between listings, so a returning agent should not have to upload it
  // again. Returns a function of a booking to { watermark, references }.
  async filesFor(bookings) {
    if (!bookings.length) return () => ({ watermark: null, references: [] });
    const ids = bookings.map(b => b.id);
    const emails = [...new Set(bookings.map(b => String(b.email || "").toLowerCase()).filter(Boolean))];
    const r = await this.query(
      `SELECT ${Db.FILE_META}, lower(b.email) AS email FROM booking_files f JOIN bookings b ON b.id = f.booking_id ` +
      "WHERE f.booking_id = ANY($1) OR (f.kind = 'watermark' AND lower(b.email) = ANY($2)) ORDER BY f.created_at, f.id",
      [ids, emails]);
    const rows = r.rows.map(x => Object.assign(fromFile(x), { email: x.email }));
    return b => {
      const own = rows.filter(f => f.bookingId === b.id);
      const email = String(b.email || "").toLowerCase();
      const mine = own.filter(f => f.kind === "watermark").pop();
      const saved = email ? rows.filter(f => f.kind === "watermark" && f.email === email).pop() : null;
      const strip = f => { if (!f) return null; const o = Object.assign({}, f); delete o.email; return o; };
      return {
        watermark: strip(mine || saved) && Object.assign(strip(mine || saved), { fromEarlier: !mine }),
        references: own.filter(f => f.kind === "reference").map(strip)
      };
    };
  }

  // Has this client had a confirmed shoot before? By email, or by phone
  // written any way. What the $99 first shoot price is checked against.
  async bookedBefore(email, phone) {
    const digits = String(phone || "").replace(/\D/g, "").slice(-10);
    const r = await this.query(
      "SELECT 1 FROM bookings WHERE status = 'confirmed' AND (lower(email) = $1 OR ($2 <> '' AND right(regexp_replace(phone, '\\D', '', 'g'), 10) = $2)) LIMIT 1",
      [String(email || "").toLowerCase(), digits.length >= 7 ? digits : ""]);
    return r.rowCount > 0;
  }

  async clientCounts() {
    const r = await this.query("SELECT lower(email) AS email, count(*) AS n FROM bookings WHERE status = 'confirmed' GROUP BY lower(email)");
    const out = new Map();
    for (const row of r.rows) out.set(row.email, Number(row.n));
    return out;
  }

  // Everything from a date on, newest first within a day, for the admin list.
  async list(from, to) {
    const r = await this.query(
      "SELECT * FROM bookings WHERE date >= $1 AND date <= $2 ORDER BY date, starts_at, number",
      [from, to]);
    return r.rows.map(fromRow);
  }

  // ---- photos: the shoot uploaded to a booking --------------------------
  // See server/migrations/009_fulfillment.sql for what each column means.

  async photos(bookingId) {
    const r = await this.query("SELECT * FROM photos WHERE booking_id = $1 ORDER BY sort_order, id", [bookingId]);
    return r.rows.map(photoRow);
  }

  async photo(bookingId, id) {
    const r = await this.query("SELECT * FROM photos WHERE booking_id = $1 AND id = $2", [bookingId, id]);
    return photoRow(r.rows[0]);
  }

  // A new photo at the end of the job. The same bytes twice in one booking
  // hit the unique index and come back as { duplicate } instead.
  async addPhoto(f) {
    const r = await this.query(
      "INSERT INTO photos (booking_id, original_filename, sort_order, sha256, mime_type, original_storage_key, source_thumb_key, " +
      "source_preview_key, original_width, original_height, original_size) " +
      "VALUES ($1, $2, COALESCE((SELECT max(sort_order) + 1 FROM photos WHERE booking_id = $1), 0), $3, $4, $5, $6, $7, $8, $9, $10) " +
      "ON CONFLICT (booking_id, sha256) DO NOTHING RETURNING *",
      [f.bookingId, f.originalFilename, f.sha256, f.mimeType, f.originalStorageKey, f.sourceThumbKey, f.sourcePreviewKey,
        f.originalWidth, f.originalHeight, f.originalSize]);
    return photoRow(r.rows[0]);
  }

  async findPhotoBySha(bookingId, sha) {
    const r = await this.query("SELECT * FROM photos WHERE booking_id = $1 AND sha256 = $2", [bookingId, sha]);
    return photoRow(r.rows[0]);
  }

  async updatePhoto(id, patch, where = "") {
    const keys = Object.keys(patch);
    const sets = keys.map((k, i) => `${snake(k)} = $${i + 2}`);
    sets.push("updated_at = now()");
    const r = await this.query(`UPDATE photos SET ${sets.join(", ")} WHERE id = $1 ${where} RETURNING *`, [id, ...keys.map(k => patch[k])]);
    return photoRow(r.rows[0]);
  }

  // The same change to many photos of one booking at once: the bulk actions.
  // `where` narrows it further, so "queue these" never touches a photo that
  // is already being edited.
  async updatePhotos(bookingId, ids, patch, where = "") {
    const keys = Object.keys(patch);
    const sets = keys.map((k, i) => `${snake(k)} = $${i + 3}`);
    sets.push("updated_at = now()");
    const r = await this.query(
      `UPDATE photos SET ${sets.join(", ")} WHERE booking_id = $1 AND id = ANY($2::bigint[]) ${where} RETURNING *`,
      [bookingId, ids, ...keys.map(k => patch[k])]);
    return r.rows.map(photoRow);
  }

  async deletePhotos(bookingId, ids) {
    const r = await this.query(
      "DELETE FROM photos WHERE booking_id = $1 AND id = ANY($2::bigint[]) AND ai_edit_status <> 'processing' RETURNING *",
      [bookingId, ids]);
    return r.rows.map(photoRow);
  }

  // The order the owner dragged them into. Ids not named keep their place
  // after the named ones.
  async reorderPhotos(bookingId, ids) {
    await this.query(
      "UPDATE photos p SET sort_order = o.n - 1, updated_at = now() FROM unnest($2::bigint[]) WITH ORDINALITY AS o(id, n) " +
      "WHERE p.booking_id = $1 AND p.id = o.id", [bookingId, ids]);
    await this.query(
      "UPDATE photos SET sort_order = sort_order + $3 WHERE booking_id = $1 AND NOT (id = ANY($2::bigint[]))",
      [bookingId, ids, ids.length]);
  }

  // The next photos for the AI editor, taken so no other worker can take them.
  // The attempt is counted here, before the call, so a server that dies mid
  // edit still has it on the record and a photo can never be retried forever.
  async claimEdits(n, now = new Date()) {
    const r = await this.query(
      "UPDATE photos SET ai_edit_status = 'processing', locked_at = $2, ai_attempt_count = ai_attempt_count + 1, updated_at = $2 " +
      "WHERE id IN (SELECT id FROM photos WHERE ai_edit_status = 'queued' AND (next_attempt_at IS NULL OR next_attempt_at <= $2) " +
      "ORDER BY next_attempt_at NULLS FIRST, booking_id, sort_order, id LIMIT $1 FOR UPDATE SKIP LOCKED) RETURNING *",
      [n, now]);
    return r.rows.map(photoRow);
  }

  // Photos a restarted server left half done. One whose master was saved only
  // needs its sizes made again, which costs nothing; one without goes back in
  // the queue if it has attempts left, and fails if not.
  async staleEdits(olderThan) {
    const r = await this.query("SELECT * FROM photos WHERE ai_edit_status = 'processing' AND locked_at < $1", [olderThan]);
    return r.rows.map(photoRow);
  }

  async editCounts() {
    const r = await this.query("SELECT ai_edit_status AS s, count(*) AS n FROM photos WHERE ai_edit_status IN ('queued', 'processing') GROUP BY 1");
    const out = { queued: 0, processing: 0 };
    for (const row of r.rows) out[row.s] = Number(row.n);
    return out;
  }

  // Per booking numbers for the admin list: how far each job's photos are.
  async photoSummary(ids) {
    if (!ids.length) return new Map();
    const r = await this.query(
      "SELECT booking_id, count(*) AS total, count(*) FILTER (WHERE selected_for_delivery) AS finals, " +
      "count(*) FILTER (WHERE ai_edit_status IN ('queued', 'processing')) AS editing, " +
      "count(*) FILTER (WHERE ai_edit_status = 'failed') AS failed " +
      "FROM photos WHERE booking_id = ANY($1) GROUP BY booking_id", [ids]);
    const c = await this.query(
      "SELECT booking_id, count(*) AS n FROM change_requests WHERE booking_id = ANY($1) AND resolved_at IS NULL GROUP BY booking_id", [ids]);
    const open = new Map(c.rows.map(x => [x.booking_id, Number(x.n)]));
    const out = new Map(r.rows.map(x => [x.booking_id, { total: Number(x.total), finals: Number(x.finals), editing: Number(x.editing), failed: Number(x.failed), changes: open.get(x.booking_id) || 0 }]));
    for (const [id, n] of open) if (!out.has(id)) out.set(id, { total: 0, finals: 0, editing: 0, failed: 0, changes: n });
    return out;
  }

  // ---- change requests from the gallery ----------------------------------
  async addChange(bookingId, photoIds, labels, message) {
    const r = await this.query(
      "INSERT INTO change_requests (booking_id, photo_ids, photo_labels, message) VALUES ($1, $2::bigint[], $3, $4) RETURNING *",
      [bookingId, photoIds, labels, message]);
    return changeRow(r.rows[0]);
  }

  async changes(bookingId) {
    const r = await this.query("SELECT * FROM change_requests WHERE booking_id = $1 ORDER BY created_at DESC", [bookingId]);
    return r.rows.map(changeRow);
  }

  async changesToday(bookingId) {
    const r = await this.query("SELECT count(*) AS n FROM change_requests WHERE booking_id = $1 AND created_at > now() - interval '1 day'", [bookingId]);
    return Number(r.rows[0].n);
  }

  async resolveChange(bookingId, id, done) {
    const r = await this.query("UPDATE change_requests SET resolved_at = $3 WHERE booking_id = $1 AND id = $2 RETURNING *",
      [bookingId, id, done ? new Date() : null]);
    return changeRow(r.rows[0]);
  }

  async byGallery(tok) {
    if (!tok) return null;
    const r = await this.query("SELECT * FROM bookings WHERE gallery_token = $1", [tok]);
    return fromRow(r.rows[0]);
  }

  // Stamp a booking column once; whoever wins the update does the thing.
  async claimOnce(id, column, now = new Date()) {
    if (!["gallery_first_viewed_at", "delivery_email_sent_at", "sms_copied_at"].includes(column)) throw new Error("bad claim column");
    const r = await this.query(`UPDATE bookings SET ${column} = $2 WHERE id = $1 AND ${column} IS NULL RETURNING id`, [id, now]);
    return r.rowCount === 1;
  }

  async close() { await this.pool.end(); }
}

module.exports = { Db };
