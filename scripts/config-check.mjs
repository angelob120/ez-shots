/**
 * Boot-time configuration preflight for the things that fail silently.
 *
 * Companion to storage-check.mjs, and the same argument: a missing env var
 * doesn't announce itself, it just makes one feature quietly wrong until a
 * customer runs into it. This checks the two that are worst to discover late.
 *
 * Unlike the storage check there's no round-trip here — these are questions
 * about configuration, answerable without talking to anyone.
 */

const {
  APP_URL,
  NEXT_PUBLIC_APP_URL,
  SMS_PROVIDER,
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_MESSAGING_SERVICE_SID,
  PAYMENT_MODE,
  STRIPE_SECRET_KEY,
  STRIPE_SECRET_KEY_TEST,
  STRIPE_SECRET_KEY_LIVE,
  STRIPE_PUBLISHABLE_KEY_TEST,
  STRIPE_PUBLISHABLE_KEY_LIVE,
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
} = process.env;

const log = (msg) => console.log(`[config] ${msg}`);
let fatal = false;

// ---------------------------------------------------------------------------
// APP_URL — post-order-gaps.md item 7
// ---------------------------------------------------------------------------
//
// orderUrl() falls back to a bare `/o/<token>` path when neither var is set.
// In the logged-message stub that's harmless and even readable. In a real text
// message it is a string a customer cannot act on, and there is nothing in the
// running system that looks wrong — the message sends, the row says SENT, and
// the only symptom is a customer who can't find their order and phones the
// restaurant instead. Which is the exact support call this product exists to
// remove.

const base = (APP_URL ?? NEXT_PUBLIC_APP_URL ?? "").trim();
const smsLive = SMS_PROVIDER === "twilio";

if (!base) {
  if (smsLive) {
    log("✗ APP_URL is unset and SMS_PROVIDER=twilio.");
    log("  Order links in outgoing texts would be a bare path — useless to a customer.");
    log("  Set APP_URL to the public origin (e.g. https://order.example.com).");
    fatal = true;
  } else {
    log("! APP_URL is unset. Order links will be bare paths.");
    log("  Harmless while SMS is stubbed; fatal the moment it isn't.");
  }
} else {
  try {
    const u = new URL(base);
    if (u.protocol !== "https:" && u.hostname !== "localhost") {
      log(`! APP_URL is ${u.protocol}// — links in texts should be https outside local dev.`);
    }
    log(`✓ APP_URL=${u.origin}`);
  } catch {
    log(`✗ APP_URL is not a valid URL: ${base}`);
    log("  Needs a scheme — https://host, not host.");
    fatal = true;
  }
}

// ---------------------------------------------------------------------------
// SMS provider — post-order-gaps.md item 11
// ---------------------------------------------------------------------------
//
// getSmsProvider() falls back to the stub when the flag is set but credentials
// are missing. That fallback is the safe behaviour at runtime and a terrible
// thing to discover in production, because the failure mode is total silence
// that looks exactly like success: every Message row says SENT.

const { TWILIO_API_KEY_SID, TWILIO_API_KEY_SECRET } = process.env;
const hasApiKey = TWILIO_API_KEY_SID && TWILIO_API_KEY_SECRET;
const hasAuthToken = !!TWILIO_AUTH_TOKEN;

