/**
 * Sign in with Google and Apple — the pure half.
 *
 * Provider configuration, the authorization URL, the round-trip state, and the
 * rules about what an identity is allowed to do once it comes back. No network
 * access and no database, so all of it is testable; the exchange and the
 * signature verification live in `oauth-server.ts`.
 *
 * ## The rule that shapes everything here
 *
 * `CLAUDE.md` says owner logins have exactly one door: an invite token, never
 * stored, single-use. OAuth is a second door unless it is explicitly barred
 * from being one — so it is.
 *
 *   **A staff sign-in can only ever authenticate a `User` that already
 *   exists.** Google returning a verified address we have never seen is not a
 *   signup; it is a failed login with a helpful message. `staffLinkDecision`
 *   below is the whole of that rule and the only place it is decided.
 *
 * Customers are the opposite case and deliberately so. A diner has no invite,
 * no tenant to be provisioned, and no access to anything but their own order
 * history at one restaurant — so a customer sign-in *does* create an account
 * on first use. The two audiences are separate models, separate cookies and
 * separate callbacks precisely so that a change to one cannot quietly become a
 * change to the other.
 *
 * ## What a sign-in still does not grant
 *
 * A verified email address from Apple is not messaging consent, is not a phone
 * number, and is not a `Customer` row. Consent has one door — the checkout
 * checkbox — and `lib/sms.ts` reads `optInStatus` and nothing else. A customer
 * account is a convenience for seeing past orders; it changes nothing about
 * who may be texted.
 */

import { FEATURES } from "@/lib/features";

export type OAuthProvider = "google" | "apple";

/** Who is signing in. Different models, different cookies, different rules. */
export type OAuthAudience = "staff" | "customer";

export const OAUTH_PROVIDERS: OAuthProvider[] = ["google", "apple"];

export const PROVIDER_LABEL: Record<OAuthProvider, string> = {
  google: "Google",
  apple: "Apple",
};

export function isOAuthProvider(v: string): v is OAuthProvider {
  return v === "google" || v === "apple";
}

/* ── Provider endpoints ─────────────────────────────────────────────────── */

export type ProviderEndpoints = {
  authorize: string;
  token: string;
  jwks: string;
  issuer: string;
  scope: string;
  /**
   * Apple posts the callback as a form rather than a query string when name
   * scopes are requested, so the callback route has to read the body. Google
   * uses a plain redirect. Getting this wrong produces a callback that sees no
   * code and reports "sign-in cancelled" for every successful sign-in.
   */
  responseMode: "query" | "form_post";
};

export const ENDPOINTS: Record<OAuthProvider, ProviderEndpoints> = {
  google: {
    authorize: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
    jwks: "https://www.googleapis.com/oauth2/v3/certs",
    issuer: "https://accounts.google.com",
    scope: "openid email profile",
    responseMode: "query",
  },
  apple: {
    authorize: "https://appleid.apple.com/auth/authorize",
    token: "https://appleid.apple.com/auth/token",
    jwks: "https://appleid.apple.com/auth/keys",
    issuer: "https://appleid.apple.com",
    scope: "name email",
    responseMode: "form_post",
  },
};

/* ── Configuration ──────────────────────────────────────────────────────── */

export type ProviderConfig = {
  provider: OAuthProvider;
  clientId: string;
  /** Google: the client secret. Apple: derived per-request, so empty here. */
  clientSecret: string;
};

/**
 * Whether a provider is usable, without throwing.
 *
 * Deliberately soft: a deployment with no Google credentials should render a
 * login page with no Google button, not a crashed login page. Every sign-in
 * surface asks this before drawing anything.
 */
export function providerConfigured(provider: OAuthProvider): boolean {
  // MVP: OAuth is hidden. See `lib/features.ts` — this is the choke point, and
  // returning false here is exactly the state a deployment with no credentials
  // was always in, so every caller's unconfigured branch is the one that runs.
  if (!FEATURES.oauthSignIn) return false;
  if (provider === "google") {
    return Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET);
  }
  return Boolean(
    process.env.APPLE_OAUTH_CLIENT_ID &&
      process.env.APPLE_TEAM_ID &&
      process.env.APPLE_KEY_ID &&
      process.env.APPLE_PRIVATE_KEY
  );
}

export function configuredProviders(): OAuthProvider[] {
  return OAUTH_PROVIDERS.filter(providerConfigured);
}

/**
 * Whether to render a provider button that cannot work yet.
 *
 * Default on, so the buttons are visible while the platform is being set up and
 * you can see what the sign-in surfaces actually look like before spending an
 * afternoon in the Google and Apple consoles.
 *
 * **Set `OAUTH_PREVIEW_BUTTONS=0` before real diners see a storefront.** A
 * placeholder in front of the person building the product costs nothing; the
 * same placeholder in front of a hungry stranger is a dead end on the one page
 * whose whole job is to take their order.
 */
