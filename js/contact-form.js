// EZ Shots forms -> EmailJS (client side, no backend).
// Every form on the site with class "lead-form" wires itself up here. There is
// one handler on purpose: a second copy is how one form starts validating
// differently from another, and how a field silently stops reaching the inbox.
//
// HOW THE TEMPLATE CONSTRAINT SHAPES THIS
// The EmailJS template has a fixed set of variables: site_name, from_name,
// email_id, reply_to, phone, message, subject. It cannot grow a variable per
// question. So anything that is not one of those five known fields is folded
// into `message` as a "Label: value" line, in the order the fields appear in
// the form. That is what lets a two field contact form and a twenty field
// intake form share one template and one monthly send quota.
//
// PER FORM SETTINGS, all optional, all read off the <form> element:
//   data-required   comma separated field names that must be filled
//                   (default "name,email,message")
//   data-subject    subject line prefix (default "New lead from EZ Shots")
//   data-subject-field  a field name whose value is appended to the subject,
//                   so the inbox says which property an intake is for
//   data-success    the message shown after a successful send
(function () {
  // ------------------------------------------------------------------
  // CONFIG (these are publishable client-side keys, safe to ship)
  // ------------------------------------------------------------------
  var CONFIG = {
    SERVICE_ID: "service_dburs96",           // Gmail, connected as bigmoneygelo11@gmail.com
    // The account holds two templates, both called "My Default Template".
    // One delivers to angelobrown1000@gmail.com and one to a yahoo address
    // belonging to a different project. This must be the ID of the one whose
    // "To Email" is angelobrown1000@gmail.com. Confirm it in the dashboard
    // before trusting a lead to it: sending to the wrong one loses the lead
    // silently, because EmailJS still reports success.
    TEMPLATE_ID: "template_qlotxua",
    PUBLIC_KEY: "ki7V3klQWzRzeIMte",
    SITE_NAME: "EZ Shots"                     // hardcoded per site, do not change
  };

  // Fields the template has a real variable for. Everything else gets folded
  // into the message body.
  var CORE = ["name", "email", "phone", "message", "_hp"];

  function ready(fn) {
    if (document.readyState !== "loading") fn();
    else document.addEventListener("DOMContentLoaded", fn);
  }

  // The visible question, so the email reads like the form rather than like
  // a list of input names.
  function labelFor(form, el) {
    if (el.getAttribute("data-label")) return el.getAttribute("data-label");
    var wrap = el.closest(".field, .field-inline");
    var lab = wrap && wrap.querySelector("label");
    if (lab) return lab.textContent.replace(/\s*\*\s*$/, "").trim();
    return el.name.replace(/[_-]+/g, " ").replace(/^./, function (c) { return c.toUpperCase(); });
  }

  function valueOf(form, name) {
    var el = form.elements.namedItem(name);
    if (!el) return "";
    // A RadioNodeList exposes the checked radio's value directly.
    if (typeof el.value === "string" && el.type !== "checkbox") return el.value.trim();
    if (el.type === "checkbox") return el.checked ? (el.value && el.value !== "on" ? el.value : "Yes") : "";
    return "";
  }

  ready(function () {
    var forms = document.querySelectorAll("form.lead-form");
    if (!forms.length) return;

    // Init the SDK if it loaded. If the CDN failed, validation still runs and
    // the send attempt below shows a clear error instead of a dead form.
    var sdkReady = typeof emailjs !== "undefined";
    if (sdkReady) {
      emailjs.init({ publicKey: CONFIG.PUBLIC_KEY });
    } else {
      console.error("[EZ Shots] EmailJS SDK failed to load.");
    }

    forms.forEach(function (form) {
      var btn = form.querySelector('button[type="submit"]');
      var status = form.querySelector(".form-status");
      var btnLabel = btn ? btn.textContent : "Send";

      var required = (form.getAttribute("data-required") || "name,email,message")
        .split(",").map(function (x) { return x.trim(); }).filter(Boolean);
      var subjectPrefix = form.getAttribute("data-subject") || ("New lead from " + CONFIG.SITE_NAME);
      var subjectField = form.getAttribute("data-subject-field") || "";
      var successText = form.getAttribute("data-success") || "Thanks, I will be in touch shortly.";

      // A pricing button can carry its package across to this form, so a ready
      // buyer does not land on a blank select and have to re-choose the thing
      // they just clicked. Matches on a substring so the link can say
      // "essentials" rather than the whole option label.
      (function preselectFromUrl() {
        var want = new URLSearchParams(location.search).get("package");
        if (!want) return;
        var sel = form.elements.namedItem("package");
        if (!sel || !sel.options) return;
        for (var i = 0; i < sel.options.length; i++) {
          if (sel.options[i].value.toLowerCase().indexOf(want.toLowerCase()) !== -1) {
            sel.selectedIndex = i;
            return;
          }
        }
      })();

      function setStatus(type, text) {
        if (!status) return;
        status.className = "form-status show " + type;
        status.textContent = text;
        if (type === "error") status.setAttribute("role", "alert");
      }

      form.addEventListener("submit", function (e) {
        e.preventDefault();

        // Honeypot. A real person never sees this field, so anything in it is
        // a bot. Report success rather than an error: telling a bot it failed
        // just teaches it to try again.
        if (valueOf(form, "_hp")) {
          form.reset();
          setStatus("success", successText);
          return;
        }

        var name = valueOf(form, "name");
        var email = valueOf(form, "email");
        var phone = valueOf(form, "phone");
        var message = valueOf(form, "message");

        var missing = required.filter(function (f) { return !valueOf(form, f); });
        if (missing.length) {
          var el = form.elements.namedItem(missing[0]);
          if (el && el.focus) el.focus();
          var names = missing.map(function (f) {
            var e2 = form.elements.namedItem(f);
            return e2 && e2.tagName ? labelFor(form, e2).toLowerCase() : f;
          });
          // "a, b and c" rather than "a, b, c". A validation message is read
          // by someone who has already made a mistake, so it should not read
          // like a machine listing columns.
          var list = names.length > 1
            ? names.slice(0, -1).join(", ") + " and " + names[names.length - 1]
            : names[0];
          setStatus("error", "Please fill in " + list + ".");
          return;
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          setStatus("error", "That email address does not look right. Please check it.");
          return;
        }

        // Fold every non core field into the message, in form order, so a
        // twenty question intake arrives readable in a template that only
        // knows about {{message}}.
        var extras = [];
        var seen = {};
        Array.prototype.forEach.call(form.elements, function (el) {
          if (!el.name || CORE.indexOf(el.name) !== -1 || seen[el.name]) return;
          if (el.type === "submit" || el.type === "button") return;
          seen[el.name] = true;
          var v = valueOf(form, el.name);
          if (v) extras.push(labelFor(form, el) + ": " + v);
        });

        var body = extras.length ? extras.join("\n") : "";
        if (message) body = body ? body + "\n\nNotes:\n" + message : message;

        var subject = subjectPrefix;
        var tail = subjectField ? valueOf(form, subjectField) : name;
        if (tail) subject += " - " + tail;

        var params = {
          site_name: CONFIG.SITE_NAME,
          from_name: name,
          email_id: email,
          reply_to: email,
          phone: phone,
          message: body,
          subject: subject
        };

        if (typeof emailjs === "undefined") {
          setStatus("error", "Sorry, the form could not load. Please email bigmoneygelo2@gmail.com directly.");
          return;
        }

        if (btn) { btn.disabled = true; btn.textContent = "Sending..."; }
        setStatus("pending", "Sending...");

        emailjs.send(CONFIG.SERVICE_ID, CONFIG.TEMPLATE_ID, params).then(
          function () {
            form.reset();
            form.querySelectorAll(".pkg-cta.open").forEach(function (n) { n.classList.remove("open"); });
            setStatus("success", successText);
            if (btn) { btn.disabled = false; btn.textContent = btnLabel; }
          },
          function (err) {
            console.error("[EZ Shots] EmailJS send failed:", err);
            setStatus("error", "Sorry, something went wrong. Please email bigmoneygelo2@gmail.com or try again.");
            if (btn) { btn.disabled = false; btn.textContent = btnLabel; }
          }
        );
      });
    });
  });
})();
