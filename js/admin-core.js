// What every admin page shares: the sign in, the sign out, the JSON helper,
// and the four panels (checking, off, login, the page itself). admin.js and
// admin-bookings.js call EZAdmin.boot() and get told when the owner is in.
//
// Nothing here is a security control. A person who can reach /api/admin/* has
// signed in on the server, and a person who has not gets a 401 whatever this
// file does. It exists so there is one sign in form and not two.
(function () {
  var A = window.EZAdmin = {};

  A.el = function (id) { return document.getElementById(id); };

  A.esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  };

  A.status = function (node, type, text) {
    if (!node) return;
    node.className = "form-status show " + type;
    node.textContent = text;
  };

  A.api = function (url, opts) {
    return fetch(url, Object.assign({ headers: { "content-type": "application/json", accept: "application/json" } }, opts))
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (d) {
          if (!r.ok) throw new Error(d.error || "Request failed (" + r.status + ")");
          return d;
        });
      });
  };

  A.money = function (n) { return "$" + Number(n || 0).toLocaleString("en-US"); };

  // boot(onReady): shows the right panel for the server's answer, wires the
  // sign in and sign out, and calls onReady(session) once the owner is in.
  // Returns nothing useful. session is what /api/admin/session replied.
  A.boot = function (onReady) {
    var boot = A.el("admin-boot"), off = A.el("admin-off"), login = A.el("admin-login"), panel = A.el("admin-panel");
    if (!boot) return;
    var session = null;

    function show(node) {
      [boot, off, login, panel].forEach(function (n) { if (n) n.hidden = n !== node; });
    }

    function enter() {
      show(panel);
      return Promise.resolve(onReady(session)).catch(function (e) {
        var s = A.el("login-status");
        show(login);
        A.status(s, "error", e.message || "Could not load.");
      });
    }

    var form = A.el("login-form");
    if (form) {
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        var s = A.el("login-status");
        A.status(s, "pending", "Checking...");
        A.api("/api/admin/login", { method: "POST", body: JSON.stringify({ password: A.el("admin-password").value }) })
          .then(function () {
            A.el("admin-password").value = "";
            return A.api("/api/admin/session");
          })
          .then(function (d) { session = d; return enter(); })
          .catch(function (err) { A.status(s, "error", err.message); });
      });
    }

    var out = A.el("logout-btn");
    if (out) {
      out.addEventListener("click", function () {
        A.api("/api/admin/logout", { method: "POST" }).then(function () { show(login); });
      });
    }

    fetch("/api/admin/session", { headers: { accept: "application/json" } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || !d.enabled) return show(off);
        session = d;
        if (d.authed) return enter();
        show(login);
      })
      .catch(function () { show(off); });
  };
})();
