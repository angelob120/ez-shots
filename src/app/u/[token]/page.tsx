import { prisma } from "@/lib/prisma";
import { recordEmailOptOut } from "@/lib/email";
import { resubscribeAction } from "./actions";

export const dynamic = "force-dynamic";

/**
 * The unsubscribe page.
 *
 * ─── Why it unsubscribes on GET ───────────────────────────────────────────
 *
 * Normally a GET that changes state is a mistake — a link prefetcher or an
 * antivirus scanner following links in mail will trip it. Here that trade is
 * taken deliberately, and in the safe direction:
 *
 *   - The failure mode of unsubscribing too eagerly is somebody stops getting
 *     marketing email they can re-enable with one click on this same page.
 *   - The failure mode of requiring a confirmation click is a person who
 *     believes they unsubscribed, keeps receiving mail, and presses "report
 *     spam" instead. That verdict goes to the mailbox provider, applies to the
 *     sending domain, and damages deliverability for every tenant sharing it.
 *
 * RFC 8058 one-click makes the same call for the same reason, and the header
 * we send with every marketing email (see lib/email-sendgrid.ts) points here.
 *
 * ─── Why it's on the platform origin ──────────────────────────────────────
 *
 * `lib/domains.ts` keeps three origins apart and this is a `platformOrigin()`
 * case, even though the mail is from the restaurant. An unsubscribe link has to
 * work for years — including after the owner lets their custom domain lapse or
 * leaves the platform entirely — and a suppression request we can't honour
 * because a hostname stopped resolving is a CAN-SPAM violation with our name on
 * it.
 *
 * ─── Why there is no auth ─────────────────────────────────────────────────
 *
 * The token is the auth, the same arrangement `/o/[token]` uses for order
 * status. Asking somebody to sign in to stop receiving email is the single
 * most reliable way to convert them into a spam complaint.
 */
export default async function UnsubscribePage({
  params,
  searchParams,
}: {
  params: { token: string };
  searchParams: { resubscribed?: string };
}) {
  const resubscribed = searchParams.resubscribed === "1";

  // Guarded, and the guard is load-bearing: without it the redirect back from
  // `resubscribeAction` would land on this page and immediately unsubscribe
  // them again, so the "keep me subscribed" button would silently do nothing.
  const customer = resubscribed
    ? await lookupByToken(params.token)
    : await recordEmailOptOut(params.token, "unsubscribed");

  if (!customer) {
    return (
      <Shell>
        <h1 className="text-[20px] text-ink">Link not recognised</h1>
        <p className="mt-3 text-[14px] leading-relaxed text-dim">
          This unsubscribe link isn&apos;t valid. It may have been truncated by your email client —
          try copying the whole address from the message.
        </p>
      </Shell>
    );
  }

  const restaurant = await prisma.restaurant.findUnique({
    where: { id: customer.restaurantId },
    select: { name: true },
  });

  return (
    <Shell>
      {resubscribed ? (
        <>
          <h1 className="text-[20px] text-ink">You&apos;re back on the list</h1>
          <p className="mt-3 text-[14px] leading-relaxed text-dim">
            {restaurant?.name ?? "The restaurant"} can email you again at{" "}
            <span className="font-mono text-[13px]">{customer.email}</span>.
          </p>
        </>
      ) : (
        <>
          <h1 className="text-[20px] text-ink">Unsubscribed</h1>
          <p className="mt-3 text-[14px] leading-relaxed text-dim">
            {restaurant?.name ?? "The restaurant"} will stop emailing{" "}
            <span className="font-mono text-[13px]">{customer.email}</span>.
          </p>

          {/* Said plainly because it is the question people actually have, and
              because an unsubscribe that silently killed order notifications
              would be a worse outcome than the one they asked to avoid. */}
          <p className="mt-3 text-[13px] leading-relaxed text-mute">
            You&apos;ll still get messages about orders you place — receipts and pickup updates.
            Those aren&apos;t marketing, and turning them off would leave you waiting on food with
            no way to know it&apos;s ready.
          </p>

          <form action={resubscribeAction} className="mt-6">
            <input type="hidden" name="token" value={params.token} />
            <button className="text-[13px] text-dim underline underline-offset-2 hover:text-ink">
              Actually, keep me subscribed
            </button>
          </form>
        </>
      )}
    </Shell>
  );
}

function lookupByToken(token: string) {
  return prisma.customer.findUnique({
    where: { emailUnsubToken: token },
    select: { id: true, restaurantId: true, email: true },
  });
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-[520px] flex-col justify-center px-6 py-16">
      <div className="rounded-sm border border-line bg-surface p-8">{children}</div>
    </main>
  );
}
