"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * Offset pagination for the customer lists.
 *
 * Links rather than buttons, and the page number lives in the URL like every
 * other filter in this console — so "page 3 of their customers" is something
 * you can paste into a ticket, and the back button does what it looks like it
 * does.
 *
 * Offset rather than cursor: these lists are sorted by mutable columns
 * (`lastOrderAt`, `orderCount`), which cursors handle badly, and nobody pages
 * deeply through a customer list — they search. If a tenant ever has enough
 * customers for the offset cost to matter, that is the moment to add a
 * cursor, not before.
 */
export default function Pager({
  page,
  pageSize,
  total,
}: {
  page: number;
  pageSize: number;
  total: number;
}) {
  const pathname = usePathname();
  const params = useSearchParams();

  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;

  const href = (p: number) => {
    const sp = new URLSearchParams(params.toString());
    if (p <= 1) sp.delete("page");
    else sp.set("page", String(p));
    const qs = sp.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  };

  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  const link =
    "rounded-sm border border-line2 px-3 py-1.5 text-[12px] text-dim transition-colors hover:text-ink";
  const disabled = "rounded-sm border border-line px-3 py-1.5 text-[12px] text-mute opacity-50";

  return (
    <nav className="mt-4 flex items-center gap-3" aria-label="Pagination">
      <span className="text-[12px] tabular-nums text-mute">
        {first.toLocaleString()}–{last.toLocaleString()} of {total.toLocaleString()}
      </span>
      <div className="ml-auto flex items-center gap-2">
        {page > 1 ? (
          <Link href={href(page - 1)} className={link} rel="prev">
            Previous
          </Link>
        ) : (
          <span className={disabled}>Previous</span>
        )}
        <span className="text-[12px] tabular-nums text-dim">
          Page {page} of {pages}
        </span>
        {page < pages ? (
          <Link href={href(page + 1)} className={link} rel="next">
            Next
          </Link>
        ) : (
          <span className={disabled}>Next</span>
        )}
      </div>
    </nav>
  );
}
