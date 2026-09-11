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
// boot and recorded in schema_migrations. Never edit an applied one, add 002.
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

  // Paid. Idempotent: the webhook and the success page can both call it, and
  // the unique index refuses a second confirmed booking on the slot, which
  // surfaces here as an error rather than a silent double booking.
  async confirm(id, payment = {}, now = new Date()) {
    const b = await this.find(id);
    if (!b) return null;
    if (b.status === "confirmed") return b;
    return this.update(id, Object.assign({ status: "confirmed", paid: true, paidAt: now, expiresAt: null }, payment), now);
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

  // Everything from a date on, newest first within a day, for the admin list.
  async list(from, to) {
    const r = await this.query(
      "SELECT * FROM bookings WHERE date >= $1 AND date <= $2 ORDER BY date, starts_at, number",
      [from, to]);
    return r.rows.map(fromRow);
  }

  async close() { await this.pool.end(); }
}

module.exports = { Db };
