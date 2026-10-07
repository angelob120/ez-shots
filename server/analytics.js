// Site analytics: what visitors do on the site, kept in our own Postgres and
// read back by admin-analytics.html. No third party script, no cookie.
//
// The browser (js/site.js, window.ezTrack) sends small events to
// POST /api/track: a page view, a Book button pressed, a booking step
// reached, a booking made, a contact form sent. record() cleans one up and
// stores it; report() turns a period of them, plus the bookings table, into
// the numbers the analytics page draws.
//
// What is never stored: a name, an email, an IP, a cookie. A visitor is a
// hash of the IP and browser with a salt that changes every day, so the
// same person counts once a day and cannot be followed across days. The
// owner's own visits are skipped (a request carrying the admin cookie), and
// so are bots that say they are bots.
"use strict";

const crypto = require("node:crypto");

const NAMES = ["view", "cta", "book_step", "booked", "contact"];
const BOT = /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|externalhit|curl|wget|python|node-fetch|axios|go-http|java\/|httpclient|monitor|uptime/i;
const KEEP_DAYS = 400;

// Per IP, at most this many events in ten minutes. A real visitor sends a
// handful a page; anything past this is a script and is quietly dropped.
const hits = new Map();
function flooding(ip, now = Date.now()) {
  const h = hits.get(ip);
  if (!h || now - h.since > 10 * 60 * 1000) { hits.set(ip, { since: now, n: 1 }); return false; }
  h.n += 1;
  if (hits.size > 5000) for (const [k, v] of hits) if (now - v.since > 10 * 60 * 1000) hits.delete(k);
  return h.n > 150;
}

function str(v, max) { return String(v == null ? "" : v).trim().slice(0, max); }

function deviceOf(ua) {
  if (/ipad|tablet|(android(?!.*mobile))/i.test(ua)) return "Tablet";
  if (/mobi|iphone|ipod|android/i.test(ua)) return "Mobile";
  return "Desktop";
}

// The path a page is counted under. Tokens in private links (gallery,
// manage) never reach the table.
function cleanPath(p) {
  p = str(p, 200).split("#")[0];
  if (!p.startsWith("/")) return "";
  if (p.startsWith("/g/")) return "/g";
  const [base, query] = p.split("?");
  let out = base.replace(/\.html$/, "").replace(/\/index$/, "/").replace(/(.)\/+$/, "$1") || "/";
  // A portfolio project is worth telling apart; every other query is dropped.
  if (out === "/project" && query) {
    const id = new URLSearchParams(query).get("id");
    if (id && /^[a-z0-9-]{1,60}$/i.test(id)) out += "?id=" + id;
  }
  return out;
}

// Only the host of the page that sent them, and only when it is somewhere
// else. The full referring URL can carry a search or a person's name.
function refHost(ref, ownHosts) {
  try {
    const h = new URL(ref).hostname.toLowerCase().replace(/^www\./, "");
    return ownHosts.includes(h) ? "" : h.slice(0, 120);
  } catch { return ""; }
}

function visitorOf(secret, ip, ua, now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  return crypto.createHash("sha256").update(secret + "|" + day + "|" + ip + "|" + ua).digest("hex").slice(0, 20);
}

