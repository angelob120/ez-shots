// Renders the portfolio grid and gallery strip wherever their containers exist.
(function () {
  var grid = document.getElementById("portfolio-grid");
  if (grid) {
    var limit = parseInt(grid.getAttribute("data-limit") || "0", 10);
    var list = window.EZ_PROJECTS || [];
    if (limit > 0) list = list.slice(0, limit);
    list.forEach(function (p) {
      var a = document.createElement("a");
      a.className = "card";
      a.href = "project.html?id=" + encodeURIComponent(p.id);
      a.innerHTML =
        '<div class="thumb"><img src="' + p.cover + '" alt="' + p.title + '" loading="lazy"></div>' +
        '<div class="body">' +
          '<span class="tag">' + p.type + '</span>' +
          '<h3>' + p.title + '</h3>' +
          '<p>' + p.short + '</p>' +
          '<span class="more">View project →</span>' +
        '</div>';
      grid.appendChild(a);
    });
  }

  var strip = document.getElementById("gallery-strip");
  if (strip) {
    var glimit = parseInt(strip.getAttribute("data-limit") || "0", 10);
    var imgs = window.EZ_GALLERY || [];
    if (glimit > 0) imgs = imgs.slice(0, glimit);
    imgs.forEach(function (src) {
      var img = document.createElement("img");
      img.src = src; img.loading = "lazy"; img.alt = "EZ Shots real estate photo";
      strip.appendChild(img);
    });
  }
})();
