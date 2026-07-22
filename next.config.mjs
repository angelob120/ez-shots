/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: { remotePatterns: [{ protocol: "https", hostname: "**" }] },

  /**
   * Short aliases for the policy pages.
   *
   * These exist because the short forms are what gets typed into a carrier
   * registration form, an app-store listing, and a Stripe account profile —
   * and those fields are entered once and then hard to change. Permanent
   * redirects so the canonical `/legal/*` URL is the one that gets indexed.
   */
  async redirects() {
    return [
      { source: "/terms", destination: "/legal/terms", permanent: true },
      { source: "/tos", destination: "/legal/terms", permanent: true },
      { source: "/privacy", destination: "/legal/privacy", permanent: true },
      { source: "/privacy-policy", destination: "/legal/privacy", permanent: true },
      { source: "/refunds", destination: "/legal/refunds", permanent: true },
      { source: "/sms", destination: "/legal/messaging", permanent: true },
      { source: "/messaging", destination: "/legal/messaging", permanent: true },
      { source: "/cookies", destination: "/legal/cookies", permanent: true },
      { source: "/aup", destination: "/legal/acceptable-use", permanent: true },
      { source: "/dmca", destination: "/legal/ip-policy", permanent: true },
    ];
  },
  experimental: {
    // Hosts we may legitimately be reached under. Next compares the Server
    // Action's `Origin` against `x-forwarded-host` and aborts on a mismatch;
    // behind Cloudflare + Railway those two disagree unless we say otherwise.
    // Tenant custom domains are handled in the host-rewrite Worker instead —
    // they're bring-your-own and can't be enumerated here.
    serverActions: {
      allowedOrigins: [
        ...new Set(
          [
            // Fallback origin for Cloudflare for SaaS. Traffic arriving under
            // this Host is "platform" traffic to the Worker, so it passes
            // through WITHOUT the Origin rewrite — meaning Origin stays
            // `origin.blueobsidian.xyz` while Railway stamps x-forwarded-host
            // as the .up.railway.app host. Allow it explicitly.
            "origin.blueobsidian.xyz",
            "blueobsidian.xyz",
            "www.blueobsidian.xyz",
            // Railway's own generated hostname.
            process.env.RAILWAY_PUBLIC_DOMAIN,
            ...(process.env.ALLOWED_ACTION_ORIGINS ?? "").split(","),
          ]
            .map((h) => h?.trim().toLowerCase())
            .filter(Boolean)
        ),
      ],
    },
  },
};
export default nextConfig;