// Returns true when the event was stored. Never throws: a failed write must
// not show up on the visitor's page.
async function record(db, b, ctx) {
  try {
    if (!db || !b || typeof b !== "object") return false;
    const ua = str(ctx.ua, 400);
    if (!ua || BOT.test(ua) || ctx.admin) return false;
    if (flooding(ctx.ip)) return false;
    const name = str(b.n, 20);
    if (!NAMES.includes(name)) return false;
    const path = cleanPath(b.p);
    if (!path) return false;
    const ownHosts = [str(ctx.host, 120).toLowerCase().split(":")[0].replace(/^www\./, "")];
    if (ctx.siteHost) ownHosts.push(ctx.siteHost);
    const sid = /^[a-z0-9]{8,32}$/i.test(String(b.s || "")) ? String(b.s) : "";
    await db.query(
      `INSERT INTO analytics_events (name, path, label, sid, visitor, ref, utm_source, utm_medium, utm_campaign, device)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [name, path, str(b.l, 80), sid, visitorOf(ctx.secret, ctx.ip, ua), name === "view" ? refHost(b.r, ownHosts) : "",
        str(b.us, 60).toLowerCase(), str(b.um, 60).toLowerCase(), str(b.uc, 80), deviceOf(ua)]
    );
    return true;
  } catch (e) {
    console.error("[ez-shots] analytics write failed:", e.message);
    return false;
  }
}

// Where a visit came from, in words the owner knows. A utm_source on the
// link wins over the referrer, so a texted link tagged ?utm_source=text
// reads as Text instead of Direct.
const KNOWN = [
  [/(^|\.)google\./, "Google"], [/(^|\.)bing\.com$/, "Bing"], [/duckduckgo\.com$/, "DuckDuckGo"], [/(^|\.)yahoo\./, "Yahoo"],
  [/(^|\.)(facebook\.com|fb\.com|fb\.me)$/, "Facebook"], [/instagram\.com$/, "Instagram"], [/(linkedin\.com|lnkd\.in)$/, "LinkedIn"],
  [/^(t\.co|x\.com|twitter\.com)$/, "X"], [/youtube\.com$|youtu\.be$/, "YouTube"], [/nextdoor\.com$/, "Nextdoor"],
  [/(chatgpt\.com|openai\.com)$/, "ChatGPT"], [/perplexity\.ai$/, "Perplexity"], [/(^|\.)tiktok\.com$/, "TikTok"],
  [/(mail\.google\.com|outlook\.|mail\.yahoo\.)/, "Email"]
];
const UTM = { google: "Google", facebook: "Facebook", fb: "Facebook", instagram: "Instagram", ig: "Instagram", linkedin: "LinkedIn",
  text: "Text", sms: "Text", email: "Email", newsletter: "Email", nextdoor: "Nextdoor", tiktok: "TikTok", youtube: "YouTube", flyer: "Flyer", qr: "QR code" };
function sourceOf(s) {
  if (s.utm_source) return UTM[s.utm_source] || s.utm_source.charAt(0).toUpperCase() + s.utm_source.slice(1);
  if (!s.ref) return "Direct";
  for (const [re, label] of KNOWN) if (re.test(s.ref)) return label;
  return s.ref;
}

function pct(a, b) { return b ? Math.round(a / b * 1000) / 10 : 0; }

// Everything the analytics page shows for the last `days` days. `tz` is the
// business's timezone, so a day is a Detroit day and not a UTC one.
async function report(db, days, tz) {
  const now = new Date();
  const start = new Date(now.getTime() - days * 86400000);
  const prevStart = new Date(start.getTime() - days * 86400000);
  const q = (text, params) => db.query(text, params).then(r => r.rows);

  const [totals, prev, daily, pages, firsts, flags, ctas, live, today, biz, bizPrev, monthly, pipeline, repeat, packages] = await Promise.all([
    q(`SELECT count(*)::int AS views, count(DISTINCT visitor)::int AS visitors, count(DISTINCT NULLIF(sid, ''))::int AS sessions
       FROM analytics_events WHERE name = 'view' AND at >= $1`, [start]),
    q(`SELECT count(*)::int AS views, count(DISTINCT visitor)::int AS visitors, count(DISTINCT NULLIF(sid, ''))::int AS sessions,
         count(DISTINCT sid) FILTER (WHERE name = 'booked')::int AS booked
       FROM analytics_events WHERE at >= $1 AND at < $2 AND (name = 'view' OR name = 'booked')`, [prevStart, start]),
    q(`SELECT to_char((at AT TIME ZONE $2)::date, 'YYYY-MM-DD') AS day,
         count(*) FILTER (WHERE name = 'view')::int AS views,
         count(DISTINCT visitor) FILTER (WHERE name = 'view')::int AS visitors,
         count(*) FILTER (WHERE name = 'booked')::int AS booked
       FROM analytics_events WHERE at >= $1 GROUP BY 1 ORDER BY 1`, [start, tz]),
    q(`SELECT path, count(*)::int AS views, count(DISTINCT visitor)::int AS visitors
       FROM analytics_events WHERE name = 'view' AND at >= $1 GROUP BY path ORDER BY views DESC LIMIT 15`, [start]),
    // The landing page is a visit's first page; its source is the first view
    // that says where it came from, so a tagged link opened in a tab that was
    // already on the site still counts as that link.
    q(`SELECT DISTINCT ON (sid) sid, first_value(path) OVER (PARTITION BY sid ORDER BY at) AS path,
         ref, utm_source, utm_medium, utm_campaign, device
       FROM analytics_events WHERE name = 'view' AND sid <> '' AND at >= $1
       ORDER BY sid, (utm_source = '' AND ref = ''), at`, [start]),
    q(`SELECT sid,
         count(*) FILTER (WHERE name = 'view')::int AS views,
         bool_or(name = 'view' AND path = '/book') AS saw_book,
         bool_or(name = 'book_step' AND label = '2') AS step2,
         bool_or(name = 'book_step' AND label = '3') AS step3,
         bool_or(name = 'booked') AS booked,
         bool_or(name = 'contact') AS contact
       FROM analytics_events WHERE sid <> '' AND at >= $1 GROUP BY sid`, [start]),
    q(`SELECT path, label, count(*)::int AS n FROM analytics_events WHERE name = 'cta' AND at >= $1
       GROUP BY path, label ORDER BY n DESC LIMIT 12`, [start]),
    q(`SELECT count(DISTINCT sid)::int AS n FROM analytics_events WHERE at >= now() - interval '5 minutes'`),
    q(`SELECT count(*)::int AS views, count(DISTINCT visitor)::int AS visitors FROM analytics_events
       WHERE name = 'view' AND (at AT TIME ZONE $1)::date = (now() AT TIME ZONE $1)::date`, [tz]),
    q(`SELECT
         count(*) FILTER (WHERE status IN ('confirmed', 'cancelled'))::int AS bookings,
         count(*) FILTER (WHERE status IN ('confirmed', 'cancelled') AND source = 'site')::int AS site,
         count(*) FILTER (WHERE status IN ('confirmed', 'cancelled') AND source <> 'site')::int AS manual,
         count(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
         count(*) FILTER (WHERE status = 'confirmed' AND video_selected)::int AS video,
         count(*) FILTER (WHERE status = 'confirmed' AND first_shoot)::int AS first,
         count(*) FILTER (WHERE status = 'confirmed')::int AS confirmed,
         coalesce(avg(EXTRACT(EPOCH FROM (starts_at - created_at)) / 86400) FILTER (WHERE status = 'confirmed'), 0)::float AS lead_days
       FROM bookings WHERE created_at >= $1`, [start]),
    q(`SELECT
         (SELECT count(*)::int FROM bookings WHERE status IN ('confirmed', 'cancelled') AND created_at >= $1 AND created_at < $2) AS bookings,
         (SELECT coalesce(sum(amount * 100 - refunded_cents), 0)::int FROM bookings WHERE paid AND paid_at >= $1 AND paid_at < $2) AS revenue_cents`, [prevStart, start]),
    q(`SELECT to_char(date_trunc('month', paid_at AT TIME ZONE $1), 'YYYY-MM') AS month,
         coalesce(sum(amount * 100 - refunded_cents), 0)::int AS cents, count(*)::int AS jobs
       FROM bookings WHERE paid AND paid_at >= date_trunc('month', now() AT TIME ZONE $1) - interval '11 months'
       GROUP BY 1 ORDER BY 1`, [tz]),
    q(`SELECT stage, count(*)::int AS n, coalesce(sum(amount), 0)::int AS value
       FROM bookings WHERE status = 'confirmed' AND NOT paid GROUP BY stage`),
    q(`SELECT count(*)::int AS clients, count(*) FILTER (WHERE n > 1)::int AS repeat
       FROM (SELECT lower(email) AS e, count(*) AS n FROM bookings WHERE status = 'confirmed' GROUP BY 1) t`),
    q(`SELECT package_name AS name, count(*)::int AS n FROM bookings
       WHERE status = 'confirmed' AND created_at >= $1 GROUP BY 1 ORDER BY n DESC`, [start])
  ]);

  // Paid in the period, net of refunds, from the same table the money
  // tiles on the bookings page read.
  const paid = (await q(`SELECT count(*)::int AS jobs, coalesce(sum(amount * 100 - refunded_cents), 0)::int AS cents
    FROM bookings WHERE paid AND paid_at >= $1`, [start]))[0];

  // Each session's landing page and source, joined to what it went on to do.
  const bySid = new Map(flags.map(f => [f.sid, f]));
  const sources = new Map(), landings = new Map(), devices = new Map(), campaigns = new Map();
  const bump = (m, k, f) => {
    const r = m.get(k) || { name: k, sessions: 0, booked: 0, contact: 0 };
    r.sessions += 1; if (f && f.booked) r.booked += 1; if (f && f.contact) r.contact += 1;
    m.set(k, r);
  };
  let bounces = 0;
  for (const s of firsts) {
    const f = bySid.get(s.sid);
    bump(sources, sourceOf(s), f);
    bump(landings, s.path, f);
    bump(devices, s.device || "Desktop", f);
    if (s.utm_campaign) bump(campaigns, s.utm_campaign, f);
    if (f && f.views <= 1 && !f.booked && !f.contact) bounces += 1;
  }
  const rank = m => [...m.values()].sort((a, b) => b.sessions - a.sessions).slice(0, 12)
    .map(r => Object.assign(r, { rate: pct(r.booked, r.sessions) }));

  const sessions = flags.length;
  const funnel = [
    ["Visited the site", sessions],
    ["Opened the booking page", flags.filter(f => f.saw_book || f.step2 || f.step3 || f.booked).length],
    ["Picked a package", flags.filter(f => f.step2 || f.step3 || f.booked).length],
    ["Picked a time", flags.filter(f => f.step3 || f.booked).length],
    ["Booked", flags.filter(f => f.booked).length]
  ].map(([label, n]) => ({ label, n, rate: pct(n, sessions) }));

  const t = totals[0], p = prev[0], b = biz[0], bp = bizPrev[0];
  const bookedSessions = funnel[4].n;
  return {
    days, from: start.toISOString(), to: now.toISOString(),
    traffic: {
      views: t.views, visitors: t.visitors, sessions: t.sessions,
      prevViews: p.views, prevVisitors: p.visitors, prevSessions: p.sessions,
      pagesPerSession: t.sessions ? Math.round(t.views / t.sessions * 10) / 10 : 0,
      bounceRate: pct(bounces, firsts.length),
      conversion: pct(bookedSessions, sessions),
      prevConversion: pct(p.booked, p.sessions),
      contacts: flags.filter(f => f.contact).length,
      live: live[0].n, todayViews: today[0].views, todayVisitors: today[0].visitors
    },
    daily, pages, ctas, funnel,
    sources: rank(sources), landings: rank(landings), devices: rank(devices), campaigns: rank(campaigns),
    business: {
      bookings: b.bookings, prevBookings: bp.bookings, site: b.site, manual: b.manual, cancelled: b.cancelled,
      revenue: paid.cents / 100, prevRevenue: bp.revenue_cents / 100, paidJobs: paid.jobs,
      avgTicket: paid.jobs ? Math.round(paid.cents / paid.jobs) / 100 : 0,
      videoRate: pct(b.video, b.confirmed), firstRate: pct(b.first, b.confirmed),
      leadDays: Math.round(b.lead_days * 10) / 10,
      clients: repeat[0].clients, repeatClients: repeat[0].repeat,
      packages,
      unpaid: pipeline.map(r => ({ stage: r.stage, n: r.n, value: r.value })),
      monthly: monthly.map(r => ({ month: r.month, revenue: r.cents / 100, jobs: r.jobs }))
    }
  };
}

// Run from the server's clock. A year and a bit is plenty for comparing a
// month with the same month last year; older rows only cost disk.
async function prune(db) {
  await db.query(`DELETE FROM analytics_events WHERE at < now() - ($1 || ' days')::interval`, [String(KEEP_DAYS)]);
}

module.exports = { record, report, prune, cleanPath, sourceOf, deviceOf };
