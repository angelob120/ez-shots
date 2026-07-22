/**
 * Tests for the pure half of Google/Apple sign-in.
 *
 * Run with `npx tsx scripts/oauth.test.ts`. No network, no Prisma — which is
 * exactly why the invite-only rule lives in a pure function. Every branch of
 * `staffLinkDecision` that returns `allow` is a way into an owner's dashboard,
 * and a rule that can only be exercised by standing up an OAuth provider is a
 * rule that stops being exercised.
 *
 * The property being defended, stated once: **an OAuth sign-in can never
 * create an operator account.** `lib/invites.ts` is the only door, the token is
 * never stored, and a second path that mints an owner login from a Google
 * profile would make all of that decorative.
 */

import assert from "node:assert/strict";
import {
  identityFromClaims,
  isOAuthProvider,
  providerConfigured,
  configuredProviders,
  redirectUri,
  safeNextPath,
  staffLinkDecision,
  providerButtons,
  previewButtonsEnabled,
  pkceChallenge,
  randomToken,
  type OAuthIdentity,
} from "../src/lib/oauth";
import { FEATURES } from "../src/lib/features";

let passed = 0;
let skipped = 0;

/**
 * The credential-reading tests, which only mean anything when the feature is
 * on.
 *
 * `FEATURES.oauthSignIn` short-circuits `providerConfigured` deliberately (see
 * `lib/features.ts`), so with it off these would be asserting that a kill
 * switch is on — which the `kill switch` tests below do directly, and better.
 * Skipped rather than deleted: the credential logic is untouched and has to
 * come back green when the flag flips, and a deleted test comes back as
 * nothing.
 */
const configTest: typeof test = FEATURES.oauthSignIn
  ? test
  : ((name: string) => {
      skipped++;
      void name;
      return undefined;
    }) as typeof test;

function test(name: string, fn: () => void | Promise<void>) {
  const done = () => {
    passed++;
  };
  try {
    const r = fn();
    if (r instanceof Promise) {
      return r.then(done, (err) => {
        console.error(`FAIL  ${name}`);
        throw err;
      });
    }
    done();
  } catch (err) {
    console.error(`FAIL  ${name}`);
    throw err;
  }
}

const google = (over: Partial<OAuthIdentity> = {}): OAuthIdentity => ({
  provider: "google",
  subject: "sub-123",
  email: "owner@example.com",
  emailVerified: true,
  name: "Ada",
  ...over,
});

/* ── The staff rule ─────────────────────────────────────────────────────── */

test("an unknown verified identity is DENIED, not signed up", () => {
  const d = staffLinkDecision(google(), null, null);
  assert.equal(d.kind, "deny");
  // The message has to point at the invite, because "there is no account" with
  // no next step reads as a broken product rather than as a closed door.
  assert.match(d.kind === "deny" ? d.reason : "", /invite/i);
});

test("an already-linked identity signs in", () => {
  const d = staffLinkDecision(google(), { userId: "u1", suspended: false }, null);
  assert.deepEqual(d, { kind: "allow", userId: "u1" });
});

test("a linked identity signs in even when the provider email has changed", () => {
  // The subject is the identity. People change the address on a Google account
  // and locking them out for it is a support call with no good answer.
  const d = staffLinkDecision(
    google({ email: "somewhere-else@example.com" }),
    { userId: "u1", suspended: false },
    null
  );
  assert.deepEqual(d, { kind: "allow", userId: "u1" });
});

test("a linked identity with no email at all still signs in", () => {
  const d = staffLinkDecision(
    google({ email: null, emailVerified: false }),
    { userId: "u1", suspended: false },
    null
  );
  assert.deepEqual(d, { kind: "allow", userId: "u1" });
});

test("first-time linking by verified email finds the existing account", () => {
  const d = staffLinkDecision(google(), null, { userId: "u7", suspended: false });
  assert.deepEqual(d, { kind: "allow", userId: "u7" });
});

