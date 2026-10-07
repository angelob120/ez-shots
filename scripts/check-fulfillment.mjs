// End to end, the fulfillment workspace: a shoot is uploaded (more than 75
// photos, a HEIC among them, a duplicate and a file that is not a photo),
// finals are picked and capped at 75, a few are AI edited and the rest used as
// shot, an edit that is rate limited waits and is not billed, one that is
// refused fails without a retry, Edit pressed twice pays once, Re-edit pays
// once more on purpose, Mark ready refuses until everything is finished and
// the video is there, then makes the gallery and the messages. The gallery
// keeps clean files locked until Stripe says paid, then serves them and
// zips them. Last, a server that dies mid edit finishes the photo after a
// restart without paying for it again.
//
// The real server against a throwaway Postgres, a temp folder as storage, a
// fake OpenAI, a fake Stripe and a fake mail endpoint. No credits are spent
// and no money moves.
//
// Run: npm run check:fulfillment
import { spawn, execFileSync } from "node:child_process";
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const sharp = require("sharp");

function fromEnvFile(key) {
  try {
    const m = fs.readFileSync(".env", "utf8").match(new RegExp("^\\s*" + key + "\\s*=\\s*(.*)$", "m"));
    return m ? m[1].trim().replace(/^["']|["']$/g, "") : "";
  } catch { return ""; }
}
const BASE_DB = process.env.DATABASE_URL || fromEnvFile("DATABASE_URL");
if (!BASE_DB || !/localhost|127\.0\.0\.1/.test(BASE_DB)) {
  console.log("SKIP check:fulfillment needs a local DATABASE_URL");
  process.exit(0);
}
const DB_NAME = "ez_shots_ful_" + process.pid;
const dbUrl = new URL(BASE_DB);
dbUrl.pathname = "/" + DB_NAME;
const STORE = fs.mkdtempSync(path.join(os.tmpdir(), "ez-store-"));
// CHECK_STORAGE=postgres runs the whole thing with the photos in Postgres,
// the way production keeps them.
const STORAGE_KIND = process.env.CHECK_STORAGE === "postgres" ? "postgres" : "local";
console.log("  storage: " + STORAGE_KIND);

let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? "  ok    " : "  FAIL  ") + name + (ok || detail === undefined ? "" : "\n        " + JSON.stringify(detail).slice(0, 1500)));
  if (!ok) failures++;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(fn, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(250); }
  return fn();
}
const readBuf = req => new Promise(r => { const c = []; req.on("data", x => c.push(x)); req.on("end", () => r(Buffer.concat(c))); });
const listen = handler => new Promise(r => { const s = http.createServer(handler); s.listen(0, "127.0.0.1", () => r(s)); });
const portOf = s => s.address().port;

// ---- test photos --------------------------------------------------------------
// Each test photo has its own colour, which tells the fake OpenAI which one it
// was sent (every photo arrives padded to the same square): photo 1 is
// refused, photo 2 is rate limited once and then edited, the rest are edited.
async function jpeg(w, h, seed) {
  const hue = (seed * 47) % 255;
  return sharp({ create: { width: w, height: h, channels: 3, background: { r: hue, g: 120, b: 255 - hue } } })
    .composite([{ input: Buffer.from(`<svg width="${w}" height="${h}"><text x="20" y="${h / 2}" font-size="${h / 6}" fill="#fff">photo ${seed}</text></svg>`) }])
    .jpeg({ quality: 80 }).toBuffer();
}

