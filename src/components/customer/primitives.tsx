"use client";

import * as React from "react";
import Icon from "./Icon";

export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

/**
 * Bottom sheet. Everything that isn't the menu lives in one of these — item
 * detail, cart, checkout — because that's the interaction a phone user already
 * knows from every native app they use.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
  /** Let content run to the very top edge (the item photo does). */
  bleed,
  /**
   * Compact bar that fades in once the content scrolls past its own heading.
   * Without it, a long item sheet loses all sense of what you're configuring
   * the moment the title leaves the screen.
   */
  stickyTitle,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  bleed?: boolean;
  stickyTitle?: React.ReactNode;
}) {
  const [dy, setDy] = React.useState(0);
  const [dragging, setDragging] = React.useState(false);
  const [scrolled, setScrolled] = React.useState(false);
  const startY = React.useRef<number | null>(null);

  // Freeze the page behind the sheet so scrolling doesn't leak through.
  React.useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  React.useEffect(() => {
    if (open) setDy(0);
  }, [open]);

  // Drag-to-dismiss, bound to the grabber rather than the whole sheet. Binding
  // it to the sheet body would fight the scroll container underneath, and the
  // grabber is the affordance people already reach for.
  function onGrabDown(e: React.PointerEvent) {
    if (e.pointerType === "mouse") return;
    startY.current = e.clientY;
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onGrabMove(e: React.PointerEvent) {
    if (startY.current == null) return;
    setDy(Math.max(0, e.clientY - startY.current));
  }
  function onGrabUp() {
    if (startY.current == null) return;
    startY.current = null;
    setDragging(false);
    if (dy > 110) onClose();
    else setDy(0);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div
        className="store-scrim absolute inset-0 bg-black/55 backdrop-blur-[2px]"
        style={dy ? { opacity: Math.max(0.25, 1 - dy / 320) } : undefined}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{
          transform: dy ? `translateY(${dy}px)` : undefined,
          transition: dragging ? "none" : "transform 260ms cubic-bezier(0.32,0.72,0,1)",
        }}
        className="store-sheet store-lift-lg relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-[28px] bg-s-raised sm:max-w-[480px] sm:rounded-[28px]"
      >
        {/* Grabber floats over bleeding content instead of reserving space
            above it — an item photo shouldn't start 40px down the sheet. */}
        <div
          onPointerDown={onGrabDown}
          onPointerMove={onGrabMove}
          onPointerUp={onGrabUp}
          onPointerCancel={onGrabUp}
          style={{ touchAction: "none" }}
          className={cx(
            "absolute inset-x-0 top-0 z-20 flex h-10 items-start justify-center pt-2.5 sm:hidden",
            bleed && "pointer-events-auto"
          )}
        >
          <div
            className={cx(
              "h-1 w-10 rounded-full transition-colors",
              bleed ? "bg-white/70 shadow-sm" : "bg-s-line2"
            )}
          />
        </div>

        {stickyTitle && (
          <div
            className={cx(
              "absolute inset-x-0 top-0 z-10 border-b border-s-line bg-s-raised/95 px-4 py-3.5 backdrop-blur-xl transition-opacity duration-200",
              scrolled ? "opacity-100" : "pointer-events-none opacity-0"
            )}
          >
            <div className="pr-11">{stickyTitle}</div>
          </div>
        )}

        <button
          onClick={onClose}
          aria-label="Close"
          className={cx(
            "absolute right-3 top-3 z-20 grid h-9 w-9 place-items-center rounded-full backdrop-blur-md transition active:scale-90",
            bleed && !scrolled
              ? "bg-black/45 text-white"
              : "border border-s-line bg-s-bg/90 text-s-dim hover:text-s-ink"
          )}
        >
          <Icon name="close" size={17} color="currentColor" strokeWidth={2.2} />
        </button>

        <div
          onScroll={(e) => {
            const next = e.currentTarget.scrollTop > 150;
            setScrolled((prev) => (prev === next ? prev : next));
          }}
          className={cx(
            "hearth-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain",
            !bleed && "pt-11"
          )}
        >
          {children}
        </div>

        {footer && (
          <div className="store-pad-bottom shrink-0 border-t border-s-line bg-s-raised px-4 pb-3 pt-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Quantity control. Big enough to hit with a thumb on a moving bus.
 *
 * In the cart, decrementing from one means "remove this" — so rather than
 * disabling the minus into a dead grey button, it turns into a trash icon and
 * does the thing. A disabled control at the exact moment someone wants to
 * delete a line is the most common way a cart traps people.
 */
export function Stepper({
  value,
  onChange,
  min = 1,
  max = 50,
  onRemoveAtMin,
  removeLabel = "Remove item",
}: {
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  onRemoveAtMin?: () => void;
  removeLabel?: string;
}) {
  const atMin = value <= min;
  const removes = atMin && Boolean(onRemoveAtMin);

  return (
    <div className="inline-flex items-center gap-0.5 rounded-full border border-s-line bg-s-bg p-1">
      <button
        type="button"
        onClick={() => (removes ? onRemoveAtMin!() : onChange(Math.max(min, value - 1)))}
        disabled={atMin && !removes}
        aria-label={removes ? removeLabel : "Decrease quantity"}
        className={cx(
          "grid h-9 w-9 place-items-center rounded-full transition active:scale-90 disabled:opacity-30",
          removes ? "text-[#c2382b]" : "text-s-ink hover:bg-s-raised"
        )}
      >
        <Icon name={removes ? "trash" : "minus"} size={16} color="currentColor" strokeWidth={2} />
      </button>
      <span className="min-w-[1.75rem] text-center text-[15px] font-bold tabular-nums">
        {value}
      </span>
      <button
        type="button"
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
        aria-label="Increase quantity"
        className="grid h-9 w-9 place-items-center rounded-full text-s-ink transition hover:bg-s-raised active:scale-90 disabled:opacity-30"
      >
        <Icon name="plus" size={16} color="currentColor" strokeWidth={2} />
      </button>
    </div>
  );
}

/**
 * Where you are in the order. Three states, because that's the whole flow:
 * build the order, hand over a phone number, done.
 *
 * The sheets used to give no indication that checkout was a sequence at all —
 * you tapped "Go to checkout" and a different sheet appeared, with no sense of
 * how much was left or whether you could go back.
 */
export function Steps({ current }: { current: 0 | 1 | 2 }) {
  const LABELS = ["Order", "Details", "Done"];

  return (
    <ol className="flex items-center gap-2" aria-label="Checkout progress">
      {LABELS.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <React.Fragment key={label}>
            <li
              className="flex items-center gap-1.5"
              aria-current={active ? "step" : undefined}
            >
              <span
                className={cx(
                  "grid h-5 w-5 place-items-center rounded-full text-[10.5px] font-bold tabular-nums transition-colors",
                  done || active
                    ? "bg-s-accent text-s-accentInk"
                    : "border border-s-line text-s-mute"
                )}
              >
                {done ? (
                  <Icon name="check" size={11} color="currentColor" strokeWidth={3.2} />
                ) : (
                  i + 1
                )}
              </span>
              <span
                className={cx(
                  "text-[11.5px] font-bold uppercase tracking-[0.08em] transition-colors",
                  active ? "text-s-ink" : done ? "text-s-dim" : "text-s-mute"
                )}
              >
                {label}
              </span>
            </li>
            {i < LABELS.length - 1 && (
              <li aria-hidden="true" className="h-px w-4 flex-1 bg-s-line sm:w-6" />
            )}
          </React.Fragment>
        );
      })}
    </ol>
  );
}

/**
 * Menu photo with a graceful nothing-to-show state. A tenant mid-onboarding
 * has half a menu photographed, so the fallback has to look intentional
 * rather than broken.
 */
export function Photo({
  src,
  alt,
  color,
  className,
  rounded = "rounded-2xl",
}: {
  src: string | null;
  alt: string;
  color?: string | null;
  className?: string;
  rounded?: string;
}) {
  const [failed, setFailed] = React.useState(false);

  if (!src || failed) {
    return (
      <div
        className={cx(
          "flex items-center justify-center bg-s-line/60 text-s-mute",
          rounded,
          className
        )}
        style={color ? { background: color } : undefined}
        aria-hidden="true"
      >
        <Icon name="bag" size={20} color="currentColor" />
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className={cx("h-full w-full object-cover", rounded, className)}
    />
  );
}

/**
 * Swipe-left-to-remove, the gesture every phone user already has in muscle
 * memory from Mail and Messages. Drag past the threshold and release to remove;
 * anything short of it snaps back. The row still contains its own visible
 * remove button (passed as children) so pointer and keyboard users — and anyone
 * who never discovers the gesture — are never stranded.
 */
export function SwipeRow({
  onRemove,
  removeLabel = "Remove",
  children,
}: {
  onRemove: () => void;
  removeLabel?: string;
  children: React.ReactNode;
}) {
  const [dx, setDx] = React.useState(0);
  const [dragging, setDragging] = React.useState(false);
  const start = React.useRef<{ x: number; y: number } | null>(null);
  const axis = React.useRef<"undecided" | "horizontal" | "vertical">("undecided");

  const THRESHOLD = 96; // past this on release, the row goes
  const MAX = 132; // a little rubber past the threshold, then it holds

  function onPointerDown(e: React.PointerEvent) {
    // Ignore the mouse; this is a touch affordance. Mouse users get the button.
    if (e.pointerType === "mouse") return;
    start.current = { x: e.clientX, y: e.clientY };
    axis.current = "undecided";
    setDragging(true);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!start.current) return;
    const mx = e.clientX - start.current.x;
    const my = e.clientY - start.current.y;

    // Decide once whether this is a horizontal swipe or a vertical scroll, so
    // we never hijack the list's scroll.
    if (axis.current === "undecided") {
      if (Math.abs(mx) < 6 && Math.abs(my) < 6) return;
      axis.current = Math.abs(mx) > Math.abs(my) ? "horizontal" : "vertical";
      if (axis.current === "horizontal") e.currentTarget.setPointerCapture(e.pointerId);
    }
    if (axis.current !== "horizontal") return;

    // Left only; ease past the threshold instead of tracking 1:1 forever.
    const raw = Math.min(0, mx);
    const eased = raw < -THRESHOLD ? -THRESHOLD - (raw + THRESHOLD) * 0.35 : raw;
    setDx(Math.max(-MAX, eased));
  }

  function end() {
    if (!start.current) return;
    start.current = null;
    setDragging(false);
    if (dx <= -THRESHOLD) {
      setDx(-MAX);
      onRemove();
    } else {
      setDx(0);
    }
  }

  const revealed = Math.min(1, Math.abs(dx) / THRESHOLD);

  return (
    <div className="relative overflow-hidden">
      {/* The intent, revealed as the row slides. */}
      <div className="absolute inset-y-0 right-0 flex items-center justify-end bg-[#c2382b] pr-5 text-white">
        <span
          className="flex items-center gap-1.5 text-[13px] font-semibold"
          style={{ opacity: revealed }}
        >
          <Icon name="trash" size={16} color="currentColor" />
          {removeLabel}
        </span>
      </div>

      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={end}
        onPointerCancel={end}
        style={{
          transform: `translateX(${dx}px)`,
          transition: dragging ? "none" : "transform 220ms cubic-bezier(0.32,0.72,0,1)",
          touchAction: "pan-y",
        }}
        className="relative bg-s-raised"
      >
        {children}
      </div>
    </div>
  );
}

/** Full-width primary action in the tenant's accent. */
export function AccentButton({
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={cx(
        "flex w-full items-center justify-center gap-2 rounded-full bg-s-accent px-5 text-[15px] font-semibold text-s-accentInk transition active:scale-[0.98] disabled:opacity-40 disabled:active:scale-100",
        "h-[52px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-s-accent",
        className
      )}
    />
  );
}