if (!smsLive) {
  log(`driver=stub — SMS_PROVIDER=${SMS_PROVIDER ?? "unset"}. Messages are recorded, not sent.`);
} else if (!TWILIO_ACCOUNT_SID || (!hasApiKey && !hasAuthToken)) {
  const missing = [];
  if (!TWILIO_ACCOUNT_SID) missing.push("TWILIO_ACCOUNT_SID");
  if (!hasApiKey && !hasAuthToken) {
    missing.push("TWILIO_AUTH_TOKEN (or TWILIO_API_KEY_SID + TWILIO_API_KEY_SECRET)");
  }
  log(`✗ SMS_PROVIDER=twilio but missing: ${missing.join(", ")}`);
  log("  The app would fall back to the stub and send nothing, silently.");
  fatal = true;
} else if (!TWILIO_ACCOUNT_SID.startsWith("AC")) {
  // The single most common Twilio misconfiguration: an API Key SID (SK…) put
  // in the Account SID slot. It authenticates but breaks the request URL, which
  // is built as /Accounts/{TWILIO_ACCOUNT_SID}/Messages.json — the path has to
  // name the AC… account, never the key.
  log(`✗ TWILIO_ACCOUNT_SID starts with ${TWILIO_ACCOUNT_SID.slice(0, 2)}… — it must be the AC… Account SID.`);
  log("  An SK… value here is an API Key SID; it belongs in TWILIO_API_KEY_SID.");
  log("  The Account SID is in the URL path and every send fails without the AC… value.");
  fatal = true;
} else {
  log(
    hasApiKey
      ? `✓ driver=twilio account=${TWILIO_ACCOUNT_SID.slice(0, 8)}… auth=API key ${TWILIO_API_KEY_SID.slice(0, 8)}…`
      : `✓ driver=twilio account=${TWILIO_ACCOUNT_SID.slice(0, 8)}… auth=Auth Token`
  );

  // The API key signs outbound sends, but Twilio signs *inbound* webhooks with
  // the Account Auth Token — an API key secret cannot validate them. Without the
  // token, sms-webhook.ts rejects every callback with a 503, so STOP/START and
  // delivery receipts silently stop being processed. That's a consent-record
  // failure, not just a missing feature.
  if (hasApiKey && !hasAuthToken) {
    log("! Using an API key but TWILIO_AUTH_TOKEN is unset — inbound webhooks (STOP/START,");
    log("  delivery receipts) will be rejected. Set TWILIO_AUTH_TOKEN as well for signature checks.");
  }
  log(
    TWILIO_MESSAGING_SERVICE_SID
      ? "  platform messaging service configured — tenants without their own smsFrom can still send."
      : "! no TWILIO_MESSAGING_SERVICE_SID — tenants with no smsFrom of their own cannot send at all."
  );
  log("  Reminder: sending numbers still need A2P 10DLC registration to reach US carriers.");
}

// ---------------------------------------------------------------------------
// Email provider
// ---------------------------------------------------------------------------
//
// Same failure shape as SMS, one notch worse. getEmailProvider() falls back to
// the stub when the flag is set but the key is missing, and a marketing
// campaign then reports "sent to 240 people" with 240 Message rows saying SENT
// while nothing left the building. An owner discovers that from a promotion
// nobody redeemed, weeks later, with no way to tell it apart from a promotion
// nobody wanted.
//
// EMAIL_FROM is checked separately and is the sharper edge: without it there is
// no sender for tenants who haven't verified a domain of their own, which is
// all of them on day one.

const { EMAIL_PROVIDER, SENDGRID_API_KEY, EMAIL_FROM, SENDGRID_SANDBOX } = process.env;
const emailLive = EMAIL_PROVIDER === "sendgrid";

if (!emailLive) {
  log(`email driver=stub — EMAIL_PROVIDER=${EMAIL_PROVIDER ?? "unset"}. Email is recorded, not sent.`);
} else if (!SENDGRID_API_KEY) {
  log("✗ EMAIL_PROVIDER=sendgrid but SENDGRID_API_KEY is unset.");
  log("  The app would fall back to the stub and send nothing, silently.");
  fatal = true;
} else {
  log(`✓ email driver=sendgrid${SENDGRID_SANDBOX === "1" ? " (SANDBOX — validates, delivers nothing)" : ""}`);

  if (!EMAIL_FROM) {
    log("✗ EMAIL_PROVIDER=sendgrid but EMAIL_FROM is unset.");
    log("  Tenants without their own verified sending domain — which is all of them");
    log("  initially — would have no from-address at all. Every send fails at the API.");
    fatal = true;
  } else {
    log(`  platform sender ${EMAIL_FROM} — must be a verified sender or on a verified domain in SendGrid.`);
  }

  log("  Reminder: an unverified sending domain fails DMARC at the recipient and lands in spam");
  log("  while SendGrid still reports a successful send. Verify the domain, not just the address.");
}