// ---- fake OpenAI ----------------------------------------------------------------
const aiCalls = [];
const limitedOnce = new Set();
const aiSrv = await listen(async (req, res) => {
  const raw = await readBuf(req);
  const form = await new Response(raw, { headers: { "content-type": req.headers["content-type"] } }).formData();
  const img = form.get("image") || form.getAll("image[]")[0];
  const input = Buffer.from(await img.arrayBuffer());
  const meta = await sharp(input).metadata();
  const px = await sharp(input).extract({ left: 600, top: 250, width: 1, height: 1 }).raw().toBuffer();
  const tag = Math.round(px[0] / 47);
  aiCalls.push({ tag, width: meta.width, height: meta.height, quality: form.get("quality"), size: form.get("size"), model: form.get("model"), prompt: form.get("prompt"), images: form.getAll("image[]").length || 1 });
  res.setHeader("content-type", "application/json");
  if (tag === 1) { res.statusCode = 400; return res.end(JSON.stringify({ error: { message: "Your request was rejected by the safety system." } })); }
  if (tag === 2 && !limitedOnce.has(2)) { limitedOnce.add(2); res.statusCode = 429; return res.end(JSON.stringify({ error: { message: "Rate limit reached." } })); }
  const [w, h] = String(form.get("size")).split("x").map(Number);
  const out = await sharp(input).resize(w, h, { fit: "fill" }).modulate({ brightness: 1.15 }).jpeg({ quality: 90 }).toBuffer();
  res.end(JSON.stringify({ data: [{ b64_json: out.toString("base64") }], usage: { input_tokens: 1000, output_tokens: 4000 } }));
});

// ---- fake Stripe and mail -------------------------------------------------------
const stripeCalls = [];
let sessions = 0;
const stripeSrv = await listen(async (req, res) => {
  const form = Object.fromEntries(new URLSearchParams((await readBuf(req)).toString()));
  stripeCalls.push({ method: req.method, url: req.url, form });
  res.setHeader("content-type", "application/json");
  if (req.method === "POST" && req.url === "/v1/checkout/sessions") {
    sessions++;
    return res.end(JSON.stringify({ id: "cs_test_" + sessions, url: "https://checkout.test/cs_test_" + sessions }));
  }
  res.statusCode = 404;
  res.end("{}");
});
const mails = [];
const mailSrv = await listen(async (req, res) => { const b = JSON.parse((await readBuf(req)).toString() || "{}"); mails.push(b); res.end("OK"); });

// ---- the real server --------------------------------------------------------------
const free = await listen(() => {});
const PORT = portOf(free);
free.close();
const SITE = "http://127.0.0.1:" + PORT;
let server, serverLog = "";
function startServer() {
  serverLog = "";
  server = spawn(process.execPath, ["server.js"], {
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: dbUrl.toString(), NODE_ENV: "development", TZ: "America/Detroit",
      ADMIN_PASSWORD: "check-pass", ADMIN_SECRET: "", STORAGE_DIR: STORE, STORAGE_BACKEND: STORAGE_KIND,
      OBJECT_STORAGE_ENDPOINT: "", OBJECT_STORAGE_BUCKET: "", ENDPOINT: "", BUCKET: "",
      OPENAI_API_KEY: "sk-fake-test-key-000", OPENAI_API_BASE: "http://127.0.0.1:" + portOf(aiSrv), OPENAI_IMAGE_MODEL: "gpt-image-2",
      AI_CONCURRENCY: "3", AI_RATE_LIMIT_WAIT_MS: "2000",
      STRIPE_SECRET_KEY: "sk_test_fake", STRIPE_WEBHOOK_SECRET: "whsec_check", STRIPE_API_BASE: "http://127.0.0.1:" + portOf(stripeSrv),
      EMAIL_TEST_ENDPOINT: "http://127.0.0.1:" + portOf(mailSrv) + "/send", GMAIL_USER: "", GMAIL_APP_PASSWORD: "",
      OWNER_EMAIL: "owner@example.com", SITE_URL: SITE, DATA_DIR: "", TICK_MS: "600000"
    }),
    stdio: ["ignore", "pipe", "pipe"]
  });
  server.stdout.on("data", d => { serverLog += d; });
  server.stderr.on("data", d => { serverLog += d; });
  return waitFor(() => /online booking ON/.test(serverLog), 20000);
}

