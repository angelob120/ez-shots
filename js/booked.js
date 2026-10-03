// booked.html: the confirmation screen.
//
// The details come from the server by the booking's private token, never from
// the query string itself, so the page cannot be made to claim a booking that
// does not exist. If the lookup gives us nothing, the page still reads as a
// confirmation, it just does not claim specifics.
(function () {
  var q = new URLSearchParams(location.search);
  var token = q.get("t") || "";
  var box = document.getElementById("booked-summary");
  if (!box || !window.fetch) return;

  // The booking this tab remembered for a retry is done. Forgetting it means
  // a second booking from the same tab starts clean.
  try { sessionStorage.removeItem("ez-hold"); } catch (e) {}

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  if (!/^[a-f0-9]{32}$/.test(token)) return;
  fetch("/api/manage?t=" + encodeURIComponent(token), { headers: { accept: "application/json" } })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) {
      var b = d && d.booking;
      if (!b) return;
      var rows = [
        ["Booking", b.id],
        ["What", b.package + (b.firstShoot ? ", first shoot half price" : "")],
        ["When", b.when],
        ["Where", b.address],
        ["Due after you see the photos", "$" + b.amount],
        ["Due today", "$0"]
      ];
      box.innerHTML = rows.map(function (r, i) {
        return '<div class="sum-row' + (i === rows.length - 1 ? " sum-total" : "") + '"><span>' +
          esc(r[0]) + "</span><b>" + esc(r[1]) + "</b></div>";
      }).join("");
      box.hidden = false;
      var mail = document.getElementById("booked-email");
      if (mail && b.email) {
        mail.textContent = "A confirmation is on its way to " + b.email + ". Not there in a few minutes? Check spam, or open your booking with the button below.";
        mail.hidden = false;
      }
      document.getElementById("booked-ics").href = "/api/ics?t=" + encodeURIComponent(token);
      document.getElementById("booked-manage").href = "/manage?t=" + encodeURIComponent(token);
      document.getElementById("booked-actions").hidden = false;
    })
    .catch(function () {});
})();
