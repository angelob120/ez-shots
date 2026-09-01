// Renders the portfolio grid and the gallery wherever their containers exist.
// Containers: #portfolio-grid (optional data-limit), #gallery-strip (optional data-limit).
(function () {
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  var grid = document.getElementById("portfolio-grid");
  if (grid) {
    var limit = parseInt(grid.getAttribute("data-limit") || "0", 10);
    var list = window.EZ_PROJECTS || [];
    if (limit > 0) list = list.slice(0, limit);
    grid.innerHTML = list.map(function (p) {
      return '<a class="card" href="project.html?id=' + encodeURIComponent(p.id) + '">' +
        '<div class="thumb">' +
          '<img src="' + esc(p.cover) + '" alt="' + esc(p.title) + ', ' + esc(p.location) + '" loading="lazy">' +
          (p.pkg ? '<span class="pill">' + esc(p.pkg) + '</span>' : "") +
        '</div>' +
        '<div class="body">' +
          '<span class="tag">' + esc(p.type) + '</span>' +
          '<h3>' + esc(p.title) + '</h3>' +
          '<p class="meta">' + esc(p.location) + (p.sqft ? " &middot; " + esc(p.sqft) : "") + '</p>' +
          '<p>' + esc(p.short) + '</p>' +
          '<span class="more">View the shoot &rarr;</span>' +
        '</div>' +
      '</a>';
    }).join("");
  }

  var strip = document.getElementById("gallery-strip");
  if (strip) {
    var glimit = parseInt(strip.getAttribute("data-limit") || "0", 10);
    var imgs = window.EZ_GALLERY || [];
    if (glimit > 0) imgs = imgs.slice(0, glimit);
    strip.innerHTML = imgs.map(function (src) {
      return '<img src="' + esc(src) + '" loading="lazy" alt="EZ Shots real estate photography, Metro Detroit">';
    }).join("");
  }
})();
