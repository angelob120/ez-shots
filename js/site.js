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
    var active = l[2] === page;
    return '<a href="' + l[0] + '"' + (active ? ' class="active" aria-current="page"' : "") + ">" + l[1] + "</a>";
  }).join("");

  // Inline SVG rather than emoji. An emoji toggle renders as a different
  // picture on every OS and cannot inherit the theme's text colour.
  var ICON = {
    moon: '<svg class="i-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
    sun: '<svg class="i-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
    menu: '<svg class="i-menu" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
    close: '<svg class="i-close" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>'
  };

  var MARK = '<span class="brand-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l1.6-2.2A1 1 0 0 1 9.4 5.4h5.2a1 1 0 0 1 .8.4L17 8h3a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.2"/></svg></span>';

  var header =
    '<a class="skip-link" href="#main">Skip to content</a>' +
    '<div class="announce">' +
      '<b>First shoot 50% off</b> for Metro Detroit realtors' +
      '<span class="dot hide-sm">|</span>' +
      '<span class="hide-sm">Full refund for 48 hours after every gallery</span>' +
      '<span class="dot">|</span>' +
      '<a href="guarantee.html">See how it works</a>' +
    '</div>' +
    '<header class="site-header"><div class="container nav">' +
      '<a href="index.html" class="brand">' + MARK + 'EZ <span>Shots</span></a>' +
      '<nav class="nav-links" id="nav-links" aria-label="Main">' + nav + '</nav>' +
      '<div class="nav-tools">' +
        '<button type="button" class="icon-btn theme-toggle" aria-label="Switch between light and dark theme">' + ICON.sun + ICON.moon + '</button>' +
        '<a href="packages.html" class="btn nav-cta">Book a shoot</a>' +
        '<button type="button" class="icon-btn menu-btn" aria-label="Menu" aria-controls="nav-links" aria-expanded="false">' + ICON.menu + ICON.close + '</button>' +
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

  // Light / dark theme toggle (defaults to system, remembers a manual choice).
  // The two glyphs are both in the DOM and CSS shows one, so nothing here
  // has to know what the icon looks like.
  function currentTheme() {
    return document.documentElement.getAttribute("data-theme") || "light";
  }
  var themeBtn = document.querySelector(".theme-toggle");
  if (themeBtn) {
    themeBtn.addEventListener("click", function () {
      var next = currentTheme() === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      try { localStorage.setItem("theme", next); } catch (e) {}
    });
  }
  if (window.matchMedia) {
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function (e) {
      var saved;
      try { saved = localStorage.getItem("theme"); } catch (err) {}
      if (!saved) document.documentElement.setAttribute("data-theme", e.matches ? "dark" : "light");
    });
  }

  // Package "Book" button reveals Buy Now / Book a call
  document.querySelectorAll(".pkg-book").forEach(function (b) {
    b.addEventListener("click", function () { b.closest(".pkg-cta").classList.add("open"); });
  });

  // Mobile menu. A drawer that only closes by pressing the same button again
  // is a trap on a phone: every other way out of it has to work too.
  var menuBtn = document.querySelector(".menu-btn");
  var linksEl = document.querySelector(".nav-links");
  if (menuBtn && linksEl) {
    function setMenu(open) {
      linksEl.classList.toggle("open", open);
      menuBtn.setAttribute("aria-expanded", open ? "true" : "false");
    }
    menuBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      setMenu(!linksEl.classList.contains("open"));
    });
    linksEl.addEventListener("click", function (e) {
      if (e.target.closest("a")) setMenu(false);
    });
    document.addEventListener("click", function (e) {
      if (!linksEl.classList.contains("open")) return;
      if (!e.target.closest(".nav")) setMenu(false);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && linksEl.classList.contains("open")) {
        setMenu(false);
        menuBtn.focus();
      }
    });
    // Leaving the mobile breakpoint with the drawer open would otherwise
    // leave .open set on a nav that is now a horizontal row.
    if (window.matchMedia) {
      window.matchMedia("(min-width: 941px)").addEventListener("change", function (e) {
        if (e.matches) setMenu(false);
      });
    }
  }

  // Lift the header off the page once it stops sitting on the hero.
  var headerEl = document.querySelector(".site-header");
  if (headerEl) {
    var ticking = false;
    function onScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () {
        headerEl.classList.toggle("scrolled", window.scrollY > 8);
        ticking = false;
      });
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }
})();