export function previewButtonsEnabled(): boolean {
  return process.env.OAUTH_PREVIEW_BUTTONS !== "0";
}

export type ProviderButton = { provider: OAuthProvider; configured: boolean };

/**
 * What the sign-in surfaces should draw.
 *
 * Every provider is returned with a flag rather than being filtered out, so the
 * caller renders a real link or a visibly inert placeholder and never has to
 * guess which. An unconfigured provider is never given a working href — the
 * start route would only bounce it back to `/login?oauth=unavailable`, which
 * reads as a broken button rather than an unfinished one.
 */
export function providerButtons(): ProviderButton[] {
  // Gated separately from `providerConfigured` on purpose: the preview
  // placeholder renders precisely *because* a provider is unconfigured, so
  // without this a hidden feature would still draw two "coming soon" buttons on
  // the login page and on every storefront.
  if (!FEATURES.oauthSignIn) return [];
  const preview = previewButtonsEnabled();
  return OAUTH_PROVIDERS.map((provider) => ({
    provider,
    configured: providerConfigured(provider),
  })).filter((b) => b.configured || preview);
}

export function providerConfig(provider: OAuthProvider): ProviderConfig | null {
  if (!providerConfigured(provider)) return null;
  if (provider === "google") {
    return {
      provider,
      clientId: process.env.GOOGLE_OAUTH_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!,
    };
  }
  return { provider, clientId: process.env.APPLE_OAUTH_CLIENT_ID!, clientSecret: "" };
}

/**
 * The redirect URI, which must be the **platform** origin and never a tenant's
 * custom domain.
 *
 * Two reasons, and the second is the one that bites. Google and Apple require
 * every redirect URI to be registered in advance, and tenant domains are
 * bring-your-own and cannot be enumerated — so a callback on a custom domain
 * fails at the provider with an error the owner cannot fix. And the OAuth
 * state cookie is set on whichever host started the flow; coming back on a
 * different host means the cookie is not sent and every sign-in fails
 * verification.
 *
 * This is the same three-origin distinction `lib/domains.ts` draws:
 * `platformOrigin()` for things that must stay ours.
 */
export function redirectUri(origin: string, provider: OAuthProvider): string {
  return `${origin.replace(/\/$/, "")}/api/auth/${provider}/callback`;
}

/* ── Round-trip state ───────────────────────────────────────────────────── */

/**
 * What we need back when the provider redirects the browser to us.
 *
 * Carried in a signed, short-lived, HTTP-only cookie rather than in the `state`
 * query parameter. The parameter is echoed by the provider and is therefore
 * attacker-influenced; the cookie is not, and requiring both to agree is what
 * makes the callback resistant to login CSRF — someone who tricks you into
 * following their callback URL does not have their state cookie in your
 * browser, so the comparison fails and nothing happens.
 */
export type OAuthState = {
  provider: OAuthProvider;
  audience: OAuthAudience;
  /** Echoed in the `state` parameter and compared on return. */
  nonce: string;
  /** PKCE. Sent hashed on the way out, in full on the exchange. */
  verifier: string;
  /** Where to land afterwards. Validated as a same-site path, never a URL. */
  next: string;
  /** Customer sign-ins only: which tenant's storefront this belongs to. */
  restaurantId?: string;
  slug?: string;
};

export const OAUTH_STATE_COOKIE = "hearth_oauth_state";
/** Ten minutes: long enough for a slow consent screen, short enough to matter. */
export const OAUTH_STATE_MAX_AGE = 600;

/**
 * Reject anything that isn't a same-site path.
 *
 * `next` arrives from a query string, so without this an attacker crafts a
 * sign-in link that lands the freshly-authenticated user on their site. The
 * scheme-relative case (`//evil.com`) is the one that gets missed — the browser
 * treats it as absolute, so a bare `startsWith("/")` check passes it straight
 * through.
 */
export function safeNextPath(raw: string | null | undefined, fallback = "/"): string {
  if (!raw) return fallback;
  if (!raw.startsWith("/")) return fallback;
  if (raw.startsWith("//") || raw.startsWith("/\\")) return fallback;
  if (raw.includes("://")) return fallback;
  return raw;
}

/* ── PKCE ───────────────────────────────────────────────────────────────── */

export function randomToken(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return base64url(buf);
}

export function base64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** S256 challenge for a verifier. Web Crypto, so it runs in any runtime. */
export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

/* ── Authorization URL ──────────────────────────────────────────────────── */

