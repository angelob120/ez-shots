import { cx } from "@/components/hearth/ui";

/**
 * A customer tag, rendered.
 *
 * The colour arrives from the database as one of a fixed set of *names*
 * (`lib/customers.ts#TAG_COLORS`), never as a hex value, and this is the only
 * place those names become classes. Two things follow from that and both are
 * the point:
 *
 * - Every colour used here resolves through `--h-*` tokens that exist in both
 *   the light and dark blocks of `globals.css`, so `scripts/theme.test.ts`
 *   covers them. A hex value stored per tag would be invisible to that test
 *   and would eventually be dark grey on near-black.
 * - An unknown name — a colour removed from the palette, a hand-edited row —
 *   falls back to neutral rather than producing `border-undefined`. A tag that
 *   renders plainly is a cosmetic problem; a tag that renders as unstyled text
 *   with no border is one an owner can't see at all.
 */
const TONES: Record<string, string> = {
  neutral: "border-line2 text-dim",
  accent: "border-accent/40 text-accent",
  good: "border-goodLine text-good",
  warn: "border-warnLine text-warn",
  bad: "border-badLine text-badInk",
};

export default function TagChip({
  name,
  color = "neutral",
  className,
  title,
}: {
  name: string;
  color?: string;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cx(
        "inline-flex max-w-[160px] items-center truncate rounded-full border px-2 py-0.5 text-[11px] font-medium",
        TONES[color] ?? TONES.neutral,
        className
      )}
    >
      {name}
    </span>
  );
}

export { TONES as TAG_TONES };
