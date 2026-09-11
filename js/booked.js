// booked.html: the confirmation screen.
//
// The details come from Stripe through /api/session, never from the query
// string. A page that prints "Paid $125" because the URL said so is a page
// anyone can screenshot without paying. The same request is what confirms the
// booking on the server if the webhook has not already, so landing here is
// enough. If the lookup gives us nothing, the page still reads as a
// confirmation, it just does not claim specifics.
(function () {
  var id = new URLSearchParams(location.search).get("session_id");
  var box = document.getElementById("booked-summary");
  if (!id || !box || !window.fetch) return;

  // The hold this tab remembered for a retry is spent. Forgetting it means a
  // second booking from the same tab starts clean.
  try { sessionStorage.removeItem("ez-hold"); } catch (e) {}

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  fetch("/api/session?id=" + encodeURIComponent(id), { headers: { accept: "application/json" } })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) {
      if (!d || !d.paid) return;
      var b = d.booking;
      var rows = [];
      if (b && b.id) rows.push(["Booking", b.id]);
      if (d.package) rows.push(["What", d.package]);
      if (b && b.when) rows.push(["When", b.when]);
      else if (d.date) rows.push(["When", d.date + (d.time ? " at " + d.time : "")]);
      if (d.address) rows.push(["Where", d.address]);
      if (!rows.length) return;
      rows.push(["Paid", "$" + d.amount]);
      box.innerHTML = rows.map(function (r, i) {
        return '<div class="sum-row' + (i === rows.length - 1 ? " sum-total" : "") + '"><span>' +
          esc(r[0]) + "</span><b>" + esc(r[1]) + "</b></div>";
      }).join("");
      box.hidden = false;

      if (b && b.token) {
        document.getElementById("booked-ics").href = "/api/ics?t=" + encodeURIComponent(b.token);
        document.getElementById("booked-manage").href = "manage.html?t=" + encodeURIComponent(b.token);
        document.getElementById("booked-actions").hidden = false;
      }
    })
    .catch(function () {});
})();
