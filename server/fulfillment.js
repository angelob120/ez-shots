// Fulfillment: from the photos on the camera to a paid client downloading
// them, without leaving EZ Shots.
//
//   upload   the whole shoot is dropped onto the booking (admin-job.html).
//            Each file streams to a temp file, is checked by its bytes,
//            converted if it is a HEIC, given a small picking view, and kept
//            in object storage. The same file twice is one photo.
//   select   the owner picks the finals. At most config.maxPhotos (75) of
//            them, interior, exterior and drone counted together.
//   edit     Edit with AI queues the picked photos. A worker in this process
//            sends them to the AI editor a few at a time, keeps the result as
//            the edited master, and makes every other size from it with
//            sharp. Use as shot makes the master from the original instead,
//            for no AI cost.
//   review   the owner scans the edits, approves, removes, re-edits one.
//   ready    checks the count, that every final is finished and that a
//            bought video is there, then creates the gallery at /g/<token>,
//            fills preview_url and final_url with it (so the manage page and
//            every email that already used those keep working), and moves the
//            booking to ready, or to delivered if it was already paid.
//   send     admin shows the gallery link, a text message and an email ready
//            to copy, and can send the email.
//   gallery  the client sees watermarked previews and a Pay button. Stripe
//            saying paid (webhook or the return to the gallery) unlocks high
//            resolution and MLS downloads, one by one or as a zip. Every
//            byte comes through here after the server has checked the
//            payment; no storage address is ever given out.
//
// MONEY: an AI edit is paid for, so nothing here ever repeats one by
// accident. A photo with an edited master is never sent again unless the
// owner presses Re-edit. Each attempt is counted before the call, a photo
// gets AI_MAX_ATTEMPTS at most, a rate limit waits and does not count, and a
// server that restarts mid edit finds the photo by its old lock and either
// finishes the free part or queues it once more within the same limit.
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const images = require("./images");
const { provider: editor } = require("./editor");
const { ZipWriter } = require("./zip");

const MB = 1024 * 1024;
const envNum = (name, def, lo, hi) => { const v = Number(process.env[name]); return Number.isFinite(v) && v >= lo && v <= hi ? v : def; };
const PHOTO_MAX = envNum("PHOTO_UPLOAD_MAX_MB", 100, 5, 500) * MB;
const VIDEO_MAX = envNum("VIDEO_UPLOAD_MAX_MB", 4096, 50, 20000) * MB;
const CONCURRENCY = envNum("AI_CONCURRENCY", 3, 1, 10);
const MAX_ATTEMPTS = envNum("AI_MAX_ATTEMPTS", 3, 1, 10);
const AI_EDGE = envNum("AI_INPUT_LONG_EDGE", 3840, 1024, 6000);
const STALE_MS = envNum("AI_STALE_MINUTES", 15, 5, 240) * 60 * 1000;
// How long a rate limited edit waits before it is tried again.
const RATE_WAIT_MS = envNum("AI_RATE_LIMIT_WAIT_MS", 60000, 1000, 3600000);
// Unset keeps every file for as long as the bucket lasts. Set, the source
// photos that never made the final gallery are deleted that many days after
// delivery. Delivered photos are never deleted automatically.
const RETENTION_DAYS = envNum("SOURCE_RETENTION_DAYS", 0, 0, 3650);

