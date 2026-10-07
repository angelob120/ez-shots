// Where the photos live. Postgres holds what a photo is; the bytes live here.
//
// Three providers behind one small interface, so the rest of the server never
// knows which one it has:
//
//   postgres  the Railway Postgres the bookings already live in. The owner's
//          choice on 2026-10-06: everything on Railway, nothing else to set
//          up. Files are split into 8 MB pieces (migration 012), so a big
//          video fits and a range request reads only what it needs. This is
//          the default whenever there is a DATABASE_URL and no bucket.
//   s3     any S3 compatible bucket: Cloudflare R2, a Railway bucket, Amazon
//          S3, Backblaze B2. Signed with AWS Signature Version 4 by hand, the
//          same way server/stripe.js talks to Stripe without an SDK. Path
//          style addresses (endpoint/bucket/key), which all of those accept.
//   local  a folder on disk. For a laptop only: a Railway container's disk is
//          wiped on every deploy, so production refuses to use it unless
//          STORAGE_DIR is set on purpose (a mounted volume).
//
// The interface:
//   put(key, source, type)   source is a Buffer or a path to a file on disk
//   get(key, range)          { status, stream, length, type, range } or null
//   buffer(key)              the whole object, for image processing
//   remove(key)
//   name                     "postgres", "s3" or "local", for admin status
//
// The client never sees a storage address. Every byte a browser gets is
// streamed through the server after it has checked who is asking, which is
// what keeps an unpaid gallery's full resolution files locked.
//
// ENV
//   OBJECT_STORAGE_ENDPOINT           https://<account>.r2.cloudflarestorage.com, or the bucket host
//   OBJECT_STORAGE_BUCKET
//   OBJECT_STORAGE_ACCESS_KEY_ID
//   OBJECT_STORAGE_SECRET_ACCESS_KEY
//   OBJECT_STORAGE_REGION             "auto" for R2, the bucket's region elsewhere
//   A Railway bucket's own variable names (ENDPOINT, BUCKET, ACCESS_KEY_ID,
//   SECRET_ACCESS_KEY, REGION) work too, so referencing them is enough.
//   STORAGE_DIR                       local folder, development only
//   STORAGE_BACKEND                   postgres, s3 or local, to choose outright
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const http = require("node:http");
const https = require("node:https");

function env(...names) {
  for (const n of names) { const v = String(process.env[n] || "").trim(); if (v) return v; }
  return "";
}

// A key is ours to build, but it still ends up in a path on disk or a URL, so
// it is checked here once rather than trusted everywhere.
function checkKey(key) {
  if (typeof key !== "string" || !/^[A-Za-z0-9][A-Za-z0-9/._-]{0,400}$/.test(key) || key.includes("..")) {
    throw new Error("bad storage key: " + key);
  }
  return key;
}

function contentLength(source) {
  return Buffer.isBuffer(source) ? source.length : fs.statSync(source).size;
}

// ---------------------------------------------------------------------------
// AWS Signature Version 4
// ---------------------------------------------------------------------------
const hmac = (k, s) => crypto.createHmac("sha256", k).update(s).digest();
const sha256hex = s => crypto.createHash("sha256").update(s).digest("hex");
// RFC 3986, which is what SigV4 wants: encodeURIComponent leaves !'()* alone.
const enc = s => encodeURIComponent(s).replace(/[!'()*]/g, c => "%" + c.charCodeAt(0).toString(16).toUpperCase());
const encPath = p => p.split("/").map(enc).join("/");

// Signs a request and returns the headers to send with it. `payloadHash` is
// UNSIGNED-PAYLOAD for a streamed upload, which S3 allows over https.
function signV4({ method, host, pathname, query = {}, headers = {}, payloadHash, accessKey, secretKey, region, service = "s3", now = new Date() }) {
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = amzDate.slice(0, 8);
  const all = Object.assign({}, headers, { host, "x-amz-date": amzDate, "x-amz-content-sha256": payloadHash });
  const names = Object.keys(all).map(h => h.toLowerCase()).sort();
  const lower = {};
  for (const [k, v] of Object.entries(all)) lower[k.toLowerCase()] = String(v).trim().replace(/\s+/g, " ");
  const canonicalQuery = Object.keys(query).sort().map(k => enc(k) + "=" + enc(String(query[k]))).join("&");
  const canonical = [method, encPath(pathname), canonicalQuery,
    names.map(n => n + ":" + lower[n] + "\n").join(""), names.join(";"), payloadHash].join("\n");
  const scope = `${day}/${region}/${service}/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256hex(canonical)].join("\n");
  const kDate = hmac("AWS4" + secretKey, day);
  const kSigning = hmac(hmac(hmac(kDate, region), service), "aws4_request");
  const signature = crypto.createHmac("sha256", kSigning).update(toSign).digest("hex");
  return Object.assign({}, all, {
    authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`
  });
}