test("an UNVERIFIED email never links, even to an account that exists", () => {
  // The attack this closes: set the email on a throwaway provider account to
  // an owner's address, sign in, get their dashboard. An unverified claim is a
  // string the user typed.
  const d = staffLinkDecision(
    google({ emailVerified: false }),
    null,
    { userId: "u7", suspended: false }
  );
  assert.equal(d.kind, "deny");
});

test("a missing email never links", () => {
  const d = staffLinkDecision(
    google({ email: null }),
    null,
    { userId: "u7", suspended: false }
  );
  assert.equal(d.kind, "deny");
});

test("a suspended tenant is denied on both paths", () => {
  assert.equal(staffLinkDecision(google(), { userId: "u1", suspended: true }, null).kind, "deny");
  assert.equal(staffLinkDecision(google(), null, { userId: "u7", suspended: true }).kind, "deny");
});

test("the linked identity wins over an email match on a different account", () => {
  // Two accounts, one address reused. The link is the stronger statement:
  // somebody deliberately connected this provider identity to that account.
  const d = staffLinkDecision(
    google(),
    { userId: "linked", suspended: false },
    { userId: "by-email", suspended: false }
  );
  assert.deepEqual(d, { kind: "allow", userId: "linked" });
});

/* ── Claims ─────────────────────────────────────────────────────────────── */

test("identityFromClaims requires a subject", () => {
  assert.equal(identityFromClaims("google", { email: "a@b.com" }), null);
  assert.equal(identityFromClaims("google", { sub: "   " }), null);
});

test("email is lowercased and trimmed so matching does not depend on typing", () => {
  const id = identityFromClaims("google", { sub: "s", email: "  Owner@Example.COM " })!;
  assert.equal(id.email, "owner@example.com");
});

test("email_verified is accepted as a boolean or the string Apple sends", () => {
  assert.equal(identityFromClaims("google", { sub: "s", email_verified: true })!.emailVerified, true);
  assert.equal(identityFromClaims("apple", { sub: "s", email_verified: "true" })!.emailVerified, true);
  assert.equal(identityFromClaims("apple", { sub: "s", email_verified: "false" })!.emailVerified, false);
  assert.equal(identityFromClaims("apple", { sub: "s" })!.emailVerified, false);
});

test("a name is assembled from given/family when there is no name claim", () => {
  const id = identityFromClaims("google", { sub: "s", given_name: "Ada", family_name: "Lovelace" })!;
  assert.equal(id.name, "Ada Lovelace");
});

test("Apple's one-time name from the callback body is used as a fallback", () => {
  // Apple sends the display name exactly once, in the form post, never in the
  // token. Dropping it here means the account is nameless forever.
  const id = identityFromClaims("apple", { sub: "s" }, "Grace Hopper")!;
  assert.equal(id.name, "Grace Hopper");
});

test("an Apple private relay address is kept as a real address", () => {
  const id = identityFromClaims("apple", {
    sub: "s",
    email: "abc123@privaterelay.appleid.com",
    email_verified: true,
  })!;
  assert.equal(id.email, "abc123@privaterelay.appleid.com");
  assert.equal(id.emailVerified, true);
});

/* ── Redirect safety ────────────────────────────────────────────────────── */

test("safeNextPath allows same-site paths", () => {
  assert.equal(safeNextPath("/dashboard/menu"), "/dashboard/menu");
  assert.equal(safeNextPath("/r/pizza?x=1"), "/r/pizza?x=1");
});

test("safeNextPath rejects the scheme-relative bypass", () => {
  // The one that gets missed: a bare startsWith("/") check passes //evil.com
  // straight through, and the browser treats it as absolute.
  assert.equal(safeNextPath("//evil.example"), "/");
  assert.equal(safeNextPath("/\\evil.example"), "/");
});

