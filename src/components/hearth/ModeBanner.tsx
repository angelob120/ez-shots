"use client";

import { useEffect, useState } from "react";

/**
 * The banner that will not go away while money isn't moving.
 *
 * It sits in the *layout*, above everything, on every admin page — not on the
 * payments screen where you'd only see it if you already remembered. The whole
 * failure it guards against is forgetting, so it has to be somewhere you can't
 * navigate away from.
 *
 * Three deliberate choices:
 *
 *   - **It counts down live.** A static "expires at 04:12" is a number you have
 *     to do arithmetic on. "2h 14m left" is a fact.
 *   - **It says what's actually happening in plain terms** — orders are being
 *     taken and no money is arriving. "Payment mode: STUB" means nothing at a
 *     glance and is exactly the phrasing that gets skimmed past for a week.
 *   - **There is no dismiss button.** A banner you can dismiss is a banner
 *     that's dismissed.
 *
 * `variant="owner"` is the restaurant-facing wording. They are the ones cooking
 * food for orders that collected nothing, so they get told — but in their terms,
 * not ours.
 */
export default function ModeBanner({
  mode,
  expiresAt,
  revertTo,
  variant = "admin",
}: {
  mode: "TEST" | "STUB";
  /** ISO string — serialised across the server/client boundary. */
  expiresAt: string | null;
  revertTo: string | null;
  variant?: "admin" | "owner";
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!expiresAt) return;
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [expiresAt]);

  const remaining = expiresAt ? new Date(expiresAt).getTime() - now : null;
  const lapsed = remaining !== null && remaining <= 0;

  const headline =
    variant === "owner"
      ? "Card payments aren't collecting money right now"
      : mode === "STUB"
        ? "Payments are stubbed — checkout succeeds and charges nothing"
        : "Payments are in Stripe test mode — no real money is moving";

  const body =
    variant === "owner"
      ? "Orders still come through and you should still make the food, but nothing is being charged to the customer's card. We're on it — this is on our side, not yours."
      : mode === "STUB"
        ? "Customers complete checkout, kitchens cook, and Stripe has no record of any of it."
        : "Charges land on the test keys. Refundable, visible in the Stripe test dashboard, worth nothing.";

  return (
    <div className="border-b border-warnLine bg-warnBg">
      <div className="mx-auto flex max-w-[1180px] flex-wrap items-center gap-x-3 gap-y-1 px-6 py-2">
        <span className="flex h-2 w-2 shrink-0">
          <span className="absolute inline-flex h-2 w-2 animate-ping rounded-full bg-warnInk opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-warnInk" />
        </span>

        <span className="text-[12.5px] font-semibold text-warnInk">{headline}</span>
        <span className="text-[12px] text-warnDim">{body}</span>

        {expiresAt && variant === "admin" && (
          <span className="ml-auto shrink-0 font-mono text-[12px] text-warnInk">
            {lapsed
              ? "reverting on next order"
              : `${formatRemaining(remaining!)} left${revertTo ? ` → ${revertTo}` : ""}`}
          </span>
        )}

        {!expiresAt && variant === "admin" && (
          <span className="ml-auto shrink-0 font-mono text-[12px] text-badInk">
            no timer set
          </span>
        )}
      </div>
    </div>
  );
}

function formatRemaining(ms: number): string {
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${Math.max(1, mins)}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}
