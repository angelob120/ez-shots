// manage.html: the customer's own view of one booking, by the token in the
// link they were given. No account, no password. The token is 32 random hex
// characters and the server answers nothing without the right one.
//
// What can be done here is deliberately small: see it, put it in a calendar,
// cancel it. Moving it is an email, because a move is a new slot and the
// owner should see it happen.
(function () {
  var params = new URLSearchParams(location.search);
  var token = params.get("t") || "";
  var title = document.getElementById("manage-title");
  var lead = document.getElementById("manage-lead");
  var block = document.getElementById("manage-block");
  var missing = document.getElementById("manage-missing");
  var summary = document.getElementById("manage-summary");
  var cancelBtn = document.getElementById("manage-cancel");
  var status = document.getElementById("manage-status");

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function say(type, text) {
    status.className = "form-status show " + type;
    status.textContent = text;
  }

  function none() {
    title.textContent = "No booking found";
    lead.textContent = "";
    block.hidden = true;
    missing.hidden = false;
  }

  function paint(b) {
    var LABEL = { confirmed: "Booked and paid", held: "Booked, payment pending", expired: "Not completed", cancelled: "Cancelled" };
    // A paid booking waits for me to confirm it, so it is not "booked" until I have.
    var refunded = b.refunded ? "$" + (b.refunded % 1 ? b.refunded.toFixed(2) : b.refunded) : "";
    var label = b.state === "confirmed" && b.awaiting ? "Paid, waiting for me to confirm"
      : b.state === "cancelled" && refunded ? "Cancelled, " + refunded + " refunded"
      : (LABEL[b.state] || b.state);
    title.textContent = b.address;
    lead.textContent = b.when + ". " + label + ".";
    var rows = [
      ["Booking", b.id],
      ["What", b.package],
      ["When", b.when],
      ["Where", b.address],
      ["Access", b.access + (b.accessNotes ? ". " + b.accessNotes : "")],
      ["Notes", b.notes],
      ["Status", label]
    ].filter(function (r) { return r[1]; });
    rows.push([b.paid ? "Paid" : "Price", "$" + b.amount]);
    summary.innerHTML = rows.map(function (r, i) {
      return '<div class="sum-row' + (i === rows.length - 1 ? " sum-total" : "") + '"><span>' + esc(r[0]) + "</span><b>" + esc(r[1]) + "</b></div>";
    }).join("");
    document.getElementById("manage-ics").href = "/api/ics?t=" + encodeURIComponent(token);
    document.getElementById("manage-ics").hidden = b.state === "cancelled";
    cancelBtn.hidden = !b.canCancel;
    block.hidden = false;
    missing.hidden = true;
  }

  if (!token || !window.fetch) return none();

  fetch("/api/manage?t=" + encodeURIComponent(token), { headers: { accept: "application/json" } })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) { if (d && d.booking) paint(d.booking); else none(); })
    .catch(none);

  cancelBtn.addEventListener("click", function () {
    if (!window.confirm("Cancel this shoot? The time goes back on the calendar straight away.")) return;
    cancelBtn.disabled = true;
    say("pending", "Cancelling...");
    fetch("/api/manage/cancel?t=" + encodeURIComponent(token), {
      method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: "{}"
    })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (x) {
        if (!x.ok) throw new Error(x.d.error || "Could not cancel.");
        paint(x.d.booking);
        say("success", "Cancelled. If you had paid, the refund is on its way to the same card.");
      })
      .catch(function (e) { say("error", e.message); cancelBtn.disabled = false; });
  });
})();