// The unsubscribe link is minted on platformOrigin(). Without APP_URL it is a
// bare path — an unsubscribe link a reader cannot click, which is the specific
// thing that makes them press "report spam" instead. That verdict attaches to
// the sending domain and is shared by every tenant on it.
if (emailLive && !base) {
  log("✗ EMAIL_PROVIDER=sendgrid but APP_URL is unset — unsubscribe links would be bare paths.");
  log("  An unsubscribe that doesn't work is a CAN-SPAM problem and a deliverability one.");
  fatal = true;
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------
//
// The live mode now lives in the database (PlatformSetting), flippable from
// /admin, so this can only check the *env* — that each key set present is
// internally consistent, and that PAYMENT_MODE's default has the keys it needs.
// A key set with no secret degrades to the stub at runtime, which reports every
// charge as succeeded while no money moves; that is the failure this guards.

// Resolve each mode's secret key the same way stripeConfigForMode does: the
// split var first, then the unsuffixed var when its prefix matches. Secret keys
// come in two species — standard (sk_) and restricted (rk_) — and either is a
// valid secret; only the test/live half of the prefix has to match the slot.
const isTestSecret = (v) => v?.startsWith("sk_test_") || v?.startsWith("rk_test_");
const isLiveSecret = (v) => v?.startsWith("sk_live_") || v?.startsWith("rk_live_");

const testSecret = STRIPE_SECRET_KEY_TEST ?? (isTestSecret(STRIPE_SECRET_KEY) ? STRIPE_SECRET_KEY : undefined);
const liveSecret = STRIPE_SECRET_KEY_LIVE ?? (isLiveSecret(STRIPE_SECRET_KEY) ? STRIPE_SECRET_KEY : undefined);
const testPub = STRIPE_PUBLISHABLE_KEY_TEST ?? (NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.startsWith("pk_test_") ? NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY : undefined);
const livePub = STRIPE_PUBLISHABLE_KEY_LIVE ?? (NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.startsWith("pk_live_") ? NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY : undefined);

// Any key present but the wrong species is a hard error — a live secret in a
// test slot (or vice versa) routes real money somewhere nobody intended.
const wrongSlot = [
  ["test secret", STRIPE_SECRET_KEY_TEST, (v) => isTestSecret(v), "sk_test_/rk_test_"],
  ["live secret", STRIPE_SECRET_KEY_LIVE, (v) => isLiveSecret(v), "sk_live_/rk_live_"],
  ["test publishable", STRIPE_PUBLISHABLE_KEY_TEST, (v) => v?.startsWith("pk_test_"), "pk_test_"],
  ["live publishable", STRIPE_PUBLISHABLE_KEY_LIVE, (v) => v?.startsWith("pk_live_"), "pk_live_"],
];
for (const [name, val, ok, want] of wrongSlot) {
  if (val && !ok(val)) {
    log(`✗ Stripe ${name} key should start with ${want} — wrong key in this slot.`);
    fatal = true;
  }
}

log(`payments keys: test=${testSecret ? "✓" : "—"}${testPub ? "+pub" : ""}  live=${liveSecret ? "✓" : "—"}${livePub ? "+pub" : ""}`);

const mode = (PAYMENT_MODE ?? "STUB").toUpperCase();
if (mode === "TEST" && !testSecret) {
  log("! PAYMENT_MODE=TEST but no test secret key — default would fall back to the stub until an admin sets a mode with keys.");
} else if (mode === "LIVE" && !liveSecret) {
  log("! PAYMENT_MODE=LIVE but no live secret key — default would fall back to the stub until an admin sets a mode with keys.");
} else if (mode === "LIVE") {
  log("✓ default payment mode LIVE — real money. Each restaurant needs completed Stripe Connect onboarding or its whole bill routes to the platform.");
} else {
  log(`default payment mode ${mode}. Admins can flip this at /admin/test-mode without a redeploy.`);
  // This is only the *env fallback*, used when the settings row has never been
  // written. The live value lives in the database and carries an auto-revert
  // timer — see lib/payments.ts. Worth saying out loud because a deploy log
  // reading "STUB" next to a full set of live keys otherwise looks like a
  // misconfiguration when it's usually just an untouched default.
  if (liveSecret) {
    log("  Live keys are present, so an admin can switch to LIVE at any time.");
  }
}

// Webhook secret is what lets Connect status and payment state update on their
// own. Absent, the endpoint rejects everything (safe) and owners fall back to
// the Refresh button — worth noting, not fatal.
const hasWebhookSecret =
  !!process.env.STRIPE_WEBHOOK_SECRET_TEST ||
  !!process.env.STRIPE_WEBHOOK_SECRET_LIVE ||
  !!process.env.STRIPE_WEBHOOK_SECRET;
if ((testSecret || liveSecret) && !hasWebhookSecret) {
  log("! No STRIPE_WEBHOOK_SECRET — Stripe webhooks are rejected; Connect/payment status won't auto-update.");
}

// ---------------------------------------------------------------------------
// Google / Apple sign-in
// ---------------------------------------------------------------------------
//
// Half-configured is the failure worth catching. A missing credential set is
// fine — the buttons simply aren't offered — but a partial one produces a
// button that goes to the provider and comes back with an opaque error, which
// reads as "sign-in is broken" rather than "sign-in isn't set up".

const googleParts = {
  GOOGLE_OAUTH_CLIENT_ID: process.env.GOOGLE_OAUTH_CLIENT_ID,
  GOOGLE_OAUTH_CLIENT_SECRET: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
};
const appleParts = {
  APPLE_OAUTH_CLIENT_ID: process.env.APPLE_OAUTH_CLIENT_ID,
  APPLE_TEAM_ID: process.env.APPLE_TEAM_ID,
  APPLE_KEY_ID: process.env.APPLE_KEY_ID,
  APPLE_PRIVATE_KEY: process.env.APPLE_PRIVATE_KEY,
};

for (const [label, parts] of [["Google", googleParts], ["Apple", appleParts]]) {
  const set = Object.entries(parts).filter(([, v]) => !!v);
  const missing = Object.entries(parts).filter(([, v]) => !v).map(([k]) => k);
  if (set.length === 0) continue;
  if (missing.length === 0) {
    log(`✓ Sign in with ${label} configured.`);
  } else {
    log(`! Sign in with ${label} is half-configured — missing ${missing.join(", ")}. The button is hidden until every value is set.`);
  }
}

// The redirect URI is registered with the provider in advance and must match
// exactly. Without APP_URL we cannot build it, so every sign-in fails at the
// provider with a mismatch the operator cannot debug from our logs.
if ((Object.values(googleParts).some(Boolean) || Object.values(appleParts).some(Boolean)) && !process.env.APP_URL) {
  log("! OAuth credentials are set but APP_URL is not — the redirect URI can't be built and every sign-in will fail at the provider.");
}

// Fatal by default, unlike storage. A broken image degrades the page; a text
// message nobody receives, or one carrying a link that goes nowhere, is a
// promise the product made and didn't keep. Set CONFIG_CHECK_STRICT=0 to boot
// anyway.
if (fatal && process.env.CONFIG_CHECK_STRICT !== "0") {
  log("refusing to boot. Set CONFIG_CHECK_STRICT=0 to override.");
  process.exit(1);
}

process.exit(0);
