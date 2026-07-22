// Shared header + footer injected into every page.
// Set the active page with: <body data-page="portfolio">
(function () {
  var page = document.body.getAttribute("data-page") || "";
  var links = [
    ["index.html", "Home", "home"],
    ["portfolio.html", "Portfolio", "portfolio"],
    ["gallery.html", "Gallery", "gallery"],
    ["about.html", "About", "about"],
    ["packages.html", "Packages", "packages"],
    ["contact.html", "Contact", "contact"]
  ];
  var nav = links.map(function (l) {
    var active = l[2] === page ? ' class="active"' : "";
    return '<a href="' + l[0] + '"' + active + ">" + l[1] + "</a>";
  }).join("");

  // Static top bar
  var header =
    '<div class="ticker"><span class="tick">🎉 New realtors: first shoot 50% off</span></div>' +
    '<header class="site-header"><div class="container nav">' +
      '<a href="index.html" class="brand">EZ<span>Shots</span></a>' +
      '<nav class="nav-links">' + nav +
        '<a href="packages.html" class="btn">Book a Shoot</a>' +
      '</nav>' +
      '<button class="theme-toggle" aria-label="Toggle light/dark theme" title="Toggle theme">🌙</button>' +
      '<button class="menu-btn" aria-label="Menu">☰</button>' +
    '</div></header>';

  var footer =
    '<footer class="footer"><div class="container">' +
      '<div class="footer-top">' +
        '<div class="footer-brand">' +
          '<div class="brand">EZ<span>Shots</span></div>' +
          '<p>Real estate photography, video &amp; drone. MLS-ready delivery in 24–48 hours.</p>' +
          '<a href="mailto:bigmoneygelo2@gmail.com" class="footer-email">bigmoneygelo2@gmail.com</a>' +
        '</div>' +
        '<div class="footer-col">' +
          '<h4>Explore</h4>' +
          '<a href="portfolio.html">Portfolio</a>' +
          '<a href="gallery.html">Gallery</a>' +
          '<a href="packages.html">Packages</a>' +
          '<a href="about.html">About</a>' +
          '<a href="contact.html">Contact</a>' +
        '</div>' +
        '<div class="footer-col">' +
          '<h4>Legal</h4>' +
          '<a href="terms.html">Terms of Service</a>' +
          '<a href="refund.html">Refund &amp; Cancellation</a>' +
          '<a href="privacy.html">Privacy Policy</a>' +
        '</div>' +
        '<div class="footer-col">' +
          '<h4>Get started</h4>' +
          '<a href="packages.html">Book a Shoot</a>' +
          '<a href="https://tidycal.com/angelo3/quick-10-minute-chat" target="_blank" rel="noopener">Book a Call</a>' +
        '</div>' +
      '</div>' +
      '<div class="footer-bottom">' +
        '<p>&copy; ' + new Date().getFullYear() + ' EZ Shots. All rights reserved.</p>' +
        '<p class="footer-source">*Listings with aerial photos sold 68% faster — <a href="https://www.redfin.com/blog/professional-real-estate-photos-sell-homes-for-more/" target="_blank" rel="noopener">Redfin / MLS study</a>.</p>' +
      '</div>' +
    '</div></footer>';

  var h = document.getElementById("site-header");
  var f = document.getElementById("site-footer");
  if (h) h.outerHTML = header;
  if (f) f.outerHTML = footer;

  // Light / dark theme toggle (defaults to system, remembers choice)
  function currentTheme() {
    return document.documentElement.getAttribute("data-theme") || "light";
  }
  function updateThemeIcon() {
    var b = document.querySelector(".theme-toggle");
    if (b) b.textContent = currentTheme() === "dark" ? "☀️" : "🌙";
  }
  updateThemeIcon();
  var themeBtn = document.querySelector(".theme-toggle");
  if (themeBtn) {
    themeBtn.addEventListener("click", function () {
      var next = currentTheme() === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      try { localStorage.setItem("theme", next); } catch (e) {}
      updateThemeIcon();
    });
  }
  // Follow system changes only while the user hasn't chosen manually
  if (window.matchMedia) {
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function (e) {
      var saved;
      try { saved = localStorage.getItem("theme"); } catch (err) {}
      if (!saved) {
        document.documentElement.setAttribute("data-theme", e.matches ? "dark" : "light");
        updateThemeIcon();
      }
    });
  }

  // Package "Book" → reveal Buy Now / Book a Time options
  document.querySelectorAll(".pkg-book").forEach(function (b) {
    b.addEventListener("click", function () {
      b.closest(".pkg-cta").classList.add("open");
    });
  });

  // Mobile menu toggle
  var btn = document.querySelector(".menu-btn");
  var linksEl = document.querySelector(".nav-links");
  if (btn && linksEl) {
    btn.addEventListener("click", function () { linksEl.classList.toggle("open"); });
  }
})();
