import { PROVIDER_LABEL, providerButtons, type OAuthProvider } from "@/lib/oauth";

/**
 * Google / Apple sign-in buttons.
 *
 * A server component rendering plain links — no JavaScript, nothing to
 * hydrate. Each button is a GET to the start route, which is where the whole
 * flow is decided.
 *
 * A provider without credentials still renders, as a visibly inert button with
 * a note saying so. That is `OAUTH_PREVIEW_BUTTONS`, on by default: the
 * alternative is a login page that looks finished and identical whether or not
 * the setup was ever done, which is exactly the "looks done, isn't" failure
 * this codebase keeps running into. The placeholder is deliberately not a
 * working link — pointing it at the start route would bounce straight back to
 * `/login?oauth=unavailable` and read as broken rather than unfinished.
 */
export default function OAuthButtons({
  /** "staff" for the operator login, "customer" for a storefront. */
  audience = "staff",
  slug,
  next,
  label = "Or continue with",
}: {
  audience?: "staff" | "customer";
  slug?: string;
  next?: string;
  label?: string;
}) {
  const buttons = providerButtons();
  if (buttons.length === 0) return null;

  const href = (p: OAuthProvider) => {
    const params = new URLSearchParams();
    if (audience === "customer") params.set("as", "customer");
    if (slug) params.set("slug", slug);
    if (next) params.set("next", next);
    const qs = params.toString();
    return `/api/auth/${p}/start${qs ? `?${qs}` : ""}`;
  };

  const anyUnconfigured = buttons.some((b) => !b.configured);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-line" />
        <span className="text-[11px] uppercase tracking-[0.08em] text-mute">{label}</span>
        <span className="h-px flex-1 bg-line" />
      </div>

      <div className="grid gap-2">
        {buttons.map(({ provider, configured }) =>
          configured ? (
            <a
              key={provider}
              href={href(provider)}
              className="flex h-10 items-center justify-center gap-2.5 rounded-sm border border-line2 bg-surface2 text-[13px] font-medium text-ink transition-colors hover:bg-surface"
            >
              <ProviderMark provider={provider} />
              Continue with {PROVIDER_LABEL[provider]}
            </a>
          ) : (
            <button
              key={provider}
              type="button"
              disabled
              // `title` rather than only the footnote below, because on a
              // touchscreen the footnote is the only explanation and on a
              // desktop the hover is the faster one.
              title={`${PROVIDER_LABEL[provider]} sign-in hasn't been set up on this deployment yet.`}
              className="flex h-10 cursor-not-allowed items-center justify-center gap-2.5 rounded-sm border border-dashed border-line2 bg-surface2/40 text-[13px] font-medium text-mute"
            >
              <span className="opacity-40">
                <ProviderMark provider={provider} />
              </span>
              Continue with {PROVIDER_LABEL[provider]}
              <span className="text-[11px] font-normal">— coming soon</span>
            </button>
          )
        )}
      </div>

      {anyUnconfigured && (
        <p className="text-[11px] leading-relaxed text-mute">
          Greyed-out options aren&apos;t connected yet. They light up as soon as the credentials
          are set — see <code className="text-dim">docs/SETUP-your-turn.md</code>.
        </p>
      )}
    </div>
  );
}

/**
 * Brand marks, inline. Both providers' guidelines require their own mark on the
 * button and forbid recolouring it — so these carry literal hex values rather
 * than theme tokens, which is the one place in the operator UI where that is
 * correct.
 */
function ProviderMark({ provider }: { provider: OAuthProvider }) {
  if (provider === "google") {
    return (
      <svg viewBox="0 0 18 18" className="h-4 w-4" aria-hidden>
        <path
          fill="#4285F4"
          d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
        />
        <path
          fill="#34A853"
          d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z"
        />
        <path
          fill="#FBBC05"
          d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z"
        />
        <path
          fill="#EA4335"
          d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
        />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 18 18" className="h-4 w-4" aria-hidden fill="currentColor">
      <path d="M12.9 9.55c-.02-1.9 1.55-2.81 1.62-2.86-.88-1.29-2.26-1.47-2.75-1.49-1.17-.12-2.29.69-2.88.69-.6 0-1.51-.67-2.48-.66-1.28.02-2.46.74-3.12 1.88-1.33 2.3-.34 5.7.95 7.57.63.91 1.39 1.94 2.38 1.9.95-.04 1.31-.62 2.46-.62s1.48.62 2.49.6c1.03-.02 1.68-.93 2.31-1.85.73-1.06 1.03-2.09 1.05-2.14-.02-.01-2.01-.77-2.03-3.06ZM11.03 3.9c.52-.64.88-1.52.78-2.4-.75.03-1.67.5-2.21 1.13-.48.56-.91 1.46-.79 2.32.84.06 1.7-.42 2.22-1.05Z" />
    </svg>
  );
}
