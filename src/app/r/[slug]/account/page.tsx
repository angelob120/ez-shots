import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { tenantWhere, platformOrigin } from "@/lib/domains";
import { getCustomerSession } from "@/lib/customer-session";
import { storeRootProps } from "@/components/customer/theme";
import { orderPath } from "@/lib/orders";
import { FEATURES } from "@/lib/features";

/**
 * "Your orders" — the thing that makes a customer sign-in worth having.
 *
 * Server-rendered, no JavaScript, no client bundle. It is a list of past orders
 * and a link to each status page; the status page already exists and already
 * knows how to show an order, so this does not reimplement it.
 *
 * Two access rules, both enforced by the queries rather than by a check that
 * could be forgotten:
 *
 * - The session is read **for this tenant**, so a signature-valid cookie from
 *   another restaurant's storefront resolves to null here.
 * - Orders are selected by `customerId` taken from the account row, never from
 *   anything in the URL. There is no parameter on this page that names a
 *   customer, so there is nothing to tamper with.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your orders",
  robots: { index: false, follow: false },
};

function money(cts: number): string {
  return `$${(cts / 100).toFixed(2)}`;
}

const STATUS_LABEL: Record<string, string> = {
  RECEIVED: "Received",
  ACCEPTED: "Accepted",
  READY: "Ready for pickup",
  COMPLETED: "Picked up",
  CANCELED: "Cancelled",
  REJECTED: "Not accepted",
};

export default async function AccountPage({ params }: { params: { slug: string } }) {
  // MVP: customer accounts are hidden — 404 rather than render an empty list.
  // `getCustomerSession` already returns null (lib/features.ts), which would
  // send the diner to the storefront with the implication that signing in first
  // would have worked. Nothing here can sign them in, so say the page isn't
  // there. See docs/mvp-hidden-features.md.
  if (!FEATURES.customerAccounts) notFound();

  const restaurant = await prisma.restaurant.findFirst({
    where: tenantWhere(params.slug),
    select: {
      id: true,
      slug: true,
      name: true,
      accentColor: true,
      theme: true,
      themePreset: true,
    },
  });
  if (!restaurant) notFound();

  const session = await getCustomerSession(restaurant.id);
  if (!session) {
    // Not signed in is not an error state worth a page of its own — the
    // storefront footer is where sign-in lives.
    redirect(`/r/${restaurant.slug}`);
  }

  const account = await prisma.customerAccount.findFirst({
    where: { id: session.accountId, restaurantId: restaurant.id },
    select: { name: true, email: true, customerId: true },
  });
  if (!account) redirect(`/r/${restaurant.slug}`);

  // No linked customer means they have signed in but never ordered — the link
  // is made at checkout, because a Customer is keyed by phone and a sign-in
  // supplies an email address.
  const orders = account.customerId
    ? await prisma.order.findMany({
        where: { restaurantId: restaurant.id, customerId: account.customerId },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: {
          id: true,
          publicToken: true,
          number: true,
          status: true,
          totalCts: true,
          refundedCts: true,
          createdAt: true,
          items: { select: { name: true, qty: true } },
        },
      })
    : [];

  return (
    <div className="store min-h-screen bg-s-bg text-s-ink" {...storeRootProps(restaurant)}>
      <div className="mx-auto max-w-[640px] px-5 py-12">
        <a
          href={`/r/${restaurant.slug}`}
          className="text-[13px] text-s-mute underline underline-offset-2 hover:opacity-70"
        >
          &larr; {restaurant.name}
        </a>

        <h1 className="mt-4 text-[26px] font-semibold tracking-tight">Your orders</h1>
        <p className="mt-2 text-[13.5px] text-s-dim">
          Signed in as {account.name || account.email}.
        </p>

        {orders.length === 0 ? (
          <div className="mt-8 rounded-2xl border border-s-line bg-s-raised px-5 py-10 text-center">
            <p className="text-[15px] font-semibold">Nothing here yet</p>
            <p className="mx-auto mt-2 max-w-[340px] text-[13.5px] leading-relaxed text-s-dim">
              Orders you place from now on will show up here. If you have ordered before with a
              different phone number, those orders stay on the text message they were confirmed
              with.
            </p>
            <a
              href={`/r/${restaurant.slug}`}
              className="mt-6 inline-flex h-11 items-center rounded-full bg-s-accent px-6 text-[14px] font-semibold text-white"
            >
              See the menu
            </a>
          </div>
        ) : (
          <ul className="mt-8 space-y-3">
            {orders.map((o) => {
              const items = o.items.map((i) => `${i.qty}× ${i.name}`).join(", ");
              return (
                <li key={o.id}>
                  <a
                    href={orderPath(o.publicToken)}
                    className="block rounded-2xl border border-s-line bg-s-raised px-5 py-4 transition hover:border-s-accent"
                  >
                    <div className="flex items-baseline justify-between gap-4">
                      <span className="text-[15px] font-semibold">Order {o.number}</span>
                      <span className="text-[13px] tabular-nums text-s-dim">
                        {money(o.totalCts)}
                        {o.refundedCts > 0 && (
                          <span className="ml-1.5 text-s-mute">
                            ({money(o.refundedCts)} refunded)
                          </span>
                        )}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-[13px] text-s-dim" title={items}>
                      {items}
                    </p>
                    <p className="mt-1.5 text-[12px] text-s-mute">
                      {STATUS_LABEL[o.status] ?? o.status} &middot;{" "}
                      {o.createdAt.toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </p>
                  </a>
                </li>
              );
            })}
          </ul>
        )}

        <form
          method="POST"
          action={`${platformOrigin()}/api/auth/signout`}
          className="mt-10 border-t border-s-line pt-6"
        >
          <input type="hidden" name="next" value={`/r/${restaurant.slug}`} />
          <button
            type="submit"
            className="text-[13px] text-s-mute underline underline-offset-2 hover:opacity-70"
          >
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
