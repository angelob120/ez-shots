"use client";

import * as React from "react";
import Icon from "./Icon";
import { AccentButton, Photo, Sheet, Stepper, Steps, SwipeRow, cx } from "./primitives";
import { STOCK } from "./stock";
import { money } from "./theme";
import { summarizeSelection, unitPriceCts, type CartLine, type MenuItemDTO } from "@/lib/cart";
import { OPT_IN_TEXT } from "@/lib/consent";
import type { PlacedOrder } from "@/app/r/[slug]/actions";

export type Totals = {
  subtotalCts: number;
  surchargeCts: number;
  taxCts: number;
  totalCts: number;
};

/** Floating bar that only exists when there's something in the cart. */
export function CartBar({
  count,
  totalCts,
  onOpen,
  disabledReason,
}: {
  count: number;
  totalCts: number;
  onOpen: () => void;
  /**
   * Set when the kitchen isn't accepting orders. The bar stays visible — the
   * cart is still theirs and will still be here when the place reopens — but
   * it stops pretending to be a way through to checkout.
   */
  disabledReason?: string | null;
}) {
  // Replay the nudge whenever the count climbs — the confirmation that an add
  // actually landed, since the item sheet closes over it. Keying the button on
  // the count restarts the CSS animation cleanly.
  const prev = React.useRef(count);
  const grew = count > prev.current;
  React.useEffect(() => {
    prev.current = count;
  }, [count]);

  if (count === 0) return null;

  if (disabledReason) {
    return (
      <div className="store-pad-bottom pointer-events-none fixed inset-x-0 bottom-0 z-40 px-4 pb-3">
        <div className="flex min-h-[58px] w-full items-center gap-3 rounded-full border border-s-line bg-s-raised px-5 py-3 text-s-dim shadow-[0_8px_30px_-4px_rgba(0,0,0,0.35)] sm:mx-auto sm:max-w-[460px]">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-s-bg text-[13.5px] font-bold tabular-nums text-s-ink">
            {count}
          </span>
          <span className="text-[13.5px] leading-snug">{disabledReason}</span>
          <span className="ml-auto text-[15.5px] font-bold tabular-nums text-s-ink">
            {money(totalCts)}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="store-pad-bottom pointer-events-none fixed inset-x-0 bottom-0 z-40 px-4 pb-3">
      <button
        key={grew ? count : "steady"}
        onClick={onOpen}
        className={cx(
          "store-slide-up pointer-events-auto flex h-[58px] w-full items-center gap-3 rounded-full bg-s-accent px-5 text-s-accentInk shadow-[0_8px_30px_-4px_rgba(0,0,0,0.35)] transition active:scale-[0.98] sm:mx-auto sm:max-w-[460px]",
          grew && "store-bump"
        )}
      >
        <span className="grid h-8 w-8 place-items-center rounded-full bg-black/20 text-[13.5px] font-bold tabular-nums">
          {count}
        </span>
        <span className="text-[15.5px] font-semibold tracking-[-0.01em]">View order</span>
        <span className="ml-auto flex items-center gap-1.5 text-[15.5px] font-bold tabular-nums">
          {money(totalCts)}
          <Icon name="chevron" size={16} color="currentColor" strokeWidth={2.4} />
        </span>
      </button>
    </div>
  );
}

/** The itemized total. One component so the surcharge line can never drift. */
export function TotalsBlock({
  totals,
  surchargeLabel,
}: {
  totals: Totals;
  surchargeLabel: string;
}) {
  const Row = ({ label, value }: { label: React.ReactNode; value: string }) => (
    <div className="flex items-baseline justify-between py-1.5 text-[14px] text-s-dim">
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );

  return (
    <div className="rounded-3xl border border-s-line bg-s-bg px-4 py-3">
      <Row label="Subtotal" value={money(totals.subtotalCts)} />
      {/* Disclosed as its own line, always. This is a compliance constraint,
          not a design preference — see the junk-fee rules. */}
      <Row
        label={
          <span className="inline-flex items-center gap-1.5">
            {surchargeLabel}
            <span
              title="A small per-order fee that funds this ordering app and its rewards. It goes to the app, not the restaurant."
              className="grid h-4 w-4 cursor-help place-items-center rounded-full bg-s-line text-[10px] font-bold text-s-dim"
              aria-label="What is this fee?"
            >
              ?
            </span>
          </span>
        }
        value={money(totals.surchargeCts)}
      />
      <Row label="Tax" value={money(totals.taxCts)} />
      <div className="mt-1.5 flex items-baseline justify-between border-t border-s-line pt-2.5">
        <span className="text-[15px] font-bold">Total</span>
        <span className="text-[19px] font-extrabold tabular-nums tracking-[-0.02em] text-s-accent">
          {money(totals.totalCts)}
        </span>
      </div>
    </div>
  );
}

export function CartSheet({
  open,
  onClose,
  lines,
  itemsById,
  totals,
  surchargeLabel,
  onQty,
  onEdit,
  onRemove,
  onRestore,
  onCheckout,
}: {
  open: boolean;
  onClose: () => void;
  lines: CartLine[];
  itemsById: Map<string, MenuItemDTO>;
  totals: Totals;
  surchargeLabel: string;
  onQty: (key: string, qty: number) => void;
  onEdit: (key: string) => void;
  onRemove: (key: string) => void;
  onRestore: (line: CartLine, index: number) => void;
  onCheckout: () => void;
}) {
  // A removal you can take back. The line is gone from the order immediately
  // (totals update, no limbo state), but the data is held for a few seconds so
  // an accidental swipe costs one tap, not a re-order.
  const [undo, setUndo] = React.useState<{ line: CartLine; index: number } | null>(null);
  const undoTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearUndo = React.useCallback(() => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = null;
    setUndo(null);
  }, []);

  // Drop the undo offer when the sheet closes; a stale one on reopen is noise.
  React.useEffect(() => {
    if (!open) clearUndo();
  }, [open, clearUndo]);

  React.useEffect(() => () => clearUndo(), [clearUndo]);

  function remove(line: CartLine, index: number) {
    onRemove(line.key);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setUndo({ line, index });
    undoTimer.current = setTimeout(() => setUndo(null), 5000);
  }

  function restore() {
    if (undo) onRestore(undo.line, undo.index);
    clearUndo();
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Your order"
      stickyTitle={
        <div className="flex items-baseline gap-2">
          <span className="text-[15px] font-bold tracking-[-0.01em]">Your order</span>
          <span className="ml-auto shrink-0 text-[14px] font-bold tabular-nums text-s-accent">
            {money(totals.totalCts)}
          </span>
        </div>
      }
      footer={
        lines.length > 0 ? (
          <AccentButton onClick={onCheckout}>
            <span>Continue</span>
            <span className="ml-auto tabular-nums">{money(totals.totalCts)}</span>
          </AccentButton>
        ) : undefined
      }
    >
      <div className="px-5 pb-5">
        <Steps current={0} />

        <div className="mt-4 flex items-baseline gap-2">
          <h2 className="text-[22px] font-extrabold tracking-[-0.03em]">Your order</h2>
          {lines.length > 0 && (
            <span className="text-[13px] font-medium tabular-nums text-s-mute">
              {lines.reduce((a, l) => a + l.qty, 0)} items
            </span>
          )}
        </div>

        {lines.length === 0 ? (
          <div className="py-14 text-center">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-s-bg text-s-mute">
              <Icon name="bag" size={24} color="currentColor" />
            </div>
            <p className="mt-4 text-[15.5px] font-semibold">Nothing here yet</p>
            <p className="mt-1 text-[13px] text-s-dim">Add something from the menu to get started.</p>
            <button
              onClick={onClose}
              className="mt-4 rounded-full border border-s-line px-5 py-2.5 text-[13.5px] font-semibold transition active:scale-95"
            >
              Back to menu
            </button>
          </div>
        ) : (
          <div className="mt-3 divide-y divide-s-line">
            {lines.map((line, index) => {
              const item = itemsById.get(line.itemId);
              if (!item) return null;
              const choices = summarizeSelection(item, line.optionIds);
              const lineTotal = unitPriceCts(item, line.optionIds) * line.qty;

              return (
                <SwipeRow
                  key={line.key}
                  removeLabel="Remove"
                  onRemove={() => remove(line, index)}
                >
                <div className="flex gap-3 py-4">
                  <div className="h-[68px] w-[68px] shrink-0">
                    <Photo
                      src={item.imageUrl || STOCK.dish}
                      alt={item.name}
                      color={item.color}
                      rounded="rounded-2xl"
                      className="h-full w-full"
                    />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-[14.5px] font-semibold leading-snug">{item.name}</h3>
                      <span className="shrink-0 text-[14.5px] font-bold tabular-nums">
                        {money(lineTotal)}
                      </span>
                    </div>
                    {choices && (
                      <p className="mt-0.5 line-clamp-2 text-[12.5px] text-s-dim">{choices}</p>
                    )}
                    {line.notes && (
                      <p className="mt-0.5 line-clamp-2 text-[12.5px] italic text-s-mute">
                        “{line.notes}”
                      </p>
                    )}

                    <div className="mt-2.5 flex items-center gap-2">
                      <Stepper
                        value={line.qty}
                        onChange={(n) => onQty(line.key, n)}
                        onRemoveAtMin={() => remove(line, index)}
                        removeLabel={`Remove ${item.name}`}
                      />
                      <button
                        onClick={() => onEdit(line.key)}
                        className="rounded-full border border-s-line px-3.5 py-2 text-[12.5px] font-semibold text-s-dim transition hover:bg-s-bg hover:text-s-ink active:scale-95"
                      >
                        Edit
                      </button>
                    </div>
                  </div>
                </div>
                </SwipeRow>
              );
            })}
          </div>
        )}

        {undo && (
          <div className="store-slide-up mt-3 flex items-center gap-3 rounded-2xl bg-s-ink px-4 py-3 text-s-raised">
            <span className="flex-1 text-[13px] font-medium">Removed from order</span>
            <button
              onClick={restore}
              className="text-[13px] font-bold text-s-raised underline underline-offset-2 active:opacity-70"
            >
              Undo
            </button>
          </div>
        )}

        {lines.length > 0 && (
          <div className="mt-4">
            <TotalsBlock totals={totals} surchargeLabel={surchargeLabel} />
          </div>
        )}
      </div>
    </Sheet>
  );
}

