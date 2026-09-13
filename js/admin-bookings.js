// admin-bookings.html: the owner's day.
//
// One GET brings back every booking from two months ago to the end of the
// booking window, with a state worked out on the server (confirmed, held,
// expired, cancelled), how much is left to refund, how many bookings each
// client has had, and the numbers for the top. This file draws the next shoot,
// the numbers, a list or a week, and a drawer per booking with everything the
// owner can do to it: mark it paid, reschedule, refund, cancel, keep a private
// note. The same drawer adds a booking by hand. Signing in, the top bar,
// toasts and the confirm dialog live in js/admin-core.js.
//
// A refund moves real money back to a card, so it asks twice: a panel to pick
// the amount, then a confirm dialog. Opening the panel mints a request id that
// goes with the refund, so a second press of the same refund is recognised by
// the server and by Stripe and refunds nothing more.
(function () {
  var A = window.EZAdmin;
  if (!A || !A.el("adm-app")) return;
  var el = A.el, esc = A.esc, money = A.money, icon = A.icon;

  var data = null;
  var loadedAt = 0;
  var avail = null;          // /api/availability, for the time pickers
  var ui = load("ez-admin-ui", { filter: "upcoming", view: "list" });
  var q = "";
  var weekStart = null;
  var openId = null;         // booking in the drawer, or "new"
  var panel = null;          // "move" | "refund" | null
  var refundKey = {};

  function load(k, def) { try { return Object.assign(def, JSON.parse(localStorage.getItem(k) || "{}")); } catch (e) { return def; } }
  function save() { try { localStorage.setItem("ez-admin-ui", JSON.stringify({ filter: ui.filter, view: ui.view })); } catch (e) {} }
  function newKey() { return Math.random().toString(36).slice(2, 12) + Date.now().toString(36); }
  function find(id) { return data && data.bookings.filter(function (b) { return b.id === id; })[0]; }
  function first(name) { return String(name || "").split(/\s+/)[0] || "the client"; }

  // ----------------------------------------------------------------
  // What a booking is, in one word the owner would use
  // ----------------------------------------------------------------
  function kind(b) {
    if (b.state === "confirmed") return b.paid ? "paid" : "unpaid";
    return b.state;
  }
  function badge(b) {
    var k = kind(b), r = b.refundedCents > 0;
    var map = {
      paid: r ? (b.refundable > 0 ? ["b-info", "Part refunded"] : ["b-info", "Refunded"]) : ["b-ok", "Paid"],
      unpaid: ["b-warn", "Unpaid"],
      held: ["b-warn", "Awaiting payment"],
      expired: ["b-bad", "Payment lapsed"],
      cancelled: r ? ["b-mute", "Cancelled, refunded"] : ["b-mute", "Cancelled"]
    };
    var m = map[k] || ["b-mute", k];
    return '<span class="adm-badge ' + m[0] + '">' + esc(m[1]) + "</span>";
  }
  function needsAttention(b) {
    var k = kind(b);
    return (k === "unpaid") || ((k === "held" || k === "expired") && b.date >= data.today);
  }
  // A client who has booked before and still got the first shoot price.
  // Nothing on the booking page checks this, so the owner should see it.
  function repeatDiscount(b) { return b.firstShoot && b.clientBookings > 1 && b.state !== "cancelled"; }

  // ----------------------------------------------------------------
  // Filters
  // ----------------------------------------------------------------
  var FILTERS = [
    ["upcoming", "Upcoming"],
    ["attention", "Needs attention"],
    ["past", "Past"],
    ["cancelled", "Cancelled"],
    ["all", "All"]
  ];
  function inFilter(b, f) {
    var t = data.today;
    if (f === "upcoming") return b.date >= t && (b.state === "confirmed" || b.state === "held");
    if (f === "attention") return needsAttention(b);
    if (f === "past") return b.date < t && b.state === "confirmed";
    if (f === "cancelled") return b.state === "cancelled";
    return true;
  }
  function matches(b) {
    if (!q) return true;
    return [b.id, b.address, b.name, b.email, b.phone, A.digits(b.phone), b.brokerage, b.packageName, b.notes, b.internalNotes]
      .join(" ").toLowerCase().indexOf(q) !== -1;
  }
  function rows() {
    var list = data.bookings.filter(function (b) { return (q ? true : inFilter(b, ui.filter)) && matches(b); });
    if (q || ui.filter === "past" || ui.filter === "cancelled" || ui.filter === "all") list = list.slice().reverse();
    return list;
  }

  // ----------------------------------------------------------------
  // Top of the page
  // ----------------------------------------------------------------
  function paintHead() {
    var h = new Date().getHours();
    el("greet").textContent = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
    var s = data.stats;
    var bits = [A.longDay(data.today)];
    if (s.ticket) bits.push("Average ticket " + money(s.ticket) + " this month");
    if (s.repeat) bits.push(s.repeat + (s.repeat === 1 ? " repeat client" : " repeat clients"));
    el("greet-sub").textContent = bits.join(". ") + ".";
    var n = el("adm-tab-count");
    if (n) { n.hidden = !s.unpaid; n.textContent = s.unpaid; n.title = s.unpaid + " need attention"; }
  }

  function paintNext() {
    var now = Date.now();
    var next = data.bookings.filter(function (b) {
      return b.state === "confirmed" && Date.parse(b.startsAt) + 90 * 60000 > now;
    }).sort(function (a, b) { return Date.parse(a.startsAt) - Date.parse(b.startsAt); })[0];
    var box = el("next");
    if (!next) { box.innerHTML = ""; return; }
    var start = Date.parse(next.startsAt);
    var dayWord = next.date === data.today ? "Today" : next.date === A.addDays(data.today, 1) ? "Tomorrow" : A.shortDay(next.date);
    var when = start <= now ? "happening now" : A.until(start);
    box.innerHTML =
      '<div class="adm-next">' +
        '<div class="adm-next-when"><span>' + esc(dayWord) + "</span><b>" + esc(next.time.replace(" ", " ")) + "</b></div>" +
        '<div class="adm-next-main">' +
          '<div class="adm-next-eyebrow">Next shoot, ' + esc(when) + "</div>" +
          "<b>" + esc(next.address) + "</b>" +
          "<span>" + esc([next.name, next.packageName, next.access].filter(Boolean).join(", ")) + "</span>" +
        "</div>" +
        '<div class="adm-next-actions">' +
          '<a class="adm-btn" href="' + esc(maps(next.address)) + '" target="_blank" rel="noopener">' + icon("map") + "Directions</a>" +
          (next.phone ? '<a class="adm-btn" href="sms:' + esc(A.digits(next.phone)) + '">' + icon("message") + "Text</a>" : "") +
          '<button type="button" class="adm-btn" data-open="' + esc(next.id) + '">Open</button>' +
        "</div>" +
      "</div>";
  }

  function paintKpis() {
    var s = data.stats;
    var todays = data.bookings.filter(function (b) { return b.date === data.today && b.state === "confirmed"; });
    var later = todays.filter(function (b) { return Date.parse(b.startsAt) > Date.now(); });
    var delta = "";
    if (s.lastMonthRevenue > 0) {
      var pct = Math.round((s.revenue - s.lastMonthRevenue) / s.lastMonthRevenue * 100);
      delta = '<span class="' + (pct >= 0 ? "adm-up" : "adm-down") + '">' + (pct >= 0 ? "+" : "") + pct + "%</span> on last month";
    } else {
      delta = "net of refunds";
    }
    var month = A.MONTHS[new Date().getMonth()];
    var tile = function (label, value, sub, filter) {
      var tag = filter ? 'button type="button" data-filter="' + filter + '"' : "div";
      return "<" + tag + ' class="adm-kpi"><div class="adm-kpi-label">' + esc(label) + '</div><div class="adm-kpi-value">' + esc(value) +
        '</div><div class="adm-kpi-sub">' + sub + "</div></" + (filter ? "button" : "div") + ">";
    };
    el("kpis").innerHTML =
      tile("Today", todays.length + (todays.length === 1 ? " shoot" : " shoots"),
        later.length ? "next at " + esc(later[0].time) : todays.length ? "all done" : "nothing booked") +
      tile("This week", s.week + (s.week === 1 ? " shoot" : " shoots"), esc(s.upcoming + " upcoming, " + money(s.upcomingValue) + " booked"), "upcoming") +
      tile("Revenue in " + month, money(s.revenue), delta) +
      tile("Needs attention", String(s.unpaid), s.unpaid ? "unpaid or waiting on payment" : "everything is paid up", "attention");
  }

  function paintFilters() {
    el("filters").innerHTML = FILTERS.map(function (f) {
      var n = data.bookings.filter(function (b) { return inFilter(b, f[0]); }).length;
      return '<button type="button" data-filter="' + f[0] + '" aria-pressed="' + (!q && ui.filter === f[0]) + '">' + esc(f[1]) +
        (f[0] === "all" ? "" : ' <span class="n">' + n + "</span>") + "</button>";
    }).join("");
    el("views").innerHTML =
      '<button type="button" data-view="list" aria-pressed="' + (ui.view === "list") + '" aria-label="List">' + icon("list") + "List</button>" +
      '<button type="button" data-view="week" aria-pressed="' + (ui.view === "week") + '" aria-label="Week">' + icon("calendar") + "Week</button>";
  }

  // ----------------------------------------------------------------
  // The list
  // ----------------------------------------------------------------
  function maps(a) { return "https://www.google.com/maps/dir/?api=1&destination=" + encodeURIComponent(a || ""); }

  function row(b) {
    var sub = [b.name, b.packageName, b.brokerage].filter(Boolean).join(", ");
    var rel = A.DAYS[A.dateOf(b.date).getDay()];
    if (b.date === data.today && b.state === "confirmed") {
      var start = Date.parse(b.startsAt), now = Date.now();
      rel = start + 90 * 60000 < now ? "done" : start <= now ? "now" : A.until(start);
    }
    var dim = b.state === "cancelled" || b.state === "expired";
    return '<button type="button" class="adm-bk' + (dim ? " is-dim" : "") + (openId === b.id ? " is-open" : "") + '" data-open="' + esc(b.id) + '">' +
      '<div class="adm-bk-time"><b>' + esc(b.time) + "</b><span>" + esc(rel) + "</span></div>" +
      '<div class="adm-bk-main"><b>' + esc(b.address) + (repeatDiscount(b) ? '<span class="adm-flag" title="Has booked before and still got the first shoot price">Repeat at 50% off</span>' : "") + "</b><span>" + esc(sub) + "</span></div>" +
      '<div class="adm-bk-amt">' + esc(money(b.amount)) + "<small>" + (b.firstShoot ? "first shoot" : b.source === "admin" ? "added by you" : "&nbsp;") + "</small></div>" +
      '<div class="adm-bk-state">' + badge(b) + "</div>" +
      icon("chev", "adm-bk-chev") +
    "</button>";
  }

  function paintList() {
    var list = rows();
    var wrap = el("list");
    if (!list.length) {
      var msg = q ? ["Nothing matches “" + q + "”", "Search looks at every booking, past and future."]
        : { upcoming: ["Nothing booked ahead", "New bookings land here the moment they are paid."],
            attention: ["All clear", "Nothing is unpaid or waiting on a payment."],
            past: ["No past shoots yet", "Shoots from the last two months show here."],
            cancelled: ["Nothing cancelled", "Good."], all: ["No bookings yet", ""] }[ui.filter];
      wrap.innerHTML = '<div class="adm-empty"><b>' + esc(msg[0]) + "</b>" + esc(msg[1]) + "</div>";
      return;
    }
    var html = "", day = null;
    list.forEach(function (b) {
      if (b.date !== day) {
        day = b.date;
        var same = list.filter(function (x) { return x.date === day && x.state !== "cancelled"; });
        var total = same.reduce(function (s, x) { return s + x.amount; }, 0);
        var label = (day === data.today ? "Today, " : day === A.addDays(data.today, 1) ? "Tomorrow, " : "") + A.longDay(day);
        html += '<div class="adm-daygroup' + (day === data.today ? " today" : "") + '"><span>' + esc(label) + "</span><span>" +
          (same.length ? same.length + (same.length === 1 ? " shoot, " : " shoots, ") + esc(money(total)) : "") + "</span></div>";
      }
      html += row(b);
    });
    wrap.innerHTML = html;
  }

  // ----------------------------------------------------------------
  // The week
  // ----------------------------------------------------------------
  function sundayOf(key) { return A.addDays(key, -A.dateOf(key).getDay()); }

  function paintWeek() {
    if (!weekStart) weekStart = sundayOf(data.today);
    var end = A.addDays(weekStart, 6);
    var s = A.dateOf(weekStart), e = A.dateOf(end);
    el("week-label").textContent = A.MONTHS[s.getMonth()] + " " + s.getDate() + " to " + (s.getMonth() === e.getMonth() ? "" : A.MONTHS[e.getMonth()] + " ") + e.getDate();
    var html = "";
    for (var i = 0; i < 7; i++) {
      var key = A.addDays(weekStart, i);
      var d = A.dateOf(key);
      var list = data.bookings.filter(function (b) { return b.date === key && matches(b); });
      html += '<div class="adm-wd' + (key === data.today ? " today" : "") + (key < data.today ? " past" : "") + '">' +
        '<div class="adm-wd-head"><span>' + A.DAYS[d.getDay()] + "</span><b>" + d.getDate() + "</b></div>" +
        list.map(function (b) {
          var k = kind(b);
          var cls = k === "cancelled" || k === "expired" ? " mute" : k === "paid" ? "" : " warn";
          return '<button type="button" class="adm-chip' + cls + '" data-open="' + esc(b.id) + '"><b>' + esc(b.time) + "</b><span>" + esc(b.address.split(",")[0]) + "</span><span>" + esc(b.name) + "</span></button>";
        }).join("") +
      "</div>";
    }
    el("week").innerHTML = html;
  }

  function paintBody() {
    var week = ui.view === "week";
    el("list").hidden = week;
    el("week").hidden = !week;
    el("weeknav").hidden = !week;
    el("filters").hidden = week;
    if (week) paintWeek(); else paintList();
  }

  function paintAll() {
    paintHead();
    paintNext();
    paintKpis();
    paintFilters();
    paintBody();
    paintUpdated();
  }

  function paintUpdated() { if (loadedAt) el("updated").textContent = "Updated " + A.ago(loadedAt); }

  // ----------------------------------------------------------------
  // Loading
  // ----------------------------------------------------------------
  function fetchAll(quiet) {
    if (!quiet) el("list").innerHTML = '<div class="adm-skel"></div><div class="adm-skel"></div><div class="adm-skel"></div>';
    return A.api("/api/admin/bookings").then(function (d) {
      data = d;
      loadedAt = Date.now();
      paintAll();
      if (openId && openId !== "new" && !panel) {
        var b = find(openId);
        if (b) paintDrawer(b); else closeDrawer();
      }
    });
  }

  function fetchAvail(force) {
    if (avail && !force) return Promise.resolve(avail);
    return fetch("/api/availability", { headers: { accept: "application/json" } })
      .then(function (r) { return r.ok ? r.json() : { days: {} }; })
      .catch(function () { return { days: {} }; })
      .then(function (d) { avail = d; return d; });
  }

  // ----------------------------------------------------------------
  // The drawer
  // ----------------------------------------------------------------
  var drawer = el("drawer"), scrim = el("scrim");
  var lastFocus = null;

  function openDrawer(id) {
    if (openId === null) lastFocus = document.activeElement;
    openId = id;
    panel = null;
    if (id === "new") paintNew(); else { var b = find(id); if (!b) return; paintDrawer(b); }
    drawer.hidden = false; scrim.hidden = false;
    requestAnimationFrame(function () { drawer.classList.add("show"); scrim.classList.add("show"); });
    document.body.style.overflow = "hidden";
    if (id !== "new") try { history.replaceState(null, "", "#" + id); } catch (e) {}
    document.querySelectorAll(".adm-bk.is-open").forEach(function (n) { n.classList.remove("is-open"); });
    var r = document.querySelector('.adm-bk[data-open="' + id + '"]');
    if (r) r.classList.add("is-open");
    setTimeout(function () { var f = drawer.querySelector("[data-autofocus]") || drawer.querySelector(".adm-icon"); if (f) f.focus(); }, 60);
  }

  function closeDrawer() {
    drawer.classList.remove("show"); scrim.classList.remove("show");
    document.body.style.overflow = "";
    openId = null; panel = null;
    setTimeout(function () { if (!openId) { drawer.hidden = true; scrim.hidden = true; } }, 220);
    try { history.replaceState(null, "", location.pathname); } catch (e) {}
    document.querySelectorAll(".adm-bk.is-open").forEach(function (n) { n.classList.remove("is-open"); });
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function copyBtn(text, what) {
    return text ? '<button type="button" class="adm-copy" data-copy="' + esc(text) + '" data-what="' + esc(what) + '" aria-label="Copy ' + esc(what) + '">' + icon("copy") + "</button>" : "";
  }
  function dl(pairs) {
    var body = pairs.filter(function (p) { return p[1]; }).map(function (p) {
      return "<dt>" + esc(p[0]) + "</dt><dd" + (p[3] ? ' class="pre"' : "") + ">" + (p[2] === "html" ? p[1] : "<span>" + esc(p[1]) + "</span>") + (p[4] || "") + "</dd>";
    }).join("");
    return body ? '<dl class="adm-dl">' + body + "</dl>" : "";
  }

  function paintDrawer(b) {
    var k = kind(b);
    var canRefund = b.paid && b.refundable > 0;
    var live = b.state !== "cancelled";
    var price = money(b.amount) + (b.firstShoot ? ", first shoot" : "") + (b.listPrice && b.listPrice !== b.amount ? " (list " + money(b.listPrice) + ")" : "");
    var manage = location.origin + "/manage.html?t=" + b.token;

    var alert = "";
    if (k === "held" || k === "expired") {
      alert = '<div class="adm-panel"><b>' + (k === "held" ? "Waiting on payment" : "The payment never came through") + "</b>" +
        '<p class="adm-help">' + (k === "held"
          ? "The time is held until " + esc(A.stamp(b.expiresAt)) + ". " + (data.stripe ? "Stripe confirms it on its own when they pay." : "Check Stripe for the payment, then mark it paid.")
          : "The hold lapsed and the time is open again. If they paid another way, mark it paid to put it back on the calendar.") + "</p>" +
        '<div class="adm-panel-actions"><button type="button" class="adm-btn adm-btn-primary" data-act="confirm">Mark paid</button></div></div>';
    } else if (k === "unpaid") {
      alert = '<div class="adm-panel"><b>Booked, not paid yet</b><p class="adm-help">You added this by hand. Mark it paid once the money is in.</p>' +
        '<div class="adm-panel-actions"><button type="button" class="adm-btn adm-btn-primary" data-act="confirm">Mark paid</button></div></div>';
    }
    if (repeatDiscount(b)) {
      alert += '<div class="adm-panel"><b>Returning client at first shoot price</b><p class="adm-help">' + esc(first(b.name)) +
        " has " + b.clientBookings + " bookings with you and still took the half price. Worth a word, or a partial refund if it was a mistake on your side.</p></div>";
    }

    var sub = "";
    if (panel === "move") sub = movePanel(b);
    if (panel === "refund" && canRefund) sub = refundPanel(b);

    var history = [
      ["Booked" + (b.source === "admin" ? " by you" : " on the site"), b.createdAt],
      [b.paid ? "Paid" + (b.checkoutMode === "manual" ? ", marked by you" : "") : "", b.paidAt],
      [b.refundedCents ? "Refunded " + money(b.refundedCents / 100) + " in total" : "", b.refundedAt],
      [b.state === "cancelled" ? "Cancelled by the " + (b.cancelledBy || "owner") : "", b.cancelledAt]
    ].filter(function (h) { return h[0] && h[1]; }).sort(function (x, y) { return Date.parse(x[1]) - Date.parse(y[1]); });

    drawer.innerHTML =
      '<div class="adm-drawer-head">' +
        '<div class="adm-drawer-top"><span class="adm-drawer-id">' + esc(b.id) + " " + badge(b) + '</span><button type="button" class="adm-icon" data-close aria-label="Close">' + icon("x") + "</button></div>" +
        '<h2 id="drawer-title">' + esc(b.address) + "</h2>" +
        "<p>" + esc(A.longDay(b.date) + " at " + b.time + ", " + b.packageName) + "</p>" +
      "</div>" +
      '<div class="adm-drawer-body">' +
        '<div class="adm-quick">' +
          '<a href="' + esc(maps(b.address)) + '" target="_blank" rel="noopener">' + icon("map") + "Directions</a>" +
          (b.phone ? '<a href="tel:' + esc(A.digits(b.phone)) + '">' + icon("phone") + "Call</a>" : "") +
          (b.phone ? '<a href="sms:' + esc(A.digits(b.phone)) + '">' + icon("message") + "Text</a>" : "") +
          (b.email ? '<a href="mailto:' + esc(b.email) + '">' + icon("mail") + "Email</a>" : "") +
        "</div>" +
        sub + alert +
        '<div class="adm-sec"><h3>Client</h3>' + dl([
          ["Name", b.name, 0, 0, copyBtn(b.name, "Name")],
          ["Phone", b.phone, 0, 0, copyBtn(b.phone, "Phone")],
          ["Email", b.email, 0, 0, copyBtn(b.email, "Email")],
          ["Brokerage", b.brokerage],
          ["Bookings", b.clientBookings > 1 ? b.clientBookings + " with you, a returning client" : b.clientBookings === 1 ? "First booking" : ""]
        ]) + "</div>" +
        '<div class="adm-sec"><h3>Shoot</h3>' + dl([
          ["When", A.longDay(b.date) + " at " + b.time],
          ["Address", b.address, 0, 0, copyBtn(b.address, "Address")],
          ["Package", b.packageName + ", " + price],
          ["Access", [b.access, b.accessNotes].filter(Boolean).join(". ")],
          ["Home", [b.size, b.occupancy].filter(Boolean).join(", ")],
          ["Their notes", b.notes, 0, 1]
        ]) + "</div>" +
        '<div class="adm-sec"><h3>Payment</h3>' + dl([
          ["Charged", money(b.amount)],
          ["Refunded", b.refundedCents ? money(b.refundedCents / 100) : ""],
          ["Left to refund", b.refundedCents && b.refundable ? money(b.refundable) : ""],
          ["Stripe", b.stripePaymentIntent ? '<a href="https://dashboard.stripe.com/payments/' + esc(b.stripePaymentIntent) + '" target="_blank" rel="noopener" style="color:var(--accent);font-weight:600">Open the payment</a>' : "", "html"]
        ]) + "</div>" +
        '<div class="adm-sec"><h3>Private note</h3>' +
          '<textarea class="adm-textarea" data-f="note" rows="3" placeholder="Only you see this. Gate code arrangements, what the agent asked for, anything.">' + esc(b.internalNotes || "") + "</textarea>" +
          '<div class="adm-panel-actions" style="margin-top:8px"><button type="button" class="adm-btn" data-act="note">Save note</button><span class="adm-help" style="align-self:center">Ctrl or Cmd and Enter saves too</span></div>' +
        "</div>" +
        (history.length ? '<div class="adm-sec"><h3>History</h3><div class="adm-timeline">' + history.map(function (h) {
          return "<div><i></i><b style=\"font-weight:500\">" + esc(h[0]) + "</b><span>" + esc(A.stamp(h[1])) + "</span></div>";
        }).join("") + "</div></div>" : "") +
      "</div>" +
      '<div class="adm-drawer-foot">' +
        (live ? '<button type="button" class="adm-btn" data-panel="move">' + icon("calendar") + "Reschedule</button>" : "") +
        (canRefund ? '<button type="button" class="adm-btn" data-panel="refund">Refund</button>' : "") +
        '<button type="button" class="adm-btn adm-btn-quiet" data-copy="' + esc(manage) + '" data-what="Client link" title="The link the client uses to see or cancel the booking">' + icon("copy") + "Client link</button>" +
        (live ? '<button type="button" class="adm-btn adm-btn-quiet" data-act="cancel" style="margin-left:auto;color:var(--adm-bad-fg)">Cancel booking</button>' : "") +
      "</div>";
    if (panel === "move") paintMoveSlots(b);
  }

  // ---- reschedule ----
  function movePanel(b) {
    return '<div class="adm-panel" id="move-panel"><b>Move this shoot</b>' +
      '<div class="adm-grid2">' +
        '<label class="adm-field"><span>New day</span><input class="adm-input" type="date" data-f="move-date" min="' + esc(data.today) + '" value="' + esc(b.date >= data.today ? b.date : data.today) + '" data-autofocus /></label>' +
        '<label class="adm-field"><span>Or any time</span><input class="adm-input" type="time" data-f="move-custom" step="900" /></label>' +
      "</div>" +
      '<div class="adm-field"><span>Open times that day</span><div class="adm-slots" id="move-slots"><span class="adm-help">Loading...</span></div>' +
        '<p class="adm-help">Times already booked are crossed out. You can pick any time with the box above, the public schedule does not bind you.</p></div>' +
      (b.email ? '<label class="adm-check"><input type="checkbox" data-f="move-notify"' + (data.email ? " checked" : " disabled") + " /> <span>Email " + esc(first(b.name)) + " the new time" + (data.email ? "" : " (emails are not switched on)") + "</span></label>" : "") +
      '<div class="adm-panel-actions"><button type="button" class="adm-btn adm-btn-primary" data-act="move">Move shoot</button><button type="button" class="adm-btn" data-panel="">Never mind</button></div>' +
    "</div>";
  }

  var moveTime = null;
  function slotButtons(key, exceptId, selected) {
    var open = (avail && avail.days && avail.days[key]) || [];
    var taken = data.bookings.filter(function (x) { return x.date === key && x.id !== exceptId && (x.state === "confirmed" || x.state === "held"); })
      .map(function (x) { return x.time; });
    var all = open.concat(taken).filter(function (t, i, arr) { return arr.indexOf(t) === i; })
      .sort(function (a, b) { return A.minutesOf(a) - A.minutesOf(b); });
    if (!all.length) return '<span class="adm-help">Nothing on the public calendar that day. Use the time box.</span>';
    return all.map(function (t) {
      var isTaken = taken.indexOf(t) !== -1;
      return '<button type="button" class="adm-slot' + (isTaken ? " taken" : "") + '" data-slot="' + esc(t) + '"' + (isTaken ? " disabled" : "") +
        ' aria-pressed="' + (selected === t) + '">' + esc(t) + "</button>";
    }).join("");
  }
  function paintMoveSlots(b) {
    var input = drawer.querySelector('[data-f="move-date"]');
    var box = el("move-slots");
    if (!input || !box) return;
    fetchAvail().then(function () { box.innerHTML = slotButtons(input.value, b.id, moveTime); });
  }

  // ---- refund ----
  function refundPanel(b) {
    if (!refundKey[b.id]) refundKey[b.id] = newKey();
    var half = Math.round(b.refundable * 50) / 100;
    return '<div class="adm-panel danger"><b>Refund to their card</b>' +
      '<label class="adm-field"><span>Amount, up to ' + esc(money(b.refundable)) + "</span>" +
        '<div class="adm-money"><input class="adm-input" type="number" inputmode="decimal" min="0.01" step="0.01" max="' + esc(b.refundable) + '" value="' + esc(b.refundable) + '" data-f="amount" data-autofocus /></div></label>' +
      '<div class="adm-slots"><button type="button" class="adm-slot" data-amount="' + esc(b.refundable) + '">All ' + esc(money(b.refundable)) + '</button><button type="button" class="adm-slot" data-amount="' + esc(half) + '">Half ' + esc(money(half)) + "</button>" +
        (b.refundable >= 20 ? '<button type="button" class="adm-slot" data-amount="20">$20</button>' : "") + "</div>" +
      (b.state !== "cancelled" ? '<label class="adm-check"><input type="checkbox" data-f="cancel" /> <span>Also cancel the booking and open the time back up</span></label>' : "") +
      '<p class="adm-help">It goes back to the card through Stripe and cannot be undone. ' + esc(first(b.name)) + " gets an email saying so.</p>" +
      '<div class="adm-panel-actions"><button type="button" class="adm-btn adm-btn-danger" data-act="refund">Refund</button><button type="button" class="adm-btn" data-panel="">Never mind</button></div>' +
    "</div>";
  }

  // ---- new booking ----
  function paintNew() {
    var pk = data.packages || [];
    var p0 = pk.filter(function (p) { return p.active; })[0] || pk[0] || { price: 0 };
    var start = A.addDays(data.today, 1);
    drawer.innerHTML =
      '<div class="adm-drawer-head"><div class="adm-drawer-top"><span class="adm-drawer-id">Added by you, for a client who called or texted</span><button type="button" class="adm-icon" data-close aria-label="Close">' + icon("x") + "</button></div>" +
        '<h2 id="drawer-title">New booking</h2></div>' +
      '<form class="adm-drawer-body" id="new-form" novalidate>' +
        '<div class="adm-sec adm-stack"><h3>When and what</h3>' +
          '<div class="adm-grid2">' +
            '<label class="adm-field"><span>Day</span><input class="adm-input" type="date" name="date" value="' + start + '" required data-autofocus /></label>' +
            '<label class="adm-field"><span>Or any time</span><input class="adm-input" type="time" name="custom" step="900" /></label>' +
          "</div>" +
          '<div class="adm-field"><span>Time</span><div class="adm-slots" id="new-slots"><span class="adm-help">Loading...</span></div></div>' +
          '<div class="adm-grid2">' +
            '<label class="adm-field"><span>Package</span><select class="adm-select" name="packageId">' + pk.map(function (p) {
              return '<option value="' + esc(p.id) + '"' + (p === p0 ? " selected" : "") + ">" + esc(p.name + (p.active ? "" : " (hidden)")) + "</option>";
            }).join("") + "</select></label>" +
            '<label class="adm-field"><span>Price</span><div class="adm-money"><input class="adm-input" type="number" name="amount" min="0" step="1" value="' + esc(p0.price) + '" /></div></label>' +
          "</div>" +
          '<label class="adm-switch"><input type="checkbox" name="firstShoot" /><i></i> First shoot, half price</label>' +
        "</div>" +
        '<div class="adm-sec adm-stack"><h3>Client</h3>' +
          '<div class="adm-grid2">' +
            '<label class="adm-field"><span>Name</span><input class="adm-input" name="name" autocomplete="off" required /></label>' +
            '<label class="adm-field"><span>Mobile</span><input class="adm-input" name="phone" type="tel" autocomplete="off" /></label>' +
            '<label class="adm-field"><span>Email</span><input class="adm-input" name="email" type="email" autocomplete="off" /></label>' +
            '<label class="adm-field"><span>Brokerage</span><input class="adm-input" name="brokerage" autocomplete="off" /></label>' +
          "</div>" +
          '<label class="adm-field"><span>Property address</span><input class="adm-input" name="address" autocomplete="off" required /></label>' +
          '<label class="adm-field"><span>Access</span><input class="adm-input" name="access" placeholder="Lockbox, agent meets me, owner home" /></label>' +
          '<label class="adm-field"><span>Their notes</span><textarea class="adm-textarea" name="notes" rows="2"></textarea></label>' +
          '<label class="adm-field"><span>Private note</span><textarea class="adm-textarea" name="internalNotes" rows="2"></textarea></label>' +
        "</div>" +
        '<div class="adm-sec adm-stack"><h3>Payment</h3>' +
          '<label class="adm-switch"><input type="checkbox" name="paid" /><i></i> Already paid (cash, Zelle, card in person)</label>' +
          '<label class="adm-check"><input type="checkbox" name="notify" disabled /> <span id="notify-text">Send the You are booked email (needs paid and an email address)</span></label>' +
        "</div>" +
        '<button type="submit" hidden></button>' +
      "</form>" +
      '<div class="adm-drawer-foot"><button type="button" class="adm-btn adm-btn-primary adm-btn-lg" data-act="create">Add booking</button><button type="button" class="adm-btn adm-btn-lg" data-close>Cancel</button></div>';
    moveTime = null;
    paintNewSlots();
  }
  function paintNewSlots() {
    var f = el("new-form");
    if (!f) return;
    fetchAvail().then(function () { var box = el("new-slots"); if (box) box.innerHTML = slotButtons(f.elements.date.value, null, moveTime); });
  }
  function syncNew() {
    var f = el("new-form");
    if (!f) return;
    var p = (data.packages || []).filter(function (x) { return x.id === f.elements.packageId.value; })[0];
    var n = f.elements.notify;
    var can = f.elements.paid.checked && /@/.test(f.elements.email.value) && data.email;
    n.disabled = !can;
    if (!can) n.checked = false;
    el("notify-text").textContent = can ? "Send " + first(f.elements.name.value) + " the You are booked email" :
      data.email ? "Send the You are booked email (needs paid and an email address)" : "Send the You are booked email (emails are not switched on)";
    return p;
  }

  // ----------------------------------------------------------------
  // Actions
  // ----------------------------------------------------------------
  function patch(b, body, busyText) {
    var t = A.toast(busyText || "Saving...", "pending");
    return A.api("/api/admin/bookings/" + encodeURIComponent(b.id), { method: "PATCH", body: JSON.stringify(body) })
      .then(function (d) { t.done(); return d; }, function (e) { t.done(); throw e; });
  }

  function act(name, btn) {
    if (name === "create") return create(btn);
    var b = find(openId);
    if (!b) return;
    var done = function (msg) { return function (d) { A.toast(typeof msg === "function" ? msg(d) : msg); panel = null; return fetchAll(true).then(function () { var x = find(b.id); if (x) paintDrawer(x); }); }; };
    var fail = function (e) {
      if (btn) btn.disabled = false;
      // Stripe said no, so that refund request is finished and the next try is
      // a new one. A dropped connection keeps the id, because the refund may
      // have gone through and a retry must not make a second one.
      if (name === "refund" && !(e instanceof TypeError)) refundKey[b.id] = newKey();
      A.toast(e.message, "error");
    };
    if (btn) btn.disabled = true;

    if (name === "confirm") return patch(b, { action: "confirm" }).then(done("Marked paid."), fail);
    if (name === "note") {
      return patch(b, { action: "note", note: drawer.querySelector('[data-f="note"]').value }).then(function () {
        A.toast("Note saved.");
        if (btn) btn.disabled = false;
        return fetchAll(true);
      }, fail);
    }
    if (name === "cancel") {
      if (btn) btn.disabled = false;
      return A.confirm({
        title: "Cancel this booking?",
        body: b.address + "\n" + A.longDay(b.date) + " at " + b.time + "\n\nThe time opens up again straight away. Nothing is refunded" + (b.paid ? ", use Refund for that." : "."),
        ok: "Cancel booking", cancel: "Keep it", danger: true
      }).then(function (yes) { if (yes) return patch(b, { action: "cancel" }).then(done("Booking cancelled."), fail); });
    }
    if (name === "move") {
      var date = drawer.querySelector('[data-f="move-date"]').value;
      var custom = drawer.querySelector('[data-f="move-custom"]').value;
      var time = custom ? A.labelOf(Number(custom.split(":")[0]) * 60 + Number(custom.split(":")[1])) : moveTime;
      var box = drawer.querySelector('[data-f="move-notify"]');
      if (!date || !time) { if (btn) btn.disabled = false; return A.toast("Pick a day and a time.", "error"); }
      return patch(b, { action: "move", date: date, time: time, notify: !!(box && box.checked) }, "Moving...")
        .then(done(function (d) { return "Moved to " + A.shortDay(date) + " at " + time + "." + (d.emailed ? " " + first(b.name) + " has been emailed." : ""); }), fail)
        .then(function () { moveTime = null; avail = null; });
    }
    if (name === "refund") {
      var amount = Number(drawer.querySelector('[data-f="amount"]').value);
      var c = drawer.querySelector('[data-f="cancel"]');
      var cancel = !!(c && c.checked);
      if (btn) btn.disabled = false;
      if (!(amount > 0)) return A.toast("Enter an amount to refund.", "error");
      if (amount > b.refundable + 0.001) return A.toast("The most you can refund on this booking is " + money(b.refundable) + ".", "error");
      return A.confirm({
        title: "Refund " + money(amount) + " to " + b.name + "?",
        body: "It goes back to their card and cannot be undone." + (cancel ? "\nThe booking will also be cancelled." : ""),
        ok: "Refund " + money(amount), danger: true
      }).then(function (yes) {
        if (!yes) return;
        return patch(b, { action: "refund", amount: amount, cancel: cancel, confirm: true, requestId: refundKey[b.id] || newKey() }, "Refunding...")
          .then(function (d) { delete refundKey[b.id]; return d; })
          .then(done(function (d) { return d.duplicate ? "That refund had already gone through. Nothing more was refunded." : "Refunded " + money(amount) + ". The client has been emailed."; }), fail);
      });
    }
  }

  function create(btn) {
    var f = el("new-form");
    var v = function (n) { return (f.elements[n].value || "").trim(); };
    var custom = v("custom");
    var time = custom ? A.labelOf(Number(custom.split(":")[0]) * 60 + Number(custom.split(":")[1])) : moveTime;
    var missing = [];
    if (!v("date") || !time) missing.push("a day and time");
    if (v("name").length < 2) missing.push("the client's name");
    if (v("address").length < 6) missing.push("the address");
    ["name", "address"].forEach(function (n) { f.elements[n].setAttribute("aria-invalid", v(n).length < (n === "name" ? 2 : 6) ? "true" : "false"); });
    if (missing.length) return A.toast("Add " + missing.join(", ") + ".", "error");
    btn.disabled = true;
    var t = A.toast("Adding...", "pending");
    A.api("/api/admin/bookings", { method: "POST", body: JSON.stringify({
      date: v("date"), time: time, packageId: v("packageId"), amount: v("amount"), firstShoot: f.elements.firstShoot.checked,
      name: v("name"), phone: v("phone"), email: v("email"), brokerage: v("brokerage"), address: v("address"),
      access: v("access"), notes: v("notes"), internalNotes: v("internalNotes"),
      paid: f.elements.paid.checked, notify: f.elements.notify.checked
    }) }).then(function (d) {
      t.done();
      A.toast("Booked " + d.booking.id + " for " + A.shortDay(d.booking.date) + " at " + d.booking.time + "." + (d.emailed ? " The client has been emailed." : ""));
      avail = null;
      moveTime = null;
      return fetchAll(true).then(function () { openDrawer(d.booking.id); });
    }, function (e) {
      t.done();
      btn.disabled = false;
      A.toast(e.message, "error");
    });
  }

  // ----------------------------------------------------------------
  // CSV of what is on screen
  // ----------------------------------------------------------------
  function exportCsv() {
    var list = ui.view === "week" ? data.bookings.filter(function (b) { return b.date >= weekStart && b.date <= A.addDays(weekStart, 6); }) : rows();
    var cols = [["Booking", "id"], ["Date", "date"], ["Time", "time"], ["Status", function (b) { return kind(b); }], ["Client", "name"], ["Email", "email"],
      ["Phone", "phone"], ["Brokerage", "brokerage"], ["Address", "address"], ["Package", "packageName"], ["Amount", "amount"],
      ["First shoot", function (b) { return b.firstShoot ? "yes" : "no"; }], ["Paid at", "paidAt"], ["Refunded", function (b) { return (b.refundedCents || 0) / 100; }],
      ["Source", "source"], ["Client notes", "notes"], ["Private note", "internalNotes"]];
    var cell = function (x) { x = x == null ? "" : String(x); return /[",\n]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x; };
    var csv = [cols.map(function (c) { return c[0]; }).join(",")].concat(list.map(function (b) {
      return cols.map(function (c) { return cell(typeof c[1] === "function" ? c[1](b) : b[c[1]]); }).join(",");
    })).join("\n");
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "ez-shots-bookings-" + data.today + ".csv";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    A.toast("Exported " + list.length + (list.length === 1 ? " booking." : " bookings."));
  }

  // ----------------------------------------------------------------
  // Wiring. One delegated handler, because the list and drawer are redrawn.
  // ----------------------------------------------------------------
  el("search-wrap").insertAdjacentHTML("afterbegin", icon("search"));
  el("refresh-btn").innerHTML = icon("refresh");
  el("export-btn").innerHTML = icon("download") + "<span>Export</span>";
  el("add-btn").innerHTML = icon("plus") + "<span>New booking</span>";
  el("week-prev").innerHTML = icon("left");
  el("week-next").innerHTML = icon("chev");

  document.addEventListener("click", function (e) {
    var t = e.target;
    var o = t.closest("[data-open]");
    if (o) return openDrawer(o.getAttribute("data-open"));
    var f = t.closest("[data-filter]");
    if (f) {
      ui.filter = f.getAttribute("data-filter"); ui.view = "list"; q = ""; el("search").value = "";
      save(); paintFilters(); paintBody();
      if (f.classList.contains("adm-kpi")) el("list").scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    var vw = t.closest("[data-view]");
    if (vw) { ui.view = vw.getAttribute("data-view"); save(); paintFilters(); paintBody(); return; }
    if (t.closest("[data-close]") || t === scrim) return closeDrawer();
    var cp = t.closest("[data-copy]");
    if (cp) return A.copy(cp.getAttribute("data-copy"), cp.getAttribute("data-what"));
    var pn = t.closest("[data-panel]");
    if (pn && openId && openId !== "new") {
      panel = pn.getAttribute("data-panel") || null;
      moveTime = null;
      paintDrawer(find(openId));
      var ff = drawer.querySelector("[data-autofocus]");
      if (ff) ff.focus();
      drawer.querySelector(".adm-drawer-body").scrollTop = 0;
      return;
    }
    var sl = t.closest("[data-slot]");
    if (sl && !sl.disabled) {
      moveTime = sl.getAttribute("data-slot");
      drawer.querySelectorAll("[data-slot]").forEach(function (x) { x.setAttribute("aria-pressed", x === sl); });
      var c1 = drawer.querySelector('[data-f="move-custom"], [name="custom"]');
      if (c1) c1.value = "";
      return;
    }
    var am = t.closest("[data-amount]");
    if (am) { drawer.querySelector('[data-f="amount"]').value = am.getAttribute("data-amount"); return; }
    var a = t.closest("[data-act]");
    if (a) return act(a.getAttribute("data-act"), a);
  });

  drawer.addEventListener("input", function (e) {
    var n = e.target;
    if (n.matches('[data-f="move-date"]')) { moveTime = null; var b = find(openId); if (b) paintMoveSlots(b); }
    if (n.matches('[data-f="move-custom"], [name="custom"]') && n.value) { moveTime = null; drawer.querySelectorAll("[data-slot]").forEach(function (x) { x.setAttribute("aria-pressed", "false"); }); }
    var f = el("new-form");
    if (f && f.contains(n)) {
      if (n.name === "date") { moveTime = null; paintNewSlots(); }
      if (n.name === "packageId" || n.name === "firstShoot") {
        var p = (data.packages || []).filter(function (x) { return x.id === f.elements.packageId.value; })[0];
        if (p) f.elements.amount.value = f.elements.firstShoot.checked ? p.firstPrice : p.price;
      }
      syncNew();
    }
  });
  drawer.addEventListener("change", function (e) { if (el("new-form") && el("new-form").contains(e.target)) syncNew(); });
  drawer.addEventListener("keydown", function (e) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      if (e.target.matches('[data-f="note"]')) { e.preventDefault(); act("note", drawer.querySelector('[data-act="note"]')); }
      else if (el("new-form")) { e.preventDefault(); create(drawer.querySelector('[data-act="create"]')); }
    }
  });
  drawer.addEventListener("submit", function (e) { e.preventDefault(); });

  el("search").addEventListener("input", function (e) {
    q = e.target.value.trim().toLowerCase();
    paintFilters(); paintBody();
  });
  el("refresh-btn").addEventListener("click", function () { avail = null; fetchAll().then(function () { A.toast("Up to date."); }, function (e) { A.toast(e.message, "error"); }); });
  el("export-btn").addEventListener("click", exportCsv);
  el("add-btn").addEventListener("click", function () { openDrawer("new"); });
  el("week-prev").addEventListener("click", function () { weekStart = A.addDays(weekStart, -7); paintWeek(); });
  el("week-next").addEventListener("click", function () { weekStart = A.addDays(weekStart, 7); paintWeek(); });
  el("week-today").addEventListener("click", function () { weekStart = sundayOf(data.today); paintWeek(); });

  document.addEventListener("keydown", function (e) {
    if (document.querySelector(".adm-modal")) return;
    var typing = /input|textarea|select/i.test(e.target.tagName);
    if (e.key === "Escape" && openId) { e.preventDefault(); return closeDrawer(); }
    if (typing || e.metaKey || e.ctrlKey || e.altKey || !data) return;
    if (e.key === "/") { e.preventDefault(); if (ui.view === "week") { ui.view = "list"; save(); paintFilters(); paintBody(); } el("search").focus(); }
    if (e.key === "n" && !openId) { e.preventDefault(); openDrawer("new"); }
  });

  // Keep the page true while it sits open on a laptop all day, without
  // redrawing a drawer somebody is typing in.
  setInterval(function () {
    if (!data) return;
    paintUpdated();
    if (document.visibilityState === "visible" && Date.now() - loadedAt > 60000 && !panel && openId !== "new") fetchAll(true).catch(function () {});
  }, 20000);
  document.addEventListener("visibilitychange", function () {
    if (data && document.visibilityState === "visible" && Date.now() - loadedAt > 60000 && !panel && openId !== "new") fetchAll(true).catch(function () {});
  });

  A.boot("bookings", function (s) {
    if (!s.bookings) {
      el("list").innerHTML = '<div class="adm-empty"><b>No database connected</b>Online booking is off, so there is nothing to list. Set DATABASE_URL on the ez-shots service in Railway.</div>';
      return;
    }
    return fetchAll().then(function () {
      var id = (location.hash || "").slice(1);
      if (/^EZ-\d{6}$/.test(id) && find(id)) openDrawer(id);
    });
  });
})();
