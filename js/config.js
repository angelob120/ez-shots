// EZ Shots runtime config: packages, prices, checkout links, availability.
//
// WHY THIS EXISTS
// Prices used to be typed into the HTML of packages.html with a Stripe link
// glued beside them, so changing one was a code edit in several files and a
// deploy. Now there is exactly one source and the owner edits it on the site.
//
// WHERE THE NUMBERS COME FROM, in order:
//   1. GET /api/config          the live config the server holds, what admin.html
//                               writes to. This is the real answer when the
//                               server is running.
//   2. GET /config.json         the file in the repo. The fallback for a plain
//                               static deploy with no server, and the seed the
//                               server copies on first boot.
// There is deliberately no third copy of the prices in this file. A hardcoded
// fallback here is how a stale price ends up on screen months after it changed,
// with nobody able to say where it came from.
//
// Nothing renders a price before EZ.ready fires, so a wrong number never
// flashes up ahead of the right one.
(function () {
  var EZ = window.EZ || (window.EZ = {});
  var waiting = [];
  var loaded = false;

  EZ.config = { packages: [], availability: {}, serverCheckout: false };
  EZ.failed = false;

  EZ.ready = function (fn) {
    if (loaded) fn(EZ.config);
    else waiting.push(fn);
  };

  EZ.packageById = function (id) {
    return EZ.config.packages.filter(function (p) { return p.id === id; })[0] || null;
  };

  function finish(cfg) {
    if (loaded) return;
    loaded = true;
    if (cfg) EZ.config = cfg;
    else EZ.failed = true;
    waiting.splice(0).forEach(function (fn) { fn(EZ.config); });
  }

  function valid(d) {
    return d && Array.isArray(d.packages) && d.packages.length && d.availability;
  }

  function get(url) {
    return fetch(url, { headers: { accept: "application/json" } }).then(function (r) {
      return r.ok ? r.json() : null;
    });
  }

  if (!window.fetch) return finish(null);

  // A missing /api/config is the normal case on a static deploy, not an error.
  get("/api/config")
    .catch(function () { return null; })
    .then(function (d) { return valid(d) ? d : get("/config.json").catch(function () { return null; }); })
    .then(function (d) { finish(valid(d) ? d : null); })
    .catch(function () { finish(null); });

  // If both requests hang, the page still has to do something.
  setTimeout(function () { finish(null); }, 6000);
})();
