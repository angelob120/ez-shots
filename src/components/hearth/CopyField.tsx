"use client";

import { useState } from "react";
import { cx } from "@/components/hearth/ui";

/**
 * A read-only value with a copy button.
 *
 * Used anywhere the operator's next move is "paste this into a message":
 * invite links, Stripe onboarding URLs, storefront addresses, DNS records. The
 * whole reason it exists as a component is that a selectable <input> plus a
 * button is otherwise reimplemented slightly differently every time, and the
 * differences are always in the feedback — which is the only part that matters,
 * because a copy button that doesn't visibly confirm gets pressed three times.
 */
export default function CopyField({
  value,
  label,
  hint,
  mono = true,
  tone = "default",
}: {
  value: string;
  label?: string;
  hint?: string;
  mono?: boolean;
  tone?: "default" | "accent";
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Clipboard API needs a secure context and can be refused outright. The
      // input is selectable, so manual copy still works — don't throw a scary
      // error at someone whose next move is Cmd-C.
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div>
      {label && <div className="mb-1.5 text-[12px] font-medium text-dim">{label}</div>}
      <div
        className={cx(
          "flex items-stretch overflow-hidden rounded-sm border bg-surface2",
          tone === "accent" ? "border-accentDim" : "border-line2"
        )}
      >
        <input
          readOnly
          value={value}
          onFocus={(e) => e.currentTarget.select()}
          className={cx(
            "min-w-0 flex-1 bg-transparent px-3 py-2 text-[12px] text-ink outline-none",
            mono && "font-mono"
          )}
        />
        <button
          type="button"
          onClick={copy}
          className={cx(
            "shrink-0 border-l px-3 text-[12px] font-medium transition-colors",
            tone === "accent"
              ? "border-accentDim text-accent hover:bg-accent/10"
              : "border-line2 text-dim hover:bg-surface hover:text-ink"
          )}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      {hint && <p className="mt-1 text-[11px] leading-relaxed text-mute">{hint}</p>}
    </div>
  );
}