let cookie = "";
async function call(method, p, body, headers = {}) {
  const r = await fetch(SITE + p, {
    method,
    headers: Object.assign({ accept: "application/json" }, body !== undefined && !Buffer.isBuffer(body) ? { "content-type": "application/json" } : {}, cookie ? { cookie } : {}, headers),
    body: body === undefined ? undefined : Buffer.isBuffer(body) ? body : typeof body === "string" ? body : JSON.stringify(body)
  });
  const buf = Buffer.from(await r.arrayBuffer());
  let json = null;
  try { json = JSON.parse(buf.toString("utf8")); } catch {}
  return { status: r.status, json, buf, headers: r.headers };
}
const asClient = async (m, p, b, h) => { const c = cookie; cookie = ""; try { return await call(m, p, b, h); } finally { cookie = c; } };
function signed(payload) {
  const t = Math.floor(Date.now() / 1000);
  const v1 = crypto.createHmac("sha256", "whsec_check").update(t + "." + payload).digest("hex");
  return { "stripe-signature": `t=${t},v1=${v1}`, "content-type": "application/json" };
}

execFileSync("psql", [BASE_DB, "-qc", `CREATE DATABASE ${DB_NAME}`], { stdio: "pipe" });
try {
  const up = await startServer();
  check("server boots with " + STORAGE_KIND + " storage and the AI editor", !!up && new RegExp("photo storage " + STORAGE_KIND + ", AI editor gpt-image-2").test(serverLog), serverLog.slice(-800));
  if (!up) throw new Error("server did not start");
  const login = await call("POST", "/api/admin/login", { password: "check-pass" });
  cookie = (login.headers.get("set-cookie") || "").split(";")[0];

  // ---- a booking with the video, added by the owner
  const cfg = (await call("GET", "/api/config")).json;
  const tomorrow = new Date(Date.now() + 86400000);
  const date = tomorrow.getFullYear() + "-" + String(tomorrow.getMonth() + 1).padStart(2, "0") + "-" + String(tomorrow.getDate()).padStart(2, "0");
  const add = await call("POST", "/api/admin/bookings", { date, time: "10:00 AM", packageId: cfg.packages[0].id, video: true,
    name: "Dana Ruiz", email: "dana@example.com", phone: "3135550101", address: "123 Main St, Birmingham MI 48009" });
  const id = add.json.booking.id;
  check("a $299 booking with video exists", add.status === 200 && add.json.booking.amount === 299 && add.json.booking.videoSelected === true, add.json);
  const job = async () => (await call("GET", `/api/admin/jobs/${id}`)).json;
  const act = (body) => call("POST", `/api/admin/jobs/${id}/action`, body);
  const upload = (buf, name) => call("POST", `/api/admin/jobs/${id}/photos?name=${encodeURIComponent(name)}`, buf, { "content-type": "application/octet-stream" });

  // ---- 1. upload
  const special = [await jpeg(1601, 1067, 1), await jpeg(1602, 1068, 2), await jpeg(1600, 1067, 3), await jpeg(1067, 1600, 4)];
  const r1 = [];
  for (let i = 0; i < special.length; i++) r1.push(await upload(special[i], `IMG_000${i + 1}.jpg`));
  check("photos upload and come back with picking views", r1.every(r => r.status === 200 && r.json.photo && r.json.photo.sourceThumb), r1.map(r => r.json));
  const S = path.join(os.tmpdir(), "ez-heic-" + process.pid);
  fs.writeFileSync(S + ".jpg", await jpeg(900, 600, 9));
  let heic = null;
  try { execFileSync("sips", ["-s", "format", "heic", S + ".jpg", "--out", S + ".heic"], { stdio: "pipe" }); heic = fs.readFileSync(S + ".heic"); } catch {}
  if (heic) {
    const h = await upload(heic, "IMG_0005.HEIC");
    const raw = h.json && h.json.photo && await call("GET", h.json.photo.original.replace(SITE, ""));
    check("a HEIC is converted to a JPEG on arrival", h.status === 200 && h.json.photo.width === 900 && raw && raw.headers.get("content-type") === "image/jpeg" &&
      raw.buf[0] === 0xff && raw.buf[1] === 0xd8, h.json);
  } else console.log("  skip  HEIC conversion (sips not available to make a test file)");
  const dup = await upload(special[2], "copy-of-IMG_0003.jpg");
  check("the same file twice is one photo", dup.status === 200 && dup.json.duplicate === true);
  const notPhoto = await upload(Buffer.from("MZ this is not a photo at all, it is pretending"), "virus.exe");
  check("a file that is not a photo is refused by its bytes", notPhoto.status === 415, notPhoto.json);
  const bulk = [];
  for (let i = 0; i < 76; i++) bulk.push(upload(await jpeg(400, 300, 100 + i), `bulk-${i}.jpg`));
  const bulkDone = await Promise.all(bulk);
  let j = await job();
  check("more than 75 source photos are allowed", bulkDone.every(r => r.status === 200) && j.photos.length === 76 + 4 + (heic ? 1 : 0), j.photos.length);
  check("uploading moves a booked job to shot, quietly", j.booking.stage === "shot" && !mails.some(m => /editing/i.test(m.subject || "")));

  // ---- 2. finals are capped at 75, all categories together
  const bulkIds = j.photos.filter(p => p.name.startsWith("bulk-")).map(p => p.id);
  const over = await act({ action: "final", ids: bulkIds, on: true });
  check("76 finals are refused", over.status === 400 && /most is 75/.test(over.json.error), over.json);
  await act({ action: "category", ids: bulkIds.slice(0, 30), category: "drone" });
  const cat = await act({ action: "final", ids: bulkIds.slice(0, 70), on: true });
  check("70 finals, 30 of them drone, are fine: no limit per category", cat.status === 200 && cat.json.readiness.finals === 70, cat.json && cat.json.readiness);

  // ---- 3. AI edits
  const [refused, limited, wide, tall] = r1.map(r => r.json.photo.id);
  const callsBefore = aiCalls.length;
  const q = await act({ action: "edit", ids: [refused, limited, wide, tall] });
  check("four photos are queued for the AI editor", q.status === 200 && q.json.queued === 4, q.json);
  const tooMany = await act({ action: "edit", ids: bulkIds.slice(70) });
  check("editing past the limit is refused before anything is paid for", tooMany.status === 400 && /most is 75/.test(tooMany.json.error), tooMany.json);
  j = await waitFor(async () => { const x = await job(); return x.photos.filter(p => [refused, limited, wide, tall].includes(p.id)).every(p => p.status === "complete" || p.status === "failed") && x; }, 120000);
  const byId = x => j.photos.find(p => p.id === x);
  check("an edit finishes with every size made", byId(wide).status === "complete" && byId(wide).ready && byId(wide).thumb && byId(wide).preview, byId(wide));
  check("a refused edit fails at once, is not retried and is not counted as billed", byId(refused).status === "failed" && aiCalls.filter(c => c.tag === 1).length === 1 && byId(refused).attempts === 0 && /safety/.test(byId(refused).error), byId(refused));
  check("a rate limited edit waits, is not billed, then finishes", byId(limited).status === "complete" && aiCalls.filter(c => c.tag === 2).length === 2 && byId(limited).edits === 1, byId(limited));
  const wideCall = aiCalls.find(c => c.tag === 3), tallCall = aiCalls.find(c => c.tag === 4);
  check("the editor is asked for 1024x1024 at medium quality, the photo padded in, never stretched", wideCall && wideCall.size === "1024x1024" && wideCall.quality === "medium" &&
    wideCall.width === 1024 && /gray bands at the edges are padding/.test(wideCall.prompt) && tallCall && tallCall.size === "1024x1024", { wideCall, tallCall });
  check("the result is cut back to the photo's own shape", byId(wide).editedWidth === 1024 && byId(wide).editedHeight === 683 && byId(tall).editedWidth === 683 && byId(tall).editedHeight === 1024, [byId(wide), byId(tall)]);
  check("the prompt protects the property", wideCall && /Do NOT: add or remove furniture/.test(wideCall.prompt) && /preserving the actual property/.test(wideCall.prompt));
  check("each edit is estimated at $0.053", Math.abs(byId(wide).cost - 0.053) < 0.0001, byId(wide).cost);
  const paidCalls = aiCalls.length;
  await act({ action: "edit", ids: [wide, tall] });
  await sleep(4000);
  check("pressing Edit again on finished photos pays for nothing", aiCalls.length === paidCalls);
  const masterBefore = byId(wide).high;
  const re = await act({ action: "reedit", ids: [wide] });
  j = await waitFor(async () => { const x = await job(); const p = x.photos.find(p => p.id === wide); return p.status === "complete" && p.high !== masterBefore && x; }, 60000);
  check("Re-edit pays once more, on purpose, and replaces the edit", re.json.queued === 1 && aiCalls.length === paidCalls + 1 && byId(wide).edits === 2, byId(wide));
  check("the usage numbers add up", j.usage.aiEdited === 3 && j.usage.reEdits === 1 && j.usage.aiFailures === 1 && Math.abs(j.usage.aiCost - 0.21) < 0.011 && j.usage.storageBytes > 0, j.usage);

  // ---- 4. use as shot, then ready
  const shot = await act({ action: "original", ids: bulkIds.slice(0, 70) });
  check("use as shot queues without the AI editor", shot.json.queued === 70);
  j = await waitFor(async () => { const x = await job(); return x.photos.filter(p => p.final).every(p => p.status !== "queued" && p.status !== "processing") && x; }, 120000);
  check("photos used as shot cost nothing", aiCalls.length === paidCalls + 1 && j.photos.filter(p => p.source === "original").length === 70);
  check("Mark ready is blocked by the failed final and the missing video", !j.readiness.ok && j.readiness.problems.some(x => /failed/.test(x)) && j.readiness.videoMissing, j.readiness);
  const blocked = await act({ action: "ready" });
  check("and the server refuses it too", blocked.status === 400);
  await act({ action: "final", ids: [refused], on: false });
  const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from("ftypisom"), Buffer.alloc(4000, 1)]);
  const vid = await call("POST", `/api/admin/jobs/${id}/video?name=walkthrough.mp4`, mp4, { "content-type": "application/octet-stream" });
  check("the listing video uploads", vid.status === 200, vid.json);
  const approve = await act({ action: "approveAll" });
  check("Approve all approves every finished final", approve.json.approved === 73, approve.json.approved);
  const ready = await act({ action: "ready" });
  const gurl = ready.json && ready.json.booking.galleryUrl;
  const token = gurl && gurl.split("/g/")[1];
  check("Mark ready makes the gallery", ready.status === 200 && /^http.*\/g\/[A-Za-z0-9_-]{22,}$/.test(gurl) && ready.json.booking.stage === "ready", ready.json && ready.json.error);
  const t = ready.json.templates;
  check("the text message has the name, the address and the link", t.sms.startsWith("Hey Dana, your photos for 123 Main St, Birmingham MI 48009 are ready.") && t.sms.includes(gurl) && !/[–—]/.test(t.sms + t.emailSubject + t.emailBody), t);
  check("the email is ready to copy", t.emailSubject === "Your EZ Shots photos are ready - 123 Main St, Birmingham MI 48009" && t.emailBody.startsWith("Hi Dana,") && t.emailBody.includes(gurl));
  const again = await act({ action: "ready" });
  check("pressing Mark ready again keeps the same gallery", again.json.booking.galleryUrl === gurl);

  // ---- 5. the gallery before payment
  const g = await asClient("GET", "/api/gallery/" + token);
  check("the gallery shows 73 photos in order, the video and a Pay button", g.status === 200 && g.json.photos.length === 73 && g.json.canPay && g.json.video && !g.json.downloads &&
    g.json.photos[0].view.includes("/preview"), g.json && { n: g.json.photos.length, canPay: g.json.canPay });
  const first = g.json.photos[0];
  const thumb = await asClient("GET", first.thumb);
  const preview = await asClient("GET", first.view);
  const highLocked = await asClient("GET", `/g/${token}/p/${first.id}/high`);
  const lowLocked = await asClient("GET", `/g/${token}/p/${first.id}/low`);
  const zipLocked = await asClient("GET", `/g/${token}/zip/high`);
  const vidDl = await asClient("GET", `/g/${token}/video?dl=1`);
  check("thumbnails and watermarked previews show before payment", thumb.status === 200 && preview.status === 200 && preview.headers.get("content-type") === "image/jpeg");
  check("high res, MLS, the zips and the video download stay locked until paid", highLocked.status === 402 && lowLocked.status === 402 && zipLocked.status === 402 && vidDl.status === 402);
  const otherBooking = (await call("POST", "/api/admin/bookings", { date, time: "2:00 PM", packageId: cfg.packages[0].id, name: "Other", address: "9 Other Rd, Troy MI" })).json.booking;
  check("another booking's photo cannot be fetched through this gallery", (await asClient("GET", `/g/${token}/p/999999/thumb`)).status === 404 &&
    (await asClient("GET", `/api/admin/jobs/${otherBooking.id}`)).status === 401);
  check("a made up gallery link finds nothing", (await asClient("GET", "/api/gallery/AAAAAAAAAAAAAAAAAAAAAA")).status === 404);
  const viewed = await job();
  check("the client's first view is recorded", !!viewed.booking.galleryFirstViewedAt);
  const page = await asClient("GET", "/g/" + token);
  check("/g/<token> serves the gallery page", page.status === 200 && page.buf.toString().includes("js/gallery.js"));

  // ---- 5b. the client asks for a change
  const noMsg = await asClient("POST", `/api/gallery/${token}/change`, { message: "  ", photos: [2] });
  const askOne = await asClient("POST", `/api/gallery/${token}/change`, { message: "Brighter kitchen please", photos: [2, 999] });
  const askAll = await asClient("POST", `/api/gallery/${token}/change`, { message: "Can the drone shots be warmer?" });
  check("a change request needs a message", noMsg.status === 400);
  check("a change request is taken for one photo or the whole gallery", askOne.status === 200 && askAll.status === 200);
  const changeMail = await waitFor(() => mails.find(m => /^Change requested: 123 Main St/.test(m.subject || "")));
  check("the owner is emailed the request with a link to the job", !!changeMail && changeMail.html.includes("Photo 2: Brighter kitchen please") && changeMail.html.includes("/admin-job?id=" + id), changeMail && changeMail.subject);
  let cj = await job();
  const one = cj.changes.find(c => c.message === "Brighter kitchen please");
  check("the job lists both requests, the photo one naming photo 2 only", cj.changes.length === 2 && one.photos === "Photo 2" && one.photoIds.length === 1 && one.photoIds[0] === g.json.photos[1].id, cj.changes);
  check("a change request flags nothing", cj.booking.flagged === false);
  const res2 = await act({ action: "resolveChange", changeId: one.id });
  check("the owner can mark a request done", res2.status === 200 && res2.json.changes.find(c => c.id === one.id).resolvedAt);

  // ---- 6. pay, and the downloads unlock
  const pay = await asClient("POST", `/api/gallery/${token}/pay`);
  const sess = stripeCalls.filter(c => c.url === "/v1/checkout/sessions").pop();
  check("Pay opens Stripe for $299, coming back to the gallery", pay.status === 200 && sess.form["line_items[0][price_data][unit_amount]"] === "29900" &&
    sess.form.success_url.startsWith(gurl + "?paid="), sess && sess.form);
  const payload = JSON.stringify({ type: "checkout.session.completed", data: { object: { id: pay.json.url.split("/").pop(), payment_status: "paid", payment_intent: "pi_x", client_reference_id: id, metadata: { booking_id: id, purpose: "pay" } } } });
  const wh = await call("POST", "/api/stripe/webhook", payload, signed(payload));
  check("the Stripe webhook is accepted", wh.status === 200, wh.json);
  const gp = await asClient("GET", "/api/gallery/" + token);
  const paidThumb = await asClient("GET", gp.json.photos[0].thumb);
  check("unpaid, the grid thumbnail is the watermarked one; paid, the clean one, at a new address", thumb.status === 200 && paidThumb.status === 200 &&
    !thumb.buf.equals(paidThumb.buf) && gp.json.photos[0].thumb !== first.thumb);
  check("paid, the full resolution view is offered too", /\/high\?v=/.test(gp.json.photos[0].full) && !/dl=1/.test(gp.json.photos[0].full));
  check("after payment the gallery offers both downloads", gp.json.paid && gp.json.downloads && gp.json.downloads.highName === "123-main-st-high-resolution.zip" && gp.json.photos[0].high, gp.json.downloads);
  const high = await asClient("GET", gp.json.photos[0].high);
  check("a high res photo downloads with a clean name", high.status === 200 && /attachment; filename="123-main-st-01.jpg"/.test(high.headers.get("content-disposition")), high.headers.get("content-disposition"));
  const zipFile = path.join(os.tmpdir(), "ez-zip-" + process.pid + ".zip");
  const zipHigh = await asClient("GET", gp.json.downloads.high);
  fs.writeFileSync(zipFile, zipHigh.buf);
  let listing = "";
  try { listing = execFileSync("unzip", ["-l", zipFile]).toString(); execFileSync("unzip", ["-tq", zipFile]); } catch (e) { listing = "BAD " + e.message; }
  check("the high res zip holds 73 photos, named in order, and tests clean", zipHigh.status === 200 && /73 files/.test(listing) && listing.includes("123-main-st-01.jpg") && listing.includes("123-main-st-73.jpg"), listing.slice(-300));
  const zipMls = await asClient("GET", gp.json.downloads.mls);
  fs.writeFileSync(zipFile, zipMls.buf);
  try { listing = execFileSync("unzip", ["-l", zipFile]).toString(); } catch (e) { listing = "BAD"; }
  check("the MLS zip holds the MLS copies", zipMls.status === 200 && listing.includes("123-main-st-01-mls.jpg") && zipMls.buf.length < zipHigh.buf.length);
  const mlsDims = await sharp((await asClient("GET", gp.json.photos.find(p => p.id === wide).mls)).buf).metadata();
  check("an MLS copy is never enlarged past the edit", mlsDims.width === 1024, mlsDims);
  const delivered = await waitFor(() => mails.find(m => m.to === "dana@example.com" && /^Paid, here are your files/.test(m.subject)));
  check("the paid email links the gallery", !!delivered && delivered.html.includes(gurl));
  const after = await job();
  check("admin shows paid and unlocked", after.booking.paid && !!after.booking.downloadsUnlockedAt);

  // ---- 7. a restart mid edit does not pay twice
  const wideNow = after.photos.find(p => p.id === wide);
  const callsNow = aiCalls.length;
  server.kill();
  await sleep(800);
  execFileSync("psql", [dbUrl.toString(), "-qc", `UPDATE photos SET ai_edit_status = 'processing', locked_at = now() - interval '1 hour', low_res_storage_key = NULL WHERE id = ${wide}`], { stdio: "pipe" });
  await startServer();
  cookie = (await call("POST", "/api/admin/login", { password: "check-pass" })).headers.get("set-cookie").split(";")[0];
  const back = await waitFor(async () => { const x = await job(); const p = x.photos.find(p => p.id === wide); return p.status === "complete" && p.ready && x; }, 40000);
  check("after a restart the half done photo is finished without a new AI call", !!back && aiCalls.length === callsNow && back.photos.find(p => p.id === wide).edits === wideNow.edits, serverLog.slice(-500));

  // ---- 8. a client with no usable first name
  const ful = require("../server/fulfillment.js").setup({ getDb: () => null, storage: null });
  const nn = ful.templates({ name: "@@ office", address: "5 Elm St" }, "https://ezshots.org/g/x");
  check("with no first name the text says Hey, and never Hey ,", nn.sms.startsWith("Hey, your photos for 5 Elm St are ready.") && nn.emailBody.startsWith("Hi,\n") && !/Hey ,|Hi ,/.test(nn.sms + nn.emailBody), nn);
} catch (e) {
  failures++;
  console.log("  FAIL  " + e.stack);
} finally {
  if (server) server.kill();
  for (const s of [aiSrv, stripeSrv, mailSrv]) s.close();
  await sleep(300);
  try { execFileSync("psql", [BASE_DB, "-qc", `DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`], { stdio: "pipe" }); } catch {}
  fs.rmSync(STORE, { recursive: true, force: true });
}

if (failures) {
  console.log("\n" + failures + " fulfillment check(s) failed. Server log:\n" + serverLog.slice(-3000));
  process.exit(1);
}
console.log("\nAll fulfillment checks passed.");