function setup(ctx) {
  const { json, send, raw, body, str, readConfig, origin, email, after, crm } = ctx;
  const storage = ctx.storage;
  const db = () => ctx.getDb();
  const log = (...a) => console.log("[ez-shots]", ...a);
  const warn = (...a) => console.error("[ez-shots]", ...a);

  // ------------------------------------------------------------------------
  // Small helpers
  // ------------------------------------------------------------------------
  const rand = (n = 8) => crypto.randomBytes(n).toString("hex");
  const safeName = n => String(n || "file").normalize("NFKD").replace(/[^\w.-]+/g, "-").replace(/^[-.]+|-+$/g, "").slice(0, 80) || "file";
  const slug = s => String(s || "").toLowerCase().split(",")[0].replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "property";
  const prefix = b => `bookings/${b.id}`;

  function galleryUrl(b, req) {
    const base = String(process.env.PUBLIC_GALLERY_BASE_URL || "").trim().replace(/\/$/, "") || (req ? origin(req) : ctx.SITE_URL);
    return b.galleryToken ? base + "/g/" + b.galleryToken : "";
  }

  function firstName(b) {
    const f = String(b.name || "").trim().split(/\s+/)[0] || "";
    return /^[A-Za-z][A-Za-z'.]*$/.test(f) ? f : "";
  }

  // What the owner copies to the client. A missing first name makes "Hey,"
  // and never "Hey ,".
  function templates(b, url) {
    const f = firstName(b);
    const addr = String(b.address || "").trim() || "your listing";
    return {
      sms: `Hey${f ? " " + f : ""}, your photos for ${addr} are ready.\n\nYou can view everything here:\n${url}\n\n` +
        "There is no upfront charge. You can review the photos first and complete payment from the gallery when you're ready.",
      emailSubject: `Your EZ Shots photos are ready - ${addr}`,
      emailBody: `Hi${f ? " " + f : ""},\n\nYour EZ Shots media for ${addr} is ready.\n\nView your gallery here:\n\n${url}\n\n` +
        "You can review the work before paying. Once payment is complete, your full-resolution and MLS-ready downloads will automatically unlock.\n\nThanks,\nEZ Shots"
    };
  }

  // A request body streamed to a temp file: size capped, hashed on the way,
  // and the first bytes kept for sniffing. Never held in memory whole.
  function toTemp(req, limit) {
    return new Promise((resolve, reject) => {
      const file = path.join(os.tmpdir(), "ez-up-" + rand());
      const out = fs.createWriteStream(file);
      const hash = crypto.createHash("sha256");
      let size = 0, head = Buffer.alloc(0), failed = false;
      const fail = e => {
        if (failed) return;
        failed = true;
        out.destroy();
        fsp.rm(file, { force: true }).catch(() => {});
        reject(e);
      };
      req.on("data", c => {
        size += c.length;
        if (size > limit) { const e = new Error("too big"); e.tooBig = true; req.unpipe(out); req.resume(); return fail(e); }
        if (head.length < 64) head = Buffer.concat([head, c.subarray(0, 64 - head.length)]);
        hash.update(c);
      });
      req.on("aborted", () => fail(new Error("upload cancelled")));
      req.on("error", fail);
      out.on("error", fail);
      out.on("finish", () => { if (!failed) resolve({ file, size, head, sha256: hash.digest("hex") }); });
      req.pipe(out);
    });
  }

  // Stream a stored object to the browser.
  async function stream(req, res, key, { type, filename, download = false, cache = "private, max-age=86400" } = {}) {
    if (!key) return send(res, 404, "Not found", { "content-type": "text/plain" });
    const range = req.headers.range && /^bytes=\d*-\d*$/.test(req.headers.range) ? req.headers.range : undefined;
    let obj;
    try { obj = await storage.get(key, range); }
    catch (e) { warn("storage read failed", key, e.message); return send(res, 502, "Storage error", { "content-type": "text/plain" }); }
    if (!obj) return send(res, 404, "Not found", { "content-type": "text/plain" });
    const headers = {
      "content-type": type || obj.type || "application/octet-stream",
      "cache-control": cache,
      "accept-ranges": "bytes",
      "content-security-policy": "default-src 'none'; sandbox",
      "x-content-type-options": "nosniff"
    };
    if (obj.length != null) headers["content-length"] = obj.length;
    if (obj.range) headers["content-range"] = obj.range;
    if (filename) headers["content-disposition"] = `${download ? "attachment" : "inline"}; filename="${filename.replace(/[^\w. -]/g, "")}"`;
    res.writeHead(obj.status === 206 ? 206 : obj.status === 416 ? 416 : 200, headers);
    if (!obj.stream || req.method === "HEAD") { if (obj.stream) obj.stream.destroy(); return res.end(); }
    obj.stream.on("error", () => res.destroy());
    res.on("close", () => obj.stream.destroy());
    obj.stream.pipe(res);
  }

  const removeKeys = keys => Promise.all([...new Set(keys.filter(Boolean))].map(k => storage.remove(k).catch(e => warn("could not delete", k, e.message))));

  function photoKeys(p) {
    return [p.originalStorageKey, p.sourceThumbKey, p.sourcePreviewKey, p.editedMasterStorageKey,
      p.highResStorageKey, p.lowResStorageKey, p.thumbnailStorageKey, p.previewStorageKey, p.previewThumbKey];
  }

  // A photo as the admin workspace sees it.
  function adminPhoto(b, p) {
    const v = Date.parse(p.updatedAt) || 0;
    const href = variant => `/api/admin/jobs/${b.id}/photos/${p.id}/${variant}?v=${v}`;
    return {
      id: p.id, name: p.originalFilename, order: p.sortOrder, category: p.category,
      width: p.originalWidth, height: p.originalHeight, editedWidth: p.editedWidth, editedHeight: p.editedHeight,
      size: p.originalSize, final: p.selectedForDelivery, sentToEdit: p.selectedForEdit,
      status: p.aiEditStatus, source: p.editSource, reedit: p.reeditRequested,
      edited: !!p.editedMasterStorageKey, ready: ready(p), approved: !!p.approvedAt,
      attempts: p.aiAttemptCount, edits: p.aiEditCount, cost: p.aiCostEstimate, error: p.errorMessage,
      sourceThumb: href("source-thumb"), sourcePreview: href("source-preview"), original: href("original"),
      thumb: p.thumbnailStorageKey ? href("thumb") : "", preview: p.lowResStorageKey ? href("low") : "",
      high: p.highResStorageKey ? href("high") : ""
    };
  }

  // Finished: an edited master and every size made from it.
  function ready(p) {
    return p.aiEditStatus === "complete" && !!(p.editedMasterStorageKey && p.highResStorageKey && p.lowResStorageKey &&
      p.thumbnailStorageKey && p.previewStorageKey && p.previewThumbKey);
  }

  function usage(b, photos) {
    const ai = photos.filter(p => p.aiEditCount > 0);
    const edits = photos.reduce((s, p) => s + p.aiEditCount, 0);
    return {
      sourcePhotos: photos.length,
      aiEdited: ai.length,
      reEdits: Math.max(0, edits - ai.length),
      aiFailures: photos.filter(p => p.aiEditStatus === "failed").length,
      aiAttempts: photos.reduce((s, p) => s + p.aiAttemptCount, 0),
      aiCost: Math.round(photos.reduce((s, p) => s + p.aiCostEstimate, 0) * 100) / 100,
      storageBytes: photos.reduce((s, p) => s + p.originalSize + p.editedSize + p.derivedSize, 0) + Number(b.videoSize || 0)
    };
  }

  // What stands between this job and Mark Ready, in the owner's words.
  function readiness(b, photos, cfg) {
    const max = cfg.maxPhotos || 75;
    const finals = photos.filter(p => p.selectedForDelivery);
    const problems = [];
    if (!finals.length) problems.push("Pick at least one final photo.");
    if (finals.length > max) problems.push(`${finals.length} final photos is over the ${max} limit. Remove ${finals.length - max}.`);
    const working = finals.filter(p => p.aiEditStatus === "queued" || p.aiEditStatus === "processing").length;
    if (working) problems.push(`${working} still being edited.`);
    const failed = finals.filter(p => p.aiEditStatus === "failed").length;
    if (failed) problems.push(`${failed} failed to edit. Retry, use as shot, or remove ${failed === 1 ? "it" : "them"}.`);
    const unedited = finals.filter(p => p.aiEditStatus === "none").length;
    if (unedited) problems.push(`${unedited} not edited yet. Edit with AI or use as shot.`);
    const videoMissing = !!b.videoSelected && !b.videoStorageKey && !b.videoOverride;
    if (videoMissing) problems.push("The listing video was bought and is not uploaded yet.");
    if (b.status !== "confirmed") problems.push("This booking is cancelled.");
    return { ok: !problems.length, problems, finals: finals.length, max, videoMissing };
  }

  // ------------------------------------------------------------------------
  // The AI editing worker
  // ------------------------------------------------------------------------
  let active = 0;
  const bookingCache = new Map();
  async function bookingOf(id) {
    const hit = bookingCache.get(id);
    if (hit && Date.now() - hit.at < 30000) return hit.b;
    const b = await db().find(id);
    bookingCache.set(id, { b, at: Date.now() });
    return b;
  }

  // Up to two of the client's reference photos, small, when the owner turned
  // that on for this booking. Each one is paid for on every edit.
  async function referencesFor(b) {
    if (!b.editUseReferences) return [];
    const of = (await db().filesFor([b]))(b);
    const out = [];
    for (const f of of.references.slice(0, 2)) {
      const file = await db().file(f.id);
      if (file) out.push((await images.aiInput(file.data, 1024)).buffer);
    }
    return out;
  }

  async function processOne(p) {
    const b = await bookingOf(p.bookingId);
    if (!b) return db().updatePhoto(p.id, { aiEditStatus: "failed", errorMessage: "Booking not found.", lockedAt: null });
    const tag = `${p.bookingId} photo ${p.id}`;
    let masterKey = p.editedMasterStorageKey;
    let master = null;
    const oldKeys = [];
    const patch = {};
    const needsMaster = !masterKey || p.reeditRequested;
    if (needsMaster) {
      const orig = await storage.buffer(p.originalStorageKey);
      if (!orig) throw Object.assign(new Error("The original file is missing from storage."), { retryable: false, charged: false });
      if (p.editSource === "original") {
        master = await images.cleanJpeg(orig);
        Object.assign(patch, { editSource: "original" });
      } else {
        if (!editor.ready) throw Object.assign(new Error("The AI editor is not set up (OPENAI_API_KEY)."), { retryable: false, charged: false });
        const input = await images.aiInput(orig, AI_EDGE);
        const r = await editor.edit({
          image: input.buffer, width: input.width, height: input.height, category: p.category,
          instructions: b.editInstructions, references: await referencesFor(b)
        });
        master = r.buffer;
        Object.assign(patch, {
          editSource: "ai", aiModel: r.model, aiEditCount: p.aiEditCount + 1,
          aiCostEstimate: Math.round((p.aiCostEstimate + r.costEstimate) * 10000) / 10000
        });
        log(`${tag} edited by ${r.model}, about $${r.costEstimate.toFixed(3)}`);
      }
      // A new name every time, so a browser holding the old edit in its cache
      // gets the new one, and the old files can go once this one is saved.
      masterKey = `${prefix(b)}/edited-master/${p.id}-${rand(4)}.jpg`;
      await storage.put(masterKey, master, "image/jpeg");
      oldKeys.push(p.editedMasterStorageKey, p.lowResStorageKey, p.thumbnailStorageKey, p.previewStorageKey, p.previewThumbKey);
      Object.assign(patch, {
        editedMasterStorageKey: masterKey, editedSize: master.length, editedAt: new Date(),
        reeditRequested: false, approvedAt: null
      });
      // Saved before the sizes are made: if the server dies now, the master
      // is on the record and the restart only redoes the free part.
      await db().updatePhoto(p.id, patch);
    } else {
      master = await storage.buffer(masterKey);
      if (!master) throw Object.assign(new Error("The edited master is missing from storage."), { retryable: false, charged: false });
      oldKeys.push(p.lowResStorageKey, p.thumbnailStorageKey, p.previewStorageKey, p.previewThumbKey);
    }

    const s = await images.deliverySizes(master);
    const base = `${prefix(b)}`;
    const v = rand(4);
    const keys = {
      lowResStorageKey: `${base}/low-res/${p.id}-${v}.jpg`,
      thumbnailStorageKey: `${base}/thumbnails/${p.id}-${v}.webp`,
      previewStorageKey: `${base}/preview/${p.id}-${v}.jpg`,
      previewThumbKey: `${base}/preview/${p.id}-${v}-thumb.webp`
    };
    await storage.put(keys.lowResStorageKey, s.low, "image/jpeg");
    await storage.put(keys.thumbnailStorageKey, s.thumb, "image/webp");
    await storage.put(keys.previewStorageKey, s.preview, "image/jpeg");
    await storage.put(keys.previewThumbKey, s.thumbMarked, "image/webp");
    await db().updatePhoto(p.id, Object.assign(keys, {
      highResStorageKey: masterKey, highResSize: master.length, lowResSize: s.low.length,
      derivedSize: s.low.length + s.thumb.length + s.preview.length + s.thumbMarked.length,
      editedWidth: s.width, editedHeight: s.height,
      aiEditStatus: "complete", lockedAt: null, nextAttemptAt: null, errorMessage: ""
    }));
    await removeKeys(oldKeys.filter(k => k && k !== masterKey));
  }

  async function runOne(p) {
    active++;
    try {
      await processOne(p);
    } catch (e) {
      const charged = e.charged !== false;
      const attempts = charged ? p.aiAttemptCount : Math.max(0, p.aiAttemptCount - 1);
      const again = e.retryable && attempts < MAX_ATTEMPTS;
      const wait = !charged ? RATE_WAIT_MS : 30000 * Math.pow(2, Math.max(0, attempts - 1));
      warn(`${p.bookingId} photo ${p.id} edit failed (attempt ${p.aiAttemptCount}${charged ? "" : ", not billed"}):`, e.message);
      await db().updatePhoto(p.id, {
        aiEditStatus: again ? "queued" : "failed", aiAttemptCount: attempts, lockedAt: null,
        nextAttemptAt: again ? new Date(Date.now() + wait) : null,
        errorMessage: String(e.message || "Edit failed").slice(0, 500)
      }).catch(x => warn("could not record the failure", x.message));
    } finally {
      active--;
    }
  }

  let pumping = false;
  async function pump() {
    if (!db() || !storage || pumping) return;
    pumping = true;
    try {
      const free = CONCURRENCY - active;
      if (free <= 0) return;
      const claimed = await db().claimEdits(free);
      for (const p of claimed) runOne(p);
    } catch (e) {
      warn("edit queue:", e.message);
    } finally {
      pumping = false;
    }
  }

  // A server that restarted mid edit. With a master saved, the photo goes
  // back in the queue as is and only its sizes are made again. Without one
  // it goes back only if it has attempts left.
  async function recover() {
    if (!db() || !storage) return;
    const stale = await db().staleEdits(new Date(Date.now() - STALE_MS));
    for (const p of stale) {
      const hasMaster = !!p.editedMasterStorageKey && !p.reeditRequested;
      const again = hasMaster || p.aiAttemptCount < MAX_ATTEMPTS;
      await db().updatePhoto(p.id, {
        aiEditStatus: again ? "queued" : "failed", lockedAt: null, nextAttemptAt: null,
        errorMessage: again ? "" : "The server restarted during the edit and the attempts ran out. Press Retry to try once more."
      }, "AND ai_edit_status = 'processing'");
      log(`${p.bookingId} photo ${p.id} recovered after a restart, ${again ? "queued again" : "failed"}`);
    }
  }

  async function retention() {
    if (!RETENTION_DAYS || !db() || !storage) return;
    const r = await db().query(
      "SELECT p.* FROM photos p JOIN bookings b ON b.id = p.booking_id WHERE p.selected_for_delivery = false " +
      "AND p.ai_edit_status = 'none' AND b.delivered_at IS NOT NULL AND b.delivered_at < now() - ($1 || ' days')::interval LIMIT 200",
      [String(RETENTION_DAYS)]);
    for (const row of r.rows) {
      const p = { id: Number(row.id), bookingId: row.booking_id, keys: [row.original_storage_key, row.source_thumb_key, row.source_preview_key] };
      await removeKeys(p.keys);
      await db().query("DELETE FROM photos WHERE id = $1", [p.id]);
    }
    if (r.rows.length) log(`retention: removed ${r.rows.length} unused source photos`);
  }

  function start() {
    setInterval(() => pump(), 3000).unref();
    setInterval(() => recover().catch(e => warn("edit recovery:", e.message)), 5 * 60 * 1000).unref();
    setInterval(() => retention().catch(e => warn("retention:", e.message)), 6 * 3600 * 1000).unref();
    setTimeout(() => recover().catch(e => warn("edit recovery:", e.message)), 10000).unref();
  }

  // ------------------------------------------------------------------------
  // Admin: the job workspace
  // ------------------------------------------------------------------------
  async function jobView(req, b) {
    const cfg = await readConfig();
    const photos = await db().photos(b.id);
    const url = galleryUrl(b, req);
    const of = (await db().filesFor([b]))(b);
    const pub = ctx.publicBooking(b);
    return {
      booking: Object.assign(pub, {
        stage: b.stage, status: b.status, paid: !!b.paid, paidAt: b.paidAt, flagged: !!b.flaggedAt,
        editInstructions: b.editInstructions || "", editUseReferences: !!b.editUseReferences,
        video: b.videoStorageKey ? { name: b.videoName, size: Number(b.videoSize || 0), url: `/api/admin/jobs/${b.id}/video` } : null,
        videoOverride: !!b.videoOverride,
        galleryUrl: url, galleryCreatedAt: b.galleryCreatedAt, galleryFirstViewedAt: b.galleryFirstViewedAt,
        downloadsUnlockedAt: b.downloadsUnlockedAt, smsCopiedAt: b.smsCopiedAt, deliveryEmailSentAt: b.deliveryEmailSentAt,
        manualLinks: !b.galleryToken && !!(b.previewUrl || b.finalUrl)
      }),
      photos: photos.map(p => adminPhoto(b, p)),
      references: of.references.map(f => ({ id: f.id, name: f.name, url: "/api/admin/files/" + f.id })),
      changes: await db().changes(b.id),
      referenceNotes: b.referenceNotes || "",
      readiness: readiness(b, photos, cfg),
      usage: usage(b, photos),
      templates: url ? templates(b, url) : null,
      maxPhotos: cfg.maxPhotos || 75,
      storage: storage ? storage.name : null,
      storageMissing: storage ? [] : ctx.storageMissing(),
      editor: { ready: editor.ready, name: editor.name, model: editor.model, estimateEach: editor.estimateEach },
      emailOn: email.configured(),
      limits: { photoMb: PHOTO_MAX / MB, videoMb: VIDEO_MAX / MB }
    };
  }

  async function uploadPhoto(req, res, b, url) {
    if (!storage) return json(res, 503, { error: "Photo storage is not set up yet." });
    let t;
    try { t = await toTemp(req, PHOTO_MAX); }
    catch (e) { return json(res, e.tooBig ? 413 : 400, { error: e.tooBig ? `That file is over ${PHOTO_MAX / MB} MB.` : "The upload did not finish. Retry it." }); }
    const name = str(url.searchParams.get("name"), 200) || "photo.jpg";
    try {
      const mime = images.sniff(t.head);
      if (!mime) return json(res, 415, { error: `${name} is not a JPG, PNG, WebP or HEIC photo.` });
      const dup = await db().findPhotoBySha(b.id, t.sha256);
      if (dup) return json(res, 200, { duplicate: true, photo: adminPhoto(b, dup) });
      let source = t.file, type = mime, ext = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[mime];
      if (mime === "image/heic") {
        // Converted once, here. From now on this JPEG is the original.
        try { source = await images.convertHeic(await fsp.readFile(t.file)); }
        catch (e) { warn(`${b.id} could not convert ${name}:`, e.message); return json(res, 415, { error: `${name} could not be read as a HEIC photo.` }); }
        type = "image/jpeg"; ext = "jpg";
      }
      let d, views;
      try {
        d = await images.dims(source);
        views = await images.sourceViews(source);
      } catch (e) {
        return json(res, 415, { error: `${name} could not be read as a photo.` });
      }
      const id = rand(6), base = safeName(name.replace(/\.[a-z0-9]+$/i, ""));
      const keys = {
        originalStorageKey: `${prefix(b)}/original/${id}-${base}.${ext}`,
        sourceThumbKey: `${prefix(b)}/thumbnails/source-${id}.webp`,
        sourcePreviewKey: `${prefix(b)}/preview/source-${id}.jpg`
      };
      await storage.put(keys.originalStorageKey, source, type);
      await storage.put(keys.sourceThumbKey, views.thumb, "image/webp");
      await storage.put(keys.sourcePreviewKey, views.preview, "image/jpeg");
      const p = await db().addPhoto(Object.assign({
        bookingId: b.id, originalFilename: name, sha256: t.sha256, mimeType: type,
        originalWidth: d.width, originalHeight: d.height, originalSize: Buffer.isBuffer(source) ? source.length : t.size
      }, keys));
      if (!p) {
        // The same file landed twice at once and the other one won.
        await removeKeys(Object.values(keys));
        const won = await db().findPhotoBySha(b.id, t.sha256);
        return json(res, 200, { duplicate: true, photo: won && adminPhoto(b, won) });
      }
      // Photos arriving means the shoot happened. Quietly, no email: the
      // owner's Shoot done button still sends that one.
      if (b.status === "confirmed" && (b.stage || "booked") === "booked") {
        await db().update(b.id, { stage: "shot", shotAt: b.shotAt || new Date() });
        crm.report("shot", ctx.publicBooking(Object.assign({}, b, { stage: "shot" })));
      }
      return json(res, 200, { photo: adminPhoto(b, p) });
    } finally {
      fsp.rm(t.file, { force: true }).catch(() => {});
    }
  }

  async function uploadVideo(req, res, b, url) {
    if (!storage) return json(res, 503, { error: "Storage is not set up yet." });
    let t;
    try { t = await toTemp(req, VIDEO_MAX); }
    catch (e) { return json(res, e.tooBig ? 413 : 400, { error: e.tooBig ? `That video is over ${VIDEO_MAX / MB} MB.` : "The upload did not finish. Retry it." }); }
    try {
      const mime = images.sniffVideo(t.head);
      if (!mime) return json(res, 415, { error: "That is not an MP4 or MOV video." });
      const name = str(url.searchParams.get("name"), 200) || "listing-video.mp4";
      const key = `${prefix(b)}/video/${rand(6)}-${safeName(name)}`;
      await storage.put(key, t.file, mime);
      const old = b.videoStorageKey;
      const c = await db().update(b.id, { videoStorageKey: key, videoName: name, videoMime: mime, videoSize: t.size });
      if (old) await removeKeys([old]);
      log(`${b.id} video uploaded, ${Math.round(t.size / MB)} MB`);
      return json(res, 200, { ok: true, video: { name, size: t.size }, booking: c.id });
    } finally {
      fsp.rm(t.file, { force: true }).catch(() => {});
    }
  }

  const ids = list => (Array.isArray(list) ? list : []).map(Number).filter(n => Number.isInteger(n) && n > 0).slice(0, 2000);

  async function action(req, res, b) {
    const p = await body(req, 512 * 1024).catch(() => null);
    if (!p) return json(res, 400, { error: "Bad request." });
    const cfg = await readConfig();
    const max = cfg.maxPhotos || 75;
    const list = ids(p.ids);
    const all = await db().photos(b.id);
    const finalsNow = all.filter(x => x.selectedForDelivery).length;
    const out = {};

    switch (p.action) {
      case "final": {
        // Finals on or off. Going over the limit is refused here, so the
        // count on screen can never pass it.
        if (p.on) {
          const adding = all.filter(x => list.includes(x.id) && !x.selectedForDelivery).length;
          if (finalsNow + adding > max) return json(res, 400, { error: `That makes ${finalsNow + adding} final photos. The most is ${max}, interior, exterior and drone together.` });
        }
        await db().updatePhotos(b.id, list, { selectedForDelivery: !!p.on });
        break;
      }
      case "category": {
        if (!["interior", "exterior", "drone", "uncategorized"].includes(p.category)) return json(res, 400, { error: "Unknown category." });
        await db().updatePhotos(b.id, list, { category: p.category });
        break;
      }
      case "order": await db().reorderPhotos(b.id, list); break;
      case "delete": {
        const gone = await db().deletePhotos(b.id, list);
        await removeKeys(gone.flatMap(photoKeys));
        out.deleted = gone.length;
        break;
      }
      case "edit":
      case "original": {
        // Edit with AI, or use as shot. Only photos with no edit yet are
        // queued; a finished one is left alone, so pressing Edit twice never
        // pays twice. Re-edit is its own action.
        if (p.action === "edit" && !editor.ready) return json(res, 503, { error: "The AI editor is not set up. Add OPENAI_API_KEY in Railway, or use the photos as shot." });
        const todo = all.filter(x => list.includes(x.id) &&
          (x.aiEditStatus === "none" || (x.aiEditStatus === "failed" && !x.editedMasterStorageKey)));
        const adding = todo.filter(x => !x.selectedForDelivery).length;
        if (finalsNow + adding > max) return json(res, 400, { error: `That makes ${finalsNow + adding} final photos. The most is ${max}. Pick fewer.` });
        const change = {
          aiEditStatus: "queued", editSource: p.action === "edit" ? "ai" : "original",
          selectedForDelivery: true, nextAttemptAt: null, errorMessage: "", aiAttemptCount: 0
        };
        if (p.action === "edit") change.selectedForEdit = true;
        const q = await db().updatePhotos(b.id, todo.map(x => x.id), change, "AND ai_edit_status IN ('none', 'failed')");
        out.queued = q.length;
        out.skipped = list.length - q.length;
        if (q.length) log(`${b.id} ${q.length} photos queued, ${p.action === "edit" ? "AI edit" : "as shot"}`);
        break;
      }
      case "reedit": {
        if (!editor.ready) return json(res, 503, { error: "The AI editor is not set up." });
        const q = await db().updatePhotos(b.id, list, {
          aiEditStatus: "queued", editSource: "ai", reeditRequested: true, selectedForEdit: true, nextAttemptAt: null, errorMessage: "", aiAttemptCount: 0
        }, "AND ai_edit_status IN ('complete', 'failed')");
        out.queued = q.length;
        if (q.length) log(`${b.id} ${q.length} photos queued for a re-edit by the owner`);
        break;
      }
      case "retry": {
        const q = await db().updatePhotos(b.id, list, { aiEditStatus: "queued", nextAttemptAt: null, errorMessage: "", aiAttemptCount: 0 }, "AND ai_edit_status = 'failed'");
        out.queued = q.length;
        break;
      }
      case "approve": await db().updatePhotos(b.id, list, { approvedAt: p.on === false ? null : new Date() }, "AND ai_edit_status = 'complete'"); break;
      case "approveAll": {
        const done = all.filter(x => x.selectedForDelivery && x.aiEditStatus === "complete" && !x.approvedAt).map(x => x.id);
        await db().updatePhotos(b.id, done, { approvedAt: new Date() });
        out.approved = done.length;
        break;
      }
      case "instructions":
        await db().update(b.id, { editInstructions: str(p.text, 1000), editUseReferences: !!p.useReferences });
        bookingCache.delete(b.id);
        break;
      case "videoOverride": await db().update(b.id, { videoOverride: !!p.on }); break;
      case "resolveChange":
        if (!await db().resolveChange(b.id, Number(p.changeId) || 0, p.done !== false)) return json(res, 404, { error: "That request is gone." });
        break;
      case "removeVideo":
        if (b.videoStorageKey) { await removeKeys([b.videoStorageKey]); await db().update(b.id, { videoStorageKey: null, videoName: "", videoMime: "", videoSize: 0 }); }
        break;
      case "ready": return markReady(req, res, b, all, cfg);
      case "smsCopied": await db().claimOnce(b.id, "sms_copied_at"); break;
      case "sendEmail": {
        if (!b.galleryToken) return json(res, 400, { error: "Mark the job ready first." });
        if (!b.email) return json(res, 400, { error: "This booking has no email address." });
        if (!email.configured()) return json(res, 503, { error: "Email is not switched on." });
        // Once, unless the owner asks again on purpose, so a retried request
        // never sends the client two copies.
        const first = await db().claimOnce(b.id, "delivery_email_sent_at");
        if (!first && p.again !== true) return json(res, 409, { error: "The gallery email already went. Press Send again to resend it.", already: true });
        if (!first) await db().update(b.id, { deliveryEmailSentAt: new Date() });
        const c = await db().find(b.id);
        const r = await email.toCustomer(c.paid ? "delivered" : "ready", ctx.publicBooking(c), ctx.SITE_URL);
        if (!r.customer) {
          if (first) await db().update(b.id, { deliveryEmailSentAt: null });
          return json(res, 502, { error: "The email did not send: " + (r.errors[0] || "unknown error") });
        }
        log(`${b.id} gallery email sent`);
        out.emailed = true;
        break;
      }
      default: return json(res, 400, { error: "Unknown action." });
    }
    const fresh = await db().find(b.id);
    return json(res, 200, Object.assign(out, await jobView(req, fresh)));
  }

  // Ready: everything the client needs, made and checked, in one press.
  async function markReady(req, res, b, photos, cfg) {
    if (b.status !== "confirmed") return json(res, 400, { error: "This booking is cancelled." });
    const r = readiness(b, photos, cfg);
    if (!r.ok) return json(res, 400, { error: r.problems.join(" "), readiness: r });
    // A final with its master but a size missing (a failed write, a cleared
    // key) goes back through the worker, which makes only the sizes, for no
    // AI cost.
    const missing = photos.filter(p => p.selectedForDelivery && !ready(p));
    if (missing.length) {
      await db().updatePhotos(b.id, missing.map(p => p.id), { aiEditStatus: "queued", nextAttemptAt: null }, "AND edited_master_storage_key IS NOT NULL AND ai_edit_status <> 'processing'");
      return json(res, 409, { error: `Finishing the sizes for ${missing.length} photo${missing.length === 1 ? "" : "s"}. Press Mark ready again in a minute.` });
    }
    const now = new Date();
    const token = b.galleryToken || crypto.randomBytes(18).toString("base64url");
    const url = galleryUrl(Object.assign({}, b, { galleryToken: token }), req);
    const patch = {
      galleryToken: token, galleryCreatedAt: b.galleryCreatedAt || now,
      previewUrl: url, finalUrl: url, shotAt: b.shotAt || now
    };
    if (b.paid) Object.assign(patch, { stage: "delivered", deliveredAt: b.deliveredAt || now, downloadsUnlockedAt: b.downloadsUnlockedAt || now });
    else Object.assign(patch, { stage: "ready", readyAt: b.readyAt || now });
    const c = await db().update(b.id, patch);
    if (!b.paid && b.stage !== "ready") crm.report("ready", ctx.publicBooking(c));
    log(`${b.id} marked ready, ${r.finals} photos, gallery ${url}`);
    return json(res, 200, Object.assign({ ready: true }, await jobView(req, c)));
  }

  async function adminFile(req, res, b, pid, variant) {
    const p = await db().photo(b.id, pid);
    if (!p) return send(res, 404, "Not found", { "content-type": "text/plain" });
    const map = {
      "source-thumb": [p.sourceThumbKey, "image/webp"], "source-preview": [p.sourcePreviewKey, "image/jpeg"],
      original: [p.originalStorageKey, p.mimeType], thumb: [p.thumbnailStorageKey, "image/webp"],
      low: [p.lowResStorageKey, "image/jpeg"], high: [p.highResStorageKey, "image/jpeg"], preview: [p.previewStorageKey, "image/jpeg"]
    };
    const m = map[variant];
    if (!m) return send(res, 404, "Not found", { "content-type": "text/plain" });
    return stream(req, res, m[0], { type: m[1], filename: p.originalFilename, cache: "private, max-age=604800" });
  }

  // /api/admin/jobs/... Returns false when the path is not one of these.
  async function admin(req, res, url) {
    const m = /^\/api\/admin\/jobs\/(EZ-\d{6})(\/.*)?$/.exec(url.pathname);
    if (!m) return false;
    if (!db()) return json(res, 503, { error: "No database." });
    const b = await db().find(m[1]);
    if (!b) return json(res, 404, { error: "No such booking." });
    const rest = m[2] || "";
    if (rest === "" && req.method === "GET") return json(res, 200, await jobView(req, b));
    if (rest === "/photos" && req.method === "POST") return uploadPhoto(req, res, b, url);
    if (rest === "/video" && req.method === "POST") return uploadVideo(req, res, b, url);
    if (rest === "/video" && (req.method === "GET" || req.method === "HEAD")) return stream(req, res, b.videoStorageKey, { type: b.videoMime, filename: b.videoName, cache: "private, max-age=3600" });
    if (rest === "/action" && req.method === "POST") return action(req, res, b);
    const f = /^\/photos\/(\d+)\/([a-z-]+)$/.exec(rest);
    if (f && (req.method === "GET" || req.method === "HEAD")) return adminFile(req, res, b, Number(f[1]), f[2]);
    return json(res, 404, { error: "No such endpoint." });
  }

  // ------------------------------------------------------------------------
  // The client's gallery
  // ------------------------------------------------------------------------
  async function galleryBooking(token) {
    if (!db() || !/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
    const b = await db().byGallery(token);
    if (!b || !b.galleryCreatedAt || b.status !== "confirmed") return null;
    return b;
  }

  async function galleryView(req, b) {
    const photos = (await db().photos(b.id)).filter(p => p.selectedForDelivery && ready(p));
    const paid = !!b.paid;
    const base = `/g/${b.galleryToken}`;
    const name = slug(b.address);
    return {
      address: b.address, agent: firstName(b) ? b.name : "", brokerage: b.brokerage || "",
      paid, amount: b.amount, packageName: b.packageName, videoSelected: !!b.videoSelected,
      status: paid ? "paid" : "unpaid", flagged: !!b.flaggedAt,
      canPay: !paid && b.stage === "ready" && !b.flaggedAt,
      photos: photos.map((p, i) => {
        const v = Date.parse(p.updatedAt) || 0;
        return {
          id: p.id, n: i + 1, category: p.category, width: p.editedWidth, height: p.editedHeight,
          thumb: `${base}/p/${p.id}/thumb?v=${v}${paid ? "&paid=1" : ""}`,
          view: `${base}/p/${p.id}/${paid ? "low" : "preview"}?v=${v}`,
          full: paid ? `${base}/p/${p.id}/high?v=${v}` : "",
          high: paid ? `${base}/p/${p.id}/high?dl=1&v=${v}` : "",
          mls: paid ? `${base}/p/${p.id}/low?dl=1&v=${v}` : ""
        };
      }),
      video: b.videoStorageKey ? { url: `${base}/video`, download: paid ? `${base}/video?dl=1` : "" } : null,
      downloads: paid ? { high: `${base}/zip/high`, mls: `${base}/zip/mls`, highName: `${name}-high-resolution.zip`, mlsName: `${name}-mls.zip` } : null
    };
  }

  // /api/gallery/<token> and /g/<token>/... Returns false when not ours.
  async function gallery(req, res, url) {
    let m = /^\/api\/gallery\/([A-Za-z0-9_-]+)(\/pay|\/change)?$/.exec(url.pathname);
    if (m) {
      const b = await galleryBooking(m[1]);
      if (!b) return json(res, 404, { error: "That gallery link does not match a gallery." });
      if (m[2] === "/change" && req.method === "POST") return requestChange(req, res, b);
      if (m[2] && req.method === "POST") {
        if (b.paid) return json(res, 400, { error: "This one is already paid. Thank you." });
        if (b.stage !== "ready") return json(res, 400, { error: "Nothing is due on this gallery." });
        const back = galleryUrl(b, req);
        return ctx.checkout(req, res, b, back + "?paid={CHECKOUT_SESSION_ID}", back);
      }
      if (req.method !== "GET") return json(res, 405, { error: "No." });
      // The first time the client opens it, not the owner checking it.
      if (!b.galleryFirstViewedAt && !ctx.authed(req)) {
        if (await db().claimOnce(b.id, "gallery_first_viewed_at")) log(`${b.id} gallery opened by the client`);
      }
      return json(res, 200, await galleryView(req, b));
    }
    m = /^\/g\/([A-Za-z0-9_-]{16,64})\/(p\/(\d+)\/(thumb|preview|low|high)|zip\/(high|mls)|video)$/.exec(url.pathname);
    if (!m) return false;
    if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "Method not allowed", { "content-type": "text/plain" });
    const b = await galleryBooking(m[1]);
    if (!b) return send(res, 404, "Not found", { "content-type": "text/plain" });
    const paid = !!b.paid;
    const name = slug(b.address);
    const dl = url.searchParams.get("dl") === "1";

    if (m[3]) {
      const variant = m[4];
      // The payment is the only key to the clean files: checked here, on the
      // server, from the booking row, every time.
      if ((variant === "high" || variant === "low") && !paid) return send(res, 402, "Pay to unlock the downloads.", { "content-type": "text/plain" });
      const p = await db().photo(b.id, Number(m[3]));
      if (!p || !p.selectedForDelivery || !ready(p)) return send(res, 404, "Not found", { "content-type": "text/plain" });
      const finals = (await db().photos(b.id)).filter(x => x.selectedForDelivery && ready(x));
      const n = String(finals.findIndex(x => x.id === p.id) + 1).padStart(2, "0");
      // Unpaid, the grid gets the watermarked thumbnail: nothing clean leaves
      // the server before the payment, at any size.
      const key = { thumb: paid ? p.thumbnailStorageKey : p.previewThumbKey, preview: p.previewStorageKey, low: p.lowResStorageKey, high: p.highResStorageKey }[variant];
      const type = variant === "thumb" ? "image/webp" : "image/jpeg";
      const file = `${name}-${n}${variant === "low" ? "-mls" : ""}.${variant === "thumb" ? "webp" : "jpg"}`;
      return stream(req, res, key, { type, filename: file, download: dl, cache: paid ? "private, max-age=604800" : "private, max-age=3600" });
    }
    if (m[5]) {
      if (!paid) return send(res, 402, "Pay to unlock the downloads.", { "content-type": "text/plain" });
      const which = m[5];
      const finals = (await db().photos(b.id)).filter(x => x.selectedForDelivery && ready(x));
      const zipName = `${name}-${which === "high" ? "high-resolution" : "mls"}.zip`;
      res.writeHead(200, {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="${zipName}"`,
        "cache-control": "private, no-store"
      });
      const z = new ZipWriter(res);
      try {
        for (let i = 0; i < finals.length; i++) {
          const p = finals[i];
          const key = which === "high" ? p.highResStorageKey : p.lowResStorageKey;
          const obj = await storage.get(key);
          if (!obj) continue;
          await z.add(`${name}-${String(i + 1).padStart(2, "0")}${which === "mls" ? "-mls" : ""}.jpg`, obj.stream);
        }
        await z.finish();
        res.end();
        log(`${b.id} ${which} zip downloaded, ${finals.length} photos`);
      } catch (e) {
        warn(`${b.id} zip stopped:`, e.message);
        res.destroy();
      }
      return;
    }
    // The video: plays in the gallery before payment, downloads after it.
    if (dl && !paid) return send(res, 402, "Pay to unlock the downloads.", { "content-type": "text/plain" });
    const ext = b.videoMime === "video/quicktime" ? "mov" : "mp4";
    return stream(req, res, b.videoStorageKey, { type: b.videoMime, filename: `${name}-listing-video.${ext}`, download: dl, cache: "private, max-age=3600" });
  }

  // Request a change, from the gallery. Told to the owner by email and kept
  // on the job; never a flag, so nothing else stops.
  async function requestChange(req, res, b) {
    const p = await body(req, 20 * 1024).catch(() => null);
    const message = str(p && p.message, 2000);
    if (!message) return json(res, 400, { error: "Tell me what you would like changed." });
    if (await db().changesToday(b.id) >= 20) return json(res, 429, { error: "That is a lot of requests for one day. Reply to my message instead and I will sort it." });
    const finals = (await db().photos(b.id)).filter(x => x.selectedForDelivery && ready(x));
    const nums = [...new Set((Array.isArray(p.photos) ? p.photos : []).map(Number))].filter(n => n >= 1 && n <= finals.length).sort((a, c) => a - c).slice(0, 75);
    const ids = nums.map(n => finals[n - 1].id);
    const labels = nums.length ? "Photo " + nums.join(", ") : "The whole gallery";
    const c = await db().addChange(b.id, ids, labels, message);
    log(`${b.id} change requested in the gallery: ${labels}`);
    after(email.toOwner("change", ctx.publicBooking(b), ctx.SITE_URL, { reason: labels + ": " + message, link: "/admin-job?id=" + b.id }), b.id, "change request");
    return json(res, 200, { ok: true, id: c.id });
  }

  // For the admin bookings list: how far each job's photos are.
  async function summaries(bookingIds) { return db() ? db().photoSummary(bookingIds) : new Map(); }

  return { admin, gallery, start, pump, recover, summaries, galleryUrl, templates, firstName };
}

module.exports = { setup };
