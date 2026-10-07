// Shared announcement bar, header and footer, injected into every page.
// Set the active page with: <body data-page="portfolio">
// Blog is in the nav since 2026-10-04 at the owner's request.
// Adding a page means adding it to `links` (nav) or the footer block below.
// book.html is deliberately NOT a nav row: it is the header CTA button, so the
// booking link is the one thing on the page that never reads as a menu item.
(function () {
  var page = document.body.getAttribute("data-page") || "";

  var links = [
    ["/services", "Services", "services"],
    ["/portfolio", "Portfolio", "portfolio"],
    ["/packages", "Pricing", "packages"],
    ["/guarantee", "Guarantee", "guarantee"],
    ["/about", "About", "about"],
    ["/blog", "Blog", "blog"],
    ["/contact", "Contact", "contact"]
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
    phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/></svg>',
    close: '<svg class="i-close" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>'
  };

  var MARK = '<span class="brand-mark" aria-hidden="true"><svg viewBox="0 0 32 32"><path d="M4 10V4h6M22 4h6v6M28 22v6h-6M10 28H4v-6" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="square"/><path class="brand-house" fill-rule="evenodd" d="M9.5 23.5v-7L16 10l6.5 6.5v7zM14.2 18.2v5.3h3.6v-5.3z"/></svg></span>';

  // The admin pages draw their own top bar with the same mark.
  window.EZ_MARK = MARK;

  // The business line, in the header on every page. The owner prefers a text,
  // so the phone strip opens Messages and every copy says texting is best.
  var PHONE = "(313) 246-3280", TEL = "tel:+13132463280", SMS = "sms:+13132463280";
  var TEXT_BEST = "Texting is best";

  var header =
    '<a class="skip-link" href="#main">Skip to content</a>' +
    // The offer in one line, biggest first: nothing down, pay only if happy.
    // On a phone it shrinks to the two things that matter most and the link.
    '<div class="announce">' +
      '<b>First shoot $99.</b> Book online, $0 down' +
      '<span class="dot hide-sm">|</span>' +
      '<span class="hide-sm">Pay only after you see the photos</span>' +
      '<span class="dot hide-md">|</span>' +
      '<span class="hide-md">Not happy? You do not pay, plus $20</span>' +
      '<span class="dot hide-md">|</span>' +
      '<span class="hide-md">Photos in 24 to 48 hours</span>' +
      '<span class="dot">|</span>' +
      '<a href="/book">Book now</a>' +
    '</div>' +
    '<header class="site-header"><div class="container nav">' +
      '<a href="/" class="brand">' + MARK + 'EZ <span>Shots</span></a>' +
      '<nav class="nav-links" id="nav-links" aria-label="Main">' + nav + '</nav>' +
      '<div class="nav-tools">' +
        '<a href="' + TEL + '" class="nav-phone" aria-label="Call or text ' + PHONE + ', texting is best">' + ICON.phone + '<span class="nav-phone-text"><b>' + PHONE + '</b><small>' + TEXT_BEST + '</small></span></a>' +
        '<button type="button" class="icon-btn theme-toggle" aria-label="Switch between light and dark theme">' + ICON.sun + ICON.moon + '</button>' +
        '<a href="/book" class="btn nav-cta">Book a shoot</a>' +
        '<button type="button" class="icon-btn menu-btn" aria-label="Menu" aria-controls="nav-links" aria-expanded="false">' + ICON.menu + ICON.close + '</button>' +
      '</div>' +
    '</div>' +
    '<a href="' + SMS + '" class="phone-strip">' + ICON.phone + '<span class="nav-phone-text"><b>' + PHONE + '</b><small>' + TEXT_BEST + '</small></span></a>' +
    '</header>';

  var footer =
    '<footer class="footer"><div class="container">' +
      '<div class="footer-top">' +
        '<div class="footer-brand">' +
          '<div class="brand">' + MARK + 'EZ <span>Shots</span></div>' +
          '<p>Real estate photography, video and FAA licensed drone work for realtors across Metro Detroit. Book online for $0, photos back in about 24 hours, pay only if you are happy.</p>' +
          '<div class="footer-contact">' +
            '<a href="' + TEL + '">' + PHONE + ' (texting is best)</a>' +
            '<a href="mailto:angelobrown1000@gmail.com">angelobrown1000@gmail.com</a>' +
            '<a href="https://tidycal.com/angelo3/quick-10-minute-chat" target="_blank" rel="noopener">Questions? Optional 10 minute call</a>' +
          '</div>' +
        '</div>' +
        '<div class="footer-col">' +
          '<h4>Work</h4>' +
          '<a href="/services">Services</a>' +
          '<a href="/portfolio">Portfolio</a>' +
          '<a href="/areas">Areas we serve</a>' +
          '<a href="/about">About</a>' +
        '</div>' +
        '<div class="footer-col">' +
          '<h4>Booking</h4>' +
          '<a href="/book">Book a shoot</a>' +
          '<a href="/packages">Pricing</a>' +
          '<a href="/guarantee">The guarantee</a>' +
          '<a href="/faq">FAQ</a>' +
          '<a href="/intake">After you book</a>' +
          '<a href="/contact">Contact</a>' +
        '</div>' +
        '<div class="footer-col footer-trust">' +
          '<h4>Good to know</h4>' +
          '<div class="footer-badges">' +
          '<div class="footer-badge">' +
            '<b>FAA Part 107 certified</b>' +
            '<span>Licensed and insured for commercial drone flight.</span>' +
          '</div>' +
          '<div class="footer-badge">' +
            '<b>Not happy, you do not pay</b>' +
            '<span>$0 to book. Pay after you see the photos, or not at all and $20 on top. Every shoot.</span>' +
          '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="footer-bottom">' +
        '<p>&copy; ' + new Date().getFullYear() + ' EZ Shots. Serving Wayne, Oakland and Macomb counties.</p>' +
        '<p><a href="/terms">Terms</a> &nbsp;&middot;&nbsp; <a href="/refund">Refunds</a> &nbsp;&middot;&nbsp; <a href="/privacy">Privacy</a> &nbsp;&middot;&nbsp; <a href="/admin">Admin</a></p>' +
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

  // Site analytics, read back in /admin-analytics. Our own server, no cookie:
  // a random id for this tab's visit in sessionStorage, the page, where the
  // visit came from and any utm_ tags on the first page. Nothing typed into a
  // form is ever sent. window.ezTrack(name, label) is how booking.js and
  // contact-form.js report a step, a booking or a sent form.
  // Admin pages and the client's own pages (manage, gallery, booked) are not
  // counted as visits.
  var sid = "", utm = {};
  try {
    sid = sessionStorage.getItem("ez_sid") || "";
    if (!sid) { sid = Math.random().toString(36).slice(2, 12) + Date.now().toString(36); sessionStorage.setItem("ez_sid", sid); }
    var qs = new URLSearchParams(location.search);
    if (qs.get("utm_source")) {
      utm = { us: qs.get("utm_source"), um: qs.get("utm_medium") || "", uc: qs.get("utm_campaign") || "" };
      sessionStorage.setItem("ez_utm", JSON.stringify(utm));
    } else {
      utm = JSON.parse(sessionStorage.getItem("ez_utm") || "{}");
    }
  } catch (e) {}

  var here = location.pathname + (location.pathname === "/project" ? location.search : "");
  window.ezTrack = function (name, label) {
    try {
      var data = JSON.stringify({ n: name, l: label || "", p: here, s: sid, r: document.referrer || "", us: utm.us, um: utm.um, uc: utm.uc });
      if (navigator.sendBeacon) navigator.sendBeacon("/api/track", new Blob([data], { type: "text/plain" }));
      else fetch("/api/track", { method: "POST", body: data, keepalive: true }).catch(function () {});
    } catch (e) {}
  };

  var privatePage = document.body.classList.contains("adm") || /^\/(g\/|manage|booked)/.test(location.pathname);
  if (!privatePage) {
    window.ezTrack("view");
    // Which Book buttons get pressed, and on which page.
    document.addEventListener("click", function (e) {
      var a = e.target.closest && e.target.closest('a[href^="/book"]');
      if (a) window.ezTrack("cta", (a.textContent || "").replace(/\s+/g, " ").trim().slice(0, 60));
    });
  } else {
    window.ezTrack = function () {};
  }
})();
