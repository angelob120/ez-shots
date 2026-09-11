// admin.html: the owner's settings screen.
//
// It edits one object, the same config the booking page reads, and PUTs the
// whole thing back. No partial updates, no field level API, because with one
// user and one config a last write wins is the right amount of machinery.
//
// The server validates everything again on the way in. Signing in, signing
// out and the panels live in js/admin-core.js, shared with the bookings page.
(function () {
  var A = window.EZAdmin;
  var el = A.el, esc = A.esc, status = A.status, api = A.api;
  if (!el("admin-boot")) return;

  var DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var cfg = null;
  var session = null;

  // Unsaved changes are the one way this page can lose work, so they are said
  // out loud on the bar and guarded on the way out of the tab. The Save button
  // stays disabled while there is nothing to save, which also means a double
  // tap cannot fire two writes.
  var isDirty = false;
  function dirty(flag) {
    isDirty = !!flag;
    var bar = document.querySelector(".admin-savebar");
    var btn = el("save-btn");
    if (bar) bar.classList.toggle("dirty", isDirty);
    if (el("save-state")) el("save-state").textContent = isDirty ? "Unsaved changes" : "Everything saved";
    if (btn) btn.disabled = !isDirty;
  }
  window.addEventListener("beforeunload", function (e) {
    if (!isDirty) return;
    e.preventDefault();
    e.returnValue = "";
  });

  // ----------------------------------------------------------------
  // Times. Small copies of the server's helpers, so a pill can be built
  // without a round trip. The server spells every time the same way on the
  // way in whatever happens here.
  // ----------------------------------------------------------------
  function minutesOf(s) {
    var m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(String(s || "").trim());
    if (!m) return null;
    var h = parseInt(m[1], 10) % 12 + (/pm/i.test(m[3]) ? 12 : 0);
    return h * 60 + parseInt(m[2], 10);
  }
  function labelOf(mins) {
    var h24 = Math.floor(mins / 60) % 24, m = mins % 60;
    return (h24 % 12 || 12) + ":" + (m < 10 ? "0" + m : m) + " " + (h24 < 12 ? "AM" : "PM");
  }
  function range(start, end, every) {
    var a = minutesOf(start), b = minutesOf(end), out = [];
    if (a === null || b === null) return out;
    for (var t = a; t <= b; t += every) out.push(labelOf(t));
    return out;
  }
  function sortTimes(list) {
    return list.slice().sort(function (x, y) { return minutesOf(x) - minutesOf(y); });
  }

  // ----------------------------------------------------------------
  // Packages
  // ----------------------------------------------------------------
  function paintPackages() {
    var wrap = el("pkg-editor");
    wrap.innerHTML = "";
    cfg.packages.forEach(function (p, i) {
      var card = document.createElement("div");
      card.className = "admin-card";
      card.innerHTML =
        '<div class="admin-card-head">' +
          '<b>' + esc(p.name || "Untitled package") + "</b>" +
          '<label class="admin-toggle"><input type="checkbox" data-f="active"' + (p.active !== false ? " checked" : "") + " /> Live on the site</label>" +
          '<button type="button" class="admin-x" data-remove="' + i + '" aria-label="Remove this package">Remove</button>' +
        "</div>" +
        '<div class="row2">' +
          '<label class="a-field"><span>Name</span><input type="text" data-f="name" value="' + esc(p.name) + '" /></label>' +
          '<label class="a-field"><span>Badge, optional</span><input type="text" data-f="badge" value="' + esc(p.badge) + '" placeholder="Most booked" /></label>' +
        "</div>" +
        '<label class="a-field"><span>One line description</span><input type="text" data-f="blurb" value="' + esc(p.blurb) + '" /></label>' +
        '<div class="row2">' +
          '<label class="a-field"><span>Normal price, dollars</span><input type="number" min="0" data-f="price" value="' + esc(p.price) + '" /></label>' +
          '<label class="a-field"><span>First shoot price, dollars</span><input type="number" min="0" data-f="firstPrice" value="' + esc(p.firstPrice) + '" /></label>' +
        "</div>" +
        '<label class="a-field"><span>What is included, one per line</span>' +
          '<textarea rows="5" data-f="bullets">' + esc((p.bullets || []).join("\n")) + "</textarea></label>" +
        '<label class="a-field"><span>Stripe link, normal price</span><input type="url" data-f="checkoutFull" value="' + esc(p.checkoutFull) + '" placeholder="https://buy.stripe.com/..." /></label>' +
        '<label class="a-field"><span>Stripe link, first shoot price</span><input type="url" data-f="checkoutFirst" value="' + esc(p.checkoutFirst) + '" placeholder="https://buy.stripe.com/..." /></label>' +
        '<p class="form-help admin-stripe-note"></p>';

      card.querySelectorAll("[data-f]").forEach(function (input) {
        input.addEventListener("input", function () { readPackage(card, p); dirty(true); });
        input.addEventListener("change", function () { readPackage(card, p); dirty(true); });
      });
      card.querySelector("[data-remove]").addEventListener("click", function () {
        if (cfg.packages.length < 2) return alert("Keep at least one package.");
        cfg.packages.splice(i, 1);
        dirty(true);
        paintPackages();
      });
      wrap.appendChild(card);
    });
    paintStripeNotes();
  }

  function readPackage(card, p) {
    card.querySelectorAll("[data-f]").forEach(function (input) {
      var f = input.getAttribute("data-f");
      if (input.type === "checkbox") p[f] = input.checked;
      else if (f === "bullets") p.bullets = input.value.split("\n").map(function (s) { return s.trim(); }).filter(Boolean);
      else if (f === "price" || f === "firstPrice") p[f] = input.value === "" ? "" : Number(input.value);
      else p[f] = input.value;
    });
    if (!p.id) p.id = slug(p.name, p);
    card.querySelector(".admin-card-head b").textContent = p.name || "Untitled package";
  }

  // The id is what ?package=pro in a link matches on, so it is set once when a
  // package is created and never again. Renaming "Listing Pro" must not break
  // every link that already points at it.
  function slug(name, mine) {
    var base = String(name || "package").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "package";
    var taken = cfg.packages.filter(function (p) { return p !== mine; }).map(function (p) { return p.id; });
    var id = base, n = 2;
    while (taken.indexOf(id) !== -1) id = base + "-" + n++;
    return id;
  }

  // When the server holds a Stripe key it creates the charge itself and the
  // links stop being the thing that takes the money. Saying so here is the
  // difference between a stale link being harmless and it being a wrong charge.
  function paintStripeNotes() {
    var on = session && session.stripe;
    document.querySelectorAll(".admin-stripe-note").forEach(function (n) {
      n.textContent = on
        ? "Stripe is connected on the server, so the price above is what gets charged and these links are only the backup if Stripe is unreachable."
        : "No Stripe key on the server yet, so these links are what actually takes the money. The price above has to match what the link charges.";
      n.classList.toggle("warn", !on);
    });
  }

  // ----------------------------------------------------------------
  // Hours and the week
  // ----------------------------------------------------------------
  var HOUR_CHOICES = range("5:00 AM", "11:00 PM", 30);
  var EVERY_CHOICES = [[60, "Every hour"], [90, "Every hour and a half"], [120, "Every 2 hours"], [180, "Every 3 hours"]];

  function fillSelect(sel, choices, current) {
    sel.innerHTML = choices.map(function (c) {
      var v = Array.isArray(c) ? c[0] : c, t = Array.isArray(c) ? c[1] : c;
      return '<option value="' + esc(v) + '"' + (String(v) === String(current) ? " selected" : "") + ">" + esc(t) + "</option>";
    }).join("");
  }

  // The times offered as pills: what the hours generate, plus anything a day
  // already has outside them, so an odd time set by hand is never lost.
  function master() {
    var h = cfg.availability.hours;
    var set = range(h.start, h.end, Number(h.every) || 120);
    for (var d = 0; d < 7; d++) {
      (cfg.availability.week[String(d)] || []).forEach(function (t) { if (set.indexOf(t) === -1) set.push(t); });
    }
    return sortTimes(set);
  }

  // What a day had before it was switched off, so switching it back on does
  // not mean rebuilding the list.
  var memo = {};

  function paintWeek() {
    var wrap = el("week-editor");
    var times = master();
    wrap.innerHTML = "";
    for (var d = 0; d < 7; d++) {
      (function (d) {
        var list = cfg.availability.week[String(d)] || [];
        var row = document.createElement("div");
        row.className = "admin-day" + (list.length ? "" : " off");
        row.innerHTML =
          '<label class="admin-day-name"><input type="checkbox"' + (list.length ? " checked" : "") + ' aria-label="' + DAYS[d] + ' open" /> ' + DAYS[d] + "</label>" +
          '<div class="admin-slots" role="group" aria-label="' + DAYS[d] + ' start times">' +
            times.map(function (t) {
              return '<button type="button" class="slot-pill' + (list.indexOf(t) !== -1 ? " on" : "") + '" data-t="' + esc(t) + '" aria-pressed="' + (list.indexOf(t) !== -1) + '">' + esc(t) + "</button>";
            }).join("") +
          "</div>";
        row.querySelector("input").addEventListener("change", function (e) {
          if (e.target.checked) {
            cfg.availability.week[String(d)] = (memo[d] && memo[d].length) ? memo[d] : range(cfg.availability.hours.start, cfg.availability.hours.end, Number(cfg.availability.hours.every) || 120);
          } else {
            memo[d] = cfg.availability.week[String(d)];
            cfg.availability.week[String(d)] = [];
          }
          dirty(true);
          paintWeek();
        });
        row.querySelectorAll(".slot-pill").forEach(function (b) {
          b.addEventListener("click", function () {
            var t = b.getAttribute("data-t");
            var cur = cfg.availability.week[String(d)] || [];
            cfg.availability.week[String(d)] = cur.indexOf(t) === -1 ? sortTimes(cur.concat([t])) : cur.filter(function (x) { return x !== t; });
            dirty(true);
            paintWeek();
          });
        });
        wrap.appendChild(row);
      })(d);
    }
  }

  function readHours() {
    cfg.availability.hours = {
      start: el("hours-start").value,
      end: el("hours-end").value,
      every: Number(el("hours-every").value)
    };
  }

  function paintHours() {
    var h = cfg.availability.hours;
    fillSelect(el("hours-start"), HOUR_CHOICES, h.start);
    fillSelect(el("hours-end"), HOUR_CHOICES, h.end);
    fillSelect(el("hours-every"), EVERY_CHOICES, h.every);
  }

  function paintBusy() {
    var v = Number(el("lookBusy").value) || 0;
    var n = master().length || 7;
    var hide = Math.floor(n * v / 100);
    el("lookBusy-out").textContent = v + "%" + (v ? ", about " + hide + " of " + n + " times hidden on a full day" : ", off");
  }

  // ----------------------------------------------------------------
  // Days off and one off days
  // ----------------------------------------------------------------
  function paintDates() {
    var b = el("blocked-editor");
    var keys = Object.keys(cfg.availability.blocked).sort();
    b.innerHTML = keys.length ? "" : '<p class="form-help">No days off set.</p>';
    keys.forEach(function (k) {
      var row = document.createElement("div");
      row.className = "admin-row";
      row.innerHTML = "<b>" + esc(k) + "</b><span>" + esc(cfg.availability.blocked[k]) + "</span>";
      var x = document.createElement("button");
      x.type = "button";
      x.className = "admin-x";
      x.textContent = "Remove";
      x.addEventListener("click", function () { delete cfg.availability.blocked[k]; dirty(true); paintDates(); });
      row.appendChild(x);
      b.appendChild(row);
    });

    var o = el("override-editor");
    var oks = Object.keys(cfg.availability.overrides).sort();
    o.innerHTML = oks.length ? "" : '<p class="form-help">No one off days set.</p>';
    oks.forEach(function (k) {
      var list = cfg.availability.overrides[k];
      var row = document.createElement("div");
      row.className = "admin-row";
      row.innerHTML = "<b>" + esc(k) + "</b><span>" + (list.length ? esc(list.join(", ")) : "Closed") + "</span>";
      var x = document.createElement("button");
      x.type = "button";
      x.className = "admin-x";
      x.textContent = "Remove";
      x.addEventListener("click", function () { delete cfg.availability.overrides[k]; dirty(true); paintDates(); });
      row.appendChild(x);
      o.appendChild(row);
    });
  }

  function parseTimes(v) {
    return sortTimes(String(v).split(",").map(function (s) {
      var m = minutesOf(s);
      return m === null ? "" : labelOf(m);
    }).filter(Boolean));
  }

  // ----------------------------------------------------------------
  // Load and save
  // ----------------------------------------------------------------
  function paintAll() {
    paintPackages();
    paintHours();
    paintWeek();
    paintDates();
    el("minNotice").value = cfg.availability.minNoticeHours;
    el("maxAdvance").value = cfg.availability.maxAdvanceDays;
    el("maxPerDay").value = cfg.availability.maxPerDay;
    el("lookBusy").value = cfg.availability.lookBusy;
    paintBusy();
    var mode = el("admin-mode");
    mode.textContent = session.stripe
      ? "Stripe connected, prices charged from this page"
      : "Stripe payment links, no API key yet";
    mode.classList.toggle("warn", !session.stripe);
    var store = el("admin-store");
    store.textContent = session.bookings ? "Bookings on" : "No database, bookings off";
    store.classList.toggle("warn", !session.bookings);
  }

  function loadConfig() {
    return api("/api/admin/config").then(function (d) {
      cfg = d;
      cfg.availability = cfg.availability || {};
      cfg.availability.hours = cfg.availability.hours || { start: "8:00 AM", end: "8:00 PM", every: 120 };
      cfg.availability.week = cfg.availability.week || {};
      cfg.availability.blocked = cfg.availability.blocked || {};
      cfg.availability.overrides = cfg.availability.overrides || {};
      paintAll();
      dirty(false);
    });
  }

  function save() {
    var s = el("save-status");
    readHours();
    cfg.availability.minNoticeHours = Number(el("minNotice").value);
    cfg.availability.maxAdvanceDays = Number(el("maxAdvance").value);
    cfg.availability.maxPerDay = Number(el("maxPerDay").value);
    cfg.availability.lookBusy = Number(el("lookBusy").value);
    status(s, "pending", "Saving...");
    api("/api/admin/config", { method: "PUT", body: JSON.stringify(cfg) }).then(function (d) {
      cfg = d.config;
      paintAll();
      dirty(false);
      status(s, "success", "Saved. The booking page and every price on the site are using these now.");
    }).catch(function (e) {
      status(s, "error", e.message);
    });
  }

  // ----------------------------------------------------------------
  el("save-btn").addEventListener("click", save);
  ["minNotice", "maxAdvance", "maxPerDay"].forEach(function (id) {
    el(id).addEventListener("input", function () { dirty(true); });
  });
  el("lookBusy").addEventListener("input", function () { paintBusy(); dirty(true); });
  ["hours-start", "hours-end", "hours-every"].forEach(function (id) {
    el(id).addEventListener("change", function () { readHours(); paintWeek(); paintBusy(); dirty(true); });
  });
  el("apply-hours").addEventListener("click", function () {
    readHours();
    var h = cfg.availability.hours;
    var list = range(h.start, h.end, Number(h.every) || 120);
    for (var d = 0; d < 7; d++) {
      if ((cfg.availability.week[String(d)] || []).length) cfg.availability.week[String(d)] = list.slice();
    }
    dirty(true);
    paintWeek();
  });

  el("add-package").addEventListener("click", function () {
    var p = {
      id: "", name: "New package", blurb: "", price: 0, firstPrice: 0,
      active: false, badge: "", bullets: [], checkoutFull: "", checkoutFirst: ""
    };
    cfg.packages.push(p);
    p.id = slug("new package", p);
    dirty(true);
    paintPackages();
  });

  el("add-block").addEventListener("click", function () {
    var d = el("block-date").value;
    if (!d) return;
    cfg.availability.blocked[d] = el("block-reason").value.trim() || "Not available";
    el("block-date").value = "";
    el("block-reason").value = "";
    dirty(true);
    paintDates();
  });

  el("add-override").addEventListener("click", function () {
    var d = el("ov-date").value;
    if (!d) return;
    cfg.availability.overrides[d] = parseTimes(el("ov-times").value);
    el("ov-date").value = "";
    el("ov-times").value = "";
    dirty(true);
    paintDates();
  });

  A.boot(function (s) {
    session = s;
    return loadConfig();
  });
})();
