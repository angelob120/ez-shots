// EZ Shots booking flow (book.html).
//
// Three screens, one <form class="lead-form">, so the whole booking reaches the
// inbox through the single handler in js/contact-form.js like every other form
// on the site. This file only does what that handler cannot: render the
// packages from config, move between screens, paint the calendar the server
// sends, keep the summary bar in step, and take the slot on the server before
// the email goes out.
//
// PRICES ARE NOT IN THIS FILE and NEITHER IS THE CALENDAR. Prices come from
// js/config.js. Which days and times are open comes from GET /api/availability,
// which is worked out on the server from the schedule, the notice window, the
// bookings already taken, the daily cap and the look busy setting. This file
// never decides that a slot is free. It draws what it is told.
//
// THE SLOT IS TAKEN AT SUBMIT, NOT AT PICK. Tapping a time only selects it.
// When "Book my shoot" is pressed, contact-form.js runs the beforeSend hook
// below, which POSTs the whole booking to /api/book. The server checks the
// slot again inside a database transaction and either holds it, in which case
// the email goes out and the browser follows the checkout link it was given,
// or says "That time was just booked", in which case the calendar is refreshed
// and the customer is back on the day and time screen.
(function () {
  var form = document.querySelector("form.booking");
  if (!form) return;

  var MONTHS = ["January", "February", "March", "April", "May", "June", "July",
    "August", "September", "October", "November", "December"];
  var DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var HOLD_KEY = "ez-hold";

  function el(sel, root) { return (root || document).querySelector(sel); }
  function all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function pad(n) { return n < 10 ? "0" + n : "" + n; }
  function keyOf(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function dateOf(key) { var p = key.split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function money(n) { return "$" + n; }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  // "Monday, September 14 at 9:00 AM" was wrapping with the AM alone on the next
  // line. Only the displayed copy gets the hard space, never the stored value,
  // which has to stay a plain "9:00 AM" for the email and for slot matching.
  function nb(s) { return String(s).replace(/ (AM|PM)\b/g, "\u00a0$1"); }

  function longDate(key) {
    var d = dateOf(key);
    return DAYS[d.getDay()] + ", " + MONTHS[d.getMonth()] + " " + d.getDate();
  }
  function shortDate(key) {
    var d = dateOf(key);
    return DAYS[d.getDay()].slice(0, 3) + ", " + MONTHS[d.getMonth()].slice(0, 3) + " " + d.getDate();
  }

  // ------------------------------------------------------------------
  var state = { step: 1, pkg: null, first: true, day: null, slot: null };
  var AV = null;   // { today, to, days: { "YYYY-MM-DD": ["8:00 AM", ...] } }

  var steps = all(".book-step", form);
  var crumbs = all(".book-crumb");
  var pkgWrap = el("#package-options", form);
  var calWrap = el("#calendar", form);
  var nextWrap = el("#next-open", form);
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
  var fBooking = el("#booking", form);
  var summary = el("#book-summary", form);
  var submit = el('button[type="submit"]', form);

  function price() { return state.pkg ? (state.first ? state.pkg.firstPrice : state.pkg.price) : 0; }

  // ------------------------------------------------------------------
  // Packages
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

  // ------------------------------------------------------------------
  // Calendar. Whole weeks, from the week that holds today to the week that
  // holds the last day of the window, so four weeks out reads as a calendar
  // and not as a strip of buttons. Only open days are buttons: a day with
  // nothing open is a number with no button behind it, whether that is because
  // it is closed, full, blocked, or too soon.
  // ------------------------------------------------------------------
  function loadAvailability() {
    if (!window.fetch) return Promise.resolve(null);
    return fetch("/api/availability", { headers: { accept: "application/json" } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { AV = d && d.days ? d : null; return AV; })
      .catch(function () { AV = null; return null; });
  }

  function paintCalendar() {
    calWrap.innerHTML = "";
    nextWrap.innerHTML = "";
    if (!AV) {
      calWrap.innerHTML = '<p class="form-help">The calendar could not load. Refresh the page, or email ' +
        '<a href="mailto:bigmoneygelo2@gmail.com">bigmoneygelo2@gmail.com</a> and I will find you a time.</p>';
      return;
    }
    var keys = Object.keys(AV.days).sort();
    if (!keys.length) {
      calWrap.innerHTML = '<p class="form-help">Nothing is open in the next few weeks. Email ' +
        '<a href="mailto:bigmoneygelo2@gmail.com">bigmoneygelo2@gmail.com</a> and we will find a time.</p>';
      return;
    }

    var today = dateOf(AV.today);
    var last = dateOf(AV.to);
    var start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - today.getDay());
    var end = new Date(last.getFullYear(), last.getMonth(), last.getDate() + (6 - last.getDay()));

    var months = [];
    var head = '<div class="cal-head" aria-hidden="true">' + DAYS.map(function (d) { return "<span>" + d.slice(0, 3) + "</span>"; }).join("") + "</div>";
    var cells = "";
    for (var d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      var key = keyOf(d);
      var open = AV.days[key];
      var first = d.getDate() === 1 || +d === +start;
      var mon = MONTHS[d.getMonth()];
      if (months.indexOf(mon) === -1 && key >= AV.today) months.push(mon);
      var inner = "<b>" + d.getDate() + "</b>" + (first ? "<small>" + mon.slice(0, 3) + "</small>" : "");
      var cls = "cal-day" + (key === AV.today ? " today" : "") + (key < AV.today ? " past" : "");
      if (open) {
        cells += '<button type="button" class="' + cls + '" data-key="' + key + '" aria-label="' +
          esc(longDate(key)) + ", " + open.length + (open.length === 1 ? " time" : " times") + ' open">' + inner + "</button>";
      } else {
        cells += '<span class="' + cls + ' off" aria-hidden="true">' + inner + "</span>";
      }
    }
    calWrap.innerHTML = '<p class="cal-months">' + months.join(" and ") + "</p>" + head +
      '<div class="cal-grid" role="group" aria-label="Pick a day">' + cells + "</div>";

    all(".cal-day[data-key]", calWrap).forEach(function (b) {
      b.addEventListener("click", function () { pickDay(b.getAttribute("data-key")); });
    });

    // The one tap answer to "when is the soonest you can come".
    var soon = keys[0];
    nextWrap.innerHTML = '<button type="button" class="next-open">Next open: <b>' + esc(shortDate(soon)) +
      ", " + esc(nb(AV.days[soon][0])) + "</b></button>";
    el(".next-open", nextWrap).addEventListener("click", function () {
      pickDay(soon);
      pickTime(AV.days[soon][0]);
    });

    // Re-select what was picked, if it survived the refresh.
    if (state.day && AV.days[state.day]) {
      var slot = state.slot;
      pickDay(state.day);
      if (slot && AV.days[state.day].indexOf(slot) !== -1) pickTime(slot);
    } else if (state.day) {
      state.day = null;
      state.slot = null;
      fDate.value = "";
      fTime.value = "";
      timeBlock.hidden = true;
    }
  }

  function pickDay(key) {
    state.day = key;
    state.slot = null;
    fTime.value = "";
    fDate.value = longDate(key);
    all(".cal-day[data-key]", calWrap).forEach(function (b) {
      b.classList.toggle("on", b.getAttribute("data-key") === key);
      b.setAttribute("aria-pressed", b.getAttribute("data-key") === key ? "true" : "false");
    });
    timeWrap.innerHTML = "";
    (AV.days[key] || []).forEach(function (s) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "time-btn";
      b.textContent = s;
      b.addEventListener("click", function () { pickTime(s); });
      timeWrap.appendChild(b);
    });
    timeBlock.hidden = false;
    paintBar();
    clearError();
    if (timeBlock.getBoundingClientRect().bottom > window.innerHeight) {
      timeBlock.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }

  function pickTime(s) {
    state.slot = s;
    fTime.value = s;
    all(".time-btn", timeWrap).forEach(function (x) { x.classList.toggle("on", x.textContent === s); });
    paintBar();
    clearError();
  }

  // ------------------------------------------------------------------
  // Summary bar and the no surprises block
  // ------------------------------------------------------------------
  function paintBar() {
    var bits = [];
    if (state.pkg) bits.push(state.pkg.name);
    if (state.day) bits.push(longDate(state.day) + (state.slot ? " at " + nb(state.slot) : ""));
    var addr = (form.elements.namedItem("address").value || "").trim();
    if (addr) bits.push(addr);
    barLine.textContent = bits.join("  |  ") || "Pick a package to start";
    barPrice.textContent = state.pkg ? money(price()) : "";
    bar.classList.toggle("ready", !!state.pkg);

    fPrice.value = state.pkg ? money(price()) + (state.first ? " (first shoot, half price)" : "") : "";

    // Where the browser goes after the email is decided by the server at
    // submit time, once the slot is held. Until then there is nowhere to go.
    form.removeAttribute("data-redirect");

    if (submit && state.pkg) {
      submit.textContent = "Book my shoot, " + money(price());
      submit.setAttribute("data-label", submit.textContent);
    }
    paintSummary();
  }

  // The compact "no surprises" block on the last screen. It repeats the
  // discount as its own line rather than only showing the number that is
  // charged, because a price that quietly halved reads like a mistake.
  function paintSummary() {
    if (!summary || !state.pkg) return;
    var rows = [
      ["What", state.pkg.name],
      ["When", state.day ? longDate(state.day) + (state.slot ? " at " + nb(state.slot) : "") : "Not picked yet"],
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

  function showStep(n, keepScroll) {
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
    if (keepScroll) return;
    var head = el(".book-head");
    if (head && window.scrollY > head.offsetTop) window.scrollTo({ top: head.offsetTop - 70, behavior: "smooth" });
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
    if (!state.day) return fail("Pick a day for the shoot.");
    if (!state.slot) return fail("Pick a time.");
    return true;
  }

  // ------------------------------------------------------------------
  // Taking the slot. Runs from contact-form.js after its own validation and
  // before the email. The hold the server gives back is remembered for the
  // tab, so a retry after a failed email, or a back button from Stripe, asks
  // for the same hold rather than tripping over it.
  // ------------------------------------------------------------------
  function savedHold() {
    try { return JSON.parse(sessionStorage.getItem(HOLD_KEY) || "null"); } catch (e) { return null; }
  }
  function saveHold(h) {
    try { if (h) sessionStorage.setItem(HOLD_KEY, JSON.stringify(h)); else sessionStorage.removeItem(HOLD_KEY); } catch (e) {}
  }
  function val(name) { var f = form.elements.namedItem(name); return f && typeof f.value === "string" ? f.value.trim() : ""; }

  form.beforeSend = function () {
    if (!window.fetch) return Promise.reject(new Error("This browser cannot book online. Please email bigmoneygelo2@gmail.com."));
    if (!state.pkg || !state.day || !state.slot) return Promise.reject(new Error("Pick a package, a day and a time first."));
    var body = {
      packageId: state.pkg.id,
      firstShoot: state.first,
      date: state.day,
      time: state.slot,
      name: val("name"), email: val("email"), phone: val("phone"), brokerage: val("brokerage"),
      address: val("address"), size: checked("size"), occupancy: checked("occupancy"),
      access: checked("access"), accessNotes: val("accessnotes"), notes: val("message")
    };
    var prior = savedHold();
    if (prior && prior.id && prior.token) body.resume = { id: prior.id, token: prior.token };

    return fetch("/api/book", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body)
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (r.ok && d.url) {
          saveHold({ id: d.id, token: d.token });
          if (fBooking) fBooking.value = d.id;
          form.setAttribute("data-redirect", d.url);
          return d;
        }
        if (d.taken) {
          // Someone else got there first. Back to the calendar, redrawn from
          // the server so the slot that just went is not offered again.
          saveHold(null);
          state.slot = null;
          fTime.value = "";
          return loadAvailability().then(function () {
            paintCalendar();
            showStep(2, true);
            timeBlock.scrollIntoView({ behavior: "smooth", block: "center" });
            throw new Error(d.error || "That time was just booked. Pick another available time.");
          });
        }
        throw new Error(d.error || "Sorry, the booking did not go through. Try again in a minute, or email bigmoneygelo2@gmail.com.");
      });
    }, function () {
      throw new Error("Could not reach the server. Check your connection and try again.");
    });
  };

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
    paintPackages();
    loadAvailability().then(paintCalendar);

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
