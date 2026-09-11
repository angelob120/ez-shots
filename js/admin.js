// admin.html: the owner's settings screen.
//
// It edits one object, the same config the booking page reads, and PUTs the
// whole thing back. No partial updates, no field level API, because with one
// user and one config a last write wins is the right amount of machinery.
//
// The server validates everything again on the way in. Nothing here is a
// security control: a person who can reach /api/admin/config has already
// signed in, and a person who has not gets a 401 whatever this file does.
(function () {
  var boot = document.getElementById("admin-boot");
  var off = document.getElementById("admin-off");
  var login = document.getElementById("admin-login");
  var panel = document.getElementById("admin-panel");
  if (!boot) return;

  var DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var cfg = null;

  function el(id) { return document.getElementById(id); }
  function show(node) {
    [boot, off, login, panel].forEach(function (n) { n.hidden = n !== node; });
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function status(node, type, text) {
    node.className = "form-status show " + type;
    node.textContent = text;
  }
  function api(url, opts) {
    return fetch(url, Object.assign({ headers: { "content-type": "application/json" } }, opts))
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (d) {
          if (!r.ok) throw new Error(d.error || "Request failed (" + r.status + ")");
          return d;
        });
      });
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
        input.addEventListener("input", function () { readPackage(card, p); });
        input.addEventListener("change", function () { readPackage(card, p); });
      });
      card.querySelector("[data-remove]").addEventListener("click", function () {
        if (cfg.packages.length < 2) return alert("Keep at least one package.");
        cfg.packages.splice(i, 1);
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
    if (!p.id) p.id = slug(p.name);
    card.querySelector(".admin-card-head b").textContent = p.name || "Untitled package";
  }

  function slug(name) {
    var base = String(name || "package").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "package";
    var taken = cfg.packages.map(function (p) { return p.id; });
    var id = base, n = 2;
    while (taken.filter(function (x) { return x === id; }).length > 1) id = base + "-" + n++;
    return id;
  }

  // When the server holds a Stripe key it creates the charge itself and the
  // links stop being the thing that takes the money. Saying so here is the
  // difference between a stale link being harmless and it being a wrong charge.
  var serverStripe = false;
  function paintStripeNotes() {
    document.querySelectorAll(".admin-stripe-note").forEach(function (n) {
      n.textContent = serverStripe
        ? "Stripe is connected on the server, so the price above is what gets charged and these links are only the backup if Stripe is unreachable."
        : "No Stripe key on the server yet, so these links are what actually takes the money. The price above has to match what the link charges.";
      n.classList.toggle("warn", !serverStripe);
    });
  }

  // ----------------------------------------------------------------
  // Availability
  // ----------------------------------------------------------------
  function paintWeek() {
    var wrap = el("week-editor");
    wrap.innerHTML = "";
    for (var d = 0; d < 7; d++) {
      (function (d) {
        var times = (cfg.availability.week[String(d)] || []).join(", ");
        var row = document.createElement("div");
        row.className = "admin-day";
        row.innerHTML = '<span class="admin-day-name">' + DAYS[d] + "</span>" +
          '<input type="text" value="' + esc(times) + '" placeholder="Closed" aria-label="' + DAYS[d] + ' start times" />';
        var input = row.querySelector("input");
        input.addEventListener("input", function () {
          cfg.availability.week[String(d)] = parseTimes(input.value);
        });
        row.classList.toggle("off", !times);
        wrap.appendChild(row);
      })(d);
    }
  }

  function parseTimes(v) {
    return String(v).split(",").map(function (s) { return s.trim().toUpperCase().replace(/\s+/g, " "); })
      .filter(function (s) { return /^\d{1,2}:\d{2} (AM|PM)$/.test(s); });
  }

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
      x.addEventListener("click", function () { delete cfg.availability.blocked[k]; paintDates(); });
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
      x.addEventListener("click", function () { delete cfg.availability.overrides[k]; paintDates(); });
      row.appendChild(x);
      o.appendChild(row);
    });
  }

  // ----------------------------------------------------------------
  // Load and save
  // ----------------------------------------------------------------
  function paintAll() {
    paintPackages();
    paintWeek();
    paintDates();
    el("minNotice").value = cfg.availability.minNoticeHours;
    el("maxAdvance").value = cfg.availability.maxAdvanceDays;
    el("daysShown").value = cfg.availability.daysShown;
    el("admin-mode").textContent = serverStripe
      ? "Stripe connected, prices charged from this page"
      : "Stripe payment links, no API key yet";
    el("admin-mode").classList.toggle("warn", !serverStripe);
  }

  function loadConfig() {
    return api("/api/admin/config").then(function (d) {
      cfg = d;
      cfg.availability = cfg.availability || {};
      cfg.availability.week = cfg.availability.week || {};
      cfg.availability.blocked = cfg.availability.blocked || {};
      cfg.availability.overrides = cfg.availability.overrides || {};
      paintAll();
      show(panel);
    });
  }

  function save() {
    var s = el("save-status");
    cfg.availability.minNoticeHours = Number(el("minNotice").value);
    cfg.availability.maxAdvanceDays = Number(el("maxAdvance").value);
    cfg.availability.daysShown = Number(el("daysShown").value);
    status(s, "pending", "Saving...");
    api("/api/admin/config", { method: "PUT", body: JSON.stringify(cfg) }).then(function (d) {
      cfg = d.config;
      paintAll();
      status(s, "success", "Saved. The booking page is using these now.");
    }).catch(function (e) {
      status(s, "error", e.message);
    });
  }

  // ----------------------------------------------------------------
  el("login-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var s = el("login-status");
    status(s, "pending", "Checking...");
    api("/api/admin/login", { method: "POST", body: JSON.stringify({ password: el("admin-password").value }) })
      .then(function () {
        el("admin-password").value = "";
        return loadConfig();
      })
      .catch(function (err) { status(s, "error", err.message); });
  });

  el("logout-btn").addEventListener("click", function () {
    api("/api/admin/logout", { method: "POST" }).then(function () { show(login); });
  });

  el("save-btn").addEventListener("click", save);

  el("add-package").addEventListener("click", function () {
    cfg.packages.push({
      id: "", name: "New package", blurb: "", price: 0, firstPrice: 0,
      active: false, badge: "", bullets: [], checkoutFull: "", checkoutFirst: ""
    });
    cfg.packages[cfg.packages.length - 1].id = slug("new package");
    paintPackages();
  });

  el("add-block").addEventListener("click", function () {
    var d = el("block-date").value;
    if (!d) return;
    cfg.availability.blocked[d] = el("block-reason").value.trim() || "Not available";
    el("block-date").value = "";
    el("block-reason").value = "";
    paintDates();
  });

  el("add-override").addEventListener("click", function () {
    var d = el("ov-date").value;
    if (!d) return;
    cfg.availability.overrides[d] = parseTimes(el("ov-times").value);
    el("ov-date").value = "";
    el("ov-times").value = "";
    paintDates();
  });

  // Boot: ask the server whether admin exists at all, and whether this browser
  // is already signed in.
  fetch("/api/admin/session", { headers: { accept: "application/json" } })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) {
      if (!d || !d.enabled) return show(off);
      serverStripe = !!d.stripe;
      if (d.authed) return loadConfig();
      show(login);
    })
    .catch(function () { show(off); });
})();
