import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { FEATURES } from "@/lib/features";
import { getSession, requireOwner } from "@/lib/auth";
import { providerButtons, PROVIDER_LABEL, type OAuthProvider } from "@/lib/oauth";
import { Card, SectionTitle } from "@/components/hearth/ui";
import UnlinkButton from "./UnlinkButton";

export const dynamic = "force-dynamic";

/**
 * Sign-in methods for an operator account.
 *
 * This page exists because the OAuth denial message tells people to "link
 * Google from settings", and a product that names a screen it does not have is
 * worse than one that says nothing.
 *
 * What it deliberately does not offer: a way to add a password, or a way to
 * create an account. Owner logins have one door — an invite token — and
 * connecting a provider happens by signing in with it, never by a button here
 * that writes an identity row directly.
 */
export default async function SignInSettingsPage() {
  // MVP: OAuth is hidden and the tab strip no longer links here, but a
  // bookmarked URL would otherwise render a settings page with nothing on it.
  // See lib/features.ts and docs/mvp-hidden-features.md.
  if (!FEATURES.oauthSignIn) notFound();

  await requireOwner();
  const session = await getSession();

  const [user, identities] = await Promise.all([
    session
      ? prisma.user.findUnique({
          where: { id: session.userId },
          select: { email: true, name: true },
        })
      : null,
    session
      ? prisma.oAuthIdentity
          .findMany({
            where: { userId: session.userId },
            select: { provider: true, email: true, lastLoginAt: true, createdAt: true },
          })
          .catch(() => [])
      : [],
  ]);

  const available = providerButtons();
  const linked = new Map(identities.map((i) => [i.provider as OAuthProvider, i]));

  return (
    <div className="space-y-6">
      <SectionTitle
        title="Sign-in methods"
        subtitle="How you get into this dashboard. Your email and password always work."
      />

      <Card>
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line pb-4">
          <div>
            <p className="text-[13px] font-medium text-ink">Email and password</p>
            <p className="text-[12px] text-dim">{user?.email ?? "—"}</p>
          </div>
          <span className="text-[12px] text-mute">Always available</span>
        </div>

        {available.length === 0 ? (
          <p className="pt-4 text-[12.5px] leading-relaxed text-dim">
            Google and Apple sign-in aren&apos;t switched on for this deployment. When they are,
            they&apos;ll appear here.
          </p>
        ) : (
          <div className="divide-y divide-line">
            {available.map(({ provider: p, configured }) => {
              const link = linked.get(p);
              return (
                <div key={p} className="flex flex-wrap items-center justify-between gap-3 py-4">
                  <div>
                    <p className="text-[13px] font-medium text-ink">{PROVIDER_LABEL[p]}</p>
                    <p className="text-[12px] text-dim">
                      {!configured ? (
                        "Not set up on this deployment yet"
                      ) : link ? (
                        <>
                          Connected{link.email ? ` as ${link.email}` : ""}
                          {link.lastLoginAt &&
                            ` · last used ${link.lastLoginAt.toLocaleDateString("en-US", {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                            })}`}
                        </>
                      ) : (
                        "Not connected"
                      )}
                    </p>
                  </div>

                  {!configured ? (
                    // Shown, but with no href. Pointing it at the start route
                    // would bounce straight back with an error and read as
                    // broken rather than unfinished.
                    <span className="inline-flex h-9 cursor-not-allowed items-center rounded-sm border border-dashed border-line2 px-4 text-[13px] text-mute">
                      Coming soon
                    </span>
                  ) : link ? (
                    <UnlinkButton provider={p} label={`Disconnect ${PROVIDER_LABEL[p]}`} />
                  ) : (
                    // A link, not a button calling an action — connecting *is*
                    // signing in. There is no path that attaches a provider
                    // identity to an account without the provider vouching for
                    // it in the same request.
                    <a
                      href={`/api/auth/${p}/start?next=/dashboard/sign-in`}
                      className="inline-flex h-9 items-center rounded-sm border border-line2 bg-surface2 px-4 text-[13px] font-medium text-ink transition-colors hover:bg-surface"
                    >
                      Connect {PROVIDER_LABEL[p]}
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card>
        <p className="text-[12.5px] leading-relaxed text-dim">
          <span className="text-ink">Connecting is safe to do and safe to undo.</span> Signing in
          with Google or Apple never creates a new EZ Orders account — it matches the verified
          email address to the account you already have. Disconnecting removes that shortcut and
          nothing else; your restaurant, menu and customer list are untouched, and your email and
          password keep working.
        </p>
      </Card>
    </div>
  );
}
