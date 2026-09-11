// EZ Shots server.
//
// The site is still static HTML. This process exists for the two things a
// static file cannot do:
//   1. Hold the live prices, checkout links and availability, so the owner can
//      change a price on the site instead of editing code and redeploying.
//   2. Hold the Stripe secret key, so the CUSTOMER'S BROWSER NEVER DECIDES WHAT
//      A SHOOT COSTS. The browser sends a package id, the server looks the
//      price up in its own config and creates the Checkout Session.
//
// Node built ins only, on purpose. The one dependency this repo had was `serve`,
// and the static rules it applied (serve.json) are reimplemented below, because
// the booking flow needs an API sitting in front of the same files.
//
// ENV
//   PORT                Railway sets this. 3000 locally.
//   DATA_DIR            where the live config is written. Default ./data.
//                       ON RAILWAY THIS MUST BE A MOUNTED VOLUME, otherwise the
//                       container filesystem resets on every deploy and every
//                       price the owner set goes back to config.json.
//   ADMIN_PASSWORD      required to use /admin. Unset means admin is off, and
//                       there is no default password, ever.
//   ADMIN_SECRET        optional, signs the session cookie. Derived from the
//                       password when unset, which logs everyone out whenever
//                       the password changes. That is the right behaviour.
//   STRIPE_SECRET_KEY   optional. When set, checkout is a Session created here
//                       with a server side price. When unset, the booking page
//                       falls back to the payment links in the config.
//   SITE_URL            optional, the public origin used to build Stripe's
//                       return URLs. Worked out from the request when unset.
"use strict";

const http = require("node:http");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = __dirname;
const PORT = parseInt(process.env.PORT || "3000", 10);
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, "data");
const LIVE_CONFIG = path.join(DATA_DIR, "config.json");
const SEED_CONFIG = path.join(ROOT, "config.json");
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const ADMIN_SECRET = process.env.ADMIN_SECRET || (ADMIN_PASSWORD ? "s:" + ADMIN_PASSWORD : "");
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY || "";
const SESSION_HOURS = 12;

// Files that live in the repo but must not be served. docs/site.md noted that
// the working notes were publicly readable on the old static deploy. They are
// not any more.
const PRIVATE = [/^\/?\.git/, /^\/?\.claude/, /^\/?node_modules/, /^\/?data\//,
  /\.md$/i, /^\/?server\.js$/, /^\/?package(-lock)?\.json$/, /^\/?Dockerfile$/, /^\/?scripts\//];

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
  ".webp": "image/webp", ".gif": "image/gif", ".ico": "image/x-icon",
  ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8", ".xml": "application/xml"
};

// ---------------------------------------------------------------------------
// Config store
// ---------------------------------------------------------------------------
let cache = null;

async function readConfig() {
  if (cache) return cache;
  try {
    cache = JSON.parse(await fsp.readFile(LIVE_CONFIG, "utf8"));
  } catch {
    cache = JSON.parse(await fsp.readFile(SEED_CONFIG, "utf8"));
  }
  return cache;
}

async function writeConfig(cfg) {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  // Write then rename, so a crash mid write cannot leave a half a price list
  // on disk for the booking page to read.
  const tmp = LIVE_CONFIG + ".tmp";
  await fsp.writeFile(tmp, JSON.stringify(cfg, null, 2));
  await fsp.rename(tmp, LIVE_CONFIG);
  cache = cfg;
}

