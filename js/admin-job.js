// admin-job.html: one booking's fulfillment, start to finish.
//
//   1. Upload  drop the whole shoot. Files go up three at a time, each with
//              its own progress bar, straight from disk (the browser streams
//              the File, it never reads a 30 MB photo into memory). A failed
//              one can be retried, all of them can be cancelled, and the same
//              file twice is skipped here and again on the server.
//   2. Sort    select (click, shift click, Select all), make final, set the
//              category, drag to reorder, delete. The count of finals against
//              the limit is always on screen, and the server refuses to pass it.
//   3. Edit    Edit with AI queues the selected photos. Before anything is
//              paid for, a dialog says how many and roughly what it costs.
//              Use as shot delivers a frame with no AI edit. The page polls
//              while edits run; leaving and coming back is fine, the server
//              does the work.
//   4. Review  every final with its edit. Approve all, then remove or
//              re-edit the misses; the viewer has Before and After.
//   5. Ready   one press makes the gallery, after the server checks it.
//   6. Send    the gallery link, a text and an email, each one click to copy.
(function () {
  var A = window.EZAdmin;
  if (!A || !A.el("job-grid")) return;
  var el = A.el, esc = A.esc, money = A.money, icon = A.icon;

  var id = (new URLSearchParams(location.search).get("id") || "").toUpperCase();
  var data = null, loadedAt = 0;
  var sel = {};               // photo id -> true
  var lastClicked = null;
  var filter = "all";
  var viewing = null;         // photo id in the viewer
  var compare = false;
  var CATS = [["interior", "Interior"], ["exterior", "Exterior"], ["drone", "Drone"], ["uncategorized", "No category"]];

  function api(path, opts) { return A.api("/api/admin/jobs/" + id + (path || ""), opts); }
  function act(body, busy) {
    var t = A.toast(busy || "Saving...", "pending");
    return api("/action", { method: "POST", body: JSON.stringify(body) })
      // A refusal is shown as a toast and goes no further, so the caller's
      // success message never runs on a failure.
      .then(function (d) { t.done(); take(d); return d; }, function (e) { t.done(); A.toast(e.message, "error"); return new Promise(function () {}); });
  }
  function selected() { return data.photos.filter(function (p) { return sel[p.id]; }); }
  function selectedIds() { return selected().map(function (p) { return p.id; }); }
  function finals() { return data.photos.filter(function (p) { return p.final; }); }
  function working() { return data.photos.filter(function (p) { return p.status === "queued" || p.status === "processing"; }); }
  function size(n) { return n >= 1073741824 ? (n / 1073741824).toFixed(1) + " GB" : n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.round(n / 1024) + " KB"; }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : (many || one + "s")); }

  // ----------------------------------------------------------------
  // Loading
  // ----------------------------------------------------------------
  function take(d) {
    data = d;
    loadedAt = Date.now();
    var keep = {};
    d.photos.forEach(function (p) { if (sel[p.id]) keep[p.id] = true; });
    sel = keep;
    paint();
  }
  function load() { return api("").then(take); }

  // While edits run, ask every few seconds. Nothing to wait for, no polling.
  var pollTimer = null;
  function poll() {
    clearTimeout(pollTimer);
    if (!data || !working().length) return;
    pollTimer = setTimeout(function () {
      if (document.visibilityState === "visible" && !viewing) load().catch(function () {}).then(poll);
      else poll();
    }, 4000);
  }

  // ----------------------------------------------------------------
  // Painting
  // ----------------------------------------------------------------
  function stepNow() {
    var b = data.booking, f = finals();
    if (b.paid && b.galleryUrl) return 6;
    if (b.galleryUrl) return 5;
    if (!data.photos.length) return 0;
    if (working().length) return 2;
    if (f.length && f.every(function (p) { return p.ready; })) return 3;
    return 1;
  }

  function paint() {
    var b = data.booking;
    document.title = b.address + " | Fulfillment | EZ Shots Admin";
    el("job-title").textContent = b.address;
    el("job-sub").textContent = [b.name, b.when, b.packageName, money(b.amount) + (b.paid ? " paid" : " due after")].filter(Boolean).join(", ");
    el("job-back").href = "/admin#" + b.id;
    var steps = ["Upload", "Sort", "AI edit", "Review", "Ready", "Send", "Paid"];
    var now = stepNow();
    el("job-flow").innerHTML = steps.map(function (s, i) {
      return '<li class="' + (i < now ? "done" : i === now ? "on" : "") + '"><b>' + (i < now ? "&#10003;" : i + 1) + "</b>" + esc(s) + "</li>";
    }).join("");
    paintNotices();
    paintChanges();
    paintVideo();
    paintCount();
    paintBar();
    paintGrid();
    paintSettings();
    paintReady();
    paintSend();
    paintUsage();
    el("job-updated").textContent = "Updated " + A.ago(loadedAt);
    if (viewing) paintViewer();
    poll();
  }

  function paintNotices() {
    var out = [];
    if (!data.storage) out.push(["bad", "Photo storage is not set up, so photos cannot be uploaded. Add " + data.storageMissing.join(", ") + " to the ez-shots service in Railway."]);
    if (!data.editor.ready) out.push(["warn", "The AI editor is off (no OPENAI_API_KEY). Photos can still be delivered as shot."]);
    if (data.booking.status !== "confirmed") out.push(["bad", "This booking is cancelled."]);
    if (data.booking.flagged) out.push(["bad", "The client pressed Not happy on this job. Nothing automatic goes to them until you clear it in Bookings."]);
    if (data.booking.manualLinks) out.push(["info", "This job was delivered with outside links before the gallery existed. Those links still work for the client."]);
    el("job-notices").innerHTML = out.map(function (n) { return '<div class="job-notice ' + n[0] + '">' + esc(n[1]) + "</div>"; }).join("");
  }

  // What the client asked to change from the gallery, newest first. Open ones
  // first, with the photos they named; done ones folded away.
  function openChanges() { return (data.changes || []).filter(function (c) { return !c.resolvedAt; }); }
  function paintChanges() {
    var all = data.changes || [], open = openChanges(), done = all.length - open.length;
    var box = el("job-changes");
    box.hidden = !all.length;
    if (!all.length) return;
    var item = function (c) {
      return '<div class="job-change' + (c.resolvedAt ? " done" : "") + '"><div><b>' + esc(c.photos) + "</b><span>" + esc(A.stamp(c.createdAt)) + "</span>" +
        "<p>" + esc(c.message) + "</p>" +
        (c.photoIds.length ? '<div class="job-change-photos">' + c.photoIds.map(function (pid) {
          var p = data.photos.filter(function (x) { return x.id === pid; })[0];
          return p ? '<button type="button" class="adm-thumb" data-view="' + pid + '" title="Open ' + esc(p.name) + '"><img src="' + esc(p.thumb || p.sourceThumb) + '" alt="" /></button>' : "";
        }).join("") + "</div>" : "") + "</div>" +
        '<button type="button" class="adm-btn' + (c.resolvedAt ? " adm-btn-quiet" : "") + '" data-change="' + c.id + '" data-done="' + (c.resolvedAt ? "0" : "1") + '">' + (c.resolvedAt ? "Reopen" : "Mark done") + "</button></div>";
    };
    box.innerHTML = '<div class="adm-card-head"><div><h2>' + (open.length ? open.length + " change " + (open.length === 1 ? "request" : "requests") + " from the client" : "Change requests") +
      "</h2><p>From the Request a change button in their gallery. Re-edit or replace the photo, press Update the gallery, then Mark done.</p></div></div>" +
      '<div class="adm-card-pad">' + open.map(item).join("") +
      (done ? '<details><summary class="adm-help">' + done + " done</summary>" + all.filter(function (c) { return c.resolvedAt; }).map(item).join("") + "</details>" : "") + "</div>";
  }

  function paintCount() {
    var f = finals().length, max = data.maxPhotos;
    el("job-count").innerHTML = '<b class="' + (f > max ? "over" : "") + '">' + f + " / " + max + "</b><span>final photos</span>" +
      "<small>" + plural(data.photos.length, "photo") + " uploaded</small>";
  }

  function paintBar() {
    var s = selected(), n = s.length, d = data.photos;
    var count = function (fn) { return d.filter(fn).length; };
    var filters = [["all", "All", d.length], ["final", "Finals", count(function (p) { return p.final; })],
      ["notfinal", "Not final", count(function (p) { return !p.final; })], ["working", "Editing", working().length],
      ["failed", "Failed", count(function (p) { return p.status === "failed"; })]];
    var canEdit = s.filter(function (p) { return p.status === "none" || (p.status === "failed" && !p.edited); }).length;
    var canRe = s.filter(function (p) { return p.status === "complete" || (p.status === "failed" && p.edited); }).length;
    var failed = s.filter(function (p) { return p.status === "failed"; }).length;
    el("job-bar").innerHTML =
      '<div class="adm-seg" role="group" aria-label="Show">' + filters.map(function (f) {
        return f[2] || f[0] === "all" ? '<button type="button" data-filter="' + f[0] + '" aria-pressed="' + (filter === f[0]) + '">' + esc(f[1]) + ' <span class="n">' + f[2] + "</span></button>" : "";
      }).join("") + "</div>" +
      '<div class="job-bar-sel"><span>' + (n ? "<b>" + n + "</b> selected" : "None selected") + "</span>" +
        '<button type="button" class="adm-btn adm-btn-quiet" data-b="all">Select all</button>' +
        (n ? '<button type="button" class="adm-btn adm-btn-quiet" data-b="none">Clear</button>' : "") + "</div>" +
      '<div class="job-bar-acts">' +
        '<button type="button" class="adm-btn adm-btn-primary" data-b="edit"' + (canEdit ? "" : " disabled") + ">Edit with AI" + (canEdit ? " (" + canEdit + ")" : "") + "</button>" +
        '<button type="button" class="adm-btn" data-b="original"' + (canEdit ? "" : " disabled") + ' title="Deliver the selected photos as shot, no AI edit, no AI cost">Use as shot</button>' +
        '<button type="button" class="adm-btn" data-b="final-on"' + (n ? "" : " disabled") + ">Make final</button>" +
        '<button type="button" class="adm-btn" data-b="final-off"' + (n ? "" : " disabled") + ">Not final</button>" +
        '<select class="adm-select job-cat" data-b="category"' + (n ? "" : " disabled") + ' aria-label="Set category"><option value="">Category...</option>' +
          CATS.map(function (c) { return '<option value="' + c[0] + '">' + c[1] + "</option>"; }).join("") + "</select>" +
        (canRe ? '<button type="button" class="adm-btn" data-b="reedit">Re-edit (' + canRe + ")</button>" : "") +
        (failed ? '<button type="button" class="adm-btn" data-b="retry">Retry (' + failed + ")</button>" : "") +
        '<button type="button" class="adm-btn adm-btn-quiet job-del" data-b="delete"' + (n ? "" : " disabled") + ">" + icon("trash") + "Delete</button>" +
      "</div>";
  }

  function visible() {
    return data.photos.filter(function (p) {
      if (filter === "final") return p.final;
      if (filter === "notfinal") return !p.final;
      if (filter === "working") return p.status === "queued" || p.status === "processing";
      if (filter === "failed") return p.status === "failed";
      return true;
    });
  }

  function badge(p) {
    var m = {
      queued: ["b-info", "Queued"], processing: ["b-info", "Editing"], failed: ["b-bad", "Failed"],
      complete: p.ready ? (p.approved ? ["b-ok", "Approved"] : ["b-ok", p.source === "original" ? "As shot" : "Edited"]) : ["b-info", "Finishing"]
    }[p.status];
    return m ? '<span class="adm-badge ' + m[0] + '">' + m[1] + "</span>" : "";
  }

  function paintGrid() {
    var list = visible();
    if (!data.photos.length) {
      el("job-grid").innerHTML = '<div class="adm-empty"><b>No photos yet</b>Drop the shoot into the box above.</div>';
      return;
    }
    if (!list.length) { el("job-grid").innerHTML = '<div class="adm-empty"><b>Nothing here</b>Pick another filter.</div>'; return; }
    el("job-grid").innerHTML = list.map(function (p) {
      var img = p.thumb || p.sourceThumb;
      return '<div class="job-tile' + (sel[p.id] ? " is-sel" : "") + (p.final ? " is-final" : "") + '" data-id="' + p.id + '" draggable="true" tabindex="0" aria-label="' + esc(p.name) + '">' +
        '<div class="job-img"><img src="' + esc(img) + '" alt="" loading="lazy" decoding="async" />' +
          '<span class="job-check" aria-hidden="true">' + (sel[p.id] ? "&#10003;" : "") + "</span>" +
          '<span class="job-badge">' + badge(p) + "</span>" +
          (p.final ? '<span class="job-final" title="In the final gallery">Final</span>' : "") +
          (openChanges().some(function (c) { return c.photoIds.indexOf(p.id) !== -1; }) ? '<span class="job-asked" title="The client asked for a change to this photo">Change asked</span>' : "") +
          (p.status === "processing" ? '<span class="job-spin" aria-hidden="true"></span>' : "") +
        "</div>" +
        '<div class="job-meta"><span class="job-name" title="' + esc(p.name + (p.error ? "\n" + p.error : "")) + '">' + esc(p.name) + "</span>" +
          '<select class="job-tcat" data-cat="' + p.id + '" aria-label="Category">' + CATS.map(function (c) {
            return '<option value="' + c[0] + '"' + (p.category === c[0] ? " selected" : "") + ">" + c[1] + "</option>";
          }).join("") + "</select></div>" +
        (p.status === "failed" && p.error ? '<div class="job-err">' + esc(p.error) + "</div>" : "") +
      "</div>";
    }).join("");
  }

  function paintSettings() {
    var b = data.booking;
    var refs = data.references || [];
    el("job-settings-body").innerHTML =
      '<label class="adm-field"><span>Extra instructions for the AI editor, this shoot only</span>' +
        '<textarea class="adm-textarea" rows="2" id="job-instr" maxlength="1000" placeholder="Slightly warmer overall tone. Client prefers bright, neutral interiors.">' + esc(b.editInstructions) + "</textarea></label>" +
      (refs.length ? '<label class="adm-check"><input type="checkbox" id="job-refs"' + (b.editUseReferences ? " checked" : "") + ' /> <span>Send two of the client\'s reference photos with each edit (costs more on every photo)</span></label>' : "") +
      (refs.length || data.referenceNotes ? '<p class="adm-help" style="margin:10px 0 6px;font-weight:600">The client\'s reference photos</p><div class="adm-thumbs">' + refs.map(function (f) {
        return '<a class="adm-thumb" href="' + esc(f.url) + '" target="_blank" rel="noopener"><img src="' + esc(f.url) + '" alt="' + esc(f.name || "Reference") + '" loading="lazy" /></a>';
      }).join("") + "</div>" + (data.referenceNotes ? '<p class="adm-help">' + esc(data.referenceNotes) + "</p>" : "") : '<p class="adm-help">The client added no reference photos.</p>') +
      '<div class="adm-panel-actions" style="margin-top:8px"><button type="button" class="adm-btn" data-b="instructions">Save notes</button></div>';
    if (b.editInstructions && !el("job-settings").dataset.touched) el("job-settings").open = true;
  }

  function paintVideo() {
    var b = data.booking;
    var box = el("job-video");
    if (!b.videoSelected) { box.innerHTML = '<p class="adm-help">Video add on: not selected.</p>'; return; }
    box.innerHTML = '<div class="adm-panel"><b>Video add on: ' + (b.video ? "uploaded" : "REQUIRED") + "</b>" +
      (b.video ? '<p class="adm-help">' + esc(b.video.name) + ", " + size(b.video.size) + '. <a href="' + esc(b.video.url) + '" target="_blank" rel="noopener">Play</a></p>'
        : '<p class="adm-help">The client paid for the listing video. Upload the finished MP4 or MOV and it plays in their gallery.</p>') +
      '<div class="adm-panel-actions"><label class="adm-btn' + (b.video ? "" : " adm-btn-primary") + ' job-pick">' + (b.video ? "Replace video" : "Upload video") +
        '<input type="file" id="job-video-file" accept="video/mp4,video/quicktime,.mp4,.mov" /></label>' +
        (b.video ? '<button type="button" class="adm-btn adm-btn-quiet" data-b="remove-video">Remove</button>' : "") +
        (!b.video ? '<label class="adm-check"><input type="checkbox" data-b="video-override"' + (b.videoOverride ? " checked" : "") + " /> <span>Mark ready without it</span></label>" : "") +
      '</div><div id="job-video-progress"></div></div>';
  }

  function paintReady() {
    var r = data.readiness, b = data.booking, f = finals();
    var done = f.filter(function (p) { return p.ready; });
    var approved = done.filter(function (p) { return p.approved; }).length;
    el("job-ready").innerHTML =
      '<div class="job-checks">' +
        '<div class="' + (r.finals && r.finals <= r.max ? "ok" : "no") + '">' + r.finals + " / " + r.max + " final photos</div>" +
        '<div class="' + (done.length === f.length && f.length ? "ok" : "no") + '">' + done.length + " of " + f.length + " finished</div>" +
        '<div class="' + (approved === done.length && done.length ? "ok" : "") + '">' + approved + " approved</div>" +
        (b.videoSelected ? '<div class="' + (b.video || b.videoOverride ? "ok" : "no") + '">Video ' + (b.video ? "uploaded" : b.videoOverride ? "skipped" : "missing") + "</div>" : "") +
      "</div>" +
      (r.problems.length ? '<ul class="job-problems">' + r.problems.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>" : "") +
      '<div class="adm-panel-actions">' +
        '<button type="button" class="adm-btn" data-b="approve-all"' + (done.length && approved < done.length ? "" : " disabled") + ">Approve all</button>" +
        '<button type="button" class="adm-btn adm-btn-primary adm-btn-lg" data-b="ready"' + (r.ok ? "" : " disabled") + ">" +
          (b.galleryUrl ? "Update the gallery" : "Mark ready") + "</button>" +
      "</div>";
  }

  function paintSend() {
    var b = data.booking, t = data.templates;
    el("sec-send").hidden = !b.galleryUrl;
    if (!b.galleryUrl) return;
    var row = function (label, value, ok) { return "<div><span>" + esc(label) + '</span><b class="' + (ok ? "ok" : "") + '">' + esc(value) + "</b></div>"; };
    el("job-send").innerHTML =
      '<div class="job-link"><input class="adm-input" readonly value="' + esc(b.galleryUrl) + '" aria-label="Gallery link" />' +
        '<button type="button" class="adm-btn adm-btn-primary" data-copy-what="Gallery link" data-copy-val="' + esc(b.galleryUrl) + '">' + icon("copy") + "Copy Gallery Link</button>" +
        '<a class="adm-btn" href="' + esc(b.galleryUrl) + '" target="_blank" rel="noopener">' + icon("external") + "Open</a></div>" +
      '<div class="adm-panel-actions" style="margin:-4px 0 14px">' +
        '<button type="button" class="adm-btn" data-copy-what="Low res gallery link" data-copy-val="' + esc(b.galleryUrl + "?res=mls") + '">' + icon("copy") + "Low res gallery link</button>" +
        '<button type="button" class="adm-btn" data-copy-what="Full res gallery link" data-copy-val="' + esc(b.galleryUrl + "?res=full") + '">' + icon("copy") + "Full res gallery link</button>" +
        '<a class="adm-btn adm-btn-quiet" href="' + esc(b.galleryUrl + "?res=mls") + '" target="_blank" rel="noopener">Open low res</a>' +
        '<a class="adm-btn adm-btn-quiet" href="' + esc(b.galleryUrl + "?res=full") + '" target="_blank" rel="noopener">Open full res</a>' +
      "</div>" +
      '<div class="job-send-grid">' +
        '<div class="adm-panel"><b>Text message</b><textarea class="adm-textarea" rows="7" readonly id="job-sms">' + esc(t.sms) + "</textarea>" +
          '<div class="adm-panel-actions"><button type="button" class="adm-btn adm-btn-primary" data-b="copy-sms">' + icon("copy") + "Copy Text</button>" +
          (b.phone ? '<a class="adm-btn" href="sms:' + esc(A.digits(b.phone)) + '">' + icon("message") + "Open Messages</a>" : "") + "</div></div>" +
        '<div class="adm-panel"><b>Email</b><input class="adm-input" readonly id="job-subject" value="' + esc(t.emailSubject) + '" aria-label="Email subject" />' +
          '<textarea class="adm-textarea" rows="8" readonly id="job-email">' + esc(t.emailBody) + "</textarea>" +
          '<div class="adm-panel-actions"><button type="button" class="adm-btn" data-b="copy-email">' + icon("copy") + "Copy Email</button>" +
          (b.email ? '<button type="button" class="adm-btn' + (b.deliveryEmailSentAt ? "" : " adm-btn-primary") + '" data-b="send-email"' + (data.emailOn ? "" : " disabled title=\"Email is not switched on\"") + ">" + icon("mail") + (b.deliveryEmailSentAt ? "Send again" : "Send Email") + "</button>" : "") +
          "</div></div>" +
      "</div>" +
      '<div class="job-dash">' +
        row("Gallery", "Ready", true) +
        row("Client viewed", b.galleryFirstViewedAt ? "Yes, " + A.stamp(b.galleryFirstViewedAt) : "Not yet", !!b.galleryFirstViewedAt) +
        row("Payment", b.paid ? "Paid " + money(b.amount) : "Unpaid, " + money(b.amount), b.paid) +
        row("High res access", b.paid ? "Unlocked" : "Locked", b.paid) +
        row("Text copied", b.smsCopiedAt ? "Yes" : "No", !!b.smsCopiedAt) +
        row("Email sent", b.deliveryEmailSentAt ? "Yes, " + A.stamp(b.deliveryEmailSentAt) : "No", !!b.deliveryEmailSentAt) +
      "</div>";
  }

  function paintUsage() {
    var u = data.usage;
    var tile = function (l, v) { return '<div class="adm-kpi"><div class="adm-kpi-label">' + esc(l) + '</div><div class="adm-kpi-value">' + esc(v) + "</div></div>"; };
    el("job-usage").innerHTML = '<div class="adm-kpis job-kpis">' +
      tile("Source photos", String(u.sourcePhotos)) + tile("AI edited", String(u.aiEdited)) + tile("Re-edits", String(u.reEdits)) +
      tile("AI failures", String(u.aiFailures)) + tile("Estimated AI cost", "$" + u.aiCost.toFixed(2)) + tile("Storage used", size(u.storageBytes)) +
      "</div>" +
      '<p class="adm-help">AI editor: ' + (data.editor.ready ? esc(data.editor.model) : "off") + ". Storage: " + esc(data.storage || "off") +
      ". The cost is an estimate from the model's token rates, see OPENAI_IMAGE_INPUT_PER_M in Railway.</p>";
  }

  // ----------------------------------------------------------------
  // The viewer: one photo large, Before and After, the review actions
  // ----------------------------------------------------------------
  function paintViewer() {
    var v = el("job-viewer");
    var list = visible();
    var i = list.map(function (p) { return p.id; }).indexOf(viewing);
    var p = list[i] || data.photos.filter(function (x) { return x.id === viewing; })[0];
    if (!p) { closeViewer(); return; }
    var after = p.preview, before = p.sourcePreview;
    var main = after && !compare ? after : before;
    v.innerHTML =
      '<div class="job-v-top"><b>' + esc(p.name) + "</b> " + badge(p) + (p.final ? ' <span class="adm-badge b-info plain">Final</span>' : "") +
        '<button type="button" class="adm-icon" data-v="close" aria-label="Close">' + icon("x") + "</button></div>" +
      '<div class="job-v-stage">' +
        (i > 0 ? '<button type="button" class="adm-icon job-v-prev" data-v="prev" aria-label="Previous">' + icon("left") + "</button>" : "") +
        (after && compare ?
          '<div class="job-compare" id="job-compare"><img src="' + esc(before) + '" alt="Before" /><div class="job-compare-after" id="job-after"><img src="' + esc(after) + '" alt="After" /></div>' +
          '<input type="range" min="0" max="100" value="50" id="job-slider" aria-label="Before and after" /><span class="job-tag l">Before</span><span class="job-tag r">After</span></div>'
          : '<img class="job-v-img" src="' + esc(main) + '" alt="' + esc(p.name) + '" />') +
        (i >= 0 && i < list.length - 1 ? '<button type="button" class="adm-icon job-v-next" data-v="next" aria-label="Next">' + icon("chev") + "</button>" : "") +
      "</div>" +
      '<div class="job-v-acts">' +
        (after ? '<button type="button" class="adm-btn" data-v="compare" aria-pressed="' + compare + '">Compare</button>' : '<span class="adm-help">Not edited yet, this is the original.</span>') +
        (p.status === "complete" ? '<button type="button" class="adm-btn' + (p.approved ? "" : " adm-btn-primary") + '" data-v="approve">' + (p.approved ? "Approved" : "Approve") + "</button>" : "") +
        '<button type="button" class="adm-btn" data-v="final">' + (p.final ? "Remove from finals" : "Make final") + "</button>" +
        (p.status === "complete" || (p.status === "failed" && p.edited) ? '<button type="button" class="adm-btn" data-v="reedit">Re-edit</button>' : "") +
        (p.status === "none" ? '<button type="button" class="adm-btn" data-v="edit">Edit with AI</button>' : "") +
        '<a class="adm-btn adm-btn-quiet" href="' + esc(p.original) + '" target="_blank" rel="noopener">View original</a>' +
        '<span class="adm-help">' + (i + 1) + " of " + list.length + (p.error ? ". " + esc(p.error) : "") + "</span>" +
      "</div>";
    var s = el("job-slider");
    if (s) s.addEventListener("input", function () { el("job-after").style.clipPath = "inset(0 0 0 " + s.value + "%)"; });
    if (s) el("job-after").style.clipPath = "inset(0 0 0 50%)";
  }
  function openViewer(pid) { viewing = pid; compare = false; el("job-viewer").hidden = false; document.body.style.overflow = "hidden"; paintViewer(); }
  function closeViewer() { viewing = null; el("job-viewer").hidden = true; document.body.style.overflow = ""; poll(); }
  function step(d) {
    var list = visible(), i = list.map(function (p) { return p.id; }).indexOf(viewing);
    if (list[i + d]) { viewing = list[i + d].id; paintViewer(); }
  }

  el("job-viewer").addEventListener("click", function (e) {
    var t = e.target.closest("[data-v]");
    if (e.target === el("job-viewer")) return closeViewer();
    if (!t) return;
    var v = t.getAttribute("data-v"), pid = viewing;
    var p = data.photos.filter(function (x) { return x.id === pid; })[0];
    if (v === "close") return closeViewer();
    if (v === "prev") return step(-1);
    if (v === "next") return step(1);
    if (v === "compare") { compare = !compare; return paintViewer(); }
    if (v === "approve") return act({ action: "approve", ids: [pid], on: !p.approved }).then(function () { if (!p.approved) step(1); });
    if (v === "final") return act({ action: "final", ids: [pid], on: !p.final });
    if (v === "reedit") return confirmCost(1, true).then(function (yes) { if (yes) act({ action: "reedit", ids: [pid] }, "Queueing..."); });
    if (v === "edit") return confirmCost(1).then(function (yes) { if (yes) act({ action: "edit", ids: [pid] }, "Queueing..."); });
  });

  // ----------------------------------------------------------------
  // Uploads
  // ----------------------------------------------------------------
  var queue = [];      // { file, state: waiting|up|done|dup|failed|cancelled, pct, xhr, error }
  var running = 0;
  var MAX_RUN = 3;
  var paintQueueSoon = null;

  function isPhoto(f) { return /^image\//.test(f.type) || /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name); }

  function addFiles(files) {
    if (!data.storage) return A.toast("Photo storage is not set up yet.", "error");
    var have = {};
    data.photos.forEach(function (p) { have[p.name + "|" + p.size] = true; });
    queue.forEach(function (q) { if (q.state !== "failed" && q.state !== "cancelled") have[q.file.name + "|" + q.file.size] = true; });
    var added = 0, skipped = 0, refused = 0;
    Array.prototype.forEach.call(files, function (f) {
      if (!isPhoto(f)) { refused++; return; }
      if (have[f.name + "|" + f.size]) { skipped++; return; }
      have[f.name + "|" + f.size] = true;
      queue.push({ file: f, state: "waiting", pct: 0 });
      added++;
    });
    if (skipped) A.toast(plural(skipped, "photo") + " already here, skipped.");
    if (refused) A.toast(plural(refused, "file") + " skipped, not a photo.", "error");
    if (added) { paintQueue(); next(); }
  }

  function next() {
    while (running < MAX_RUN) {
      var q = queue.filter(function (x) { return x.state === "waiting"; })[0];
      if (!q) break;
      send(q);
    }
    paintQueue();
  }

  function send(q) {
    running++;
    q.state = "up"; q.pct = 0; q.error = "";
    var xhr = new XMLHttpRequest();
    q.xhr = xhr;
    xhr.open("POST", "/api/admin/jobs/" + id + "/photos?name=" + encodeURIComponent(q.file.name));
    xhr.setRequestHeader("content-type", "application/octet-stream");
    xhr.upload.onprogress = function (e) { if (e.lengthComputable) { q.pct = Math.round(e.loaded / e.total * 100); paintQueueLater(); } };
    xhr.onload = function () {
      var d = {};
      try { d = JSON.parse(xhr.responseText); } catch (e) {}
      if (xhr.status === 401) { q.state = "failed"; q.error = "Signed out"; if (A._gate) A._gate("Your session ran out. Sign in again."); }
      else if (xhr.status >= 200 && xhr.status < 300) {
        q.state = d.duplicate ? "dup" : "done"; q.pct = 100;
        if (d.photo && !d.duplicate) { data.photos.push(d.photo); paintSoon(); }
      } else { q.state = "failed"; q.error = d.error || "Failed (" + xhr.status + ")"; }
      finish();
    };
    xhr.onerror = function () { q.state = "failed"; q.error = "Network error"; finish(); };
    xhr.onabort = function () { q.state = "cancelled"; finish(); };
    xhr.send(q.file);
    function finish() {
      running--; q.xhr = null;
      next();
      if (!queue.some(function (x) { return x.state === "waiting" || x.state === "up"; })) {
        var ok = queue.filter(function (x) { return x.state === "done"; }).length;
        var bad = queue.filter(function (x) { return x.state === "failed"; }).length;
        A.toast(bad ? plural(bad, "upload") + " failed. Retry them below." : plural(ok, "photo") + " uploaded.", bad ? "error" : undefined);
        load().catch(function () {});
      }
    }
  }

  var repaintTimer = null;
  function paintSoon() {
    if (repaintTimer) return;
    repaintTimer = setTimeout(function () { repaintTimer = null; paintCount(); paintBar(); paintGrid(); }, 400);
  }
  function paintQueueLater() {
    if (paintQueueSoon) return;
    paintQueueSoon = setTimeout(function () { paintQueueSoon = null; paintQueue(); }, 150);
  }

  function paintQueue() {
    var box = el("job-queue");
    if (!queue.length) { box.hidden = true; return; }
    box.hidden = false;
    var total = 0, sent = 0;
    queue.forEach(function (q) {
      if (q.state === "cancelled") return;
      total += q.file.size;
      sent += q.state === "done" || q.state === "dup" ? q.file.size : q.state === "up" ? q.file.size * q.pct / 100 : 0;
    });
    var pct = total ? Math.round(sent / total * 100) : 0;
    var by = function (s) { return queue.filter(function (q) { return q.state === s; }).length; };
    var active = by("waiting") + by("up");
    box.innerHTML =
      '<div class="job-q-head"><b>' + (active ? "Uploading, " + pct + "%" : "Uploads finished") + "</b><span>" +
        [by("done") ? by("done") + " done" : "", by("dup") ? by("dup") + " already here" : "", active ? active + " to go" : "",
          by("failed") ? by("failed") + " failed" : "", by("cancelled") ? by("cancelled") + " cancelled" : ""].filter(Boolean).join(", ") + "</span>" +
        (by("failed") ? '<button type="button" class="adm-btn" data-q="retry">Retry failed</button>' : "") +
        (active ? '<button type="button" class="adm-btn adm-btn-quiet" data-q="cancel">Cancel all</button>' : '<button type="button" class="adm-btn adm-btn-quiet" data-q="clear">Clear list</button>') +
      "</div>" +
      '<div class="job-q-bar"><i style="width:' + pct + '%"></i></div>' +
      '<div class="job-q-list">' + queue.filter(function (q) { return q.state !== "done" && q.state !== "dup"; }).slice(0, 200).map(function (q) {
        var i = queue.indexOf(q);
        return '<div class="job-q-row ' + q.state + '"><span>' + esc(q.file.name) + "</span><small>" + size(q.file.size) + "</small>" +
          '<div class="job-q-mini"><i style="width:' + (q.state === "up" ? q.pct : 0) + '%"></i></div>' +
          "<em>" + esc(q.state === "up" ? q.pct + "%" : q.state === "failed" ? q.error : q.state) + "</em>" +
          (q.state === "failed" ? '<button type="button" class="adm-btn adm-btn-quiet" data-q="one" data-i="' + i + '">Retry</button>' : "") +
          (q.state === "up" || q.state === "waiting" ? '<button type="button" class="adm-icon" data-q="stop" data-i="' + i + '" aria-label="Cancel">' + icon("x") + "</button>" : "") +
        "</div>";
      }).join("") + "</div>";
  }

  el("job-queue").addEventListener("click", function (e) {
    var b = e.target.closest("[data-q]");
    if (!b) return;
    var k = b.getAttribute("data-q"), q = queue[Number(b.getAttribute("data-i"))];
    if (k === "retry") queue.forEach(function (x) { if (x.state === "failed") x.state = "waiting"; });
    if (k === "one" && q) q.state = "waiting";
    if (k === "cancel") queue.forEach(function (x) { if (x.state === "waiting") x.state = "cancelled"; if (x.xhr) x.xhr.abort(); });
    if (k === "stop" && q) { if (q.xhr) q.xhr.abort(); else q.state = "cancelled"; }
    if (k === "clear") queue = [];
    next();
  });

  var drop = el("job-drop");
  el("job-files").addEventListener("change", function (e) { addFiles(e.target.files); e.target.value = ""; });
  ["dragenter", "dragover"].forEach(function (t) {
    drop.addEventListener(t, function (e) { if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types, "Files") !== -1) { e.preventDefault(); drop.classList.add("over"); } });
  });
  ["dragleave", "drop"].forEach(function (t) { drop.addEventListener(t, function () { drop.classList.remove("over"); }); });
  drop.addEventListener("drop", function (e) { e.preventDefault(); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); });
  drop.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); el("job-files").click(); } });
  // A photo dropped anywhere on the page goes to the uploader, not to a new tab.
  window.addEventListener("dragover", function (e) { if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types, "Files") !== -1) e.preventDefault(); });
  window.addEventListener("drop", function (e) { if (e.dataTransfer && e.dataTransfer.files.length && !drop.contains(e.target)) { e.preventDefault(); addFiles(e.dataTransfer.files); } });

  function uploadVideo(file) {
    var box = el("job-video-progress");
    var xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/admin/jobs/" + id + "/video?name=" + encodeURIComponent(file.name));
    xhr.setRequestHeader("content-type", "application/octet-stream");
    xhr.upload.onprogress = function (e) {
      if (e.lengthComputable && box) box.innerHTML = '<div class="job-q-bar"><i style="width:' + Math.round(e.loaded / e.total * 100) + '%"></i></div><p class="adm-help">Uploading the video, ' + Math.round(e.loaded / e.total * 100) + "%. Keep this page open.</p>";
    };
    xhr.onload = function () {
      var d = {}; try { d = JSON.parse(xhr.responseText); } catch (e) {}
      if (xhr.status >= 200 && xhr.status < 300) { A.toast("Video uploaded."); load(); }
      else A.toast(d.error || "The video did not upload.", "error");
    };
    xhr.onerror = function () { A.toast("The video upload failed. Try again.", "error"); };
    xhr.send(file);
  }
  el("job-video").addEventListener("change", function (e) {
    if (e.target.id === "job-video-file" && e.target.files[0]) uploadVideo(e.target.files[0]);
    if (e.target.matches('[data-b="video-override"]')) act({ action: "videoOverride", on: e.target.checked });
  });

  // ----------------------------------------------------------------
  // Selecting, sorting, reordering
  // ----------------------------------------------------------------
  el("job-grid").addEventListener("click", function (e) {
    if (e.target.closest("select")) return;
    var t = e.target.closest(".job-tile");
    if (!t) return;
    var pid = Number(t.getAttribute("data-id"));
    var list = visible().map(function (p) { return p.id; });
    if (e.shiftKey && lastClicked !== null && list.indexOf(lastClicked) !== -1) {
      var a = list.indexOf(lastClicked), b = list.indexOf(pid);
      list.slice(Math.min(a, b), Math.max(a, b) + 1).forEach(function (x) { sel[x] = true; });
    } else if (sel[pid]) delete sel[pid];
    else sel[pid] = true;
    lastClicked = pid;
    paintBar(); paintGrid();
  });
  el("job-grid").addEventListener("dblclick", function (e) {
    var t = e.target.closest(".job-tile");
    if (t && !e.target.closest("select")) openViewer(Number(t.getAttribute("data-id")));
  });
  el("job-grid").addEventListener("keydown", function (e) {
    var t = e.target.closest(".job-tile");
    if (!t) return;
    if (e.key === "Enter") openViewer(Number(t.getAttribute("data-id")));
    if (e.key === " ") { e.preventDefault(); t.click(); }
  });
  el("job-grid").addEventListener("change", function (e) {
    var c = e.target.closest("[data-cat]");
    if (c) act({ action: "category", ids: [Number(c.getAttribute("data-cat"))], category: c.value });
  });

  // Drag a tile onto another to put it there.
  var dragId = null;
  el("job-grid").addEventListener("dragstart", function (e) {
    var t = e.target.closest(".job-tile");
    if (!t) return;
    dragId = Number(t.getAttribute("data-id"));
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(dragId));
    t.classList.add("dragging");
  });
  el("job-grid").addEventListener("dragover", function (e) {
    if (dragId === null) return;
    var t = e.target.closest(".job-tile");
    if (!t) return;
    e.preventDefault();
    document.querySelectorAll(".job-tile.drop-before").forEach(function (n) { n.classList.remove("drop-before"); });
    t.classList.add("drop-before");
  });
  el("job-grid").addEventListener("drop", function (e) {
    if (dragId === null) return;
    e.preventDefault();
    e.stopPropagation();
    var t = e.target.closest(".job-tile");
    var to = t ? Number(t.getAttribute("data-id")) : null;
    var order = data.photos.map(function (p) { return p.id; });
    var moving = sel[dragId] ? order.filter(function (x) { return sel[x]; }) : [dragId];
    if (to === null || moving.indexOf(to) !== -1) return;
    order = order.filter(function (x) { return moving.indexOf(x) === -1; });
    var at = order.indexOf(to);
    Array.prototype.splice.apply(order, [at, 0].concat(moving));
    var byId = {};
    data.photos.forEach(function (p) { byId[p.id] = p; });
    data.photos = order.map(function (x) { return byId[x]; });
    paintGrid();
    api("/action", { method: "POST", body: JSON.stringify({ action: "order", ids: order }) }).then(take, function (err) { A.toast(err.message, "error"); load(); });
  });
  el("job-grid").addEventListener("dragend", function () {
    dragId = null;
    document.querySelectorAll(".job-tile.dragging, .job-tile.drop-before").forEach(function (n) { n.classList.remove("dragging", "drop-before"); });
  });

  // What a batch will roughly cost, before anything is paid for.
  function confirmCost(n, again) {
    var each = data.editor.estimateEach || 0;
    return A.confirm({
      title: (again ? "Re-edit " : "Edit ") + plural(n, "photo") + " with AI?",
      body: plural(n, "photo") + " will be processed by " + data.editor.model + "." +
        (each ? "\nEstimated cost: about $" + (n * each).toFixed(2) + "." : "") +
        (again ? "\nThe current edit stays until the new one is done." : "\nPhotos that already have an edit are skipped, so nothing is paid for twice."),
      ok: (again ? "Re-edit " : "Edit ") + n
    });
  }

  // ----------------------------------------------------------------
  // The toolbar, ready and send
  // ----------------------------------------------------------------
  document.addEventListener("click", function (e) {
    var f = e.target.closest("[data-filter]");
    if (f && el("job-bar").contains(f)) { filter = f.getAttribute("data-filter"); paintBar(); paintGrid(); return; }
    var ch = e.target.closest("[data-change]");
    if (ch) return act({ action: "resolveChange", changeId: Number(ch.getAttribute("data-change")), done: ch.getAttribute("data-done") === "1" });
    var vw = e.target.closest("[data-view]");
    if (vw) return openViewer(Number(vw.getAttribute("data-view")));
    var c = e.target.closest("[data-copy-val]");
    if (c) return A.copy(c.getAttribute("data-copy-val"), c.getAttribute("data-copy-what"));
    var b = e.target.closest("[data-b]");
    if (!b || b.tagName === "SELECT" || b.type === "checkbox") return;
    var k = b.getAttribute("data-b");
    var ids = selectedIds();
    if (k === "all") { visible().forEach(function (p) { sel[p.id] = true; }); paintBar(); paintGrid(); return; }
    if (k === "none") { sel = {}; paintBar(); paintGrid(); return; }
    if (k === "final-on") return act({ action: "final", ids: ids, on: true });
    if (k === "final-off") return act({ action: "final", ids: ids, on: false });
    if (k === "edit" || k === "original") {
      var todo = selected().filter(function (p) { return p.status === "none" || (p.status === "failed" && !p.edited); });
      if (!todo.length) return;
      var go = k === "edit" ? confirmCost(todo.length) : Promise.resolve(true);
      return go.then(function (yes) {
        if (!yes) return;
        return act({ action: k, ids: todo.map(function (p) { return p.id; }) }, "Queueing...").then(function (d) {
          A.toast(plural(d.queued || 0, "photo") + (k === "edit" ? " queued for the AI editor." : " being finished as shot.") + (d.skipped ? " " + d.skipped + " already done, skipped." : ""));
          sel = {};
          paint();
        });
      });
    }
    if (k === "reedit") {
      var re = selected().filter(function (p) { return p.status === "complete" || (p.status === "failed" && p.edited); });
      return confirmCost(re.length, true).then(function (yes) { if (yes) act({ action: "reedit", ids: re.map(function (p) { return p.id; }) }, "Queueing..."); });
    }
    if (k === "retry") return act({ action: "retry", ids: ids }, "Queueing...");
    if (k === "delete") {
      return A.confirm({ title: "Delete " + plural(ids.length, "photo") + "?", body: "They are removed from this job and from storage. This cannot be undone.", ok: "Delete", danger: true })
        .then(function (yes) { if (yes) act({ action: "delete", ids: ids }, "Deleting...").then(function () { sel = {}; paint(); }); });
    }
    if (k === "instructions") {
      el("job-settings").dataset.touched = "1";
      return act({ action: "instructions", text: el("job-instr").value, useReferences: !!(el("job-refs") && el("job-refs").checked) }).then(function () { A.toast("Notes saved. They apply to the next edits."); });
    }
    if (k === "approve-all") return act({ action: "approveAll" }).then(function (d) { A.toast(plural(d.approved || 0, "photo") + " approved."); });
    if (k === "ready") {
      return act({ action: "ready" }, "Making the gallery...").then(function () {
        A.toast("Ready. The gallery link and the messages are below.");
        el("sec-send").scrollIntoView({ behavior: "smooth", block: "start" });
      }, function () {});
    }
    if (k === "remove-video") return A.confirm({ title: "Remove the video?", ok: "Remove", danger: true }).then(function (yes) { if (yes) act({ action: "removeVideo" }); });
    if (k === "copy-sms") { A.copy(data.templates.sms, "Text"); return api("/action", { method: "POST", body: JSON.stringify({ action: "smsCopied" }) }).then(take, function () {}); }
    if (k === "copy-email") return A.copy("Subject: " + data.templates.emailSubject + "\n\n" + data.templates.emailBody, "Email");
    if (k === "send-email") {
      var again = !!data.booking.deliveryEmailSentAt;
      return A.confirm({ title: (again ? "Send the gallery email again" : "Send the gallery email") + " to " + data.booking.email + "?", ok: again ? "Send again" : "Send" })
        .then(function (yes) { if (yes) act({ action: "sendEmail", again: again }, "Sending...").then(function () { A.toast("Email sent to " + data.booking.email + "."); }, function () {}); });
    }
  });
  el("job-bar").addEventListener("change", function (e) {
    if (e.target.matches('[data-b="category"]') && e.target.value) act({ action: "category", ids: selectedIds(), category: e.target.value });
  });
  el("job-settings").addEventListener("toggle", function () { el("job-settings").dataset.touched = "1"; });

  document.addEventListener("keydown", function (e) {
    if (document.querySelector(".adm-modal")) return;
    if (viewing) {
      if (e.key === "Escape") return closeViewer();
      if (e.key === "ArrowRight") return step(1);
      if (e.key === "ArrowLeft") return step(-1);
      if (e.key.toLowerCase() === "a") { var a = el("job-viewer").querySelector('[data-v="approve"]'); if (a) a.click(); }
      if (e.key.toLowerCase() === "c") { var c = el("job-viewer").querySelector('[data-v="compare"]'); if (c) c.click(); }
      return;
    }
    var typing = /input|textarea|select/i.test(e.target.tagName);
    if (typing || !data) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") { e.preventDefault(); visible().forEach(function (p) { sel[p.id] = true; }); paintBar(); paintGrid(); }
    if (e.key === "Escape") { sel = {}; paintBar(); paintGrid(); }
    if ((e.key === "Delete" || e.key === "Backspace") && selectedIds().length) { e.preventDefault(); el("job-bar").querySelector('[data-b="delete"]').click(); }
  });

  window.addEventListener("beforeunload", function (e) {
    if (queue.some(function (q) { return q.state === "up" || q.state === "waiting"; })) { e.preventDefault(); e.returnValue = ""; }
  });

  el("job-refresh").innerHTML = icon("refresh");
  el("job-refresh").addEventListener("click", function () { load().then(function () { A.toast("Up to date."); }, function (e) { A.toast(e.message, "error"); }); });
  setInterval(function () { if (data) el("job-updated").textContent = "Updated " + A.ago(loadedAt); }, 20000);

  A.boot("bookings", function () {
    if (!/^EZ-\d{6}$/.test(id)) { el("job-title").textContent = "No booking picked"; el("job-sub").textContent = "Open a booking from the Bookings page."; return; }
    return load().catch(function (e) { el("job-title").textContent = "Could not load this job"; el("job-sub").textContent = e.message; });
  });
})();
