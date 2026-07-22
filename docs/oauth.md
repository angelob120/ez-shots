# Sign in with Google and Apple

Working plan. Read before touching `src/lib/oauth*.ts`,
`src/lib/customer-session.ts`, or anything under `src/app/api/auth/`.

## The rule that shapes everything

`CLAUDE.md`: owner logins have exactly one door — an invite token, 160 bits,
never stored, single-use. OAuth is a second door unless it is explicitly barred
from being one. So:

> **A staff sign-in can only ever authenticate a `User` that already exists.**
> Google returning a verified address we have never seen is not a signup; it is
> a failed login with a helpful message pointing at the invite.

That is `staffLinkDecision` in `lib/oauth.ts` — pure, and the only place the
decision is made. Every branch of it that returns `allow` is a way into an
owner's dashboard, which is why it is pure and why it has 24 tests. **If you
are adding a branch that ends in `setSession`, it belongs in that function.**

Customers are the opposite and deliberately so: a diner has no invite, no tenant
to provision, and access to nothing but their own order history at one
restaurant — so a customer sign-in *does* create an account on first use.

## Two audiences, kept apart structurally

|  | Staff | Customer |
|---|---|---|
| Table | `OAuthIdentity` | `CustomerAccount` |
| Cookie | `hearth_session` | `hearth_customer` |
| Creates an account? | **Never** | Yes, on first sign-in |
| Scope | Platform | One restaurant |

Two tables rather than one with a nullable owner — the same split as
`SupportNote`/`SupportMessage` and `CustomerNote`/`CustomerAdminNote`. A single
identity table with both foreign keys nullable puts a customer identity one
forgotten `WHERE` clause away from authenticating into an owner dashboard. Two
tables make the mistake unavailable rather than discouraged.

Customer accounts are **per tenant**. Signing in at two restaurants gives you
two accounts and neither sees the other. One platform-wide identity would turn
each tenant's customer list into a shared directory, and that list is the
product.

## What a customer account is not

Not a `Customer`, not a phone number, and **not consent**. `customerId` stays
null until a phone number arrives at checkout, because `Customer.phone` is the
dedupe key for the tenant's list and an email address cannot stand in for it.
`lib/sms.ts` reads `optInStatus` and nothing else, and signing in with Apple
changes neither.

## What landed on each surface

| Surface | What it does |
|---|---|
| `/login` | Provider buttons, and the denial reason rendered above the form. |
| `/dashboard/sign-in` | Connect and disconnect providers. Third tab under Settings. |
| Storefront footer | Sign in, or who you're signed in as with a link to your orders. |
| `/r/[slug]/account` | Past orders for the signed-in diner. Server-rendered, no JS. |
| Checkout | Prefills the **name** from the account. Never the phone number. |

The phone number is deliberately not prefilled even when we know it: the number
typed at checkout is what the consent record and every order notification hang
off, so prefilling it means a shared phone or a borrowed laptop silently sends
someone else's order to someone else's number.

`customerId` is linked in `placeOrderAction` and **only** there — scoped to the
tenant, and only onto a row where it is still null, so two people sharing a
laptop cannot merge into one customer record. The write is best-effort: a
failure there must not fail a paid order.

There is no "connect provider" server action, deliberately. Connecting is a
link into the normal sign-in flow. A code path that writes an `OAuthIdentity`
without the provider vouching for it in the same request would be a way to
attach an arbitrary subject to an account.

## Flow

```
/api/auth/[provider]/start   → seals state into a signed cookie, redirects to provider
/api/auth/[provider]/callback → GET (Google) or POST (Apple form_post)
/api/auth/signout            → POST only, clears the customer cookie only
```

Security order in the callback, which is the security of the whole feature:

1. State cookie present, signed by us, unexpired.
2. The `state` parameter the provider echoed matches the nonce inside it. An
   attacker cannot set a cookie for our origin in the victim's browser, so a
   forwarded callback URL is inert.
3. The ID token is **verified** against the provider's published JWKS, issuer
   and audience — not decoded. A decoded-but-unverified token is a string the
   browser handed us.
4. Only then does anything get looked up or written.

Details that are easy to get wrong and are already handled:

- **The flow always runs on `platformOrigin()`.** Tenant custom domains are
  bring-your-own and cannot be pre-registered with a provider, and a state
  cookie set on one host is not sent back to another. Storefront sign-in links
  are therefore absolute.
- **`restaurantId` is resolved from a slug server-side**, exactly as the
  analytics beacon does. Accepting an id from the query would let anyone mint a
  session pointed at a tenant they were never on.
