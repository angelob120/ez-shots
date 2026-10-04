// manage.html: the customer's own view of one booking, by the token in the
// link they were given. No account, no password. The token is 32 random hex
// characters and the server answers nothing without the right one.
//
// This page is where the client goes at every step without having to ask
// anyone: where the job is, the previews, the Pay button once the photos are
// ready, the clean files once paid, cancel before the shoot, and Not happy.
// Moving a booking is still an email, because a move is a new slot and the
// owner should see it happen.
(function () {
  var params = new URLSearchParams(location.search);
  var token = params.get("t") || "";
  var paidSession = params.get("paid") || "";
  var $ = function (id) { return document.getElementById(id); };
  var title = $("manage-title"), lead = $("manage-lead"), block = $("manage-block"), missing = $("manage-missing");
  var summary = $("manage-summary"), cancelBtn = $("manage-cancel"), status = $("manage-status");
  var payBtn = $("manage-pay"), unhappyBtn = $("manage-unhappy");

  var STEPS = ["Booked", "Shoot day", "Editing", "Photos ready", "Paid and delivered"];
  var AT = { booked: 0, shot: 2, ready: 3, delivered: 5 };

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function say(type, text) {
    status.className = "form-status show " + type;
    status.textContent = text;
  }

  function none() {
    title.textContent = "No booking found";
    lead.textContent = "";
    block.hidden = true;
    missing.hidden = false;
  }

  // One sentence that answers "what happens now?" for every state.
  function nextLine(b) {
    if (b.state === "cancelled") return "This booking is cancelled. Nothing is due. You can book a new time whenever you like.";
    if (b.state === "expired") return "This booking was not completed, so the time went back on the calendar. Nothing is due.";
    if (b.flagged && !b.paid) return "You told me the photos missed. Nothing is due, and I will be in touch personally to make it right.";
    if (b.flagged) return "You told me something is not right. I will be in touch personally.";
    if (b.stage === "delivered") return "Paid, thank you. Your full resolution files are below and stay here whenever you need them.";
    if (b.stage === "ready") return "Your photos are ready. Have a look. Happy with them? Pay $" + b.amount + " and the full resolution files unlock straight away. Not happy, you do not pay.";
    if (b.stage === "shot") return "The shoot is done and I am editing. Your previews arrive by email in about 24 hours, never more than 72. Nothing is due until then.";
    return "You are booked for " + b.when + ". Nothing is due today. A reminder comes the day before, and you pay after you have seen the photos.";
  }

  function paint(b) {
    title.textContent = b.address;
    lead.textContent = b.when + ". Booking " + b.id + ".";

    var live = b.state === "confirmed";
    var at = live ? AT[b.stage] || 0 : -1;
    if (live && b.stage === "booked" && Date.parse(b.startsAt) < Date.now()) at = 1;
    $("manage-steps").innerHTML = live ? STEPS.map(function (s, i) {
      return '<li class="' + (i < at ? "done" : i === at ? "on" : "") + '"><b>' + (i < at ? "&#10003;" : i + 1) + "</b> " + esc(s) + "</li>";
    }).join("") : "";
    $("manage-steps").hidden = !live;
    $("manage-next").textContent = nextLine(b);

    var rows = [
      ["What", b.package + (b.firstShoot ? ", first shoot half price" : "")],
      ["When", b.when],
      ["Where", b.address],
      ["Access", b.access + (b.accessNotes ? ". " + b.accessNotes : "")],
      ["Notes", b.notes]
    ].filter(function (r) { return r[1]; });
    if (b.paid) rows.push(["Paid", "$" + b.amount]);
    else if (live) rows.push(["Due after you see the photos", "$" + b.amount]);
    else rows.push(["Due", "$0"]);
    summary.innerHTML = rows.map(function (r, i) {
      return '<div class="sum-row' + (i === rows.length - 1 ? " sum-total" : "") + '"><span>' + esc(r[0]) + "</span><b>" + esc(r[1]) + "</b></div>";
    }).join("");

    $("pay").hidden = !b.canPay;
    $("manage-preview").hidden = !b.previewUrl;
    if (b.previewUrl) $("manage-preview").href = b.previewUrl;
    payBtn.textContent = "Pay $" + b.amount + " and get the files";
    $("files").hidden = !(b.paid && b.finalUrl);
    if (b.finalUrl) $("manage-files").href = b.finalUrl;
    $("unhappy").hidden = !b.canFlag;
    $("unhappy-help").textContent = b.paid
      ? "Then you get every dollar back, and I send you $20 for the trouble. Tell me what missed and I will be in touch personally."
      : "Then you do not pay, and I send you $20 for the trouble. Tell me what missed and I will be in touch personally. Nothing else gets sent to you in the meantime.";

    $("manage-ics").href = "/api/ics?t=" + encodeURIComponent(token);
    $("manage-ics").hidden = !live || b.stage !== "booked";
    cancelBtn.hidden = !b.canCancel;
    paintBrand(b);
    block.hidden = false;
    missing.hidden = true;
  }

  // ---- the watermark and reference photos ----
  // Shown while they can still change (until the photos are sent), and after
  // that only if something was added, read only.
  var brandOpen = false;
  function sayBrand(type, text) {
    var el = $("brand-status");
    el.className = "form-status" + (text ? " show " + type : "");
    el.textContent = text || "";
  }
  function thumb(f, removable, caption) {
    return '<div class="brand-thumb"><a href="' + esc(f.url) + '" target="_blank" rel="noopener"><img src="' + esc(f.url) + '" alt="' + esc(f.name || "Your upload") + '" loading="lazy" /></a>' +
      (removable ? '<button type="button" data-remove="' + f.id + '" aria-label="Remove ' + esc(f.name || "this photo") + '">&times;</button>' : "") +
      (caption ? "<small>" + esc(caption) + "</small>" : "") + "</div>";
  }
  // Uploads and removals answer with the brand fields only, so they repaint
  // this panel and leave the rest of the page alone.
  function paintBrand(b, saved) {
    if (b.canBrand !== undefined) brandOpen = !!b.canBrand;
    var refs = b.references || [], wm = b.watermark;
    $("brand").hidden = !(brandOpen || wm || refs.length || b.referenceNotes);
    $("brand-wm").innerHTML = wm ? thumb(wm, brandOpen && !wm.fromEarlier, wm.fromEarlier ? "From your last booking" : "") : "";
    $("brand-refs").innerHTML = refs.map(function (f) { return thumb(f, brandOpen); }).join("");
    $("brand-wm-pick").firstChild.nodeValue = wm ? "Replace your logo" : "Upload your logo";
    $("brand-wm-opts").hidden = !wm;
    $("brand-want").checked = !!b.wantWatermark;
    $("brand-spot").value = b.watermarkSpot || "bottom right";
    $("brand-spot").closest(".field").hidden = !b.wantWatermark;
    // Notes being typed are not wiped by a photo upload finishing.
    if (b.canBrand !== undefined || saved) $("brand-notes").value = b.referenceNotes || "";
    ["brand-wm-pick", "brand-refs-pick", "brand-save"].forEach(function (id) { $(id).hidden = !brandOpen; });
    $("brand-refs-pick").hidden = !brandOpen || refs.length >= EZUploads.MAX_REFERENCES;
    ["brand-want", "brand-spot", "brand-notes"].forEach(function (id) { $(id).disabled = !brandOpen; });
  }

  function upload(kind, file) { return EZUploads.upload(token, kind, file); }

  $("brand-wm-file").addEventListener("change", function (e) {
    var f = e.target.files[0];
    e.target.value = "";
    if (!f) return;
    sayBrand("pending", "Uploading your logo...");
    upload("watermark", f).then(function (b) {
      paintBrand(b);
      sayBrand("success", "Got your logo. It goes on the photos unless you untick the box.");
    }).catch(function (err) { sayBrand("error", err.message); });
  });

  $("brand-refs-file").addEventListener("change", function (e) {
    var files = Array.prototype.slice.call(e.target.files);
    e.target.value = "";
    if (!files.length) return;
    var done = 0, last = null;
    sayBrand("pending", "Uploading 1 of " + files.length + "...");
    files.reduce(function (p, f) {
      return p.then(function () {
        return upload("reference", f).then(function (b) {
          last = b; done++;
          paintBrand(b);
          if (done < files.length) sayBrand("pending", "Uploading " + (done + 1) + " of " + files.length + "...");
        });
      });
    }, Promise.resolve()).then(function () {
      sayBrand("success", done === 1 ? "Photo added." : done + " photos added.");
    }).catch(function (err) {
      if (last) paintBrand(last);
      sayBrand("error", (done ? done + " added. " : "") + err.message);
    });
  });

  $("brand-refs").addEventListener("click", removeFile);
  $("brand-wm").addEventListener("click", removeFile);
  function removeFile(e) {
    var btn = e.target.closest("[data-remove]");
    if (!btn) return;
    btn.disabled = true;
    post("/api/manage/remove", { id: Number(btn.getAttribute("data-remove")) }).then(function (x) {
      if (!x.ok) throw new Error(x.d.error || "Could not remove that.");
      paintBrand(x.d.booking);
      sayBrand("success", "Removed.");
    }).catch(function (err) { btn.disabled = false; sayBrand("error", err.message); });
  }

  $("brand-want").addEventListener("change", function () {
    $("brand-spot").closest(".field").hidden = !this.checked;
  });

  $("brand-save").addEventListener("click", function () {
    var btn = this;
    btn.disabled = true;
    sayBrand("pending", "Saving...");
    EZUploads.saveBrand(token, {
      wantWatermark: $("brand-want").checked,
      watermarkSpot: $("brand-spot").value,
      referenceNotes: $("brand-notes").value
    }).then(function (b) {
      btn.disabled = false;
      paintBrand(b, true);
      sayBrand("success", "Saved. I will have it with me on the shoot.");
    }).catch(function (err) { btn.disabled = false; sayBrand("error", err.message); });
  });

  function load() {
    return fetch("/api/manage?t=" + encodeURIComponent(token), { headers: { accept: "application/json" } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (d && d.booking) { paint(d.booking); return d.booking; } none(); return null; });
  }

  if (!token || !window.fetch) return none();

  function post(path, body) {
    return fetch(path + "?t=" + encodeURIComponent(token), {
      method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body || {})
    }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, d: d }; }); });
  }

  // Back from Stripe. Ask the server to read the payment from Stripe itself,
  // which also delivers if the webhook has not yet, then show the files.
  var first = paidSession && /^cs_[A-Za-z0-9_]+$/.test(paidSession)
    ? fetch("/api/session?id=" + encodeURIComponent(paidSession)).catch(function () {})
    : Promise.resolve();
  first.then(load).then(function (b) {
    if (b && paidSession && b.paid) say("success", "Payment received, thank you. Your files are ready below and on their way to your email.");
    else if (b && paidSession) say("pending", "Your payment is being confirmed. This page will show your files in a moment; refresh if it does not.");
    if (b && location.hash) {
      var target = document.getElementById(location.hash.slice(1));
      if (target && !target.hidden) target.scrollIntoView({ block: "center" });
    }
  }).catch(none);

  payBtn.addEventListener("click", function () {
    payBtn.disabled = true;
    say("pending", "Opening the secure payment page...");
    post("/api/pay").then(function (x) {
      if (!x.ok || !x.d.url) throw new Error(x.d.error || "The payment page could not be opened. Try again in a minute.");
      window.location.href = x.d.url;
    }).catch(function (e) { say("error", e.message); payBtn.disabled = false; });
  });

  unhappyBtn.addEventListener("click", function () {
    if (!window.confirm("Tell me you are not happy with the photos? Nothing is due while I sort it out.")) return;
    unhappyBtn.disabled = true;
    say("pending", "Sending...");
    post("/api/manage/unhappy", { reason: $("unhappy-reason").value }).then(function (x) {
      if (!x.ok) throw new Error(x.d.error || "That did not go through. Reply to your email instead.");
      paint(x.d.booking);
      say("success", "Got it. Nothing is due, and I will be in touch personally to make it right.");
    }).catch(function (e) { say("error", e.message); unhappyBtn.disabled = false; });
  });

  cancelBtn.addEventListener("click", function () {
    if (!window.confirm("Cancel this shoot? The time goes back on the calendar straight away.")) return;
    cancelBtn.disabled = true;
    say("pending", "Cancelling...");
    post("/api/manage/cancel").then(function (x) {
      if (!x.ok) throw new Error(x.d.error || "Could not cancel.");
      paint(x.d.booking);
      say("success", "Cancelled. Nothing is due. Book a new time whenever you like.");
    }).catch(function (e) { say("error", e.message); cancelBtn.disabled = false; });
  });
})();