// Anything that reaches this from the admin page has been typed by a person
// into a form, so it is checked rather than trusted. A price that arrives as
// the string "one fifty" must not become NaN on the pricing page.
function validate(cfg) {
  const errs = [];
  if (!cfg || !Array.isArray(cfg.packages) || !cfg.packages.length) {
    return ["There has to be at least one package."];
  }
  const ids = new Set();
  cfg.packages.forEach((p, i) => {
    const at = `Package ${i + 1}`;
    if (!p.id || !/^[a-z0-9-]+$/.test(p.id)) errs.push(`${at}: id must be lowercase letters, numbers or dashes.`);
    if (ids.has(p.id)) errs.push(`${at}: the id "${p.id}" is used twice.`);
    ids.add(p.id);
    if (!p.name || !String(p.name).trim()) errs.push(`${at}: needs a name.`);
    for (const f of ["price", "firstPrice"]) {
      const v = Number(p[f]);
      if (!Number.isFinite(v) || v < 0 || v > 100000) errs.push(`${at}: ${f} must be a number between 0 and 100000.`);
      else p[f] = Math.round(v);
    }
    for (const f of ["checkoutFull", "checkoutFirst"]) {
      const v = String(p[f] || "").trim();
      if (v && !/^https:\/\/[^\s]+$/i.test(v)) errs.push(`${at}: ${f} has to be an https link or be left blank.`);
      p[f] = v;
    }
    p.bullets = Array.isArray(p.bullets) ? p.bullets.map(b => String(b).trim()).filter(Boolean).slice(0, 20) : [];
    p.active = p.active !== false;
    p.name = String(p.name).trim();
    p.blurb = String(p.blurb || "").trim();
    p.badge = String(p.badge || "").trim();
  });

  const a = cfg.availability || (cfg.availability = {});
  a.week = a.week && typeof a.week === "object" ? a.week : {};
  for (let d = 0; d < 7; d++) {
    const list = Array.isArray(a.week[String(d)]) ? a.week[String(d)] : [];
    a.week[String(d)] = list.map(s => String(s).trim()).filter(s => /^\d{1,2}:\d{2}\s*(AM|PM)$/i.test(s));
  }
  for (const f of ["blocked", "overrides"]) {
    const o = a[f] && typeof a[f] === "object" ? a[f] : {};
    a[f] = {};
    for (const k of Object.keys(o)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) { errs.push(`${f}: "${k}" is not a YYYY-MM-DD date.`); continue; }
      a[f][k] = f === "blocked" ? String(o[k] || "Blocked")
        : (Array.isArray(o[k]) ? o[k].map(String).filter(s => /^\d{1,2}:\d{2}\s*(AM|PM)$/i.test(s)) : []);
    }
  }
  const nums = { minNoticeHours: [0, 720, 24], maxAdvanceDays: [1, 365, 45], daysShown: [1, 60, 10] };
  for (const [k, [lo, hi, def]] of Object.entries(nums)) {
    const v = Number(a[k]);
    a[k] = Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : def;
  }
  return errs;
}

// ---------------------------------------------------------------------------
// Admin auth. One user, so this is a signed cookie and not a user table.
// ---------------------------------------------------------------------------
const attempts = new Map();

function rateLimited(ip) {
  const now = Date.now();
  const rec = attempts.get(ip) || { n: 0, until: 0 };
  if (rec.until > now) return true;
  if (now - (rec.at || 0) > 15 * 60 * 1000) rec.n = 0;
  rec.n++;
  rec.at = now;
  if (rec.n > 8) { rec.until = now + 15 * 60 * 1000; rec.n = 0; }
  attempts.set(ip, rec);
  return rec.until > now;
}

function sign(exp) {
  return exp + "." + crypto.createHmac("sha256", ADMIN_SECRET).update(String(exp)).digest("hex");
}

function validToken(tok) {
  if (!ADMIN_SECRET || !tok) return false;
  const [exp, mac] = String(tok).split(".");
  if (!exp || !mac || Number(exp) < Date.now()) return false;
  const want = crypto.createHmac("sha256", ADMIN_SECRET).update(exp).digest("hex");
  const a = Buffer.from(mac, "utf8");
  const b = Buffer.from(want, "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function cookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function authed(req) {
  return !!ADMIN_PASSWORD && validToken(cookies(req).ez_admin);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function send(res, code, body, headers = {}) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
  res.writeHead(code, { "content-length": buf.length, ...headers });
  res.end(buf);
}

function json(res, code, obj, headers = {}) {
  send(res, code, JSON.stringify(obj), { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers });
}

function body(req, limit = 200 * 1024) {
  return new Promise((resolve, reject) => {
    let n = 0;
    const chunks = [];
    req.on("data", c => {
      n += c.length;
      if (n > limit) { reject(new Error("too big")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}); }
      catch { reject(new Error("bad json")); }
    });
    req.on("error", reject);
  });
}

function origin(req) {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, "");
  const proto = (req.headers["x-forwarded-proto"] || "http").split(",")[0];
  return proto + "://" + (req.headers.host || "localhost:" + PORT);
}

// Stripe wants form encoded bodies with bracketed keys.
function formEncode(obj, prefix = "", out = []) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v === undefined || v === null || v === "") continue;
    if (typeof v === "object") formEncode(v, key, out);
    else out.push(encodeURIComponent(key) + "=" + encodeURIComponent(String(v)));
  }
  return out.join("&");
}

// ---------------------------------------------------------------------------
// Static files
// ---------------------------------------------------------------------------
function isPrivate(p) { return PRIVATE.some(re => re.test(p)); }

