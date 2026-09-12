// admin-bookings.html: the owner's day.
//
// One GET brings back every booking from two months ago to the end of the
// booking window, with a state worked out on the server (confirmed, held,
// expired, cancelled), how much is left to refund, and the six numbers for the
// top. This file sorts them into Needs attention, Today, Upcoming and Past,
// draws a card each, and PATCHes what the owner can do to one: mark it paid,
// refund some or all of it, cancel it, or leave a private note. Signing in lives
// in js/admin-core.js.
//
// A refund moves real money back to a card, so it asks twice: a panel to pick
// the amount, then a confirm dialog. Opening the panel mints a request id that
// goes with the refund, so a second press of the same refund is recognised by
// the server and by Stripe and refunds nothing more.
(function () {
  var A = window.EZAdmin;
  var el = A.el, esc = A.esc, status = A.status, api = A.api, money = A.money;
  if (!el("admin-boot")) return;

  var data = null;       // the last /api/admin/bookings reply
  var open = {};         // booking id -> details panel open
  var refundOpen = {};   // booking id -> refund panel open
  var refundKey = {};    // booking id -> request id for the refund being made
  var session = null;

  var LABEL = { confirmed: "Paid", held: "Awaiting payment", expired: "Expired, unpaid", cancelled: "Cancelled" };

  var DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function nb(s) { return String(s).replace(/ (AM|PM)\b/g, "\u00a0$1"); }
  // "Mon, Sep 14", short enough to share a line with the status pill.
  function shortDay(key) {
    var p = String(key).split("-");
    var d = new Date(+p[0], +p[1] - 1, +p[2]);
    return DAYS[d.getDay()] + ", " + MONTHS[d.getMonth()] + "\u00a0" + d.getDate();
  }
  function tel(s) { return "tel:" + String(s || "").replace(/[^\d+]/g, ""); }
  function sms(s) { return "sms:" + String(s || "").replace(/[^\d+]/g, ""); }
  function maps(a) { return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(a || ""); }
  function short(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }
  // Money that can have cents, for refunds. money() is whole dollars.
  function cash(n) { n = Math.round(Number(n || 0) * 100) / 100; return "$" + (n % 1 ? n.toFixed(2) : String(n)); }
  function newKey() { return Math.random().toString(36).slice(2, 12) + Date.now().toString(36); }
  function find(id) {
    for (var i = 0; data && i < data.bookings.length; i++) if (data.bookings[i].id === id) return data.bookings[i];
    return null;
  }
  function label(b) {
    if (b.refundedCents) return (LABEL[b.state] || b.state) + ", refunded " + cash(b.refundedCents / 100);
    return LABEL[b.state] || b.state;
  }

  // ----------------------------------------------------------------
  function paintStats() {
    var s = data.stats;
    var tiles = [
      ["Today", s.today + (s.today === 1 ? " shoot" : " shoots")],
      ["This week", s.week + (s.week === 1 ? " shoot" : " shoots")],
      ["This month", s.month + (s.month === 1 ? " shoot" : " shoots")],
      ["Revenue this month", money(s.revenue)],
      ["Average ticket", money(s.ticket)],
      ["Repeat clients", String(s.repeat)]
    ];
    el("stats").innerHTML = tiles.map(function (t) {
      return '<div class="stat"><span>' + esc(t[0]) + "</span><b>" + esc(t[1]) + "</b></div>";
    }).join("");
    var mode = el("admin-mode");
    mode.textContent = data.stripe ? "Stripe confirms payment" : "Payment links: mark bookings paid here";
    mode.classList.toggle("warn", !data.stripe);
  }

  function row(label, value, cls) {
    if (!value) return "";
    return '<div class="bk-row' + (cls ? " " + cls : "") + '"><span>' + esc(label) + "</span><b>" + esc(value) + "</b></div>";
  }

  function card(b, withDay) {
    var isOpen = !!open[b.id] || !!refundOpen[b.id];
    var price = money(b.amount) + (b.firstShoot ? " (first shoot)" : "");
    var line = [b.name, b.packageName, price].filter(Boolean).join("  |  ");
    var head = withDay ? shortDay(b.date) + ", " + nb(b.time) : nb(b.time);
    var canRefund = b.paid && b.refundable > 0;

    var actions = "";
    if (b.state !== "cancelled" && b.state !== "confirmed") actions += '<button type="button" class="btn btn-sm" data-act="confirm">Mark paid</button>';
    if (canRefund) actions += '<button type="button" class="btn btn-sm btn-ghost" data-act="refund-open">Refund</button>';
    if (b.state !== "cancelled") actions += '<button type="button" class="btn btn-sm btn-ghost" data-act="cancel">Cancel booking</button>';

    var refund = "";
    if (refundOpen[b.id] && canRefund) {
      refund = '<div class="bk-refund">' +
        '<label class="a-field"><span>Amount to refund, up to ' + esc(cash(b.refundable)) + "</span>" +
          '<input type="number" inputmode="decimal" min="0.01" step="0.01" max="' + esc(b.refundable) + '" value="' + esc(b.refundable) + '" data-f="amount" /></label>' +
        (b.state !== "cancelled"
          ? '<label class="admin-toggle"><input type="checkbox" data-f="cancel" /> Also cancel the booking and open the time back up</label>'
          : "") +
        '<div class="bk-actions">' +
          '<button type="button" class="btn btn-sm btn-danger" data-act="refund-go">Refund</button>' +
          '<button type="button" class="btn btn-sm btn-ghost" data-act="refund-close">Never mind</button>' +
        "</div>" +
      "</div>";
    }

    return '<article class="bk bk-' + esc(b.state) + '" data-id="' + esc(b.id) + '">' +
      '<div class="bk-head"><b>' + esc(head) + '</b><span class="pill pill-' + esc(b.state) + '">' + esc(label(b)) + "</span></div>" +
      '<div class="bk-main"><b>' + esc(b.address) + "</b><span>" + esc(line) + "</span></div>" +
      '<div class="bk-links">' +
        '<a class="btn btn-sm btn-ghost" href="' + esc(maps(b.address)) + '" target="_blank" rel="noopener">Maps</a>' +
        '<a class="btn btn-sm btn-ghost" href="' + esc(tel(b.phone)) + '">Call</a>' +
        '<a class="btn btn-sm btn-ghost" href="' + esc(sms(b.phone)) + '">Text</a>' +
        '<a class="btn btn-sm btn-ghost" href="mailto:' + esc(b.email) + '">Email</a>' +
        '<button type="button" class="btn btn-sm btn-ghost" data-act="toggle" aria-expanded="' + isOpen + '">' + (isOpen ? "Less" : "Details") + "</button>" +
      "</div>" +
      '<div class="bk-detail"' + (isOpen ? "" : " hidden") + ">" +
        row("Booking", b.id) +
        row("When", b.when + " at " + b.time) +
        row("Package", b.packageName + ", " + price) +
        row("Access", b.access + (b.accessNotes ? ". " + b.accessNotes : "")) +
        row("Home", [b.size, b.occupancy].filter(Boolean).join(", ")) +
        row("Brokerage", b.brokerage) +
        row("Phone", b.phone) +
        row("Email", b.email) +
        row("Client notes", b.notes, "bk-notes") +
        row("Paid", b.paid ? short(b.paidAt) + (b.checkoutMode === "manual" ? ", marked by you" : "") : "") +
        row("Refunded", b.refundedCents ? cash(b.refundedCents / 100) + ", last on " + short(b.refundedAt) : "") +
        row("Stripe session", b.stripeSessionId) +
        row("Hold ends", b.state === "held" ? short(b.expiresAt) : "") +
        row("Cancelled", b.state === "cancelled" ? short(b.cancelledAt) + " by the " + (b.cancelledBy || "owner") : "") +
        '<label class="a-field bk-internal"><span>Private note, never shown to the client</span>' +
          '<textarea rows="2" data-f="note">' + esc(b.internalNotes || "") + "</textarea></label>" +
        '<div class="bk-actions">' + actions +
          '<button type="button" class="btn btn-sm btn-ghost" data-act="note">Save note</button>' +
        "</div>" +
        refund +
      "</div>" +
    "</article>";
  }

  function paintList(id, list, empty, withDay) {
    var wrap = el(id);
    if (!list.length) { wrap.innerHTML = '<p class="form-help">' + empty + "</p>"; return; }
    var html = "";
    var lastDay = null;
    list.forEach(function (b) {
      if (withDay === "group" && b.date !== lastDay) {
        html += '<h3 class="bk-day">' + esc(b.when) + "</h3>";
        lastDay = b.date;
      }
      html += card(b, withDay === true);
    });
    wrap.innerHTML = html;
  }

  function matches(b, q) {
    if (!q) return true;
    return [b.address, b.name, b.email, b.phone, b.id, b.brokerage].join(" ").toLowerCase().indexOf(q) !== -1;
  }

  function paintAll() {
    paintStats();
    var today = data.today;
    var q = (el("search").value || "").trim().toLowerCase();
    var live = data.bookings.filter(function (b) { return b.state === "confirmed" || b.state === "held"; });

    var attention = data.bookings.filter(function (b) {
      return b.date >= today && (b.state === "held" || b.state === "expired");
    });
    el("attention-block").hidden = !attention.length;
    el("attention-sub").textContent = attention.length + " booked without a payment confirmed. " +
      (data.stripe ? "Stripe confirms these on its own; one still here after an hour did not pay."
        : "Check Stripe for the payment, then mark it paid, or it lapses on its own.");
    paintList("attention", attention, "", true);

    var todays = live.filter(function (b) { return b.date === today; });
    el("today-sub").textContent = todays.length ? todays.length + (todays.length === 1 ? " shoot" : " shoots") : "";
    paintList("today", todays, "You are clear today.", false);

    var upcoming = live.filter(function (b) { return b.date > today && matches(b, q); });
    el("upcoming-sub").textContent = upcoming.length + " booked" + (q ? " matching" : "");
    paintList("upcoming", upcoming, q ? "Nothing matches." : "Nothing booked yet past today.", "group");

    var past = data.bookings.filter(function (b) {
      return (b.date < today || b.state === "cancelled" || (b.state === "expired" && b.date < today)) && matches(b, q);
    }).reverse();
    el("past-sub").textContent = " " + past.length;
    paintList("past", past, "Nothing yet.", true);
  }

  function load() {
    return api("/api/admin/bookings").then(function (d) {
      data = d;
      paintAll();
    });
  }

  // One click handler for every card, since cards are redrawn on every change.
  document.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-act]");
    if (!btn) return;
    var art = btn.closest(".bk");
    if (!art) return;
    var id = art.getAttribute("data-id");
    var act = btn.getAttribute("data-act");
    var b = find(id);
    if (act === "toggle") {
      open[id] = !(open[id] || refundOpen[id]);
      if (!open[id]) refundOpen[id] = false;
      paintAll();
      return;
    }
    if (act === "refund-open" || act === "refund-close") {
      refundOpen[id] = act === "refund-open";
      if (refundOpen[id]) refundKey[id] = newKey();
      open[id] = true;
      paintAll();
      return;
    }

    var s = el("list-status");
    var body = { action: act };
    var amount = 0;
    if (act === "note") body.note = art.querySelector('[data-f="note"]').value;
    if (act === "cancel" && !window.confirm("Cancel " + id + " without refunding? The slot opens up again straight away.\n\nTo give money back, use Refund instead.")) return;
    if (act === "refund-go") {
      amount = Number(art.querySelector('[data-f="amount"]').value);
      var box = art.querySelector('[data-f="cancel"]');
      var cancel = !!(box && box.checked);
      if (!(amount > 0)) { status(s, "error", "Enter an amount to refund."); return; }
      if (b && amount > b.refundable + 0.001) { status(s, "error", "The most you can refund on this booking is " + cash(b.refundable) + "."); return; }
      if (!window.confirm("Refund " + cash(amount) + (b ? " to " + b.name : "") + "?\n\nIt goes back to their card and cannot be undone." + (cancel ? "\nThe booking will also be cancelled." : ""))) return;
      act = "refund";
      body = { action: "refund", amount: amount, cancel: cancel, confirm: true, requestId: refundKey[id] || newKey() };
    }

    btn.disabled = true;
    status(s, "pending", act === "refund" ? "Refunding..." : "Saving...");
    api("/api/admin/bookings/" + encodeURIComponent(id), { method: "PATCH", body: JSON.stringify(body) })
      .then(function (d) {
        if (act === "refund") { refundOpen[id] = false; delete refundKey[id]; }
        status(s, "success", act === "refund"
          ? (d.duplicate ? "That refund had already gone through. Nothing more was refunded." : "Refunded " + cash(amount) + ". The client has been emailed.")
          : act === "note" ? "Note saved." : "Done.");
        return load();
      })
      .catch(function (err) {
        // Stripe said no, so that request is finished: the next try is a new
        // refund. A dropped connection keeps the id, because the refund may
        // have gone through and a retry must not make a second one.
        if (act === "refund" && !(err instanceof TypeError)) refundKey[id] = newKey();
        status(s, "error", err.message);
        btn.disabled = false;
      });
  });

  el("search").addEventListener("input", function () { if (data) paintAll(); });
  el("refresh-btn").addEventListener("click", function () { load(); });

  A.boot(function (s) {
    session = s;
    if (!s.bookings) {
      el("stats").innerHTML = "";
      el("today").innerHTML = '<p class="form-help">There is no database connected, so online booking is off and there is nothing to list. Set DATABASE_URL on the ez-shots service in Railway.</p>';
      return;
    }
    return load();
  });
})();
