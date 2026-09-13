// admin.html: the owner's settings screen.
//
// It edits one object, the same config the booking page reads, and PUTs the
// whole thing back. No partial updates, no field level API, because with one
// user and one config a last write wins is the right amount of machinery.
// Unsaved work is compared against the last saved copy, so Discard is exact and
// undoing a change by hand clears the unsaved state again.
//
// The server validates everything again on the way in. Signing in, the top
// bar, toasts and the confirm dialog live in js/admin-core.js.
(function () {
  var A = window.EZAdmin;
  if (!A || !A.el("adm-app")) return;
  var el = A.el, esc = A.esc, icon = A.icon, money = A.money;

  var DAYS = A.DAYS_LONG;
  // Monday first, the way a working week reads. Values are still 0 to 6.
  var ORDER = [1, 2, 3, 4, 5, 6, 0];
  var cfg = null, saved = "", session = null;
  var openPkg = {};
  var ovSel = [];

  // ----------------------------------------------------------------
  // Unsaved changes
  // ----------------------------------------------------------------
  function isDirty() { return !!cfg && JSON.stringify(cfg) !== saved; }
  function paintDirty() {
    var d = isDirty();
    el("savebar").classList.toggle("dirty", d);
    el("save-state").textContent = d ? "Unsaved changes" : "Everything saved";
    el("save-btn").disabled = !d;
    el("discard-btn").hidden = !d;
    el("preview-sub").textContent = "What a client sees on the booking page for the next two weeks, from what is saved." + (d ? " Save to see your changes here." : "");
  }
  function changed() { paintDirty(); }
  window.addEventListener("beforeunload", function (e) {
    if (!isDirty()) return;
    e.preventDefault();
    e.returnValue = "";
  });

  // ----------------------------------------------------------------
  // Times
  // ----------------------------------------------------------------
  function range(start, end, every) {
    var a = A.minutesOf(start), b = A.minutesOf(end), out = [];
    if (a === null || b === null) return out;
    for (var t = a; t <= b; t += every) out.push(A.labelOf(t));
    return out;
  }
  function sortTimes(list) { return list.slice().sort(function (x, y) { return A.minutesOf(x) - A.minutesOf(y); }); }
  function uniq(list) { return list.filter(function (t, i) { return list.indexOf(t) === i; }); }
  function hours() { return cfg.availability.hours; }
  function generated() { return range(hours().start, hours().end, Number(hours().every) || 120); }
  // What the hours make, plus anything a day already has outside them, so an
  // odd time set by hand is never lost.
  function master() {
    var set = generated();
    for (var d = 0; d < 7; d++) (cfg.availability.week[String(d)] || []).forEach(function (t) { set.push(t); });
    return sortTimes(uniq(set));
  }

  // ----------------------------------------------------------------
  // Packages
  // ----------------------------------------------------------------
  function off(p) {
    if (!(p.price > 0) || p.firstPrice === "" || p.firstPrice == null) return "";
    var pct = Math.round((1 - p.firstPrice / p.price) * 100);
    return pct > 0 ? pct + "% off the first shoot" : pct === 0 ? "no first shoot discount" : "first shoot costs more";
  }

  function slug(name, mine) {
    // The id is what ?package=pro in a link matches on, so it is set once when a
    // package is created and never again. Renaming "Listing Pro" must not break
    // every link that already points at it.
    var base = String(name || "package").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "package";
    var taken = cfg.packages.filter(function (p) { return p !== mine; }).map(function (p) { return p.id; });
    var id = base, n = 2;
    while (taken.indexOf(id) !== -1) id = base + "-" + n++;
    return id;
  }

  function paintPackages() {
    var wrap = el("pkg-editor");
    var n = cfg.packages.length;
    wrap.innerHTML = cfg.packages.map(function (p, i) {
      var isOpen = !!openPkg[p.id];
      return '<div class="adm-pkg" data-i="' + i + '">' +
        '<div class="adm-pkg-head">' +
          '<button type="button" class="adm-pkg-title" data-toggle aria-expanded="' + isOpen + '">' +
            "<b>" + esc(p.name || "Untitled package") + (p.badge ? ' <span class="adm-badge b-info plain" style="margin-left:6px">' + esc(p.badge) + "</span>" : "") + "</b>" +
            "<span>" + esc(money(p.price) + " normally, " + money(p.firstPrice) + " first shoot") + (off(p) ? ", " + esc(off(p)) : "") + ". " + (isOpen ? "Hide details" : "Edit") + "</span>" +
          "</button>" +
          '<label class="adm-switch" title="Shown on the site"><input type="checkbox" data-f="active"' + (p.active !== false ? " checked" : "") + " /><i></i><span>Live</span></label>" +
          '<div class="adm-pkg-tools">' +
            '<button type="button" class="adm-icon" data-move="-1"' + (i === 0 ? " disabled" : "") + ' aria-label="Move up" title="Move up">' + icon("up") + "</button>" +
            '<button type="button" class="adm-icon" data-move="1"' + (i === n - 1 ? " disabled" : "") + ' aria-label="Move down" title="Move down">' + icon("down") + "</button>" +
            '<button type="button" class="adm-icon" data-dup aria-label="Duplicate" title="Duplicate">' + icon("dup") + "</button>" +
            '<button type="button" class="adm-icon" data-remove aria-label="Remove" title="Remove">' + icon("trash") + "</button>" +
          "</div>" +
        "</div>" +
        (isOpen ?
        '<div class="adm-pkg-body">' +
          '<div class="adm-grid2">' +
            '<label class="adm-field"><span>Name</span><input class="adm-input" data-f="name" value="' + esc(p.name) + '" /></label>' +
            '<label class="adm-field"><span>Badge, optional</span><input class="adm-input" data-f="badge" value="' + esc(p.badge) + '" placeholder="Most booked" /></label>' +
          "</div>" +
          '<label class="adm-field"><span>One line description</span><input class="adm-input" data-f="blurb" value="' + esc(p.blurb) + '" /></label>' +
          '<div class="adm-grid2">' +
            '<label class="adm-field"><span>Normal price</span><div class="adm-money"><input class="adm-input" type="number" min="0" step="1" data-f="price" value="' + esc(p.price) + '" /></div></label>' +
            '<label class="adm-field"><span>First shoot price</span><div class="adm-money"><input class="adm-input" type="number" min="0" step="1" data-f="firstPrice" value="' + esc(p.firstPrice) + '" /></div>' +
              '<p class="adm-help" data-off>' + esc(off(p)) + "</p></label>" +
          "</div>" +
          '<label class="adm-field"><span>What is included, one per line</span><textarea class="adm-textarea" rows="5" data-f="bullets">' + esc((p.bullets || []).join("\n")) + "</textarea></label>" +
          '<div class="adm-grid2">' +
            '<label class="adm-field"><span>Stripe link, normal price</span><input class="adm-input" type="url" data-f="checkoutFull" value="' + esc(p.checkoutFull) + '" placeholder="https://buy.stripe.com/..." /></label>' +
            '<label class="adm-field"><span>Stripe link, first shoot price</span><input class="adm-input" type="url" data-f="checkoutFirst" value="' + esc(p.checkoutFirst) + '" placeholder="https://buy.stripe.com/..." /></label>' +
          "</div>" +
          '<p class="adm-help">Link id <code>' + esc(p.id) + "</code>. A link to <code>book.html?package=" + esc(p.id) + "</code> opens with this package picked, and renaming does not change it.</p>" +
        "</div>" : "") +
      "</div>";
    }).join("");
  }

  function readPackage(box, p, input) {
    var f = input.getAttribute("data-f");
    if (input.type === "checkbox") p[f] = input.checked;
    else if (f === "bullets") p.bullets = input.value.split("\n").map(function (s) { return s.trim(); }).filter(Boolean);
    else if (f === "price" || f === "firstPrice") p[f] = input.value === "" ? "" : Number(input.value);
    else p[f] = input.value;
    var title = box.querySelector(".adm-pkg-title");
    if (title) {
      title.querySelector("b").firstChild.textContent = p.name || "Untitled package";
      title.querySelector("span").textContent = money(p.price) + " normally, " + money(p.firstPrice) + " first shoot" + (off(p) ? ", " + off(p) : "") + ". Hide details";
    }
    var o = box.querySelector("[data-off]");
    if (o) o.textContent = off(p);
  }

  function paintStripeNote() {
    var on = session && session.stripe;
    var n = el("stripe-note");
    n.textContent = on
      ? "Stripe is connected, so the prices here are what a client is charged. The Stripe links are only the backup if Stripe cannot be reached."
      : "No Stripe key on the server, so the Stripe links are what actually take the money. Each price here has to match what its link charges.";
    n.classList.toggle("warn", !on);
  }

  // ----------------------------------------------------------------
  // Weekly hours
  // ----------------------------------------------------------------
  var HOUR_CHOICES = range("5:00 AM", "11:00 PM", 30);
  var EVERY_CHOICES = [[30, "Every 30 minutes"], [60, "Every hour"], [90, "Every hour and a half"], [120, "Every 2 hours"], [180, "Every 3 hours"]];
  var memo = {};

  function fillSelect(sel, choices, current) {
    sel.innerHTML = choices.map(function (c) {
      var v = Array.isArray(c) ? c[0] : c, t = Array.isArray(c) ? c[1] : c;
      return '<option value="' + esc(v) + '"' + (String(v) === String(current) ? " selected" : "") + ">" + esc(t) + "</option>";
    }).join("");
  }

  function paintHours() {
    fillSelect(el("hours-start"), HOUR_CHOICES, hours().start);
    fillSelect(el("hours-end"), HOUR_CHOICES, hours().end);
    fillSelect(el("hours-every"), EVERY_CHOICES, hours().every);
  }

  function paintWeek() {
    var times = master();
    el("week-editor").innerHTML = ORDER.map(function (d) {
      var list = cfg.availability.week[String(d)] || [];
      return '<div class="adm-day' + (list.length ? "" : " off") + '" data-day="' + d + '">' +
        '<label class="adm-switch"><input type="checkbox" data-dayon' + (list.length ? " checked" : "") + " /><i></i><span>" + DAYS[d] + "</span></label>" +
        '<div class="adm-slots" role="group" aria-label="' + DAYS[d] + ' start times">' + times.map(function (t) {
          var on = list.indexOf(t) !== -1;
          return '<button type="button" class="adm-slot" data-t="' + esc(t) + '" aria-pressed="' + on + '">' + esc(t) + "</button>";
        }).join("") + "</div>" +
        '<span class="adm-help" style="white-space:nowrap">' + (list.length ? list.length + (list.length === 1 ? " time" : " times") + ' <button type="button" class="adm-btn adm-btn-quiet" data-copyday title="Give every open day these times" style="min-height:28px;padding:0 8px">Copy to open days</button>' : "Closed") + "</span>" +
      "</div>";
    }).join("");
  }

  function readHours() {
    cfg.availability.hours = { start: el("hours-start").value, end: el("hours-end").value, every: Number(el("hours-every").value) };
  }

  // ----------------------------------------------------------------
  // Booking rules
  // ----------------------------------------------------------------
  function paintRules() {
    var a = cfg.availability;
    var h = Number(a.minNoticeHours) || 0;
    el("minNotice-help").textContent = h === 0 ? "A client can book a time starting right now." :
      h % 24 === 0 ? "A client needs " + (h / 24) + (h === 24 ? " day" : " days") + " notice." : "A client needs " + h + " hours notice.";
    var d = Number(a.maxAdvanceDays) || 0;
    var last = A.addDays(A.keyOf(new Date()), d);
    el("maxAdvance-help").textContent = d ? "Bookable through " + A.shortDay(last) + (d % 7 === 0 ? ", " + d / 7 + (d === 7 ? " week." : " weeks.") : ".") : "";
    var v = Number(a.lookBusy) || 0;
    var n = generated().length || 7;
    el("lookBusy-out").textContent = v ? v + "%" : "Off";
    el("lookBusy-help").textContent = v
      ? "About " + Math.floor(n * v / 100) + " of " + n + " open times are hidden on an empty day, so the calendar reads as in demand. The same times for everyone, never a day's last time, and hidden times come back as real bookings fill the day. Nobody is stopped from booking."
      : "Every open time is shown. Turn this up to hide a share of them so the calendar reads as in demand.";
  }

  // ----------------------------------------------------------------
  // Days off and one off days
  // ----------------------------------------------------------------
  function prettyDate(k) { var d = A.dateOf(k); return A.shortDay(k) + ", " + d.getFullYear(); }

  function paintDates() {
    var today = A.keyOf(new Date());
    var b = cfg.availability.blocked;
    var keys = Object.keys(b).sort();
    el("clear-past").hidden = !keys.some(function (k) { return k < today; });
    el("blocked-editor").innerHTML = keys.length ? '<div class="adm-list" style="margin-bottom:14px">' + keys.map(function (k) {
      return '<div class="adm-list-row' + (k < today ? " past" : "") + '"><b>' + esc(prettyDate(k)) + "</b><span>" + esc(b[k]) + (k < today ? ", past" : "") + "</span>" +
        '<button type="button" class="adm-icon" data-unblock="' + esc(k) + '" aria-label="Remove ' + esc(k) + '">' + icon("x") + "</button></div>";
    }).join("") + "</div>" : '<p class="adm-help" style="margin-bottom:14px">No days off set.</p>';

    var o = cfg.availability.overrides;
    var oks = Object.keys(o).sort();
    el("override-editor").innerHTML = oks.length ? '<div class="adm-list">' + oks.map(function (k) {
      return '<div class="adm-list-row' + (k < today ? " past" : "") + '"><b>' + esc(prettyDate(k)) + "</b><span>" + (o[k].length ? esc(o[k].join(", ")) : "Closed all day") + "</span>" +
        '<span style="display:flex;gap:2px"><button type="button" class="adm-icon" data-editov="' + esc(k) + '" aria-label="Edit ' + esc(k) + '" title="Edit">' + icon("chev") + "</button>" +
        '<button type="button" class="adm-icon" data-unov="' + esc(k) + '" aria-label="Remove ' + esc(k) + '">' + icon("x") + "</button></span></div>";
    }).join("") + "</div>" : '<p class="adm-help">No one off days set.</p>';
    paintOvPills();
  }

  function paintOvPills() {
    var times = sortTimes(uniq(master().concat(ovSel)));
    el("ov-pills").innerHTML = times.map(function (t) {
      return '<button type="button" class="adm-slot" data-ovt="' + esc(t) + '" aria-pressed="' + (ovSel.indexOf(t) !== -1) + '">' + esc(t) + "</button>";
    }).join("");
  }

  // ----------------------------------------------------------------
  // Preview and system
  // ----------------------------------------------------------------
  function paintPreview() {
    var grid = el("preview-grid");
    return fetch("/api/availability", { headers: { accept: "application/json" } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d) { grid.innerHTML = '<p class="adm-help">Online booking is off, so there is no calendar to preview.</p>'; return; }
        var html = "";
        for (var i = 0; i < 14; i++) {
          var k = A.addDays(d.today, i), day = A.dateOf(k);
          var n = (d.days[k] || []).length;
          html += '<div class="adm-pday' + (n ? "" : " none") + '" title="' + esc((d.days[k] || []).join(", ")) + '"><small>' + A.DAYS[day.getDay()] + "</small><b>" + day.getDate() + "</b><span>" + (n ? n + (n === 1 ? " time" : " times") : "None") + "</span></div>";
        }
        grid.innerHTML = html;
      })
      .catch(function () { grid.innerHTML = '<p class="adm-help">Could not load the calendar.</p>'; });
  }

  function paintSystem() {
    var s = session;
    var card = function (on, title, yes, no) {
      return '<div><b><span class="adm-dot' + (on ? "" : " warn") + '"></span>' + esc(title) + "</b><span>" + esc(on ? yes : no) + "</span></div>";
    };
    el("sys-grid").innerHTML =
      card(s.bookings, "Database", "Connected. Online booking is on.", "Not connected. Set DATABASE_URL; online booking is off.") +
      card(s.stripe, "Stripe checkout", "Connected. Prices are charged from this page.", "No STRIPE_SECRET_KEY. Clients pay through the Stripe links.") +
      card(s.webhook, "Stripe webhook", "On. Paid bookings confirm even if the client closes the tab.", "No STRIPE_WEBHOOK_SECRET. A booking confirms only when the client returns to the site.") +
      card(s.email, "Emails", "On. You and the client get an email when a booking is paid.", "Off. Set the EMAILJS variables and OWNER_EMAIL.");
    el("test-email").disabled = !s.email;
  }

  // ----------------------------------------------------------------
  // Load, save, discard
  // ----------------------------------------------------------------
  function normalize(d) {
    d.availability = d.availability || {};
    var a = d.availability;
    a.hours = a.hours || { start: "8:00 AM", end: "8:00 PM", every: 120 };
    a.week = a.week || {};
    a.blocked = a.blocked || {};
    a.overrides = a.overrides || {};
    return d;
  }

  function paintAll() {
    paintStripeNote();
    paintPackages();
    paintHours();
    paintWeek();
    el("minNotice").value = cfg.availability.minNoticeHours;
    el("maxAdvance").value = cfg.availability.maxAdvanceDays;
    el("maxPerDay").value = cfg.availability.maxPerDay;
    el("lookBusy").value = cfg.availability.lookBusy;
    paintRules();
    paintDates();
    paintDirty();
  }

  function adopt(d) {
    cfg = normalize(d);
    saved = JSON.stringify(cfg);
    paintAll();
  }

  function saveNow() {
    if (!isDirty()) return;
    var btn = el("save-btn");
    btn.disabled = true;
    var t = A.toast("Saving...", "pending");
    A.api("/api/admin/config", { method: "PUT", body: JSON.stringify(cfg) }).then(function (d) {
      t.done();
      adopt(d.config);
      paintPreview();
      A.toast("Saved. The booking page and every price on the site use these now.");
    }, function (e) {
      t.done();
      paintDirty();
      A.toast(e.message, "error");
    });
  }

  // ----------------------------------------------------------------
  // Wiring
  // ----------------------------------------------------------------
  el("add-package").innerHTML = icon("plus") + "Add package";
  el("view-booking").innerHTML = icon("external") + "Booking page";
  el("preview-refresh").innerHTML = icon("refresh");

  el("pkg-editor").addEventListener("input", function (e) {
    var box = e.target.closest(".adm-pkg");
    if (!box || !e.target.hasAttribute("data-f")) return;
    readPackage(box, cfg.packages[Number(box.getAttribute("data-i"))], e.target);
    changed();
  });
  el("pkg-editor").addEventListener("change", function (e) {
    var box = e.target.closest(".adm-pkg");
    if (!box || !e.target.hasAttribute("data-f")) return;
    readPackage(box, cfg.packages[Number(box.getAttribute("data-i"))], e.target);
    changed();
  });
  el("pkg-editor").addEventListener("click", function (e) {
    var box = e.target.closest(".adm-pkg");
    if (!box) return;
    var i = Number(box.getAttribute("data-i"));
    var p = cfg.packages[i];
    if (e.target.closest("[data-toggle]")) { openPkg[p.id] = !openPkg[p.id]; paintPackages(); return; }
    var mv = e.target.closest("[data-move]");
    if (mv) {
      var j = i + Number(mv.getAttribute("data-move"));
      if (j < 0 || j >= cfg.packages.length) return;
      cfg.packages.splice(j, 0, cfg.packages.splice(i, 1)[0]);
      paintPackages(); changed();
      return;
    }
    if (e.target.closest("[data-dup]")) {
      var c = JSON.parse(JSON.stringify(p));
      c.name = p.name + " copy";
      c.active = false;
      c.id = slug(c.name, c);
      cfg.packages.splice(i + 1, 0, c);
      openPkg[c.id] = true;
      paintPackages(); changed();
      A.toast("Duplicated. The copy is not live until you switch it on.");
      return;
    }
    if (e.target.closest("[data-remove]")) {
      if (cfg.packages.length < 2) return A.toast("Keep at least one package.", "error");
      A.confirm({ title: "Remove " + (p.name || "this package") + "?", body: "Links to book.html?package=" + p.id + " stop picking it. Switching it off keeps the links working instead. Nothing is lost until you save.", ok: "Remove", danger: true })
        .then(function (yes) { if (!yes) return; cfg.packages.splice(i, 1); paintPackages(); changed(); });
    }
  });

  el("add-package").addEventListener("click", function () {
    var p = { id: "", name: "New package", blurb: "", price: 0, firstPrice: 0, active: false, badge: "", bullets: [], checkoutFull: "", checkoutFirst: "" };
    cfg.packages.push(p);
    p.id = slug("new package", p);
    openPkg[p.id] = true;
    paintPackages(); changed();
    var last = el("pkg-editor").lastElementChild;
    if (last) { last.scrollIntoView({ behavior: "smooth", block: "center" }); var n = last.querySelector('[data-f="name"]'); if (n) n.select(); }
  });

  ["hours-start", "hours-end", "hours-every"].forEach(function (id) {
    el(id).addEventListener("change", function () {
      readHours();
      if (A.minutesOf(hours().end) < A.minutesOf(hours().start)) A.toast("The last shoot has to come after the first.", "error");
      paintWeek(); paintRules(); paintOvPills(); changed();
    });
  });
  el("apply-hours").addEventListener("click", function () {
    readHours();
    var list = generated();
    for (var d = 0; d < 7; d++) if ((cfg.availability.week[String(d)] || []).length) cfg.availability.week[String(d)] = list.slice();
    paintWeek(); paintRules(); changed();
    A.toast("Every open day now offers " + list.length + " times. Save to keep it.");
  });

  el("week-editor").addEventListener("click", function (e) {
    var row = e.target.closest(".adm-day");
    if (!row) return;
    var d = row.getAttribute("data-day");
    var s = e.target.closest("[data-t]");
    if (s) {
      var t = s.getAttribute("data-t"), cur = cfg.availability.week[d] || [];
      cfg.availability.week[d] = cur.indexOf(t) === -1 ? sortTimes(cur.concat([t])) : cur.filter(function (x) { return x !== t; });
      paintWeek(); changed();
      return;
    }
    if (e.target.closest("[data-copyday]")) {
      var src = cfg.availability.week[d] || [];
      for (var k = 0; k < 7; k++) if ((cfg.availability.week[String(k)] || []).length) cfg.availability.week[String(k)] = src.slice();
      paintWeek(); changed();
      A.toast("Every open day now has " + DAYS[d] + "'s times.");
    }
  });
  el("week-editor").addEventListener("change", function (e) {
    if (!e.target.hasAttribute("data-dayon")) return;
    var d = e.target.closest(".adm-day").getAttribute("data-day");
    if (e.target.checked) cfg.availability.week[d] = (memo[d] && memo[d].length) ? memo[d] : generated();
    else { memo[d] = cfg.availability.week[d]; cfg.availability.week[d] = []; }
    paintWeek(); changed();
  });

  [["minNotice", "minNoticeHours"], ["maxAdvance", "maxAdvanceDays"], ["maxPerDay", "maxPerDay"], ["lookBusy", "lookBusy"]].forEach(function (p) {
    el(p[0]).addEventListener("input", function () {
      var v = el(p[0]).value;
      cfg.availability[p[1]] = v === "" ? "" : Number(v);
      paintRules(); changed();
    });
  });

  el("add-block").addEventListener("click", function () {
    var from = el("block-from").value, to = el("block-to").value || from;
    if (!from) return A.toast("Pick a date to block.", "error");
    if (to < from) { var x = from; from = to; to = x; }
    var reason = el("block-reason").value.trim() || "Not available";
    var n = 0;
    for (var k = from; k <= to && n < 120; k = A.addDays(k, 1)) { cfg.availability.blocked[k] = reason; n++; }
    el("block-from").value = ""; el("block-to").value = ""; el("block-reason").value = "";
    paintDates(); changed();
    A.toast("Blocked " + n + (n === 1 ? " day." : " days.") + " Save to keep it.");
  });
  el("block-from").addEventListener("change", function () { if (!el("block-to").value) el("block-to").min = el("block-from").value; });
  el("clear-past").addEventListener("click", function () {
    var today = A.keyOf(new Date());
    Object.keys(cfg.availability.blocked).forEach(function (k) { if (k < today) delete cfg.availability.blocked[k]; });
    Object.keys(cfg.availability.overrides).forEach(function (k) { if (k < today) delete cfg.availability.overrides[k]; });
    paintDates(); changed();
  });
  document.addEventListener("click", function (e) {
    var u = e.target.closest("[data-unblock]");
    if (u) { delete cfg.availability.blocked[u.getAttribute("data-unblock")]; paintDates(); changed(); return; }
    var uo = e.target.closest("[data-unov]");
    if (uo) { delete cfg.availability.overrides[uo.getAttribute("data-unov")]; paintDates(); changed(); return; }
    var eo = e.target.closest("[data-editov]");
    if (eo) {
      var k = eo.getAttribute("data-editov");
      el("ov-date").value = k;
      ovSel = (cfg.availability.overrides[k] || []).slice();
      paintOvPills();
      el("ov-date").focus();
      return;
    }
    var ot = e.target.closest("[data-ovt]");
    if (ot) {
      var t = ot.getAttribute("data-ovt");
      ovSel = ovSel.indexOf(t) === -1 ? sortTimes(ovSel.concat([t])) : ovSel.filter(function (x) { return x !== t; });
      ot.setAttribute("aria-pressed", ovSel.indexOf(t) !== -1);
    }
  });
  el("ov-date").addEventListener("change", function () {
    var k = el("ov-date").value;
    if (!k) return;
    // Start from what that date offers now, so shortening a day is untick,
    // not rebuild.
    ovSel = cfg.availability.overrides[k] ? cfg.availability.overrides[k].slice()
      : cfg.availability.blocked[k] ? [] : (cfg.availability.week[String(A.dateOf(k).getDay())] || []).slice();
    paintOvPills();
  });
  el("add-override").addEventListener("click", function () {
    var k = el("ov-date").value;
    if (!k) return A.toast("Pick a date first.", "error");
    cfg.availability.overrides[k] = sortTimes(ovSel);
    var msg = A.shortDay(k) + (ovSel.length ? " offers " + ovSel.length + (ovSel.length === 1 ? " time." : " times.") : " is closed.");
    if (cfg.availability.blocked[k]) msg += " It is also a day off, which wins until you remove it.";
    el("ov-date").value = ""; ovSel = [];
    paintDates(); changed();
    A.toast(msg + " Save to keep it.");
  });

  el("preview-refresh").addEventListener("click", paintPreview);
  el("test-email").addEventListener("click", function () {
    A.confirm({ title: "Send a test email?", body: "Both booking emails, for a made up booking, go to your own inbox. Nothing goes to a client and nothing is charged.", ok: "Send test" })
      .then(function (yes) {
        if (!yes) return;
        var t = A.toast("Sending...", "pending");
        A.api("/api/admin/test-email", { method: "POST" }).then(function (r) {
          t.done();
          A.toast("Sent to " + (r.to || []).join(", ") + ". Check the inbox.");
        }, function (e) { t.done(); A.toast("The test did not send: " + e.message, "error"); });
      });
  });

  el("save-btn").addEventListener("click", saveNow);
  el("discard-btn").addEventListener("click", function () {
    A.confirm({ title: "Discard your changes?", body: "Everything goes back to what is saved.", ok: "Discard", danger: true })
      .then(function (yes) { if (yes) { adopt(JSON.parse(saved)); A.toast("Changes discarded."); } });
  });
  document.addEventListener("keydown", function (e) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s" && cfg) { e.preventDefault(); saveNow(); }
  });

  // The section you are looking at is the one lit up in the side list.
  function watchSections() {
    if (!("IntersectionObserver" in window)) return;
    var links = document.querySelectorAll("#side a");
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        links.forEach(function (a) { a.classList.toggle("active", a.getAttribute("href") === "#" + en.target.id); });
      });
    }, { rootMargin: "-30% 0px -60% 0px" });
    document.querySelectorAll(".adm-section").forEach(function (s) { io.observe(s); });
  }

  A.boot("settings", function (s) {
    session = s;
    paintSystem();
    watchSections();
    paintPreview();
    return A.api("/api/admin/config").then(adopt);
  });
})();
