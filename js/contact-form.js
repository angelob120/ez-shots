// EZ Shots contact form -> EmailJS (client side, no backend).
// Every submission emails the lead to the owner. SITE_NAME is hardcoded per
// site so the email always names its origin even when templates are shared.
(function () {
  // ------------------------------------------------------------------
  // CONFIG (these are publishable client-side keys, safe to ship)
  // ------------------------------------------------------------------
  var CONFIG = {
    SERVICE_ID: "service_dburs96",           // Gmail service, already connected
    // Use the template whose "To Email" is angelobrown1000@gmail.com.
    // In this account it is one of template_qlotxua / template_ztl1ney.
    // Confirm which in the EmailJS dashboard and set it here.
    TEMPLATE_ID: "template_qlotxua",
    // Paste from EmailJS -> Account -> General -> API Keys.
    PUBLIC_KEY: "ki7V3klQWzRzeIMte",
    SITE_NAME: "EZ Shots"                     // hardcoded per site, do not change
  };

  function ready(fn) {
    if (document.readyState !== "loading") fn();
    else document.addEventListener("DOMContentLoaded", fn);
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

      function setStatus(type, text) {
        if (!status) return;
        status.className = "form-status show " + type;
        status.textContent = text;
      }

      form.addEventListener("submit", function (e) {
        e.preventDefault();

        function fieldValue(fieldName) {
          var el = form.elements.namedItem(fieldName);
          return el && typeof el.value === "string" ? el.value.trim() : "";
        }
        var name = fieldValue("name");
        var email = fieldValue("email");
        var phone = fieldValue("phone");
        var message = fieldValue("message");
        var pkg = fieldValue("package");

        // Client side validation: Name, Email, Message required.
        if (!name || !email || !message) {
          setStatus("error", "Please fill in your name, email, and a short message.");
          return;
        }
        var emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
        if (!emailOk) {
          setStatus("error", "That email address does not look right. Please check it.");
          return;
        }

        // Fold the package choice into the message so it reaches the inbox.
        var fullMessage = message;
        if (pkg) fullMessage = "Package interest: " + pkg + "\n\n" + message;

        var params = {
          site_name: CONFIG.SITE_NAME,
          from_name: name,
          email_id: email,
          reply_to: email,
          phone: phone,
          message: fullMessage,
          subject: "New lead from " + CONFIG.SITE_NAME + " - " + name
        };

        if (typeof emailjs === "undefined") {
          setStatus("error", "Sorry, the form could not load. Please email us directly.");
          return;
        }

        if (btn) { btn.disabled = true; btn.textContent = "Sending..."; }
        setStatus("pending", "Sending...");

        emailjs.send(CONFIG.SERVICE_ID, CONFIG.TEMPLATE_ID, params).then(
          function () {
            form.reset();
            setStatus("success", "Thanks, we'll be in touch.");
            if (btn) { btn.disabled = false; btn.textContent = btnLabel; }
          },
          function (err) {
            console.error("[EZ Shots] EmailJS send failed:", err);
            setStatus("error", "Sorry, something went wrong. Please email us directly or try again.");
            if (btn) { btn.disabled = false; btn.textContent = btnLabel; }
          }
        );
      });
    });
  });
})();
