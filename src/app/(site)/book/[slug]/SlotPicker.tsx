"use client";

import { useMemo, useState } from "react";
import { cx } from "@/components/hearth/ui";

/**
 * The slot grid, and the only reason this page has any JavaScript.
 *
 * Slots are generated on the server in the **host's** timezone, because that
 * is where availability is defined and the server has no idea where the visitor
 * is — `Intl` on Railway reports UTC, which is nobody's actual zone. So the
 * server sends absolute instants as ISO strings and this component relabels
 * them in the browser's zone on mount.
 *
 * The consequence worth knowing: the first paint shows host-zone times, and
 * hydration corrects them. That is deliberate rather than a flash to be fixed
 * with a spinner — a booker who sees "2:00 PM EDT" for a moment before it
 * becomes "11:00 AM PDT" has lost nothing, whereas a booker staring at a
 * loading state on a page whose whole job is to be quick has.
 *
 * `suppressHydrationWarning` on the times is there for exactly that: the
 * server and client are *supposed* to disagree here.
 */

export type WireDay = { date: string; slots: string[] };

function fmt(iso: string, timezone: string) {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(
      new Date(iso),
    );
  }
}

function fmtDay(iso: string, timezone: string) {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "long",
      month: "long",
      day: "numeric",
    }).format(new Date(iso));
  } catch {
    return new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
    }).format(new Date(iso));
  }
}

function zoneLabel(timezone: string) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      timeZoneName: "short",
    }).formatToParts(new Date());
    return parts.find((p) => p.type === "timeZoneName")?.value ?? timezone;
  } catch {
    return timezone;
  }
}

export default function SlotPicker({
  days,
  hostTimezone,
  selected,
  onSelect,
}: {
  days: WireDay[];
  hostTimezone: string;
  selected: string | null;
  onSelect: (iso: string, timezone: string) => void;
}) {
  // Resolved once, on the client. Falls back to the host's zone during SSR so
  // the markup is at least internally consistent before hydration.
  const viewerZone = useMemo(() => {
    if (typeof window === "undefined") return hostTimezone;
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || hostTimezone;
    } catch {
      return hostTimezone;
    }
  }, [hostTimezone]);

  const [openDay, setOpenDay] = useState<string>(days[0]?.date ?? "");

  // Days are keyed by the host's calendar date, which can differ from the
  // viewer's by one — a 9am Tuesday call in New York is Monday evening in
  // Auckland. The heading is derived from the first *slot* rather than the key
  // for that reason: the label has to agree with the times printed under it.
  const active = days.find((d) => d.date === openDay) ?? days[0];

  if (days.length === 0) {
    return (
      <div className="rounded-md border border-line bg-surface p-6 text-center">
        <p className="text-[14px] font-medium text-ink">No times available right now.</p>
        <p className="mt-1.5 text-[13px] leading-relaxed text-dim">
          Nothing is open on the calendar for the next few weeks. Send a message instead and
          we&apos;ll find a time by hand.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2 overflow-x-auto pb-1">
        {days.map((d) => (
          <button
            key={d.date}
            type="button"
            onClick={() => setOpenDay(d.date)}
            className={cx(
              "shrink-0 rounded-sm border px-3 py-2 text-left transition-colors",
              d.date === active?.date
                ? "border-accent bg-accent/10 text-ink"
                : "border-line2 text-dim hover:border-line hover:text-ink",
            )}
          >
            <span className="block text-[12px] font-medium" suppressHydrationWarning>
              {fmtDay(d.slots[0], viewerZone)}
            </span>
            <span className="block text-[11px] text-dim">
              {d.slots.length} {d.slots.length === 1 ? "time" : "times"}
            </span>
          </button>
        ))}
      </div>

      <div>
        <p className="mb-2 text-[12px] text-dim" suppressHydrationWarning>
          Times shown in {zoneLabel(viewerZone)}
        </p>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {active?.slots.map((iso) => (
            <button
              key={iso}
              type="button"
              onClick={() => onSelect(iso, viewerZone)}
              className={cx(
                "rounded-sm border px-3 py-2.5 text-[13px] tabular-nums transition-colors",
                iso === selected
                  ? "border-accent bg-accent text-white"
                  : "border-line2 text-ink hover:border-accent hover:bg-accent/5",
              )}
              suppressHydrationWarning
            >
              {fmt(iso, viewerZone)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