test("safeNextPath rejects absolute URLs and honours the fallback", () => {
  assert.equal(safeNextPath("https://evil.example/x"), "/");
  assert.equal(safeNextPath("javascript:alert(1)"), "/");
  assert.equal(safeNextPath(null, "/dashboard"), "/dashboard");
  assert.equal(safeNextPath("", "/dashboard"), "/dashboard");
});

/* ── Config and endpoints ───────────────────────────────────────────────── */

test("isOAuthProvider is a real guard", () => {
  assert.equal(isOAuthProvider("google"), true);
  assert.equal(isOAuthProvider("apple"), true);
  assert.equal(isOAuthProvider("facebook"), false);
  assert.equal(isOAuthProvider("../../etc/passwd"), false);
});

test("redirectUri is built on the platform origin and tolerates a trailing slash", () => {
  assert.equal(
    redirectUri("https://ezorders.app", "google"),
    "https://ezorders.app/api/auth/google/callback"
  );
  assert.equal(
    redirectUri("https://ezorders.app/", "apple"),
    "https://ezorders.app/api/auth/apple/callback"
  );
});

configTest("an unconfigured provider is absent rather than throwing", () => {
  const saved = {
    id: process.env.GOOGLE_OAUTH_CLIENT_ID,
    secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
  };
  delete process.env.GOOGLE_OAUTH_CLIENT_ID;
  delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  try {
    // A deployment with no credentials must render a login page with no Google
    // button — not a login page that 500s.
    assert.equal(providerConfigured("google"), false);
    assert.ok(!configuredProviders().includes("google"));
  } finally {
    if (saved.id) process.env.GOOGLE_OAUTH_CLIENT_ID = saved.id;
    if (saved.secret) process.env.GOOGLE_OAUTH_CLIENT_SECRET = saved.secret;
  }
});