/** Live (313) 555-0134 formatting as they type. */
function formatPhone(raw: string): string {
  const d = raw.replace(/\D/g, "").replace(/^1/, "").slice(0, 10);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

/** One field, styled once, so the three of them can't drift apart. */
function Field({
  label,
  optional,
  hint,
  error,
  children,
}: {
  label: string;
  optional?: boolean;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="mt-5 block">
      <span className="flex items-baseline gap-2">
        <span className="text-[13.5px] font-bold tracking-[-0.01em]">{label}</span>
        {optional && (
          <span className="rounded-full border border-s-line px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.05em] text-s-mute">
            Optional
          </span>
        )}
      </span>
      {hint && <span className="mt-0.5 block text-[12.5px] text-s-mute">{hint}</span>}
      <span className="mt-2 block">{children}</span>
      {error && (
        <span className="mt-1.5 block text-[12px] font-semibold text-[#c2382b]">{error}</span>
      )}
    </label>
  );
}

const FIELD =
  "w-full rounded-3xl border bg-s-bg px-4 py-3.5 text-[16px] text-s-ink outline-none transition placeholder:text-s-mute";

export function CheckoutSheet({
  open,
  onBack,
  onClose,
  lineCount,
  totals,
  surchargeLabel,
  submitting,
  error,
  onSubmit,
  card,
  prefillName,
}: {
  open: boolean;
  /** Back to the cart — the step before this one. */
  onBack: () => void;
  onClose: () => void;
  lineCount: number;
  totals: Totals;
  surchargeLabel: string;
  submitting: boolean;
  error: string | null;
  onSubmit: (v: { name: string; phone: string; optIn: boolean; notes: string }) => void;
  /**
   * Card collection. When `enabled` is false the whole block is absent and the
   * copy reverts to pay-at-counter — the stub and test-card paths take no card.
   */
  card: {
    enabled: boolean;
    mounted: boolean;
    error: string | null;
    CardMount: React.FC;
  };
  /**
   * The name on a signed-in customer account, if there is one.
   *
   * Only the name. A phone number is not prefilled even when we know it,
   * because the number typed here is what the consent record and every order
   * notification hang off — and prefilling it means a shared phone or a
   * borrowed laptop silently sends someone else's order to someone else's
   * number.
   */
  prefillName?: string | null;
}) {
  const [name, setName] = React.useState(prefillName ?? "");
  const [phone, setPhone] = React.useState("");
  const [optIn, setOptIn] = React.useState(false);
  const [notes, setNotes] = React.useState("");
  const [touched, setTouched] = React.useState(false);

  const digits = phone.replace(/\D/g, "");
  const phoneOk = digits.length === 10;
  const showPhoneError = touched && !phoneOk;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Checkout"
      stickyTitle={
        <div className="flex items-baseline gap-2">
          <span className="text-[15px] font-bold tracking-[-0.01em]">Your details</span>
          <span className="ml-auto shrink-0 text-[14px] font-bold tabular-nums text-s-accent">
            {money(totals.totalCts)}
          </span>
        </div>
      }
      footer={
        <>
          <AccentButton
            disabled={submitting || !phoneOk || (card.enabled && !card.mounted)}
            onClick={() => {
              setTouched(true);
              if (!phoneOk) return;
              onSubmit({ name: name.trim(), phone, optIn, notes: notes.trim() });
            }}
          >
            {submitting ? (
              <span className="flex items-center gap-2">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                {card.enabled ? "Processing payment…" : "Placing order…"}
              </span>
            ) : (
              <>
                <span>{card.enabled ? "Pay & place order" : "Place order"}</span>
                <span className="ml-auto tabular-nums">{money(totals.totalCts)}</span>
              </>
            )}
          </AccentButton>
          <p className="mt-2 text-center text-[11.5px] text-s-mute">
            {card.enabled
              ? `Your card is charged ${money(totals.totalCts)} when you place the order. Payments are secured by Stripe.`
              : "You pay at the counter when you pick up. Nothing is charged now."}
          </p>
        </>
      }
    >
      <div className="px-5 pb-5">
        <Steps current={1} />

        <button
          onClick={onBack}
          className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-semibold text-s-dim transition hover:text-s-ink"
        >
          <Icon name="back" size={14} color="currentColor" strokeWidth={2.4} />
          Back to order
          <span className="text-s-mute">
            ({lineCount} {lineCount === 1 ? "item" : "items"})
          </span>
        </button>

        <h2 className="mt-3 text-[22px] font-extrabold tracking-[-0.03em]">Almost there</h2>
        <p className="mt-1 text-[13.5px] leading-relaxed text-s-dim">
          Pickup order. We&rsquo;ll text you the moment it&rsquo;s ready.
        </p>

        <Field
          label="Mobile number"
          hint="So we can text you when the order is up."
          error={showPhoneError ? "Enter a 10-digit US mobile number." : undefined}
        >
          <input
            inputMode="tel"
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(formatPhone(e.target.value))}
            onBlur={() => setTouched(true)}
            placeholder="(313) 555-0134"
            aria-invalid={showPhoneError}
            className={cx(
              FIELD,
              "tabular-nums",
              showPhoneError
                ? "border-[#c2382b] focus:ring-4 focus:ring-[#c2382b]/15"
                : "border-s-line focus:border-s-accent focus:ring-4 focus:ring-s-accent/15"
            )}
          />
        </Field>

        <Field label="Name" optional hint="Read out at the counter.">
          <input
            autoComplete="given-name"
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, 60))}
            placeholder="First name is fine"
            className={cx(FIELD, "border-s-line focus:border-s-accent focus:ring-4 focus:ring-s-accent/15")}
          />
        </Field>

        <Field label="Note for the kitchen" optional>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value.slice(0, 300))}
            rows={2}
            placeholder="Running 10 minutes late"
            className={cx(
              FIELD,
              "resize-none border-s-line text-[15px] leading-relaxed focus:border-s-accent focus:ring-4 focus:ring-s-accent/15"
            )}
          />
        </Field>

        {card.enabled && (
          <Field
            label="Card"
            hint="Charged when you place the order."
            error={card.error ?? undefined}
          >
            {/* Stripe mounts its own iframe here — the card number never
                touches this page. Until it's ready the Pay button stays
                disabled, so an empty box can't be submitted. */}
            <div className={cx(FIELD, "border-s-line py-4")}>
              <card.CardMount />
              {!card.mounted && (
                <span className="text-[13px] text-s-mute">Loading secure card field…</span>
              )}
            </div>
          </Field>
        )}

        {/* The disclosure is readable, not buried. Consent provenance is the
            whole SMS program's legal footing, so it keeps its full text and a
            real 22px control rather than being shrunk into fine print. */}
        <label
          className={cx(
            "mt-5 flex cursor-pointer gap-3 rounded-3xl border p-4 transition-colors",
            optIn ? "border-s-accent/50 bg-s-accent/[0.07]" : "border-s-line bg-s-bg"
          )}
        >
          <input
            type="checkbox"
            checked={optIn}
            onChange={(e) => setOptIn(e.target.checked)}
            className="peer sr-only"
          />
          <span
            aria-hidden="true"
            className={cx(
              "mt-0.5 grid h-[22px] w-[22px] shrink-0 place-items-center rounded-md border-2 transition-all",
              optIn
                ? "border-s-accent bg-s-accent text-s-accentInk"
                : "border-s-line2 bg-s-raised text-transparent",
              "peer-focus-visible:ring-4 peer-focus-visible:ring-s-accent/25"
            )}
          >
            <Icon name="check" size={13} color="currentColor" strokeWidth={3} />
          </span>
          <span className="text-[12.5px] leading-relaxed text-s-dim">{OPT_IN_TEXT}</span>
        </label>

        <div className="mt-6">
          <TotalsBlock totals={totals} surchargeLabel={surchargeLabel} />
        </div>

        {error && (
          <p
            role="alert"
            className="mt-4 flex gap-2.5 rounded-3xl border border-[#c2382b]/40 bg-[#c2382b]/10 px-4 py-3.5 text-[13px] font-medium leading-relaxed text-[#c2382b]"
          >
            <span className="mt-0.5 shrink-0">
              <Icon name="info" size={16} color="currentColor" strokeWidth={2.2} />
            </span>
            {error}
          </p>
        )}
      </div>
    </Sheet>
  );
}