async function serveStatic(req, res, pathname) {
  // The rules serve.json used to apply. cleanUrls stays off: turning it on 301s
  // /project.html?id=x to /project and drops the query string, which broke
  // every portfolio detail page in production once already.
  let rel = decodeURIComponent(pathname);
  if (rel === "/") rel = "/index.html";
  else if (/^\/[a-z0-9-]+$/i.test(rel)) rel = rel + ".html";

  if (isPrivate(rel)) return send(res, 404, "Not found", { "content-type": "text/plain" });

  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT + path.sep)) return send(res, 403, "Forbidden", { "content-type": "text/plain" });

  let stat;
  try { stat = await fsp.stat(file); } catch { stat = null; }
  if (!stat || stat.isDirectory()) {
    const html = await fsp.readFile(path.join(ROOT, "index.html")).catch(() => null);
    if (!html) return send(res, 404, "Not found", { "content-type": "text/plain" });
    return send(res, 404, html, { "content-type": TYPES[".html"] });
  }

  const ext = path.extname(file).toLowerCase();
  // HTML and config revalidate every time: a price change has to be visible on
  // the next reload, not a week later. Images and CSS are fine cached.
  const cacheHeader = ext === ".html" || ext === ".json"
    ? "no-cache"
    : "public, max-age=604800";
  const etag = '"' + stat.size + "-" + Number(stat.mtimeMs).toString(36) + '"';
  if (req.headers["if-none-match"] === etag) { res.writeHead(304, { etag }); return res.end(); }

  res.writeHead(200, {
    "content-type": TYPES[ext] || "application/octet-stream",
    "content-length": stat.size,
    "cache-control": cacheHeader,
    etag
  });
  fs.createReadStream(file).pipe(res);
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
async function api(req, res, pathname) {
  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress || "?";

  // What the booking page reads. Public on purpose: prices and payment links
  // are on the pricing page anyway. Nothing secret is in here.
  if (pathname === "/api/config" && req.method === "GET") {
    const cfg = await readConfig();
    return json(res, 200, {
      packages: cfg.packages,
      availability: cfg.availability,
      serverCheckout: !!STRIPE_KEY
    });
  }

  if (pathname === "/api/admin/session" && req.method === "GET") {
    return json(res, 200, { enabled: !!ADMIN_PASSWORD, authed: authed(req), stripe: !!STRIPE_KEY });
  }

  if (pathname === "/api/admin/login" && req.method === "POST") {
    if (!ADMIN_PASSWORD) {
      return json(res, 503, { error: "Admin is off. Set ADMIN_PASSWORD in the Railway variables and redeploy." });
    }
    if (rateLimited(ip)) return json(res, 429, { error: "Too many tries. Wait fifteen minutes." });
    const b = await body(req).catch(() => ({}));
    const given = Buffer.from(String(b.password || ""), "utf8");
    const want = Buffer.from(ADMIN_PASSWORD, "utf8");
    const ok = given.length === want.length && crypto.timingSafeEqual(given, want);
    if (!ok) return json(res, 401, { error: "That password is not right." });
    const tok = sign(Date.now() + SESSION_HOURS * 3600 * 1000);
    return json(res, 200, { ok: true }, {
      "set-cookie": `ez_admin=${tok}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_HOURS * 3600}` +
        (process.env.NODE_ENV === "development" ? "" : "; Secure")
    });
  }

  if (pathname === "/api/admin/logout" && req.method === "POST") {
    return json(res, 200, { ok: true }, { "set-cookie": "ez_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0" });
  }

  if (pathname === "/api/admin/config") {
    if (!authed(req)) return json(res, 401, { error: "Sign in first." });
    if (req.method === "GET") return json(res, 200, await readConfig());
    if (req.method === "PUT") {
      const b = await body(req).catch(() => null);
      if (!b) return json(res, 400, { error: "That did not arrive as valid JSON." });
      const errs = validate(b);
      if (errs.length) return json(res, 400, { error: errs.join(" ") });
      await writeConfig(b);
      return json(res, 200, { ok: true, config: b });
    }
  }

  // What the success page shows. Stripe is the only record a booking has until
  // the bookings table exists, so the confirmation reads it back rather than
  // trusting a query string: anyone can type ?paid=yes into a URL.
  if (pathname === "/api/session" && req.method === "GET") {
    const id = new URL(req.url, "http://x").searchParams.get("id") || "";
    if (!STRIPE_KEY || !/^cs_[A-Za-z0-9_]+$/.test(id)) return json(res, 404, { error: "No session." });
    try {
      const r = await fetch("https://api.stripe.com/v1/checkout/sessions/" + encodeURIComponent(id), {
        headers: { authorization: "Bearer " + STRIPE_KEY }
      });
      const d = await r.json();
      if (!r.ok || d.payment_status !== "paid") return json(res, 404, { error: "Not a paid session." });
      return json(res, 200, {
        paid: true,
        amount: (d.amount_total || 0) / 100,
        email: (d.customer_details && d.customer_details.email) || "",
        package: (d.metadata && d.metadata.package) || "",
        address: (d.metadata && d.metadata.address) || "",
        date: (d.metadata && d.metadata.shoot_date) || "",
        time: (d.metadata && d.metadata.shoot_time) || ""
      });
    } catch (e) {
      console.error("[ez-shots] session lookup failed:", e.message);
      return json(res, 502, { error: "Could not read that session." });
    }
  }

  // Checkout. The browser sends a package id and nothing else that touches
  // money. The price comes out of the server's own config.
  if (pathname === "/api/checkout" && req.method === "POST") {
    const cfg = await readConfig();
    const b = await body(req).catch(() => ({}));
    const pkg = cfg.packages.find(p => p.id === b.packageId && p.active !== false);
    if (!pkg) return json(res, 400, { error: "Unknown package." });

    const first = b.firstShoot !== false;
    const amount = first ? pkg.firstPrice : pkg.price;
    const link = first ? pkg.checkoutFirst : pkg.checkoutFull;

    if (!STRIPE_KEY) {
      if (!link) return json(res, 503, { error: "No checkout is set up for that package yet." });
      return json(res, 200, { url: link, mode: "link" });
    }

    const site = origin(req);
    const payload = {
      mode: "payment",
      success_url: site + "/booked.html?session_id={CHECKOUT_SESSION_ID}",
      cancel_url: site + "/book.html",
      customer_creation: "always",
      "line_items[0][quantity]": 1,
      "line_items[0][price_data][currency]": "usd",
      "line_items[0][price_data][unit_amount]": Math.round(amount * 100),
      "line_items[0][price_data][product_data][name]":
        pkg.name + (first ? " (first shoot, half price)" : ""),
      "line_items[0][price_data][product_data][description]":
        [b.address, b.date, b.time].filter(Boolean).join(", ").slice(0, 500) || pkg.blurb || pkg.name,
      metadata: {
        package: pkg.name,
        package_id: pkg.id,
        first_shoot: first ? "yes" : "no",
        address: String(b.address || "").slice(0, 400),
        shoot_date: String(b.date || "").slice(0, 60),
        shoot_time: String(b.time || "").slice(0, 30)
      }
    };

    try {
      const r = await fetch("https://api.stripe.com/v1/checkout/sessions", {
        method: "POST",
        headers: {
          authorization: "Bearer " + STRIPE_KEY,
          "content-type": "application/x-www-form-urlencoded"
        },
        body: formEncode(payload)
      });
      const data = await r.json();
      if (!r.ok || !data.url) {
        console.error("[ez-shots] Stripe session failed:", data && data.error && data.error.message);
        // A Stripe outage must not cost a booking. The payment link still works.
        if (link) return json(res, 200, { url: link, mode: "link-fallback" });
        return json(res, 502, { error: "Checkout could not be created." });
      }
      return json(res, 200, { url: data.url, mode: "session" });
    } catch (e) {
      console.error("[ez-shots] Stripe request threw:", e.message);
      if (link) return json(res, 200, { url: link, mode: "link-fallback" });
      return json(res, 502, { error: "Checkout could not be created." });
    }
  }

  return json(res, 404, { error: "No such endpoint." });
}

// ---------------------------------------------------------------------------
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("referrer-policy", "strict-origin-when-cross-origin");

  const done = p => p.catch(err => {
    console.error("[ez-shots]", err);
    if (!res.headersSent) send(res, 500, "Server error", { "content-type": "text/plain" });
  });

  if (url.pathname.startsWith("/api/")) return done(api(req, res, url.pathname));
  if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "Method not allowed", { "content-type": "text/plain" });
  return done(serveStatic(req, res, url.pathname));
});

server.listen(PORT, () => {
  console.log(`[ez-shots] listening on ${PORT}`);
  console.log(`[ez-shots] config dir ${DATA_DIR}`);
  console.log(`[ez-shots] admin ${ADMIN_PASSWORD ? "on" : "OFF (set ADMIN_PASSWORD)"}` +
    `, stripe ${STRIPE_KEY ? "server side sessions" : "payment links"}`);
});