class S3Storage {
  constructor(o) {
    const u = new URL(o.endpoint);
    this.base = u;
    this.bucket = o.bucket;
    this.accessKey = o.accessKey;
    this.secretKey = o.secretKey;
    this.region = o.region || "auto";
    this.name = "s3";
  }

  request(method, key, { headers = {}, body, payloadHash = sha256hex(""), timeoutMs = 10 * 60 * 1000 } = {}) {
    const pathname = (this.base.pathname.replace(/\/$/, "") + "/" + this.bucket + "/" + checkKey(key));
    const signed = signV4({
      method, host: this.base.host, pathname, headers, payloadHash,
      accessKey: this.accessKey, secretKey: this.secretKey, region: this.region
    });
    const lib = this.base.protocol === "http:" ? http : https;
    return new Promise((resolve, reject) => {
      const req = lib.request({
        method, host: this.base.hostname, port: this.base.port || undefined,
        path: encPath(pathname), headers: signed, timeout: timeoutMs
      }, resolve);
      req.on("timeout", () => req.destroy(new Error("storage timed out")));
      req.on("error", reject);
      if (body && !Buffer.isBuffer(body)) {
        const rs = fs.createReadStream(body);
        rs.on("error", e => req.destroy(e));
        rs.pipe(req);
      } else req.end(body);
    });
  }

  async drain(res) {
    const chunks = [];
    for await (const c of res) chunks.push(c);
    return Buffer.concat(chunks);
  }

  async put(key, source, type) {
    const res = await this.request("PUT", key, {
      body: source, payloadHash: "UNSIGNED-PAYLOAD",
      headers: { "content-type": type || "application/octet-stream", "content-length": contentLength(source) }
    });
    const text = (await this.drain(res)).toString("utf8");
    if (res.statusCode >= 300) throw new Error(`storage PUT ${res.statusCode}: ${text.slice(0, 300)}`);
  }

  async get(key, range) {
    const res = await this.request("GET", key, { headers: range ? { range } : {} });
    if (res.statusCode === 404) { res.resume(); return null; }
    if (res.statusCode >= 300) {
      const text = (await this.drain(res)).toString("utf8");
      throw new Error(`storage GET ${res.statusCode}: ${text.slice(0, 300)}`);
    }
    return {
      status: res.statusCode, stream: res,
      length: Number(res.headers["content-length"]) || null,
      type: res.headers["content-type"] || "", range: res.headers["content-range"] || ""
    };
  }

  async buffer(key) {
    const r = await this.get(key);
    return r ? this.drain(r.stream) : null;
  }

  async remove(key) {
    const res = await this.request("DELETE", key);
    await this.drain(res);
    if (res.statusCode >= 300 && res.statusCode !== 404) throw new Error(`storage DELETE ${res.statusCode}`);
  }
}

const { Readable } = require("node:stream");
const CHUNK = 8 * 1024 * 1024;

class PgStorage {
  // getPool is a function because the database is joined after the server
  // starts listening; storage is only used once it is there.
  constructor(getPool) { this.getPool = getPool; this.name = "postgres"; }

  pool() {
    const p = this.getPool();
    if (!p) throw new Error("the database is not connected yet");
    return p;
  }

  async put(key, source, type) {
    checkKey(key);
    const c = await this.pool().connect();
    try {
      await c.query("BEGIN");
      await c.query("DELETE FROM storage_objects WHERE key = $1", [key]);
      await c.query("INSERT INTO storage_objects (key, type, size, chunk_size) VALUES ($1, $2, $3, $4)",
        [key, type || "application/octet-stream", contentLength(source), CHUNK]);
      let n = 0;
      if (Buffer.isBuffer(source)) {
        for (let i = 0; i < source.length || (i === 0 && n === 0); i += CHUNK) {
          await c.query("INSERT INTO storage_chunks (key, n, data) VALUES ($1, $2, $3)", [key, n++, source.subarray(i, i + CHUNK)]);
          if (!source.length) break;
        }
      } else {
        // A file on disk, read a piece at a time so a big video never sits
        // in memory whole.
        for await (const piece of fs.createReadStream(source, { highWaterMark: CHUNK })) {
          await c.query("INSERT INTO storage_chunks (key, n, data) VALUES ($1, $2, $3)", [key, n++, piece]);
        }
      }
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }

  async get(key, range) {
    checkKey(key);
    const r = await this.pool().query("SELECT type, size, chunk_size FROM storage_objects WHERE key = $1", [key]);
    if (!r.rowCount) return null;
    const size = Number(r.rows[0].size), cs = r.rows[0].chunk_size, type = r.rows[0].type;
    let start = 0, end = size - 1, status = 200, cr = "";
    const m = range && /^bytes=(\d*)-(\d*)$/.exec(range);
    if (m && (m[1] || m[2])) {
      start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
      end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
      if (start > end || start >= size) return { status: 416, stream: null, length: 0, type, range: `bytes */${size}` };
      status = 206;
      cr = `bytes ${start}-${end}/${size}`;
    }
    const pool = this.pool();
    const first = Math.floor(start / cs), last = Math.floor(Math.max(end, 0) / cs);
    let n = first;
    const stream = new Readable({
      async read() {
        if (n > last || size === 0) return this.push(null);
        try {
          const q = await pool.query("SELECT data FROM storage_chunks WHERE key = $1 AND n = $2", [key, n]);
          if (!q.rowCount) return this.destroy(new Error("missing piece " + n + " of " + key));
          let d = q.rows[0].data;
          const from = n === first ? start - n * cs : 0;
          const to = n === last ? end - n * cs + 1 : d.length;
          n++;
          this.push(d.subarray(from, to));
        } catch (e) { this.destroy(e); }
      }
    });
    return { status, stream, length: size === 0 ? 0 : end - start + 1, type, range: cr };
  }

  async buffer(key) {
    const r = await this.get(key);
    if (!r) return null;
    const parts = [];
    for await (const p of r.stream) parts.push(p);
    return Buffer.concat(parts);
  }

  async remove(key) {
    await this.pool().query("DELETE FROM storage_objects WHERE key = $1", [checkKey(key)]);
  }
}

class LocalStorage {
  constructor(dir) { this.dir = path.resolve(dir); this.name = "local"; }
  file(key) { return path.join(this.dir, checkKey(key)); }

