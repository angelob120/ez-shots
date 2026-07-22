/**
 * The EZ Orders brand mark + wordmark.
 *
 * Inline SVG rather than an <img> so it inherits the theme: the tile is the
 * accent colour, the wordmark is `text-ink`, so it reads correctly in both
 * light and dark without shipping two files. The favicon (`src/app/icon.svg`)
 * is the tile alone — keep the two in sync if the mark changes.
 */
export default function Logo({
  showWordmark = true,
  size = 22,
}: {
  showWordmark?: boolean;
  size?: number;
}) {
  return (
    <span className="flex items-center gap-2">
      <svg
        width={size}
        height={size}
        viewBox="0 0 32 32"
        fill="none"
        aria-hidden
        className="shrink-0 text-accent"
      >
        {/* Tile and check both take the accent via currentColor, so the mark
            follows the theme with no dependency on a fill-* utility existing. */}
        <rect width="32" height="32" rx="8" fill="currentColor" />
        {/* A receipt with a check — "your order, done". Drawn in the tile's
            negative space in white so it survives down to favicon size. */}
        <path
          d="M11 7.5h10a1.5 1.5 0 0 1 1.5 1.5v15.2c0 .6-.7 1-1.2.6l-1.4-1a1 1 0 0 0-1.2 0l-1.3 1a1 1 0 0 1-1.2 0l-1.3-1a1 1 0 0 0-1.2 0l-1.3 1a1 1 0 0 1-1.2 0l-1.4-1c-.5-.4-1.2 0-1.2-.6V9A1.5 1.5 0 0 1 11 7.5Z"
          fill="#fff"
          fillOpacity="0.95"
        />
        <path
          d="m12.8 15.4 2 2 4-4.2"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {showWordmark && (
        <span className="whitespace-nowrap text-[14px] font-semibold tracking-tight text-ink">
          EZ Orders
        </span>
      )}
    </span>
  );
}
