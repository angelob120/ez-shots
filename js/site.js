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
      '<button class="menu-btn" aria-label="Menu">☰</button>' +
    '</div></header>';

  var footer =
    '<footer class="footer"><div class="container">' +
      '<div class="brand">EZ<span style="color:#7fb2ff">Shots</span></div>' +
      '<p>Real estate photography, video &amp; drone &nbsp;|&nbsp; bigmoneygelo2@gmail.com</p>' +
      '<p>&copy; ' + new Date().getFullYear() + ' EZ Shots. All rights reserved.</p>' +
    '</div></footer>';

  var h = document.getElementById("site-header");
  var f = document.getElementById("site-footer");
  if (h) h.outerHTML = header;
  if (f) f.outerHTML = footer;

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
