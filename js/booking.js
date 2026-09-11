// EZ Shots booking flow (book.html).
//
// Three screens, one <form class="lead-form">, so the whole booking reaches the
// inbox through the single handler in js/contact-form.js like every other form
// on the site. This file only does what that handler cannot: render the
// packages from config, move between screens, work out which days and times are
// offered, keep the summary bar in step, and point data-redirect at the right
// checkout before the button can be pressed.
//
// PRICES AND AVAILABILITY ARE NOT IN THIS FILE. They come from js/config.js,
// which the owner edits through admin.html. Nothing here hardcodes a number.
//
// WHAT THIS CANNOT DO
// A slot is not held. Without the booking table on the server, two agents can
// pick the same time and both get through, so the copy on the page says the
// exact time is confirmed by email rather than pretending the calendar is
// locked. Slot locking is phase 1 in docs/booking-roadmap.md.
(function () {
  var form = document.querySelector("form.booking");
  if (!form) return;

  var MONTHS = ["January", "February", "March", "April", "May", "June", "July",
    "August", "September", "October", "November", "December"];
  var DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  function el(sel, root) { return (root || document).querySelector(sel); }
  function all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function pad(n) { return n < 10 ? "0" + n : "" + n; }
  function keyOf(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function money(n) { return "$" + n; }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  // "1:00 PM" on a given day as a real local Date, so the notice window can be
  // compared against the clock rather than against a string.
  function slotTime(date, slot) {
    var m = String(slot).match(/^(\d+):(\d+)\s*(AM|PM)$/i);
    if (!m) return null;
    var h = parseInt(m[1], 10) % 12;
    if (/pm/i.test(m[3])) h += 12;
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), h, parseInt(m[2], 10), 0, 0);
  }

  function longDate(date) {
    return DAYS[date.getDay()] + ", " + MONTHS[date.getMonth()] + " " + date.getDate();
  }

  function dayLabel(date) {
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var diff = Math.round((date - today) / 86400000);
    var short = MONTHS[date.getMonth()].slice(0, 3) + " " + date.getDate();
    if (diff === 0) return { top: "Today", sub: short };
    if (diff === 1) return { top: "Tomorrow", sub: short };
    return { top: DAYS[date.getDay()].slice(0, 3), sub: short };
  }

  // ------------------------------------------------------------------
  var state = { step: 1, pkg: null, first: true, day: null, slot: null };
  var AV = null;

  var steps = all(".book-step", form);
  var crumbs = all(".book-crumb");
  var pkgWrap = el("#package-options", form);
  var dayWrap = el("#day-options", form);
  var timeWrap = el("#time-options", form);
  var timeBlock = el("#time-block", form);
  var bar = el(".book-bar", form);
  var barLine = el(".book-bar-line", form);
  var barPrice = el(".book-bar-price", form);
  var status = el(".form-status", form);
  var fPackage = el("#package", form);
  var fPrice = el("#packageprice", form);
  var fDate = el("#date", form);
  var fTime = el("#time", form);
  var summary = el("#book-summary", form);

  function price() { return state.pkg ? (state.first ? state.pkg.firstPrice : state.pkg.price) : 0; }
  function checkoutUrl() {
    if (!state.pkg) return "";
    return (state.first ? state.pkg.checkoutFirst : state.pkg.checkoutFull) || "";
  }

  // The one place that decides whether a time can be booked, in the order the
  // plan sets out: blocked date, then date override, then the weekday default,
  // then the notice window.
  function slotsFor(date) {
    var key = keyOf(date);
    if (AV.blocked && AV.blocked[key]) return [];
    var list = (AV.overrides && AV.overrides[key]) || (AV.week && AV.week[String(date.getDay())]) || [];
    var cutoff = new Date(Date.now() + (AV.minNoticeHours || 0) * 3600 * 1000);
    return list.filter(function (s) {
      var t = slotTime(date, s);
      return t && t > cutoff;
    });
  }

  function bookableDays() {
    var out = [];
    var now = new Date();
    var start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var max = AV.maxAdvanceDays || 45;
    var want = AV.daysShown || 10;
    for (var i = 0; i <= max && out.length < want; i++) {
      var day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      var slots = slotsFor(day);
      if (slots.length) out.push({ date: day, slots: slots });
    }
    return out;
  }

  // ------------------------------------------------------------------
  // Rendering
  // ------------------------------------------------------------------
  function paintPackages() {
    var list = EZ.config.packages.filter(function (p) { return p.active !== false; });
    pkgWrap.innerHTML = list.map(function (p) {
      var now = state.first ? p.firstPrice : p.price;
      return '<div class="pkg-pick" data-pkg="' + esc(p.id) + '" tabindex="0" role="button" aria-pressed="false">' +
        (p.badge ? '<span class="pkg-pick-badge">' + esc(p.badge) + "</span>" : "") +
        '<h3>' + esc(p.name) + "</h3>" +
        '<p class="pkg-pick-blurb">' + esc(p.blurb || "") + "</p>" +
        '<div class="pkg-pick-price"><span class="pkg-pick-now">' + money(now) + "</span>" +
          '<span class="pkg-pick-was"' + (state.first ? "" : " hidden") + ">" + money(p.price) + "</span></div>" +
        "<ul>" + (p.bullets || []).map(function (b) { return "<li>" + esc(b) + "</li>"; }).join("") + "</ul>" +
        '<span class="btn pkg-pick-btn">Choose ' + esc(p.name) + ", " + money(now) + "</span>" +
      "</div>";
    }).join("");

    all(".pkg-pick", pkgWrap).forEach(function (card) {
      function choose() { pickPackage(card.getAttribute("data-pkg")); }
      card.addEventListener("click", choose);
      card.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose(); }
      });
    });
  }

  function pickPackage(id, stay) {
    var p = EZ.packageById(id);
    if (!p) return;
    state.pkg = p;
    fPackage.value = p.name;
    all(".pkg-pick", pkgWrap).forEach(function (c) {
      var on = c.getAttribute("data-pkg") === id;
      c.classList.toggle("on", on);
      c.setAttribute("aria-pressed", on ? "true" : "false");
    });
    paintBar();
    if (!stay) showStep(2);
  }

  function paintDays() {
    var days = bookableDays();
    dayWrap.innerHTML = "";
    if (!days.length) {
      dayWrap.innerHTML = '<p class="form-help">Nothing is open in the next ' + (AV.maxAdvanceDays || 45) +
        ' days. Email <a href="mailto:bigmoneygelo2@gmail.com">bigmoneygelo2@gmail.com</a> and we will find a time.</p>';
      return;
    }
    days.forEach(function (d) {
      var lab = dayLabel(d.date);
      var b = document.createElement("button");
      b.type = "button";
      b.className = "day-btn";
      b.setAttribute("data-key", keyOf(d.date));
      b.innerHTML = "<b>" + lab.top + "</b><span>" + lab.sub + "</span>";
      b.addEventListener("click", function () { pickDay(d); });
      dayWrap.appendChild(b);
    });
  }

  function pickDay(d) {
    state.day = d;
    state.slot = null;
    fTime.value = "";
    fDate.value = longDate(d.date);
    all(".day-btn", dayWrap).forEach(function (b) {
      b.classList.toggle("on", b.getAttribute("data-key") === keyOf(d.date));
    });
    timeWrap.innerHTML = "";
    d.slots.forEach(function (s) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "time-btn";
      b.textContent = s;
      b.addEventListener("click", function () {
        state.slot = s;
        fTime.value = s;
        all(".time-btn", timeWrap).forEach(function (x) { x.classList.toggle("on", x === b); });
        paintBar();
        clearError();
      });
      timeWrap.appendChild(b);
    });
    timeBlock.hidden = false;
    paintBar();
    clearError();
  }

  function paintBar() {
    var bits = [];
    if (state.pkg) bits.push(state.pkg.name);
    if (state.day) bits.push(longDate(state.day.date) + (state.slot ? " at " + state.slot : ""));
    var addr = (form.elements.namedItem("address").value || "").trim();
    if (addr) bits.push(addr);
    barLine.textContent = bits.join("  |  ") || "Pick a package to start";
    barPrice.textContent = state.pkg ? money(price()) : "";
    bar.classList.toggle("ready", !!state.pkg);

    fPrice.value = state.pkg ? money(price()) + (state.first ? " (first shoot, half price)" : "") : "";

    // contact-form.js redirects here once the email is away, so the link has to
    // be correct before the button can be pressed.
    var url = checkoutUrl();
    if (url) form.setAttribute("data-redirect", url);
    else form.removeAttribute("data-redirect");

    var submit = el('button[type="submit"]', form);
    if (submit && state.pkg) submit.textContent = "Book my shoot, " + money(price());

    paintSummary();
  }

  // The compact "no surprises" block on the last screen. It repeats the
  // discount as its own line rather than only showing the number that is
  // charged, because a price that quietly halved reads like a mistake.
  function paintSummary() {
    if (!summary || !state.pkg) return;
    var rows = [
      ["What", state.pkg.name],
      ["When", state.day ? longDate(state.day.date) + (state.slot ? " at " + state.slot : "") : "Not picked yet"],
      ["Where", (form.elements.namedItem("address").value || "").trim() || "Not entered yet"]
    ];
    var lines = rows.map(function (r) {
      return '<div class="sum-row"><span>' + r[0] + "</span><b>" + esc(r[1]) + "</b></div>";
    });
    if (state.first) {
      lines.push('<div class="sum-row"><span>' + esc(state.pkg.name) + "</span><b>" + money(state.pkg.price) + "</b></div>");
      lines.push('<div class="sum-row"><span>First shoot, 50% off</span><b>-' + money(state.pkg.price - state.pkg.firstPrice) + "</b></div>");
    }
    lines.push('<div class="sum-row sum-total"><span>Total today</span><b>' + money(price()) + "</b></div>");
    summary.innerHTML = lines.join("");
  }

  function showStep(n) {
    state.step = n;
    steps.forEach(function (s) { s.hidden = parseInt(s.getAttribute("data-step"), 10) !== n; });
    crumbs.forEach(function (c, i) {
      c.classList.toggle("on", i + 1 === n);
      c.classList.toggle("done", i + 1 < n);
    });
    all("[data-bar-step]", bar).forEach(function (b) {
      b.hidden = parseInt(b.getAttribute("data-bar-step"), 10) !== n;
    });
    clearError();
    if (n === 3) requestCheckout();
    var head = el(".book-head");
    if (head && window.scrollY > head.offsetTop) window.scrollTo({ top: head.offsetTop - 70, behavior: "smooth" });
  }

  // If a Stripe secret key is set on the server, the server is what decides
  // what this shoot costs: it reads the package price out of its own config and
  // creates the Checkout Session. The payment link already sitting in
  // data-redirect is the fallback, so a slow or failed request costs nothing.
  var checkoutAsked = false;
  function requestCheckout() {
    if (checkoutAsked || !state.pkg || !EZ.config.serverCheckout || !window.fetch) return;
    checkoutAsked = true;
    fetch("/api/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        packageId: state.pkg.id,
        firstShoot: state.first,
        address: (form.elements.namedItem("address").value || "").trim(),
        date: fDate.value,
        time: fTime.value
      })
    })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (d && d.url) form.setAttribute("data-redirect", d.url); })
      .catch(function () { checkoutAsked = false; });
  }

  function clearError() {
    if (status && status.classList.contains("error")) status.className = "form-status";
  }

  function fail(msg, focusSel) {
    if (status) {
      status.className = "form-status show error";
      status.textContent = msg;
    }
    var f = focusSel && el(focusSel, form);
    if (f && f.focus) f.focus();
    return false;
  }

  function checked(name) {
    var g = form.elements.namedItem(name);
    return g && typeof g.value === "string" ? g.value : "";
  }

  function validateStep2() {
    if ((form.elements.namedItem("address").value || "").trim().length < 6) {
      return fail("Please enter the property address.", "#address");
    }
    if (!checked("size")) return fail("Roughly how big is the home?");
    if (!checked("occupancy")) return fail("Let me know if anyone is living in the home.");
    if (!checked("access")) return fail("Let me know how I get inside.");
    if (!fDate.value) return fail("Pick a day for the shoot.");
    if (!fTime.value) return fail("Pick a time.");
    return true;
  }

  // ------------------------------------------------------------------
  // Wiring that does not depend on config
  // ------------------------------------------------------------------
  all('input[name="firstshoot"]', form).forEach(function (r) {
    r.addEventListener("change", function () {
      // Read the flag, not the wording. The value is copy that ends up in the
      // email and it should be free to change without silently flipping the
      // price this page charges.
      state.first = r.getAttribute("data-first") === "yes";
      var keep = state.pkg && state.pkg.id;
      paintPackages();
      if (keep) pickPackage(keep, true);
      paintBar();
    });
  });

  // The access notes field only appears once it has something to say.
  var accessNotes = el("#access-notes-field", form);
  all('input[name="access"]', form).forEach(function (r) {
    r.addEventListener("change", function () {
      accessNotes.hidden = !/lockbox|code|other/i.test(r.value);
      clearError();
    });
  });

  form.elements.namedItem("address").addEventListener("input", paintBar);

  all("[data-next]", form).forEach(function (b) {
    b.addEventListener("click", function () {
      var to = parseInt(b.getAttribute("data-next"), 10);
      if (to === 2 && !state.pkg) return fail("Pick a package first.");
      if (to === 3 && !validateStep2()) return;
      showStep(to);
    });
  });
  all("[data-back]", form).forEach(function (b) {
    b.addEventListener("click", function () { showStep(parseInt(b.getAttribute("data-back"), 10)); });
  });

  // ------------------------------------------------------------------
  EZ.ready(function (cfg) {
    if (EZ.failed || !cfg.packages.length) {
      pkgWrap.innerHTML = '<p class="form-help">Packages could not load. Refresh the page, or email ' +
        '<a href="mailto:bigmoneygelo2@gmail.com">bigmoneygelo2@gmail.com</a> and I will book you in directly.</p>';
      return;
    }
    AV = cfg.availability;
    paintPackages();
    paintDays();

    // A package in the URL (?package=pro) comes from the pricing page, so
    // someone who already chose lands on the property screen, not on the
    // same question a second time.
    var want = (new URLSearchParams(location.search).get("package") || "").toLowerCase();
    if (want) {
      var match = cfg.packages.filter(function (p) {
        return p.id === want || p.name.toLowerCase().indexOf(want) !== -1;
      })[0];
      if (match) pickPackage(match.id);
    }
    paintBar();
    form.classList.add("ready");
  });

  showStep(1);
})();
