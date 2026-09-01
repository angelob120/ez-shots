// Shared announcement bar, header and footer, injected into every page.
// Set the active page with: <body data-page="portfolio">
// Adding a page means adding it to `links` (nav) or `footerLinks` below.
(function () {
  var page = document.body.getAttribute("data-page") || "";

  var links = [
    ["services.html", "Services", "services"],
    ["portfolio.html", "Portfolio", "portfolio"],
    ["packages.html", "Pricing", "packages"],
    ["guarantee.html", "Guarantee", "guarantee"],
    ["about.html", "About", "about"],
    ["contact.html", "Contact", "contact"]
  ];

  var nav = links.map(function (l) {
    return '<a href="' + l[0] + '"' + (l[2] === page ? ' class="active"' : "") + ">" + l[1] + "</a>";
  }).join("");

  var header =
    '<div class="announce">' +
      '<b>First shoot 50% off</b> for Metro Detroit realtors' +
      '<span class="dot hide-sm">|</span>' +
      '<span class="hide-sm">48 hour money back happiness guarantee on every shoot</span>' +
      '<span class="dot">|</span>' +
      '<a href="guarantee.html">See how it works</a>' +
    '</div>' +
    '<header class="site-header"><div class="container nav">' +
      '<a href="index.html" class="brand"><span class="brand-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l1.6-2.2A1 1 0 0 1 9.4 5.4h5.2a1 1 0 0 1 .8.4L17 8h3a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.2"/></svg></span>EZ <span>Shots</span></a>' +
      '<nav class="nav-links">' + nav +
        '<a href="packages.html" class="btn">Book a Shoot</a>' +
      '</nav>' +
      '<div class="nav-tools">' +
        '<button class="theme-toggle" aria-label="Toggle light and dark theme" title="Toggle theme">🌙</button>' +
        '<button class="menu-btn" aria-label="Menu" aria-expanded="false">☰</button>' +
      '</div>' +
    '</div></header>';

  var footer =
    '<footer class="footer"><div class="container">' +
      '<div class="footer-top">' +
        '<div class="footer-brand">' +
          '<div class="brand"><span class="brand-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l1.6-2.2A1 1 0 0 1 9.4 5.4h5.2a1 1 0 0 1 .8.4L17 8h3a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.2"/></svg></span>EZ <span>Shots</span></div>' +
          '<p>Real estate photography, video and FAA licensed drone work for realtors across Metro Detroit. MLS ready galleries delivered the next day on average.</p>' +
          '<div class="footer-contact">' +
            '<a href="mailto:bigmoneygelo2@gmail.com">bigmoneygelo2@gmail.com</a>' +
            '<a href="tel:+12485550139">(248) 555-0139</a>' +
          '</div>' +
        '</div>' +
        '<div class="footer-col">' +
          '<h4>Work</h4>' +
          '<a href="services.html">Services</a>' +
          '<a href="portfolio.html">Portfolio</a>' +
          '<a href="gallery.html">Photo gallery</a>' +
          '<a href="areas.html">Areas we serve</a>' +
          '<a href="about.html">About</a>' +
        '</div>' +
        '<div class="footer-col">' +
          '<h4>Booking</h4>' +
          '<a href="packages.html">Pricing</a>' +
          '<a href="guarantee.html">The guarantee</a>' +
          '<a href="faq.html">FAQ</a>' +
          '<a href="contact.html">Contact</a>' +
          '<a href="https://tidycal.com/angelo3/quick-10-minute-chat" target="_blank" rel="noopener">Book a call</a>' +
        '</div>' +
        '<div class="footer-col">' +
          '<h4>Good to know</h4>' +
          '<div class="footer-badge">' +
            '<b>FAA Part 107 certified</b>' +
            '<span>Licensed and insured for commercial drone flight.</span>' +
          '</div>' +
          '<div class="footer-badge">' +
            '<b>48 hour refund window</b>' +
            '<span>Not happy with the gallery? Full refund, every shoot.</span>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="footer-bottom">' +
        '<p>&copy; ' + new Date().getFullYear() + ' EZ Shots. Serving Wayne, Oakland and Macomb counties.</p>' +
        '<p><a href="terms.html">Terms</a> &nbsp;&middot;&nbsp; <a href="refund.html">Refunds</a> &nbsp;&middot;&nbsp; <a href="privacy.html">Privacy</a></p>' +
      '</div>' +
    '</div></footer>';

  var h = document.getElementById("site-header");
  var f = document.getElementById("site-footer");
  if (h) h.outerHTML = header;
  if (f) f.outerHTML = footer;

  // Light / dark theme toggle (defaults to system, remembers a manual choice)
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

  // Package "Book" button reveals Buy Now / Book a call
  document.querySelectorAll(".pkg-book").forEach(function (b) {
    b.addEventListener("click", function () { b.closest(".pkg-cta").classList.add("open"); });
  });

  // Mobile menu
  var btn = document.querySelector(".menu-btn");
  var linksEl = document.querySelector(".nav-links");
  if (btn && linksEl) {
    btn.addEventListener("click", function () {
      var open = linksEl.classList.toggle("open");
      btn.setAttribute("aria-expanded", open ? "true" : "false");
    });
  }
})();
