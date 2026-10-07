// gallery.html: the client's gallery at /g/<token>.
//
// View, pay, download. Before payment every photo is a watermarked preview
// and the Pay button is at the top. Back from Stripe, the server is asked to
// read the payment from Stripe itself (the same /api/session the manage page
// uses), which unlocks the downloads even if the webhook is slow. After
// payment the full views are the clean MLS size and every download is there.
// Nothing here decides what is unlocked; the server answers 402 for any clean
// file until the booking is paid.
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var token = (location.pathname.match(/^\/g\/([A-Za-z0-9_-]{16,64})/) || [])[1] || "";
  var params = new URLSearchParams(location.search);
  var paidSession = params.get("paid") || "";
  var data = null, open = -1;
  var res = params.get("res") === "full" ? "full" : "mls";
  var changeFor = null;   // photo number a change request is about, or null for the whole gallery

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; });
  }
  function say(type, text) { var s = $("gal-status"); s.className = "form-status" + (text ? " show " + type : ""); s.textContent = text || ""; }
  function link() { return location.origin + "/g/" + token; }

  if (window.EZ_MARK) $("gal-brand").insertAdjacentHTML("afterbegin", window.EZ_MARK);

  function none() {
    $("gal-title").textContent = "Gallery not found";
    $("gal-lead").textContent = "";
    $("gal-box").hidden = true;
    $("gal-missing").hidden = false;
  }

  function paint(d) {
    data = d;
    document.title = d.address + " | EZ Shots";
    $("gal-title").textContent = d.address;
    $("gal-eyebrow").textContent = d.paid ? "Paid and unlocked" : "Your property media is ready";
    $("gal-lead").textContent = d.photos.length + (d.photos.length === 1 ? " photo" : " photos") + (d.video ? " and your listing video" : "") +
      (d.agent ? ", for " + d.agent + (d.brokerage ? ", " + d.brokerage : "") : "") + ".";
    $("pay").hidden = !d.canPay;
    $("gal-amount").textContent = "$" + d.amount;
    $("gal-pay").textContent = "Pay $" + d.amount + " & Unlock Downloads";
    if (d.flagged && !d.paid) say("pending", "You told me something is not right, so nothing is due while I sort it out. I will be in touch.");
    $("downloads").hidden = !d.downloads;
    if (d.downloads) {
      $("gal-zip-high").href = d.downloads.high;
      $("gal-zip-high").setAttribute("download", d.downloads.highName);
      $("gal-zip-mls").href = d.downloads.mls;
      $("gal-zip-mls").setAttribute("download", d.downloads.mlsName);
    }
    $("gal-video").hidden = !d.video;
    if (d.video) {
      $("gal-video").innerHTML = '<video controls playsinline preload="metadata" src="' + esc(d.video.url) + '"></video>' +
        (d.video.download ? '<a class="btn btn-ghost" href="' + esc(d.video.download) + '" download>Download the video</a>' : "");
    }
    $("gal-grid").innerHTML = d.photos.map(function (p, i) {
      return '<button type="button" class="gal-tile" data-i="' + i + '" aria-label="Open photo ' + p.n + '">' +
        '<img src="' + esc(p.thumb) + '" alt="Photo ' + p.n + " of " + esc(d.address) + '" loading="' + (i < 6 ? "eager" : "lazy") + '" decoding="async" /></button>';
    }).join("");
    $("gal-foot").innerHTML = d.paid
      ? "Your downloads stay here. Bookmark this page or keep the link."
      : "Previews are watermarked. The clean full resolution and MLS files unlock the moment you pay. Not happy with them? Reply to my message and you do not pay.";
    paintRes();
    $("gal-box").hidden = false;
    $("gal-missing").hidden = true;
  }

  // Low res (MLS and web) or full resolution: what the full view shows and
  // what one photo downloads as. Unpaid, both are the watermarked preview.
  function paintRes() {
    Array.prototype.forEach.call(document.querySelectorAll("[data-res]"), function (b) {
      b.setAttribute("aria-pressed", String(b.getAttribute("data-res") === res));
    });
    $("gal-res-note").textContent = !data ? "" : !data.paid
      ? "Both sizes unlock with the payment. Until then you are looking at watermarked previews."
      : res === "full" ? "Full resolution: the largest files, for print, flyers and archives." : "Low res: sized for the MLS, websites and email.";
  }
  function viewOf(p) { return data.paid && res === "full" && p.full ? p.full : p.view; }
  function dlOf(p) { return res === "full" ? p.high : p.mls; }
  document.querySelector(".gal-res").addEventListener("click", function (e) {
    var b = e.target.closest("[data-res]");
    if (!b) return;
    res = b.getAttribute("data-res");
    try { var u = new URL(location.href); u.searchParams.set("res", res); history.replaceState(null, "", u.pathname + u.search + u.hash); } catch (x) {}
    paintRes();
    if (open >= 0) paintLight();
  });

  // ---- Request a change ----
  function askChange(n) {
    changeFor = n;
    $("gal-change-title").textContent = n ? "What would you like changed on photo " + n + "?" : "What would you like changed?";
    $("gal-change").hidden = false;
    if (open >= 0) { open = -1; paintLight(); }
    $("gal-change").scrollIntoView({ block: "center", behavior: "smooth" });
    setTimeout(function () { $("gal-change-msg").focus(); }, 300);
  }
  $("gal-change-all").addEventListener("click", function () { askChange(null); });
  $("gal-change-cancel").addEventListener("click", function () { $("gal-change").hidden = true; });
  $("gal-change").addEventListener("submit", function (e) {
    e.preventDefault();
    var msg = $("gal-change-msg").value.trim();
    if (!msg) { $("gal-change-msg").focus(); return say("error", "Tell me what you would like changed."); }
    var btn = $("gal-change").querySelector('[type="submit"]');
    btn.disabled = true;
    fetch("/api/gallery/" + token + "/change", {
      method: "POST", headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ message: msg, photos: changeFor ? [changeFor] : [] })
    }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (x) {
        btn.disabled = false;
        if (!x.ok) throw new Error(x.d.error || "That did not send. Reply to my message instead.");
        $("gal-change-msg").value = "";
        $("gal-change").hidden = true;
        say("success", "Sent. I have your request" + (changeFor ? " for photo " + changeFor : "") + " and will be in touch.");
      })
      .catch(function (err) { btn.disabled = false; say("error", err.message); });
  });

  // ---- the full view ----
  function paintLight() {
    var p = data.photos[open];
    var box = $("gal-light");
    if (!p) { box.hidden = true; document.body.style.overflow = ""; return; }
    box.innerHTML =
      '<div class="gal-l-top"><span>' + p.n + " / " + data.photos.length + "</span>" +
        '<button type="button" class="btn btn-sm btn-ghost" data-l="change">Request a change</button>' +
        (p.high ? '<a class="btn btn-sm" href="' + esc(dlOf(p)) + '">Download ' + (res === "full" ? "full res" : "low res") + "</a>" : "") +
        '<button type="button" class="gal-x" data-l="close" aria-label="Close">&times;</button></div>' +
      '<div class="gal-l-stage">' +
        (open > 0 ? '<button type="button" class="gal-nav l" data-l="prev" aria-label="Previous">&#8249;</button>' : "") +
        '<img src="' + esc(viewOf(p)) + '" alt="Photo ' + p.n + '" />' +
        (open < data.photos.length - 1 ? '<button type="button" class="gal-nav r" data-l="next" aria-label="Next">&#8250;</button>' : "") +
      "</div>";
    box.hidden = false;
    document.body.style.overflow = "hidden";
    // The next one, so paging feels instant.
    var n = data.photos[open + 1];
    if (n) { var im = new Image(); im.src = viewOf(n); }
  }
  $("gal-grid").addEventListener("click", function (e) {
    var t = e.target.closest(".gal-tile");
    if (t) { open = Number(t.getAttribute("data-i")); paintLight(); }
  });
  $("gal-light").addEventListener("click", function (e) {
    var b = e.target.closest("[data-l]");
    if (e.target === $("gal-light") || e.target.classList.contains("gal-l-stage") || (b && b.getAttribute("data-l") === "close")) { open = -1; return paintLight(); }
    if (b && b.getAttribute("data-l") === "change") return askChange(data.photos[open].n);
    if (b && b.getAttribute("data-l") === "prev") { open--; paintLight(); }
    if (b && b.getAttribute("data-l") === "next") { open++; paintLight(); }
  });
  document.addEventListener("keydown", function (e) {
    if (open < 0) return;
    if (e.key === "Escape") { open = -1; paintLight(); }
    if (e.key === "ArrowRight" && open < data.photos.length - 1) { open++; paintLight(); }
    if (e.key === "ArrowLeft" && open > 0) { open--; paintLight(); }
  });
  // Swipe on a phone.
  var sx = null;
  $("gal-light").addEventListener("touchstart", function (e) { sx = e.touches[0].clientX; }, { passive: true });
  $("gal-light").addEventListener("touchend", function (e) {
    if (sx === null) return;
    var dx = e.changedTouches[0].clientX - sx;
    sx = null;
    if (dx < -50 && open < data.photos.length - 1) { open++; paintLight(); }
    if (dx > 50 && open > 0) { open--; paintLight(); }
  });

  // ---- share and pay ----
  $("gal-share").addEventListener("click", function () {
    var done = function () { say("success", "Gallery link copied."); setTimeout(function () { say("", ""); }, 2500); };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(link()).then(done, function () { window.prompt("Copy this link:", link()); });
    else window.prompt("Copy this link:", link());
  });

  $("gal-pay").addEventListener("click", function () {
    var btn = $("gal-pay");
    btn.disabled = true;
    say("pending", "Opening the secure payment page...");
    fetch("/api/gallery/" + token + "/pay", { method: "POST", headers: { accept: "application/json" } })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (x) {
        if (!x.ok || !x.d.url) throw new Error(x.d.error || "The payment page could not be opened. Try again in a minute.");
        location.href = x.d.url;
      })
      .catch(function (e) { say("error", e.message); btn.disabled = false; });
  });

  function load() {
    return fetch("/api/gallery/" + token, { headers: { accept: "application/json" } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (d && d.photos) { paint(d); return d; } none(); return null; });
  }

  if (!token || !window.fetch) return none();

  // Back from Stripe: confirm the payment with the server, then show the
  // downloads. A slow webhook gets a few more seconds before we give up.
  var first = paidSession && /^cs_[A-Za-z0-9_]+$/.test(paidSession)
    ? fetch("/api/session?id=" + encodeURIComponent(paidSession)).catch(function () {})
    : Promise.resolve();
  first.then(load).then(function (d) {
    if (!d || !paidSession) return;
    try { history.replaceState(null, "", location.pathname); } catch (e) {}
    if (d.paid) return say("success", "Payment received, thank you. Your downloads are unlocked below.");
    say("pending", "Your payment is being confirmed. The downloads appear here in a moment.");
    var tries = 0;
    var again = function () {
      if (++tries > 10) return say("pending", "Still confirming. Refresh this page in a minute.");
      setTimeout(function () { load().then(function (x) { if (x && x.paid) say("success", "Payment received, thank you. Your downloads are unlocked below."); else again(); }); }, 2500);
    };
    again();
  }).catch(none);
  if (location.hash === "#pay") setTimeout(function () { var p = $("pay"); if (p && !p.hidden) p.scrollIntoView({ block: "center" }); }, 600);
})();
