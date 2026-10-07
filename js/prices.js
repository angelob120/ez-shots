// Binds the prices in the page copy to the live config.
//
// WHY NOT A FIND AND REPLACE
// It was tempting to scan the page for "$150" and swap it. That is wrong here.
// services.html says "Plus $75" for the twilight add on and faq.html says other
// photographers charge "$100 to $175". Those are different numbers that happen
// to look the same, and a blind replace would silently rewrite them the first
// time a package price changed. So every price that should move is marked, and
// anything unmarked is left alone on purpose.
//
// HOW TO MARK ONE
//   <span data-price="{media}">$199</span>
// The attribute is a template. Tokens are {packageId} for a package price,
// {addonId} for an add on (the listing video is {video}), and ids joined with
// a plus add up, so {media+video} is the package with the video. The element's text is replaced
// with the filled in template, so put the attribute on an element whose WHOLE
// text is the template, usually a span of its own.
//
// Whole sentences work too, which is what <option> and <title> need because
// neither can hold a span:
//   <option data-price="Real Estate Media Package, {media}">Real Estate Media Package, $199</option>
//
// The number shipped in the HTML is the fallback. If the config cannot be
// reached, or a token names a package that no longer exists, the page keeps the
// text it was served with rather than blanking out or showing "undefined".
(function () {
  function fill(tpl, cfg) {
    var missing = false;
    var out = tpl.replace(/\{([a-z0-9+-]+)(\.first)?\}/gi, function (whole, ids, first) {
      var n = 0;
      ids.split("+").forEach(function (id) {
        var p = cfg.packages.filter(function (x) { return x.id === id; })[0] ||
          (cfg.addons || []).filter(function (x) { return x.id === id; })[0];
        var v = p ? (first && p.firstPrice !== undefined ? p.firstPrice : p.price) : undefined;
        if (v === undefined || v === null || v === "") missing = true;
        else n += Number(v);
      });
      return missing ? whole : "$" + n;
    });
    return missing ? null : out;
  }

  // js/config.js has to be on the page before this one. If it is not, leave the
  // numbers the server sent rather than throwing and taking the rest of the
  // page's scripts down with it.
  if (!window.EZ || !EZ.ready) {
    console.error("[EZ Shots] js/prices.js needs js/config.js loaded first.");
    return;
  }

  EZ.ready(function (cfg) {
    if (EZ.failed || !cfg.packages.length) return;
    Array.prototype.forEach.call(document.querySelectorAll("[data-price]"), function (node) {
      var out = fill(node.getAttribute("data-price"), cfg);
      if (out === null) return;
      if (node.tagName === "META") node.setAttribute("content", out);
      else node.textContent = out;
    });
  });
})();