configTest("a half-configured Apple is not configured", () => {
  const keys = ["APPLE_OAUTH_CLIENT_ID", "APPLE_TEAM_ID", "APPLE_KEY_ID", "APPLE_PRIVATE_KEY"];
  const saved = keys.map((k) => [k, process.env[k]] as const);
  try {
    for (const k of keys) process.env[k] = "x";
    assert.equal(providerConfigured("apple"), true);
    // Missing any one of the four means the token exchange fails at Apple with
    // an opaque error. Better to not offer the button.
    delete process.env.APPLE_PRIVATE_KEY;
    assert.equal(providerConfigured("apple"), false);
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

/* ── Preview buttons ────────────────────────────────────────────────────── */

/** Run `fn` with the OAuth env wiped to a known state, then restore it. */
function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
  const keys = [
    "GOOGLE_OAUTH_CLIENT_ID",
    "GOOGLE_OAUTH_CLIENT_SECRET",
    "APPLE_OAUTH_CLIENT_ID",
    "APPLE_TEAM_ID",
    "APPLE_KEY_ID",
    "APPLE_PRIVATE_KEY",
    "OAUTH_PREVIEW_BUTTONS",
  ];
  const saved = keys.map((k) => [k, process.env[k]] as const);
  try {
    for (const k of keys) delete process.env[k];
    for (const [k, v] of Object.entries(vars)) if (v !== undefined) process.env[k] = v;
    fn();
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

configTest("preview is on by default, so unconfigured providers still render", () => {
  // The point of the default: a login page that looks identical whether or not
  // the setup was ever done is the "looks finished, isn't" failure this repo
  // keeps hitting.
  withEnv({}, () => {
    assert.equal(previewButtonsEnabled(), true);
    const buttons = providerButtons();
    assert.equal(buttons.length, 2);
    assert.deepEqual(buttons.map((b) => b.configured), [false, false]);
  });
});

configTest("OAUTH_PREVIEW_BUTTONS=0 hides what cannot work", () => {
  // What you set before real diners see a storefront. A placeholder in front of
  // a hungry stranger is a dead end on the page whose job is to take the order.
  withEnv({ OAUTH_PREVIEW_BUTTONS: "0" }, () => {
    assert.equal(previewButtonsEnabled(), false);
    assert.deepEqual(providerButtons(), []);
  });
});

configTest("a configured provider renders whatever the preview setting is", () => {
  const google = { GOOGLE_OAUTH_CLIENT_ID: "id", GOOGLE_OAUTH_CLIENT_SECRET: "secret" };
  withEnv({ ...google, OAUTH_PREVIEW_BUTTONS: "0" }, () => {
    assert.deepEqual(providerButtons(), [{ provider: "google", configured: true }]);
  });
  withEnv(google, () => {
    assert.deepEqual(providerButtons(), [
      { provider: "google", configured: true },
      { provider: "apple", configured: false },
    ]);
  });
});

configTest("preview never claims a half-configured provider works", () => {
  // The flag controls visibility, never configured-ness. A button that says it
  // works and then fails at the provider is worse than one that says it does
  // not work yet.
  withEnv({ APPLE_OAUTH_CLIENT_ID: "x", APPLE_TEAM_ID: "y" }, () => {
    const apple = providerButtons().find((b) => b.provider === "apple")!;
    assert.equal(apple.configured, false);
  });
});

/* ── PKCE ───────────────────────────────────────────────────────────────── */

const async1 = test("the PKCE challenge is base64url with no padding", async () => {
  const challenge = await pkceChallenge("verifier-value");
  assert.match(challenge, /^[A-Za-z0-9_-]+$/);
  assert.equal(challenge.includes("="), false);
  // Deterministic for a given verifier, or the exchange fails every time.
  assert.equal(challenge, await pkceChallenge("verifier-value"));
  assert.notEqual(challenge, await pkceChallenge("other-value"));
});

test("randomToken is url-safe and does not repeat", () => {
  const a = randomToken();
  const b = randomToken();
  assert.match(a, /^[A-Za-z0-9_-]+$/);
  assert.notEqual(a, b);
});

/* ── The MVP kill switch ────────────────────────────────────────────────── */

test("the feature flag hides every provider, credentials or not", () => {
  // The property the flag has to have: with it off, no surface can draw a
  // button and no route can start a flow, regardless of what is in the
  // environment. Asserted against a *fully* configured environment, because
  // "hidden because nothing is set up" is the state this must not be confused
  // with — that one comes back the moment someone adds a client ID.
  if (FEATURES.oauthSignIn) return;
  withEnv(
    {
      GOOGLE_OAUTH_CLIENT_ID: "id",
      GOOGLE_OAUTH_CLIENT_SECRET: "secret",
      APPLE_OAUTH_CLIENT_ID: "a",
      APPLE_TEAM_ID: "b",
      APPLE_KEY_ID: "c",
      APPLE_PRIVATE_KEY: "d",
    },
    () => {
      assert.equal(providerConfigured("google"), false);
      assert.equal(providerConfigured("apple"), false);
      assert.deepEqual(configuredProviders(), []);
      // Separately gated from providerConfigured on purpose: the preview
      // placeholder renders *because* a provider is unconfigured, so without
      // its own check a hidden feature would still draw two dead buttons.
      assert.deepEqual(providerButtons(), []);
    }
  );
});

test("the flag does not touch the invite-only rule", () => {
  // `staffLinkDecision` is the security property and must be independent of
  // visibility. If hiding the buttons were what kept OAuth from creating owner
  // accounts, un-hiding them would be a security change rather than a UI one.
  const claims: OAuthIdentity = {
    provider: "google",
    subject: "sub-1",
    email: "stranger@example.com",
    emailVerified: true,
    name: null,
  };
  const decision = staffLinkDecision(claims, null, null);
  assert.equal(decision.kind, "deny");
});

Promise.resolve(async1).then(() => {
  console.log(`oauth: ${passed} passed${skipped ? `, ${skipped} skipped (oauthSignIn flag off)` : ""}`);
});
