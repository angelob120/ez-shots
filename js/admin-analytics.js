// admin-analytics.html: how the site is doing.
//
// One GET to /api/admin/analytics?days=N brings back everything, worked out
// on the server from analytics_events (what visitors did, see
// server/analytics.js) and the bookings table (what it was worth). This file
// only draws it: number tiles, two bar charts, and ranked lists. Signing in,
// the top bar and toasts live in js/admin-core.js.
(function () {
  var A = window.EZAdmin;
  if (!A || !A.el("adm-app")) return;
  var el = A.el, esc = A.esc, money = A.money;

  var RANGES = [[7, "7 days"], [30, "30 days"], [90, "90 days"], [365, "12 months"]];
  var days = 30;
  try { days = Number(localStorage.getItem("ez-analytics-days")) || 30; } catch (e) {}
  var loadedAt = 0;
  var last = null;           // the last answer, redrawn when the window resizes

  function n(x) { return Number(x || 0).toLocaleString("en-US"); }
  function pctOf(x) { return (Math.round(x * 10) / 10) + "%"; }

  // "+12% on the 30 days before", or nothing when there is nothing to compare.
  function delta(now, before) {
    if (!before) return now ? "nothing the period before" : "";
    var p = Math.round((now - before) / before * 100);
    return '<span class="' + (p >= 0 ? "adm-up" : "adm-down") + '">' + (p >= 0 ? "+" : "") + p + "%</span> on the " + label() + " before";
  }
  function label() { for (var i = 0; i < RANGES.length; i++) if (RANGES[i][0] === days) return RANGES[i][1]; return days + " days"; }

  function tile(name, value, sub) {
    return '<div class="adm-kpi"><div class="adm-kpi-label">' + esc(name) + '</div><div class="adm-kpi-value">' + esc(value) +
      '</div><div class="adm-kpi-sub">' + (sub || "&nbsp;") + "</div></div>";
  }

  // ----------------------------------------------------------------
  // A column chart: one series, one colour, a tooltip on hover or focus.
  // items: [{ label, value, tip, tick }] where tick is the axis text or "".
  // ----------------------------------------------------------------
  function columns(box, items, fmt) {
    if (!items.length) { box.innerHTML = '<p class="adm-muted an-empty">Nothing yet for this period.</p>'; return; }
    var W = Math.max(300, Math.round(box.clientWidth || 720)), H = 200, top = 12, bottom = 24, left = 44;
    var max = Math.max.apply(null, items.map(function (i) { return i.value; })) || 1;
    var step = niceStep(max / 4), ceil = Math.ceil(max / step) * step;
    var plotW = W - left, slot = plotW / items.length, bw = Math.max(2, Math.min(36, slot - 2));
    var y = function (v) { return top + (H - top - bottom) * (1 - v / ceil); };
    var s = '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Chart">';
    for (var g = 0; g <= ceil; g += step) {
      s += '<line class="an-grid-line" x1="' + left + '" x2="' + W + '" y1="' + y(g) + '" y2="' + y(g) + '"/>' +
        '<text class="an-axis" x="' + (left - 6) + '" y="' + (y(g) + 4) + '" text-anchor="end">' + esc(fmt(g, true)) + "</text>";
    }
    var lastTick = -1e9;
    items.forEach(function (it, i) {
      var x = left + i * slot + (slot - bw) / 2, h = Math.max(it.value ? 2 : 0, y(0) - y(it.value));
      s += '<rect class="an-hit" x="' + (left + i * slot) + '" y="' + top + '" width="' + slot + '" height="' + (H - top - bottom) + '" data-i="' + i + '"/>';
      if (h) s += '<path class="an-bar" d="' + roundTop(x, y(0) - h, bw, h, Math.min(4, bw / 2)) + '" data-i="' + i + '"/>';
      // A tick too close to the one before it is left out, not overlapped.
      if (it.tick && x + bw / 2 - lastTick >= 46) { lastTick = x + bw / 2; s += '<text class="an-axis" x="' + (x + bw / 2) + '" y="' + (H - 6) + '" text-anchor="middle">' + esc(it.tick) + "</text>"; }
    });
    s += "</svg>";
    box.innerHTML = s;
    var svg = box.querySelector("svg"), tip = el("tip");
    function show(e) {
      var i = e.target.getAttribute("data-i");
      if (i == null) return hide();
      var it = items[+i];
      svg.querySelectorAll(".an-bar").forEach(function (b) { b.classList.toggle("dim", b.getAttribute("data-i") !== i); });
      tip.innerHTML = it.tip;
      tip.hidden = false;
      var r = e.target.getBoundingClientRect();
      var tx = Math.min(window.innerWidth - tip.offsetWidth - 8, Math.max(8, r.left + r.width / 2 - tip.offsetWidth / 2));
      tip.style.left = tx + window.scrollX + "px";
      tip.style.top = (svg.getBoundingClientRect().top + window.scrollY - tip.offsetHeight - 6) + "px";
    }
    function hide() {
      tip.hidden = true;
      svg.querySelectorAll(".an-bar").forEach(function (b) { b.classList.remove("dim"); });
    }
    svg.addEventListener("mousemove", show);
    svg.addEventListener("mouseleave", hide);
  }
  function roundTop(x, y, w, h, r) {
    r = Math.min(r, h);
    return "M" + x + "," + (y + h) + "V" + (y + r) + "Q" + x + "," + y + " " + (x + r) + "," + y +
      "H" + (x + w - r) + "Q" + (x + w) + "," + y + " " + (x + w) + "," + (y + r) + "V" + (y + h) + "Z";
  }
  function niceStep(raw) {
    if (raw <= 1) return 1;
    var p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
  }

  // ----------------------------------------------------------------
  // A ranked list with an in-row bar, the most useful shape for "which".
  // rows: [{ name, value, cols: [text, ...] }], heads: column titles.
  // ----------------------------------------------------------------
  function ranked(box, rows, heads) {
    if (!rows.length) { box.innerHTML = '<p class="adm-muted an-empty">Nothing yet for this period.</p>'; return; }
    var max = Math.max.apply(null, rows.map(function (r) { return r.value; })) || 1;
    box.innerHTML = '<table class="an-table"><thead><tr>' + heads.map(function (h, i) {
      return "<th" + (i ? ' class="num"' : "") + ">" + esc(h) + "</th>";
    }).join("") + "</tr></thead><tbody>" + rows.map(function (r) {
      return '<tr><td><div class="an-name" title="' + esc(r.name) + '">' + esc(r.name) + '</div><div class="an-track"><i style="width:' +
        Math.max(2, r.value / max * 100) + '%"></i></div></td>' +
        r.cols.map(function (c) { return '<td class="num">' + c + "</td>"; }).join("") + "</tr>";
    }).join("") + "</tbody></table>";
  }

  function pageName(p) {
    var names = { "/": "Home", "/book": "Book", "/packages": "Pricing", "/g": "Client gallery" };
    return names[p] || p;
  }

  // ----------------------------------------------------------------
  function paint(d) {
    var t = d.traffic, b = d.business;
    el("range-sub").textContent = "The last " + label() + ". " + (t.live ? t.live + (t.live === 1 ? " person" : " people") + " on the site right now." : "Nobody on the site right now.");

    el("traffic-kpis").innerHTML =
      tile("Visitors", n(t.visitors), delta(t.visitors, t.prevVisitors)) +
      tile("Page views", n(t.views), t.pagesPerSession + " a visit, " + pctOf(t.bounceRate) + " bounce") +
      tile("Visit to booking", pctOf(t.conversion), d.funnel[4].n + " booked from " + n(t.sessions) + " visits") +
      tile("Today", n(t.todayVisitors) + (t.todayVisitors === 1 ? " visitor" : " visitors"), n(t.todayViews) + " views, " + t.contacts + " contact forms in period");

    // Every day of the period, zero days included, so a quiet week shows.
    var byDay = {};
    d.daily.forEach(function (r) { byDay[r.day] = r; });
    var items = [], end = A.keyOf(new Date()), span = days > 90 ? 90 : days;
    for (var i = span - 1; i >= 0; i--) {
      var k = A.addDays(end, -i), r = byDay[k] || { visitors: 0, views: 0, booked: 0 };
      var dt = A.dateOf(k);
      var tick = span <= 7 ? A.DAYS[dt.getDay()] : (dt.getDate() === 1 || i === span - 1 || (span <= 31 && dt.getDay() === 1)) ? A.MONTHS[dt.getMonth()] + " " + dt.getDate() : "";
      items.push({ value: r.visitors, tick: tick,
        tip: "<b>" + esc(A.shortDay(k)) + "</b><br>" + n(r.visitors) + " visitors, " + n(r.views) + " views" + (r.booked ? "<br>" + r.booked + " booked" : "") });
    }
    el("daily-sub").textContent = days > 90 ? "Last 90 days" : "Each bar is one day";
    columns(el("daily"), items, function (v) { return n(v); });

    // Funnel: each step as a share of all visits, and what was lost on the way.
    var top = d.funnel[0].n || 1;
    el("funnel").innerHTML = '<ol class="an-funnel">' + d.funnel.map(function (f, i) {
      var prev = i ? d.funnel[i - 1].n : 0;
      var lost = i && prev ? Math.round((prev - f.n) / prev * 100) : 0;
      return "<li><div class=\"an-funnel-row\"><span>" + esc(f.label) + "</span><b>" + n(f.n) + "</b></div>" +
        '<div class="an-track lg"><i style="width:' + Math.max(f.n ? 2 : 0, f.n / top * 100) + '%"></i></div>' +
        '<div class="an-funnel-sub">' + (i ? pctOf(f.rate) + " of visits" + (prev ? ", " + lost + "% dropped here" : "") : "every visit in the period") + "</div></li>";
    }).join("") + "</ol>";

    ranked(el("sources"), d.sources.map(function (s) {
      return { name: s.name, value: s.sessions, cols: [n(s.sessions), n(s.booked), pctOf(s.rate)] };
    }), ["Source", "Visits", "Booked", "Rate"]);

    ranked(el("pages"), d.pages.map(function (p) {
      return { name: pageName(p.path), value: p.views, cols: [n(p.views), n(p.visitors)] };
    }), ["Page", "Views", "Visitors"]);

    ranked(el("landings"), d.landings.map(function (p) {
      return { name: pageName(p.name), value: p.sessions, cols: [n(p.sessions), n(p.booked), pctOf(p.rate)] };
    }), ["First page", "Visits", "Booked", "Rate"]);

    ranked(el("ctas"), d.ctas.map(function (c) {
      return { name: (c.label || "Book") + " on " + pageName(c.path), value: c.n, cols: [n(c.n)] };
    }), ["Button", "Presses"]);

    var dev = d.devices.map(function (s) { return { name: s.name, value: s.sessions, cols: [n(s.sessions), n(s.booked)] }; });
    var camp = d.campaigns.map(function (s) { return { name: "Campaign: " + s.name, value: s.sessions, cols: [n(s.sessions), n(s.booked)] }; });
    ranked(el("devices"), dev.concat(camp), ["Device or campaign", "Visits", "Booked"]);

    // Business.
    var waiting = b.unpaid.reduce(function (s, r) { return s + (r.stage === "ready" ? r.value : 0); }, 0);
    var waitingN = b.unpaid.reduce(function (s, r) { return s + (r.stage === "ready" ? r.n : 0); }, 0);
    var booked = b.unpaid.reduce(function (s, r) { return s + r.value; }, 0);
    el("biz-kpis").innerHTML =
      tile("Bookings made", n(b.bookings), b.site + " online, " + b.manual + " by hand" + (b.cancelled ? ", " + b.cancelled + " cancelled" : "")) +
      tile("Revenue paid", money(b.revenue), delta(b.revenue, b.prevRevenue) || "net of refunds") +
      tile("Average paid job", b.paidJobs ? money(b.avgTicket) : "None yet", b.paidJobs + (b.paidJobs === 1 ? " job" : " jobs") + " paid in the period") +
      tile("Money waiting", money(waiting), waitingN ? waitingN + " ready to be paid, " + money(booked) + " unpaid in all" : money(booked) + " unpaid, none ready");
    el("biz-kpis-2").innerHTML =
      tile("Video add on", pctOf(b.videoRate), "of confirmed bookings") +
      tile("First shoots", pctOf(b.firstRate), "booked at the first shoot price") +
      tile("Booked ahead", b.leadDays + (b.leadDays === 1 ? " day" : " days"), "booking to shoot, average") +
      tile("Repeat clients", n(b.repeatClients), "of " + n(b.clients) + " clients came back");

    var months = [], now = new Date(), byMonth = {};
    b.monthly.forEach(function (m) { byMonth[m.month] = m; });
    for (var j = 11; j >= 0; j--) {
      var md = new Date(now.getFullYear(), now.getMonth() - j, 1);
      var mk = md.getFullYear() + "-" + A.pad(md.getMonth() + 1), m = byMonth[mk] || { revenue: 0, jobs: 0 };
      months.push({ value: m.revenue, tick: A.MONTHS[md.getMonth()],
        tip: "<b>" + A.MONTHS[md.getMonth()] + " " + md.getFullYear() + "</b><br>" + money(m.revenue) + " from " + m.jobs + (m.jobs === 1 ? " job" : " jobs") });
    }
    columns(el("monthly"), months.every(function (m) { return !m.value; }) ? [] : months, function (v) { return money(v); });

    ranked(el("packages"), b.packages.map(function (p) { return { name: p.name, value: p.n, cols: [n(p.n)] }; }), ["Package", "Bookings"]);
  }

  function paintRange() {
    el("range").innerHTML = RANGES.map(function (r) {
      return '<button type="button" data-days="' + r[0] + '" aria-pressed="' + (r[0] === days) + '">' + esc(r[1]) + "</button>";
    }).join("");
  }

  function load() {
    el("refresh-btn").disabled = true;
    return A.api("/api/admin/analytics?days=" + days).then(function (d) {
      loadedAt = Date.now();
      last = d;
      paint(d);
      stamp();
    }).catch(function (e) {
      A.toast(e.message || "Could not load the numbers.", "error");
    }).then(function () { el("refresh-btn").disabled = false; });
  }
  function stamp() { if (loadedAt) el("updated").textContent = "Updated " + A.ago(loadedAt); }

  A.boot("analytics", function () {
    el("refresh-btn").innerHTML = A.icon("refresh");
    el("refresh-btn").addEventListener("click", load);
    paintRange();
    el("range").addEventListener("click", function (e) {
      var btn = e.target.closest("button[data-days]");
      if (!btn) return;
      days = Number(btn.getAttribute("data-days"));
      try { localStorage.setItem("ez-analytics-days", String(days)); } catch (x) {}
      paintRange();
      load();
    });
    setInterval(stamp, 30000);
    // The charts are drawn at the card's width so their text stays readable.
    var resizing = 0;
    window.addEventListener("resize", function () {
      clearTimeout(resizing);
      resizing = setTimeout(function () { if (last) paint(last); }, 150);
    });
    // Fresh numbers when the owner comes back to the tab.
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden && Date.now() - loadedAt > 5 * 60 * 1000) load();
    });
    return load();
  });
})();