  async put(key, source, type) {
    const f = this.file(key);
    await fsp.mkdir(path.dirname(f), { recursive: true });
    if (Buffer.isBuffer(source)) await fsp.writeFile(f + ".tmp", source);
    else await fsp.copyFile(source, f + ".tmp");
    await fsp.rename(f + ".tmp", f);
    await fsp.writeFile(f + ".type", type || "application/octet-stream");
  }

  async get(key, range) {
    const f = this.file(key);
    let st;
    try { st = await fsp.stat(f); } catch { return null; }
    const type = await fsp.readFile(f + ".type", "utf8").catch(() => "application/octet-stream");
    const m = range && /^bytes=(\d*)-(\d*)$/.exec(range);
    if (m && (m[1] || m[2])) {
      let start = m[1] ? Number(m[1]) : Math.max(0, st.size - Number(m[2]));
      let end = m[1] && m[2] ? Math.min(Number(m[2]), st.size - 1) : st.size - 1;
      if (start > end || start >= st.size) return { status: 416, stream: null, length: 0, type, range: `bytes */${st.size}` };
      return { status: 206, stream: fs.createReadStream(f, { start, end }), length: end - start + 1, type, range: `bytes ${start}-${end}/${st.size}` };
    }
    return { status: 200, stream: fs.createReadStream(f), length: st.size, type, range: "" };
  }

  async buffer(key) {
    try { return await fsp.readFile(this.file(key)); } catch { return null; }
  }

  async remove(key) {
    await fsp.rm(this.file(key), { force: true });
    await fsp.rm(this.file(key) + ".type", { force: true });
  }
}

// The storage this process uses, or null when none is set up. Null switches
// the fulfillment workspace off with a message saying what to set, rather than
// writing photos somewhere the next deploy deletes.
function fromEnv(getPool) {
  const want = env("STORAGE_BACKEND").toLowerCase();
  if (want === "postgres" && getPool) return new PgStorage(getPool);
  if (want === "local") return new LocalStorage(env("STORAGE_DIR") || path.join(__dirname, "..", "data", "storage"));
  const endpoint = env("OBJECT_STORAGE_ENDPOINT", "ENDPOINT", "AWS_ENDPOINT_URL_S3", "AWS_ENDPOINT_URL");
  const bucket = env("OBJECT_STORAGE_BUCKET", "BUCKET", "AWS_S3_BUCKET_NAME");
  const accessKey = env("OBJECT_STORAGE_ACCESS_KEY_ID", "ACCESS_KEY_ID", "AWS_ACCESS_KEY_ID");
  const secretKey = env("OBJECT_STORAGE_SECRET_ACCESS_KEY", "SECRET_ACCESS_KEY", "AWS_SECRET_ACCESS_KEY");
  if (endpoint && bucket && accessKey && secretKey) {
    return new S3Storage({ endpoint, bucket, accessKey, secretKey, region: env("OBJECT_STORAGE_REGION", "REGION", "AWS_REGION", "AWS_DEFAULT_REGION") || "auto" });
  }
  const dir = env("STORAGE_DIR");
  if (dir && want !== "postgres") return new LocalStorage(dir);
  // No bucket and no folder: the database the bookings are in.
  if (getPool && env("DATABASE_URL")) return new PgStorage(getPool);
  if (process.env.NODE_ENV === "development") return new LocalStorage(path.join(__dirname, "..", "data", "storage"));
  return null;
}

function missing() {
  return ["OBJECT_STORAGE_ENDPOINT", "OBJECT_STORAGE_BUCKET", "OBJECT_STORAGE_ACCESS_KEY_ID", "OBJECT_STORAGE_SECRET_ACCESS_KEY"]
    .filter(n => !env(n));
}

module.exports = { fromEnv, missing, signV4, S3Storage, LocalStorage, PgStorage, checkKey };
