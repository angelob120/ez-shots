import "server-only";
import { SignJWT, jwtVerify, createRemoteJWKSet, importPKCS8 } from "jose";
import {
  ENDPOINTS,
  OAUTH_STATE_MAX_AGE,
  identityFromClaims,
  redirectUri,
  type OAuthIdentity,
  type OAuthProvider,
  type OAuthState,
  type ProviderConfig,
} from "@/lib/oauth";

/**
 * The half of OAuth that talks to the network and holds secrets.
 *
 * Kept apart from `lib/oauth.ts` so the rules in that module stay testable
 * without stubbing a token endpoint — the invite-only staff rule in particular
 * is the sort of thing that must be covered by tests that always run, not
 * tests that need credentials.
 */

function secret(): Uint8Array {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) {
    throw new Error("SESSION_SECRET is missing or too short (need 16+ chars).");
  }
  return new TextEncoder().encode(s);
}

/* ── The state cookie ───────────────────────────────────────────────────── */

/**
 * The round-trip state, signed so the callback can trust it came from our own
 * start route and has not been edited in transit.
 *
 * Short-lived by construction rather than by cleanup: it carries its own
 * expiry, so an abandoned sign-in from an hour ago cannot be replayed even if
 * the cookie survives in the browser.
 */
export async function sealState(state: OAuthState): Promise<string> {
  return new SignJWT(state as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${OAUTH_STATE_MAX_AGE}s`)
    .sign(secret());
}

export async function openState(token: string | undefined): Promise<OAuthState | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    const p = payload as Record<string, unknown>;
    if (typeof p.nonce !== "string" || typeof p.verifier !== "string") return null;
    if (p.provider !== "google" && p.provider !== "apple") return null;
    if (p.audience !== "staff" && p.audience !== "customer") return null;
    return {
      provider: p.provider,
      audience: p.audience,
      nonce: p.nonce,
      verifier: p.verifier,
      next: typeof p.next === "string" ? p.next : "/",
      restaurantId: typeof p.restaurantId === "string" ? p.restaurantId : undefined,
      slug: typeof p.slug === "string" ? p.slug : undefined,
    };
  } catch {
    return null;
  }
}

/* ── Apple's client secret ──────────────────────────────────────────────── */

/**
 * Apple does not issue a static client secret. It expects a short-lived ES256
 * JWT signed with a private key downloaded from the developer portal — so the
 * "secret" has to be minted per exchange.
 *
 * The key arrives through an environment variable, which mangles newlines on
 * most hosts; `\n` sequences are restored before parsing because otherwise
 * `importPKCS8` fails with an error that says nothing about the real cause.
 */
async function appleClientSecret(): Promise<string> {
  const teamId = process.env.APPLE_TEAM_ID!;
  const keyId = process.env.APPLE_KEY_ID!;
  const clientId = process.env.APPLE_OAUTH_CLIENT_ID!;
  const pem = (process.env.APPLE_PRIVATE_KEY ?? "").replace(/\\n/g, "\n").trim();

  const key = await importPKCS8(pem, "ES256");
  return new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: keyId })
    .setIssuer(teamId)
    .setIssuedAt()
    // Apple caps this at six months; minutes is all we need and limits the
    // blast radius if one is captured in a log.
    .setExpirationTime("5m")
    .setAudience("https://appleid.apple.com")
    .setSubject(clientId)
    .sign(key);
}

/* ── Token exchange ─────────────────────────────────────────────────────── */

const JWKS = new Map<OAuthProvider, ReturnType<typeof createRemoteJWKSet>>();

function jwks(provider: OAuthProvider) {
  // Cached per provider: `createRemoteJWKSet` caches keys internally, and a
  // fresh one per sign-in would refetch Google's key set on every login.
  let set = JWKS.get(provider);
  if (!set) {
    set = createRemoteJWKSet(new URL(ENDPOINTS[provider].jwks));
    JWKS.set(provider, set);
  }
  return set;
}

export type ExchangeResult =
  | { ok: true; identity: OAuthIdentity }
  | { ok: false; error: string };

/**
 * Swap an authorization code for a verified identity.
 *
 * The ID token is verified against the provider's published keys, its issuer
 * and its audience — not merely decoded. A decoded-but-unverified token is a
 * string the browser handed us, and trusting one means anyone can sign in as
 * anyone by editing a JSON payload.
 */
export async function exchangeCode(
  config: ProviderConfig,
  code: string,
  state: OAuthState,
  origin: string,
  fallbackName?: string | null
): Promise<ExchangeResult> {
  const e = ENDPOINTS[config.provider];

  let clientSecret: string;
  try {
    clientSecret =
      config.provider === "apple" ? await appleClientSecret() : config.clientSecret;
  } catch {
    return { ok: false, error: "Apple sign-in isn't configured correctly on our side." };
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(origin, config.provider),
    client_id: config.clientId,
    client_secret: clientSecret,
    code_verifier: state.verifier,
  });

  let res: Response;
  try {
    res = await fetch(e.token, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body,
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return { ok: false, error: "We couldn't reach the sign-in provider. Try again in a moment." };
  }

  if (!res.ok) {
    // The provider's error body routinely contains the client secret back at
    // us in failure modes, so it is not logged and not surfaced.
    return { ok: false, error: "That sign-in didn't complete. Try again." };
  }

  let payload: { id_token?: string };
  try {
    payload = (await res.json()) as { id_token?: string };
  } catch {
    return { ok: false, error: "That sign-in didn't complete. Try again." };
  }
  if (!payload.id_token) return { ok: false, error: "That sign-in didn't complete. Try again." };

  let claims: Record<string, unknown>;
  try {
    const verified = await jwtVerify(payload.id_token, jwks(config.provider), {
      issuer: e.issuer,
      audience: config.clientId,
    });
    claims = verified.payload as Record<string, unknown>;
  } catch {
    return { ok: false, error: "We couldn't verify that sign-in. Try again." };
  }

  const identity = identityFromClaims(config.provider, claims, fallbackName);
  if (!identity) return { ok: false, error: "That sign-in didn't return an account we can use." };

  return { ok: true, identity };
}
