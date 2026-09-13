// What every admin page shares: the top bar, the sign in, the JSON helper, the
// toasts, the confirm dialog, icons and the little formatters. admin.js and
// admin-bookings.js call EZAdmin.boot() and get told when the owner is in.
//
// Nothing here is a security control. A person who can reach /api/admin/* has
// signed in on the server, and a person who has not gets a 401 whatever this
// file does. When a session runs out mid use, the next request's 401 brings
// the sign in back instead of leaving buttons that silently fail.
(function () {
  var A = window.EZAdmin = {};

  A.el = function (id) { return document.getElementById(id); };

  A.esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };

  // ----------------------------------------------------------------
  // Icons. Stroke SVG, one set, so every button looks like it belongs.
  // ----------------------------------------------------------------
  var P = {
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>',
    phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>',
    message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    map: '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    chev: '<path d="m9 6 6 6-6 6"/>',
    left: '<path d="m15 6-6 6 6 6"/>',
    calendar: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
    external: '<path d="M14 3h7v7M10 14 21 3M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
    up: '<path d="m18 15-6-6-6 6"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>',
    dup: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M4 16V4h12"/>',
    moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
    sun: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'
  };
  A.icon = function (name, cls) {
    return '<svg class="' + (cls || "") + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (P[name] || "") + "</svg>";
  };

  // ----------------------------------------------------------------
  // Formatting
  // ----------------------------------------------------------------
  var DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var DAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  A.DAYS = DAYS; A.DAYS_LONG = DAYS_LONG; A.MONTHS = MONTHS;

  // Whole dollars when whole, cents when not. $1,250 and $62.50.
  A.money = function (n) {
    n = Math.round(Number(n || 0) * 100) / 100;
    return (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
  };
  A.pad = function (n) { return n < 10 ? "0" + n : String(n); };
  A.keyOf = function (d) { return d.getFullYear() + "-" + A.pad(d.getMonth() + 1) + "-" + A.pad(d.getDate()); };
  A.dateOf = function (key) { var p = String(key).split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); };
  A.addDays = function (key, n) { var d = A.dateOf(key); d.setDate(d.getDate() + n); return A.keyOf(d); };
  A.shortDay = function (key) { var d = A.dateOf(key); return DAYS[d.getDay()] + ", " + MONTHS[d.getMonth()] + " " + d.getDate(); };
  A.longDay = function (key) { var d = A.dateOf(key); return DAYS_LONG[d.getDay()] + ", " + MONTHS[d.getMonth()] + " " + d.getDate(); };
  A.stamp = function (iso) {
    if (!iso) return "";
    return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  };
  A.ago = function (ms) {
    var s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (s < 45) return "just now";
    if (s < 3600) return Math.round(s / 60) + " min ago";
    return Math.round(s / 3600) + " hr ago";
  };
  // "in 3 hr", "in 2 days", "now"
  A.until = function (ms) {
    var m = Math.round((ms - Date.now()) / 60000);
    if (m <= 0) return "now";
    if (m < 60) return "in " + m + " min";
    if (m < 60 * 24) return "in " + Math.round(m / 60) + " hr";
    var d = Math.round(m / 1440);
    return "in " + d + (d === 1 ? " day" : " days");
  };
  A.minutesOf = function (s) {
    var m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(String(s || "").trim());
    if (!m) return null;
    return (parseInt(m[1], 10) % 12 + (/pm/i.test(m[3]) ? 12 : 0)) * 60 + parseInt(m[2], 10);
  };
  A.labelOf = function (mins) {
    var h = Math.floor(mins / 60) % 24, m = mins % 60;
    return (h % 12 || 12) + ":" + A.pad(m) + " " + (h < 12 ? "AM" : "PM");
  };
  A.digits = function (s) { return String(s || "").replace(/[^\d+]/g, ""); };

  // ----------------------------------------------------------------
  // Requests
  // ----------------------------------------------------------------
  A.api = function (url, opts) {
    return fetch(url, Object.assign({ headers: { "content-type": "application/json", accept: "application/json" } }, opts))
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (d) {
          if (r.status === 401 && url.indexOf("/api/admin/login") === -1) {
            if (A._gate) A._gate("Your session ran out. Sign in again.");
            throw new Error("Sign in again.");
          }
          if (!r.ok) throw new Error(d.error || "Request failed (" + r.status + ")");
          return d;
        });
      });
  };

  // ----------------------------------------------------------------
  // Toasts and the confirm dialog. A message appears where the eye already
  // is, not in a status line at the bottom of a long page.
  // ----------------------------------------------------------------
  A.toast = function (text, type) {
    var box = A.el("adm-toasts");
    if (!box) {
      box = document.createElement("div");
      box.id = "adm-toasts";
      box.className = "adm-toasts";
      box.setAttribute("role", "status");
      box.setAttribute("aria-live", "polite");
      document.body.appendChild(box);
    }
    var t = document.createElement("div");
    t.className = "adm-toast " + (type || "success");
    t.innerHTML = "<i></i><span>" + A.esc(text) + "</span>";
    box.appendChild(t);
    var ms = type === "error" ? 7000 : type === "pending" ? 20000 : 3500;
    var timer = setTimeout(function () { t.remove(); }, ms);
    t.addEventListener("click", function () { clearTimeout(timer); t.remove(); });
    return { done: function () { clearTimeout(timer); t.remove(); } };
  };

  // confirm({ title, body, ok, danger }) resolves true or false. Escape and
  // the scrim say no; Enter on the focused button says yes.
  A.confirm = function (o) {
    return new Promise(function (resolve) {
      var last = document.activeElement;
      var scrim = document.createElement("div");
      scrim.className = "adm-scrim modal";
      var m = document.createElement("div");
      m.className = "adm-modal";
      m.setAttribute("role", "alertdialog");
      m.setAttribute("aria-modal", "true");
      m.setAttribute("aria-labelledby", "adm-modal-title");
      m.innerHTML = '<h2 id="adm-modal-title">' + A.esc(o.title) + "</h2>" +
        (o.body ? "<p>" + A.esc(o.body) + "</p>" : "") +
        '<div class="adm-modal-actions">' +
          '<button type="button" class="adm-btn" data-no>' + A.esc(o.cancel || "Cancel") + "</button>" +
          '<button type="button" class="adm-btn ' + (o.danger ? "adm-btn-danger" : "adm-btn-primary") + '" data-yes>' + A.esc(o.ok || "OK") + "</button>" +
        "</div>";
      document.body.appendChild(scrim);
      document.body.appendChild(m);
      requestAnimationFrame(function () { scrim.classList.add("show"); m.classList.add("show"); });
      var yes = m.querySelector("[data-yes]");
      (o.danger ? m.querySelector("[data-no]") : yes).focus();
      function close(v) {
        document.removeEventListener("keydown", key, true);
        scrim.remove(); m.remove();
        if (last && last.focus) last.focus();
        resolve(v);
      }
      function key(e) {
        if (e.key === "Escape") { e.stopPropagation(); close(false); }
        if (e.key === "Tab") {
          var f = m.querySelectorAll("button");
          if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
          else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
        }
      }
      document.addEventListener("keydown", key, true);
      scrim.addEventListener("click", function () { close(false); });
      m.querySelector("[data-no]").addEventListener("click", function () { close(false); });
      yes.addEventListener("click", function () { close(true); });
    });
  };

  A.copy = function (text, what) {
    function ok() { A.toast((what || "Text") + " copied."); }
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(ok, function () { A.toast("Could not copy.", "error"); });
      return;
    }
    var ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); ok(); } catch (e) { A.toast("Could not copy.", "error"); }
    ta.remove();
  };

  // ----------------------------------------------------------------
  // The top bar
  // ----------------------------------------------------------------
  function theme() { return document.documentElement.getAttribute("data-theme") || "light"; }

  A.shell = function (page) {
    var top = A.el("adm-top");
    if (!top) return;
    var tab = function (href, label, key, extra) {
      return '<a href="' + href + '"' + (page === key ? ' aria-current="page"' : "") + ">" + label + (extra || "") + "</a>";
    };
    top.outerHTML =
      '<header class="adm-top"><div class="adm-wrap">' +
        '<a href="/admin" class="brand" aria-label="EZ Shots admin home">' + (window.EZ_MARK || "") + 'EZ <span>Shots</span></a>' +
        '<span class="adm-top-tag">Admin</span>' +
        '<nav class="adm-tabs" aria-label="Admin">' +
          tab("admin-bookings.html", "Bookings", "bookings", '<span class="adm-count" id="adm-tab-count" hidden></span>') +
          tab("admin.html", "Settings", "settings") +
        "</nav>" +
        '<div class="adm-top-tools">' +
          '<a class="adm-health" id="adm-health" href="admin.html#system" hidden><span class="adm-dot"></span><span class="adm-health-text"></span></a>' +
          '<a class="adm-icon adm-viewsite" href="/" target="_blank" rel="noopener" title="View the site" aria-label="View the site">' + A.icon("external") + "</a>" +
          '<button type="button" class="adm-icon theme-toggle" title="Light or dark" aria-label="Switch between light and dark theme">' + A.icon("sun", "i-sun") + A.icon("moon", "i-moon") + "</button>" +
          '<button type="button" class="adm-icon" id="adm-logout" title="Sign out" aria-label="Sign out" hidden>' + A.icon("logout") + "</button>" +
        "</div>" +
      "</div></header>";
    document.querySelector(".adm-top .theme-toggle").addEventListener("click", function () {
      var next = theme() === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      try { localStorage.setItem("theme", next); } catch (e) {}
    });
  };

  // What is not switched on, in words. Empty when everything is.
  A.problems = function (s) {
    var out = [];
    if (!s) return out;
    if (!s.bookings) out.push("No database, online booking is off");
    if (!s.stripe) out.push("Stripe key not set, payment links only");
    else if (!s.webhook) out.push("Stripe webhook secret not set");
    if (!s.email) out.push("Confirmation emails are off");
    return out;
  };

  function paintHealth(s) {
    var h = A.el("adm-health");
    if (!h) return;
    var p = A.problems(s);
    h.hidden = false;
    h.querySelector(".adm-dot").classList.toggle("warn", !!p.length);
    h.querySelector(".adm-health-text").textContent = p.length ? p.length + (p.length === 1 ? " setup issue" : " setup issues") : "All systems on";
    h.title = p.length ? p.join(". ") + "." : "Database, Stripe, webhook and emails are all on.";
  }

  // ----------------------------------------------------------------
  // boot(page, onReady): draws the top bar, shows the right panel for the
  // server's answer, wires sign in and sign out, and calls onReady(session)
  // once the owner is in.
  // ----------------------------------------------------------------
  A.boot = function (page, onReady) {
    A.shell(page);
    var boot = A.el("adm-boot"), off = A.el("adm-off"), login = A.el("adm-login"), app = A.el("adm-app");
    var session = null;
    var started = false;

    function show(node) {
      [boot, off, login, app].forEach(function (n) { if (n) n.hidden = n !== node; });
      var out = A.el("adm-logout");
      if (out) out.hidden = node !== app;
    }

    A._gate = function (msg) {
      show(login);
      A.el("adm-login-error").textContent = msg || "";
      A.el("adm-password").focus();
    };

    function enter() {
      show(app);
      paintHealth(session);
      if (started) return;
      started = true;
      return Promise.resolve(onReady(session)).catch(function (e) {
        A.toast(e.message || "Could not load.", "error");
      });
    }

    A.el("adm-login-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var err = A.el("adm-login-error");
      var btn = e.target.querySelector("button");
      err.textContent = "";
      btn.disabled = true;
      A.api("/api/admin/login", { method: "POST", body: JSON.stringify({ password: A.el("adm-password").value }) })
        .then(function () {
          A.el("adm-password").value = "";
          return A.api("/api/admin/session");
        })
        .then(function (d) { session = d; A.session = d; return enter(); })
        .catch(function (x) { err.textContent = x.message; })
        .then(function () { btn.disabled = false; });
    });

    A.el("adm-logout").addEventListener("click", function () {
      A.api("/api/admin/logout", { method: "POST" }).then(function () { location.reload(); });
    });

    fetch("/api/admin/session", { headers: { accept: "application/json" } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || !d.enabled) return show(off);
        session = d;
        A.session = d;
        if (d.authed) return enter();
        show(login);
        A.el("adm-password").focus();
      })
      .catch(function () { show(off); });
  };
})();
