"use client";

import * as React from "react";
import { setThemeAction } from "@/lib/theme-actions";
import type { Theme } from "@/lib/theme";
import { cx } from "./ui";

const OPTIONS: Array<{ value: Theme; label: string; icon: React.ReactNode }> = [
  {
    value: "light",
    label: "Light",
    icon: (
      <>
        <circle cx="8" cy="8" r="3.1" />
        <path d="M8 1.4v1.6M8 13v1.6M14.6 8H13M3 8H1.4M12.7 3.3l-1.1 1.1M4.4 11.6l-1.1 1.1M12.7 12.7l-1.1-1.1M4.4 4.4L3.3 3.3" />
      </>
    ),
  },
  {
    value: "dark",
    label: "Dark",
    icon: <path d="M13.2 9.6A5.6 5.6 0 0 1 6.4 2.8a5.7 5.7 0 1 0 6.8 6.8Z" />,
  },
  {
    value: "system",
    label: "System",
    icon: (
      <>
        <rect x="1.8" y="2.6" width="12.4" height="8.4" rx="1.3" />
        <path d="M5.6 13.4h4.8" />
      </>
    ),
  },
];

/**
 * Three-way segmented control in the top bar.
 *
 * The optimistic local state exists because the real work is a server action
 * that re-renders the layout — a round trip on a cold connection is long
 * enough that a plain form would leave the pressed segment looking unpressed
 * for a beat, which reads as the click having missed. The server's value wins
 * on the next render via the `theme` prop, so a failed write corrects itself
 * rather than leaving the control lying about what's stored.
 */
export default function ThemeToggle({ theme }: { theme: Theme }) {
  const [optimistic, setOptimistic] = React.useState<Theme>(theme);
  const [, startTransition] = React.useTransition();

  React.useEffect(() => setOptimistic(theme), [theme]);

  function choose(next: Theme) {
    if (next === optimistic) return;

    // Applied to the DOM directly as well as sent to the server. The CSS
    // variables live on `.hearth-shell`, so flipping the attribute here
    // repaints immediately; without it the page holds the old palette until
    // the server round trip lands, and the toggle feels broken on a slow link.
    document.querySelectorAll(".hearth-shell").forEach((el) => {
      if (next === "system") el.removeAttribute("data-h-theme");
      else el.setAttribute("data-h-theme", next);
    });

    setOptimistic(next);
    startTransition(() => {
      void setThemeAction(next);
    });
  }

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className="flex shrink-0 items-center gap-0.5 rounded-sm border border-line2 p-0.5"
    >
      {OPTIONS.map((o) => {
        const on = optimistic === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            title={o.label}
            onClick={() => choose(o.value)}
            className={cx(
              "rounded-[4px] px-1.5 py-1 transition-colors",
              on ? "bg-surface2 text-ink" : "text-mute hover:text-dim"
            )}
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              {o.icon}
            </svg>
            <span className="sr-only">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
