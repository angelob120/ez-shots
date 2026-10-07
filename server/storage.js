// Where the photos live. Postgres holds what a photo is; the bytes live here.
//
// Two providers behind one small interface, so the rest of the server never
// knows which one it has:
//
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
//   name                     "s3" or "local", for the status line in admin
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
function fromEnv() {
  const endpoint = env("OBJECT_STORAGE_ENDPOINT", "ENDPOINT", "AWS_ENDPOINT_URL_S3", "AWS_ENDPOINT_URL");
  const bucket = env("OBJECT_STORAGE_BUCKET", "BUCKET", "AWS_S3_BUCKET_NAME");
  const accessKey = env("OBJECT_STORAGE_ACCESS_KEY_ID", "ACCESS_KEY_ID", "AWS_ACCESS_KEY_ID");
  const secretKey = env("OBJECT_STORAGE_SECRET_ACCESS_KEY", "SECRET_ACCESS_KEY", "AWS_SECRET_ACCESS_KEY");
  if (endpoint && bucket && accessKey && secretKey) {
    return new S3Storage({ endpoint, bucket, accessKey, secretKey, region: env("OBJECT_STORAGE_REGION", "REGION", "AWS_REGION", "AWS_DEFAULT_REGION") || "auto" });
  }
  const dir = env("STORAGE_DIR");
  if (dir) return new LocalStorage(dir);
  if (process.env.NODE_ENV === "development") return new LocalStorage(path.join(__dirname, "..", "data", "storage"));
  return null;
}

function missing() {
  return ["OBJECT_STORAGE_ENDPOINT", "OBJECT_STORAGE_BUCKET", "OBJECT_STORAGE_ACCESS_KEY_ID", "OBJECT_STORAGE_SECRET_ACCESS_KEY"]
    .filter(n => !env(n));
}

module.exports = { fromEnv, missing, signV4, S3Storage, LocalStorage, checkKey };