- **The state cookie is `SameSite=None` for Apple and `Lax` for Google.** Apple
  posts the callback cross-site as a form and a Lax cookie is not sent on a
  cross-site POST. Google comes back as a top-level GET where Lax works and is
  stricter — and `None` requires `Secure`, which would break local http
  development.
- **Apple sends the display name exactly once**, in the callback body, never in
  the token and never again. The callback reads it; the upsert only writes the
  name when it has one, so the second sign-in does not erase it.
- **Apple's client secret is minted per exchange** — an ES256 JWT signed with
  the `.p8` key, five-minute expiry. `\n` sequences in the env var are restored
  before parsing, because most hosts mangle real newlines.
- **`safeNextPath` rejects `//evil.example`.** A bare `startsWith("/")` check
  passes the scheme-relative form straight through and the browser treats it as
  absolute.
- **Unconfigured providers are never fatal.** `providerConfigured` is soft, so
  missing credentials mean "that button doesn't work yet", never a 500.
- **They are still *drawn*, by default.** `OAUTH_PREVIEW_BUTTONS` (on unless set
  to `0`) renders an unconfigured provider as a visibly inert button —
  greyed, dashed border, "coming soon", no href. The reasoning: a login page
  that looks identical whether or not the setup was ever done is precisely the
  "looks finished, isn't" failure this codebase keeps hitting, and the flag
  makes the unfinished state visible instead. The placeholder deliberately has
  no working link; pointing it at the start route would bounce back to
  `/login?oauth=unavailable` and read as broken rather than unfinished.

  **Set `OAUTH_PREVIEW_BUTTONS=0` before real diners see a storefront.** A
  placeholder in front of the person building the product costs nothing; the
  same placeholder on the page whose entire job is to take a stranger's order
  is a dead end.

## Environment

| Variable | For |
|---|---|
| `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` | Google |
| `APPLE_OAUTH_CLIENT_ID` | Apple **Services ID**, not the app bundle id |
| `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` | Apple |
| `APP_URL` | Required — the redirect URI is built from it |
| `OAUTH_PREVIEW_BUTTONS` | Optional. `0` hides buttons that can't work yet; anything else (or unset) shows them inert. |

Redirect URIs to register, exactly:

```
https://<APP_URL>/api/auth/google/callback
https://<APP_URL>/api/auth/apple/callback
```

`scripts/config-check.mjs` warns on a half-configured provider and on
credentials without `APP_URL`.

## What's left

**Both of these block the feature entirely, and both are the familiar shape —
correct code that never runs.**

1. **Migration `27_oauth_accounts` has never run.** `npx prisma generate &&
   npm run db:push` on a real machine, alongside the other unrun migrations
   listed in `CLAUDE.md`. Until then `prisma.oAuthIdentity` and
   `prisma.customerAccount` do not exist on the client and both callbacks throw.
2. **No provider credentials exist.** A Google Cloud OAuth client and an Apple
   Services ID plus signing key both have to be created by hand in consoles a
   coding session cannot reach. Apple additionally requires a verified domain
   and a paid developer account. Until they exist, `configuredProviders()`
   returns `[]` and no button renders anywhere — which is the correct behaviour,
   and is also why this will look finished when it is not.

Then, in order:

3. **No audit trail on staff sign-in.** `lastLoginAt` is updated; there is no
   record of *failed* attempts or of a link being established. `OAuthIdentity`
   rows should probably be append-only in spirit the way `ServiceSuspension` is.
   P2.
4. **Apple email relay churn.** If a user disables email forwarding, the relay
   address stops working. Nothing detects this. P3.
5. **No tests for the callback routes.** The pure decisions are covered; the
   routes that call them are not. Same gap `orders.concurrency.test.ts` closed
   for orders. P2.

---

## Status: switched off for the MVP

`FEATURES.oauthSignIn` in `src/lib/features.ts` is `false`, so
`providerConfigured()` returns false and `providerButtons()` returns `[]`
regardless of what credentials are set. No button renders anywhere, both
`/api/auth/[provider]` routes bounce to `/login?oauth=unavailable`, and
`/dashboard/sign-in` 404s.

Nothing in this document is stale as a result — the design, the rules and the
setup steps are all still what has to happen. It is a visibility switch, and
`staffLinkDecision` is deliberately untouched by it: **an OAuth sign-in still
cannot create an operator account**, and the hidden buttons must never be what
enforces that.

Six credential-reading cases in `scripts/oauth.test.ts` are skipped while the
flag is off, gated rather than deleted, and two new ones assert the kill switch
directly. Restore checklist: `docs/mvp-hidden-features.md`.
