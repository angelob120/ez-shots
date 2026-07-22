"use client";

import * as React from "react";
import Icon from "./Icon";
import { AccentButton, Photo, Sheet, Stepper, cx } from "./primitives";
import { STOCK } from "./stock";
import { delta, money } from "./theme";
import {
  defaultSelection,
  unitPriceCts,
  validateSelection,
  type MenuItemDTO,
} from "@/lib/cart";

/**
 * The item screen. This is the difference between a web form and an ordering
 * app: a real photo, the description where you can read it, the choices that
 * change the price, and a quantity — all before anything hits the cart.
 */
export default function ItemSheet({
  item,
  initial,
  recommendations = [],
  onPick,
  onClose,
  onSubmit,
}: {
  item: MenuItemDTO | null;
  /** Present when editing a line that's already in the cart. */
  initial?: { qty: number; optionIds: string[]; notes: string } | null;
  /** Other items this one suggests — shown as "Pairs well with". */
  recommendations?: MenuItemDTO[];
  /** Open a recommended item's own sheet. */
  onPick?: (item: MenuItemDTO) => void;
  onClose: () => void;
  onSubmit: (v: { qty: number; optionIds: string[]; notes: string }) => void;
}) {
  const [qty, setQty] = React.useState(1);
  const [selected, setSelected] = React.useState<string[]>([]);
  const [notes, setNotes] = React.useState("");
  const [showErrors, setShowErrors] = React.useState(false);
  const [added, setAdded] = React.useState(false);

  // Reset every time a different item opens.
  React.useEffect(() => {
    if (!item) return;
    setQty(initial?.qty ?? 1);
    setSelected(initial?.optionIds ?? defaultSelection(item));
    setNotes(initial?.notes ?? "");
    setShowErrors(false);
    setAdded(false);
  }, [item, initial]);

  if (!item) return null;

  const problems = validateSelection(item, selected);
  const problemFor = (groupId: string) => problems.find((p) => p.groupId === groupId)?.message;
  const unit = unitPriceCts(item, selected);
  const lineTotal = unit * qty;

  function toggle(groupId: string, optionId: string, single: boolean, max: number) {
    setSelected((prev) => {
      const group = item!.groups.find((g) => g.id === groupId)!;
      const inGroup = new Set(group.options.map((o) => o.id));

      if (single) {
        // Radio: swap out whatever else in this group was picked.
        return [...prev.filter((id) => !inGroup.has(id)), optionId];
      }

      if (prev.includes(optionId)) return prev.filter((id) => id !== optionId);

      const countInGroup = prev.filter((id) => inGroup.has(id)).length;
      if (countInGroup >= max) return prev; // at the cap; ignore
      return [...prev, optionId];
    });
  }

  function submit() {
    if (added) return; // guard the double-tap during the confirm beat
    if (problems.length) {
      setShowErrors(true);
      // Send them to the first thing they missed rather than making them hunt.
      const first = problems.find((p) => p.groupId);
      if (first) {
        document
          .getElementById(`group-${first.groupId}`)
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      return;
    }
    // Flash the confirmation on the button itself, then commit. The sheet
    // closes over the cart bar, which picks the motion back up with its nudge.
    if (typeof navigator !== "undefined") navigator.vibrate?.(8);
    setAdded(true);
    window.setTimeout(() => onSubmit({ qty, optionIds: selected, notes: notes.trim() }), 380);
  }

  return (
    <Sheet
      open
      bleed
      onClose={onClose}
      title={item.name}
      stickyTitle={
        <div className="flex items-baseline gap-2">
          <span className="truncate text-[15px] font-bold tracking-[-0.01em]">{item.name}</span>
          <span className="ml-auto shrink-0 text-[14px] font-bold tabular-nums text-s-accent">
            {money(unit)}
          </span>
        </div>
      }
      footer={
        /* Quantity lives beside the commit button, not stranded halfway up a
           scrolling sheet where it's missed until after the add. */
        <div className="flex items-center gap-3">
          {/* Stays mounted through the confirm flash — unmounting it would let
              the button snap wider for 380ms right as it's being read. */}
          <div className={cx("transition-opacity", added && "pointer-events-none opacity-40")}>
            <Stepper value={qty} onChange={setQty} />
          </div>
          <AccentButton onClick={submit} aria-live="polite" className="flex-1">
            {added ? (
              <span className="store-pop flex items-center gap-1.5">
                <Icon name="check" size={18} color="currentColor" strokeWidth={2.5} />
                {initial ? "Updated" : "Added"}
              </span>
            ) : (
              <>
                <span>{initial ? "Update" : "Add to order"}</span>
                <span className="ml-auto tabular-nums">{money(lineTotal)}</span>
              </>
            )}
          </AccentButton>
        </div>
      }
    >
      {/* Same construction as the site's page banners: photo, black gradient,
          title sitting on it. The sheet used to open with a bare photo and put
          the name on plain background underneath, which read as a form with a
          picture attached rather than a dish. */}
      <div className="relative aspect-[4/3] w-full bg-s-bg">
        <Photo
          src={item.imageUrl || STOCK.dish}
          alt={item.name}
          color={item.color}
          rounded="rounded-none"
        />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-black/30" />

        <div className="absolute left-4 top-3.5 flex flex-wrap gap-1.5">
          {item.featured && (
            <span className="rounded-full bg-black/55 px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-[0.05em] text-white backdrop-blur-md">
              Popular
            </span>
          )}
          {item.listPriceCts != null && (
            <span className="rounded-full bg-[#c2382b] px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-[0.05em] text-white">
              Save {money(item.listPriceCts - item.priceCts)}
            </span>
          )}
        </div>

        <div className="absolute inset-x-0 bottom-0 p-5">
          <h2 className="text-[26px] font-extrabold leading-[1.08] tracking-[-0.03em] text-white drop-shadow-sm">
            {item.name}
          </h2>
          <p className="mt-1.5 flex items-baseline gap-2 text-[17px] font-bold tabular-nums text-white">
            {money(item.priceCts)}
            {item.listPriceCts != null && (
              <span className="text-[14px] font-normal text-white/70 line-through">
                {money(item.listPriceCts)}
              </span>
            )}
          </p>
        </div>
      </div>

      <div className="px-5 pb-6 pt-5">
        {item.description && (
          <p className="text-[14.5px] leading-relaxed text-s-dim">{item.description}</p>
        )}

        {item.groups.map((g) => {
          const single = g.maxSelect === 1;
          const required = g.minSelect > 0;
          const chosenInGroup = g.options.filter((o) => selected.includes(o.id)).length;
          const err = showErrors ? problemFor(g.id) : undefined;

          return (
            <section
              key={g.id}
              id={`group-${g.id}`}
              className="mt-6 scroll-mt-24"
              role="group"
              aria-label={g.name}
            >
              <div className="flex items-center gap-2">
                <h3 className="text-[16px] font-bold tracking-[-0.01em]">{g.name}</h3>
                <span
                  className={cx(
                    "rounded-full px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.05em]",
                    required
                      ? "bg-s-accent/12 text-s-accent"
                      : "border border-s-line text-s-mute"
                  )}
                >
                  {required ? "Required" : single ? "Optional" : `Up to ${g.maxSelect}`}
                </span>
                {!single && chosenInGroup > 0 && (
                  <span className="ml-auto text-[12px] font-semibold tabular-nums text-s-mute">
                    {chosenInGroup}/{g.maxSelect}
                  </span>
                )}
              </div>
              {err && (
                <p className="mt-1.5 flex items-center gap-1.5 text-[12.5px] font-medium text-[#c2382b]">
                  {err}
                </p>
              )}

              {/* Recessed against the sheet's raised surface — the option list
                  should read as something set into the sheet, not another
                  panel floating on it. */}
              <div
                className={cx(
                  "mt-3 overflow-hidden rounded-3xl border bg-s-bg transition-colors",
                  err ? "border-[#c2382b]/60" : "border-s-line"
                )}
              >
                {g.options.map((o, idx) => {
                  const on = selected.includes(o.id);
                  const atCap = !single && !on && chosenInGroup >= g.maxSelect;

                  return (
                    <label
                      key={o.id}
                      className={cx(
                        "flex cursor-pointer items-center gap-3 px-4 py-3.5 transition-colors",
                        idx > 0 && "border-t border-s-line",
                        atCap ? "cursor-not-allowed opacity-40" : "hover:bg-s-raised",
                        on && "bg-s-accent/[0.10]"
                      )}
                    >
                      {/* The native control is kept for semantics and keyboard
                          focus, but hidden: accent-color can't give a radio a
                          hit area, and these get tapped with a thumb. */}
                      <input
                        type={single ? "radio" : "checkbox"}
                        name={g.id}
                        checked={on}
                        disabled={atCap}
                        onChange={() => toggle(g.id, o.id, single, g.maxSelect)}
                        className="peer sr-only"
                      />
                      <span
                        aria-hidden="true"
                        className={cx(
                          "grid h-[22px] w-[22px] shrink-0 place-items-center border-2 transition-all duration-150",
                          single ? "rounded-full" : "rounded-md",
                          on
                            ? "border-s-accent bg-s-accent text-s-accentInk"
                            : "border-s-line2 bg-s-raised text-transparent",
                          "peer-focus-visible:ring-4 peer-focus-visible:ring-s-accent/25"
                        )}
                      >
                        {single ? (
                          <span
                            className={cx(
                              "h-2 w-2 rounded-full bg-current transition-transform",
                              on ? "scale-100" : "scale-0"
                            )}
                          />
                        ) : (
                          <Icon
                            name="check"
                            size={13}
                            color="currentColor"
                            strokeWidth={3}
                          />
                        )}
                      </span>
                      <span className="flex-1 text-[14.5px]">{o.name}</span>
                      {o.priceDeltaCts !== 0 && (
                        <span
                          className={cx(
                            "text-[13px] font-medium tabular-nums",
                            on ? "text-s-accent" : "text-s-dim"
                          )}
                        >
                          {delta(o.priceDeltaCts)}
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
            </section>
          );
        })}

        <section className="mt-6">
          <div className="flex items-center gap-2">
            <h3 className="text-[16px] font-bold tracking-[-0.01em]">Special instructions</h3>
            <span className="rounded-full border border-s-line px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.05em] text-s-mute">
              Optional
            </span>
          </div>
          <div className="relative mt-3">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value.slice(0, 200))}
              rows={3}
              placeholder="No onions, sauce on the side…"
              className="w-full resize-none rounded-3xl border border-s-line bg-s-bg px-4 py-3.5 pb-7 text-[14.5px] leading-relaxed text-s-ink outline-none transition placeholder:text-s-mute focus:border-s-accent focus:ring-4 focus:ring-s-accent/15"
            />
            <span className="pointer-events-none absolute bottom-3 right-4 text-[11px] font-medium tabular-nums text-s-mute">
              {notes.length}/200
            </span>
          </div>
        </section>

        {recommendations.length > 0 && onPick && (
          <section className="mt-8 border-t border-s-line pt-6">
            <div className="flex items-center gap-2.5">
              <span className="h-px w-6 bg-s-accent" />
              <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-s-accent">
                Pairs well with
              </span>
            </div>
            <div className="store-rail mt-4 flex snap-x snap-mandatory gap-3 overflow-x-auto pb-1">
              {recommendations.map((rec) => (
                <button
                  key={rec.id}
                  type="button"
                  onClick={() => onPick(rec)}
                  className="group w-[136px] shrink-0 snap-start text-left transition active:scale-[0.97]"
                >
                  <div className="h-[102px] w-[136px] overflow-hidden rounded-2xl border border-s-line bg-s-bg">
                    <Photo
                      src={rec.imageUrl || STOCK.dish}
                      alt={rec.name}
                      color={rec.color}
                      rounded="rounded-none"
                      className="transition-transform duration-500 group-hover:scale-[1.05]"
                    />
                  </div>
                  <p className="mt-1.5 line-clamp-1 text-[13.5px] font-semibold">{rec.name}</p>
                  <p className="text-[12.5px] font-medium tabular-nums text-s-dim">
                    {money(rec.priceCts)}
                  </p>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </Sheet>
  );
}