export async function authorizeUrl(
  config: ProviderConfig,
  state: OAuthState,
  origin: string
): Promise<string> {
  const e = ENDPOINTS[config.provider];
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri(origin, config.provider),
    response_type: "code",
    scope: e.scope,
    state: state.nonce,
    code_challenge: await pkceChallenge(state.verifier),
    code_challenge_method: "S256",
  });

  if (e.responseMode === "form_post") params.set("response_mode", "form_post");
  if (config.provider === "google") {
    // Always show the chooser. Without it, a shared machine silently signs in
    // as whoever used it last, which on an owner dashboard is somebody else's
    // restaurant.
    params.set("prompt", "select_account");
  }

  return `${e.authorize}?${params.toString()}`;
}

/* ── Identity ───────────────────────────────────────────────────────────── */

/** What we keep from a verified ID token. Nothing else is retained. */
export type OAuthIdentity = {
  provider: OAuthProvider;
  /** The provider's stable identifier. This, not the email, is the key. */
  subject: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
};

/**
 * Normalise verified ID-token claims into an identity.
 *
 * The email is lowercased and trimmed because it is used to *find* an existing
 * account, and a mismatch in case reads to the owner as "it says my account
 * doesn't exist" while they are staring at it.
 *
 * Apple's private relay addresses (`…@privaterelay.appleid.com`) are kept as
 * they are. They are real, deliverable addresses and treating them as
 * second-class is how a customer ends up unable to sign back in.
 */
export function identityFromClaims(
  provider: OAuthProvider,
  claims: Record<string, unknown>,
  /** Apple sends the name once, in the callback body, never in the token. */
  fallbackName?: string | null
): OAuthIdentity | null {
  const sub = typeof claims.sub === "string" ? claims.sub.trim() : "";
  if (!sub) return null;

  const rawEmail = typeof claims.email === "string" ? claims.email.trim().toLowerCase() : "";
  // Both providers send this as a boolean or the string "true" depending on
  // provider and version. Accept both rather than silently treating every
  // Apple address as unverified.
  const verified = claims.email_verified === true || claims.email_verified === "true";

  const name =
    (typeof claims.name === "string" && claims.name.trim()) ||
    [claims.given_name, claims.family_name]
      .filter((p): p is string => typeof p === "string" && Boolean(p.trim()))
      .join(" ")
      .trim() ||
    (fallbackName ?? "").trim();

  return {
    provider,
    subject: sub,
    email: rawEmail || null,
    emailVerified: Boolean(verified),
    name: name || null,
  };
}

/* ── The staff rule ─────────────────────────────────────────────────────── */

export type StaffLinkDecision =
  | { kind: "allow"; userId: string }
  | { kind: "deny"; reason: string };

/**
 * Whether a verified identity may sign in as staff. **The invite-only rule.**
 *
 * Pure, so the rule can be tested exhaustively without a database — which
 * matters more here than anywhere else in this module, because every branch
 * that returns `allow` is a way into an owner's dashboard.
 *
 * @param identity the verified claims
 * @param existing the account matched by provider+subject, if we have seen this
 *   identity before
 * @param byEmail the account matched by email address, if any — used for
 *   first-time linking
 */
export function staffLinkDecision(
  identity: OAuthIdentity,
  existing: { userId: string; suspended: boolean } | null,
  byEmail: { userId: string; suspended: boolean } | null
): StaffLinkDecision {
  // Already linked. The email is irrelevant here on purpose: people change the
  // address on their Google account, and the subject is what is stable.
  if (existing) {
    if (existing.suspended) return { kind: "deny", reason: "That account is suspended." };
    return { kind: "allow", userId: existing.userId };
  }

  // First time. Linking by email is only safe when the provider asserts the
  // address is verified — an unverified claim is a self-declared string, and
  // accepting it means anyone who can set their profile email to an owner's
  // address gets that owner's dashboard.
  if (!identity.email || !identity.emailVerified) {
    return {
      kind: "deny",
      reason: `${PROVIDER_LABEL[identity.provider]} didn't give us a verified email address, so we can't match it to an account. Sign in with your email and password, then link ${PROVIDER_LABEL[identity.provider]} from settings.`,
    };
  }

  if (!byEmail) {
    // The invite-only rule, and the reason this function exists. No account is
    // created here, ever.
    return {
      kind: "deny",
      reason:
        "There's no EZ Orders account for that email address. Accounts are created from an invite — check for your invite link, or get in touch and we'll send a new one.",
    };
  }

  if (byEmail.suspended) return { kind: "deny", reason: "That account is suspended." };
  return { kind: "allow", userId: byEmail.userId };
}