export function Confirmation({
  order,
  info,
  onDone,
}: {
  order: PlacedOrder;
  info: { name: string; address: string | null; city: string | null; phone: string | null };
  onDone: () => void;
}) {
  const mapsHref = info.address
    ? `https://maps.google.com/?q=${encodeURIComponent(
        `${info.name} ${info.address} ${info.city ?? ""}`
      )}`
    : null;

  return (
    <div className="store-pad-top store-pad-bottom mx-auto flex min-h-dvh max-w-[460px] flex-col px-5 py-10">
      <Steps current={2} />

      {/* The order number is the single thing they'll be asked for at the
          counter, so it gets the accent panel and the largest type on the
          screen rather than sitting as a caption above the receipt. */}
      <div className="store-fade mt-8 overflow-hidden rounded-[28px] border border-s-line bg-s-raised">
        <div className="border-b border-s-line bg-s-accent/[0.08] px-6 py-7 text-center">
          <div className="store-pop mx-auto grid h-14 w-14 place-items-center rounded-full bg-s-accent text-s-accentInk">
            <Icon name="check" size={28} color="currentColor" strokeWidth={2.6} />
          </div>
          <h1 className="mt-4 text-[24px] font-extrabold tracking-[-0.03em]">Order placed</h1>
          <p className="mt-1 text-[13.5px] leading-relaxed text-s-dim">
            {order.promisedAt ? (
              <>
                Ready around{" "}
                {new Date(order.promisedAt).toLocaleTimeString("en-US", {
                  hour: "numeric",
                  minute: "2-digit",
                })}
                . We&rsquo;ll text you when it&rsquo;s ready.
              </>
            ) : (
              <>We&rsquo;ll text you when it&rsquo;s ready for pickup.</>
            )}
          </p>

          <div className="mt-5 inline-flex flex-col items-center rounded-2xl border border-s-line bg-s-raised px-7 py-3">
            <span className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-s-mute">
              Order number
            </span>
            <span className="text-[30px] font-extrabold leading-tight tabular-nums tracking-[-0.02em] text-s-accent">
              {order.number}
            </span>
          </div>
        </div>

        <div className="px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span className="h-px w-6 bg-s-accent" />
            <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-s-accent">
              Your receipt
            </span>
          </div>

          <div className="mt-3 divide-y divide-s-line">
            {order.lines.map((l, i) => (
              <div key={i} className="flex items-baseline gap-3 py-3">
                <span className="grid h-6 min-w-6 shrink-0 place-items-center rounded-full bg-s-bg px-1.5 text-[12px] font-bold tabular-nums text-s-dim">
                  {l.qty}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-semibold">{l.name}</div>
                  {l.choices && (
                    <div className="mt-0.5 text-[12.5px] leading-relaxed text-s-dim">
                      {l.choices}
                    </div>
                  )}
                </div>
                <span className="shrink-0 text-[13.5px] font-semibold tabular-nums">
                  {money(l.lineTotalCts)}
                </span>
              </div>
            ))}
          </div>

          <div className="mt-4">
            <TotalsBlock
              totals={{
                subtotalCts: order.subtotalCts,
                surchargeCts: order.surchargeCts,
                taxCts: order.taxCts,
                totalCts: order.totalCts,
              }}
              surchargeLabel={order.surchargeLabel}
            />
          </div>
        </div>
      </div>

      {/* The one thing on this screen worth keeping. Everything else here is
          a receipt; this is how they check on the order, cancel it, or tell
          someone it went wrong — long after this tab is closed. */}
      {order.trackUrl && (
        <a
          href={order.trackUrl}
          className="mt-4 flex h-14 items-center justify-center rounded-full bg-s-accent text-[15px] font-bold text-s-accentInk transition active:scale-[0.98]"
        >
          Track this order
        </a>
      )}

      <div className="mt-4 rounded-[28px] border border-s-line bg-s-raised p-5">
        <div className="flex items-center gap-2.5">
          <span className="h-px w-6 bg-s-accent" />
          <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-s-accent">
            Pickup from
          </span>
        </div>
        <div className="mt-3 text-[17px] font-bold tracking-[-0.02em]">{info.name}</div>
        {info.address && (
          <div className="mt-0.5 text-[13.5px] leading-relaxed text-s-dim">
            {[info.address, info.city].filter(Boolean).join(", ")}
          </div>
        )}
        {(mapsHref || info.phone) && (
          <div className="mt-4 flex gap-2.5">
            {mapsHref && (
              <a
                href={mapsHref}
                target="_blank"
                rel="noreferrer"
                className="flex h-12 flex-1 items-center justify-center gap-1.5 rounded-full border border-s-line text-[13.5px] font-semibold transition hover:bg-s-bg active:scale-[0.98]"
              >
                <Icon name="pin" size={15} color="currentColor" />
                Directions
              </a>
            )}
            {info.phone && (
              <a
                href={`tel:${info.phone}`}
                className="flex h-12 flex-1 items-center justify-center gap-1.5 rounded-full border border-s-line text-[13.5px] font-semibold transition hover:bg-s-bg active:scale-[0.98]"
              >
                <Icon name="phone" size={15} color="currentColor" />
                Call
              </a>
            )}
          </div>
        )}
      </div>

      <p className="mt-5 text-center text-[12px] leading-relaxed text-s-mute">
        Pay at the counter when you collect. Keep this screen or your text
        message handy.
      </p>

      <button
        onClick={onDone}
        className="mt-4 inline-flex h-12 w-full items-center justify-center rounded-full border border-s-line text-[14px] font-semibold transition hover:bg-s-raised active:scale-[0.98]"
      >
        Back to menu
      </button>
    </div>
  );
}
