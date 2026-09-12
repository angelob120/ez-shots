// decide.html: the owner's accept or decline, from the buttons in the booking
// email.
//
// The link carries the booking id, the action and a signature the server made
// for exactly that pair, so it works on a phone with no sign in. Opening it
// changes nothing, because mail scanners open links too. Accepting takes one
// press here. Declining refunds a real customer, so it takes two, and the
// server refuses a decline that does not say it was confirmed.
(function () {
  var q = new URLSearchParams(location.search);
  var params = { b: q.get("b") || "", a: q.get("a") || "", s: q.get("s") || "" };
  function $(id) { return document.getElementById(id); }
  var title = $("decide-title"), lead = $("decide-lead"), summary = $("decide-summary"), explain = $("decide-explain");
  var step1 = $("decide-step1"), step2 = $("decide-step2"), go = $("decide-go"), yes = $("decide-yes"), no = $("decide-no");
  var sure = $("decide-sure"), status = $("decide-status");
  if (!title || !window.fetch) return;

  var current = null;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function money(n) { n = Math.round(Number(n || 0) * 100) / 100; return "$" + (n % 1 ? n.toFixed(2) : String(n)); }
  function first(name) { return String(name || "").split(/\s+/)[0] || "the client"; }
  function listing(parts) { return parts.length > 1 ? parts.slice(0, -1).join(", ") + " and " + parts[parts.length - 1] : parts[0]; }
  function say(type, text) { status.className = "form-status show " + type; status.textContent = text; }
  function quiet() { status.className = "form-status"; status.textContent = ""; }

  function call(method, extra) {
    var get = method === "GET";
    return fetch("/api/decide" + (get ? "?" + new URLSearchParams(params).toString() : ""), {
      method: method,
      headers: { "content-type": "application/json", accept: "application/json" },
      body: get ? undefined : JSON.stringify(Object.assign({}, params, extra || {}))
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) throw new Error(d.error || "Something went wrong. Try again in a minute.");
        return d;
      });
    });
  }

  function closedLine(b) {
    if (b.status === "cancelled") return b.decision === "declined" ? "You declined this booking." : "This booking is cancelled.";
    if (b.status !== "confirmed") return "This booking has not been paid for yet.";
    return "";
  }

  function paint(d) {
    var b = d.booking;
    current = d;
    var rows = [["Booking", b.id], ["Client", b.name], ["When", b.when], ["Where", b.address], ["Package", b.packageName],
      ["Paid", b.paid ? money(b.amount) : "Not paid"]];
    if (b.refunded) rows.push(["Refunded", money(b.refunded)]);
    summary.innerHTML = rows.map(function (r, i) {
      return '<div class="sum-row' + (i === rows.length - 1 ? " sum-total" : "") + '"><span>' + esc(r[0]) + "</span><b>" + esc(r[1]) + "</b></div>";
    }).join("");
    summary.hidden = false;
    step2.hidden = true;

    var closed = closedLine(b);
    var accept = d.action === "accept";
    title.textContent = (accept ? "Accept " : "Decline ") + b.name + "?";
    lead.textContent = b.when + ", " + b.address + ".";

    if (closed || (accept && b.decision === "accepted")) {
      title.textContent = b.name + ", " + b.id;
      lead.textContent = closed || "You accepted this booking.";
      explain.hidden = true;
      step1.hidden = true;
      return;
    }

    if (accept) {
      explain.textContent = "Accepting emails " + first(b.name) + " that the shoot is on, with how to get the house ready.";
      go.textContent = "Accept booking";
      go.className = "btn";
    } else {
      var parts = ["cancels the booking", "opens the time back up"];
      if (b.refundable > 0) {
        parts.push(b.canRefund
          ? "refunds " + money(b.refundable) + " to their card"
          : "tells them the " + money(b.refundable) + " is coming back, which you then refund by hand in Stripe");
      }
      parts.push("emails " + first(b.name) + " to let them know");
      explain.textContent = "Declining " + listing(parts) + "." + (b.decision === "accepted" ? " You had already accepted this one." : "");
      go.textContent = b.refundable > 0 && b.canRefund ? "Decline and refund " + money(b.refundable) : "Decline booking";
      go.className = "btn btn-ghost";
    }
    explain.hidden = false;
    step1.hidden = false;
    go.disabled = false;
  }

  function broken(message) {
    title.textContent = "This link does not work";
    lead.textContent = message;
    summary.hidden = true;
    explain.hidden = true;
    step1.hidden = true;
    step2.hidden = true;
  }

  go.addEventListener("click", function () {
    if (!current) return;
    if (current.action === "decline") {
      // The second ask. Nothing has been sent yet.
      sure.textContent = "Are you sure? This cannot be undone.";
      yes.textContent = "Yes, " + go.textContent.charAt(0).toLowerCase() + go.textContent.slice(1);
      step1.hidden = true;
      step2.hidden = false;
      yes.disabled = false;
      quiet();
      return;
    }
    go.disabled = true;
    say("pending", "Accepting...");
    call("POST").then(function (d) {
      paint(d);
      say("success", d.already ? "Already accepted, nothing more was sent." : "Accepted. " + first(d.booking.name) + " has been emailed the confirmation.");
    }).catch(function (e) { go.disabled = false; say("error", e.message); });
  });

  no.addEventListener("click", function () {
    step2.hidden = true;
    step1.hidden = false;
    quiet();
  });

  yes.addEventListener("click", function () {
    yes.disabled = true;
    no.disabled = true;
    say("pending", "Declining...");
    call("POST", { confirm: true }).then(function (d) {
      no.disabled = false;
      paint(d);
      var bits = ["Declined."];
      if (d.refundedCents) bits.push(money(d.refundedCents / 100) + " refunded to their card.");
      if (d.manualCents) bits.push("Refund " + money(d.manualCents / 100) + " by hand in Stripe.");
      bits.push(first(d.booking.name) + " has been emailed.");
      say("success", bits.join(" "));
    }).catch(function (e) { yes.disabled = false; no.disabled = false; say("error", e.message); });
  });

  if (!params.b || !params.a || !params.s) return broken("It is missing part of the address. Open it again from the email.");
  call("GET").then(paint).catch(function (e) { broken(e.message); });
})();
