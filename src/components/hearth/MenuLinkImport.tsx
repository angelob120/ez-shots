"use client";

import * as React from "react";
import { useFormState, useFormStatus } from "react-dom";
import { Button, cx } from "@/components/hearth/ui";
import { applyPriceScale, guessPriceScale, type PriceScale } from "@/lib/menu-scrape";
import type { ImportSummary } from "@/lib/menu-import";
import type { PreviewResult } from "@/app/dashboard/menu/link-import-actions";

/**
 * Import a menu by pasting a link to an existing DoorDash / Uber Eats /
 * Grubhub / Toast page.
 *
 * Three stages, and the middle one is the whole feature:
 *
 *   link ──▶ **review** ──▶ commit
 *
 * The review table is not a confirmation dialog. Scraped rows are genuinely
 * uncertain — a modifier option can look exactly like a dish, and integer
 * prices are ambiguous between cents and dollars — so this is where a human
 * resolves what a heuristic cannot. Everything is editable, everything can be
 * unticked, and nothing is written until Import is pressed.
 *
 * The cents/dollars toggle re-prices from `rawPrice`, which is why the scraper
 * keeps that field. Recomputing from the displayed price would compound each
 * flip.
 */

type PreviewAction = (
  prev: PreviewResult | undefined,
  formData: FormData
) => Promise<PreviewResult>;

type CommitAction = (
  prev: ImportSummary | undefined,
  formData: FormData
) => Promise<ImportSummary>;

/** A row in the review table. `rawPrice` survives so re-scaling stays lossless. */
type Row = {
  id: number;
  include: boolean;
  name: string;
  category: string;
  description: string | null;
  imageUrl: string | null;
  rawPrice: number;
  priceCts: number;
};

const PLATFORM_EXAMPLES = [
  "doordash.com/store/…",
  "ubereats.com/store/…",
  "grubhub.com/restaurant/…",
  "toasttab.com/…",
];

function money(cts: number): string {
  return (cts / 100).toFixed(2);
}

function PreviewSubmit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Reading the page…" : label}
    </Button>
  );
}

export default function MenuLinkImport({
  previewUrlAction,
  previewPasteAction,
  commitAction,
  note,
  onDone,
}: {
  previewUrlAction: PreviewAction;
  previewPasteAction: PreviewAction;
  commitAction: CommitAction;
  /** Context line, e.g. the onboarding "photos come later" note. */
  note?: string;
  onDone?: () => void;
}) {
  const [urlState, urlFormAction] = useFormState(previewUrlAction, undefined);
  const [pasteState, pasteFormAction] = useFormState(previewPasteAction, undefined);
  const [commitState, commitFormAction] = useFormState(commitAction, undefined);

  const [showPaste, setShowPaste] = React.useState(false);
  const [url, setUrl] = React.useState("");

  // Whichever preview ran most recently wins. Tracked by identity rather than
  // a flag so a second run of either action replaces the first cleanly.
  const preview = React.useMemo<PreviewResult | undefined>(() => {
    if (pasteState && (!urlState || pasteState.items.length > 0)) return pasteState;
    return urlState ?? pasteState;
  }, [urlState, pasteState]);

  const [rows, setRows] = React.useState<Row[]>([]);
  const [scale, setScale] = React.useState<PriceScale>("dollars");
  const seeded = React.useRef<PreviewResult | undefined>(undefined);

  // Seed the editable table once per preview. Deliberately not a `useEffect`
  // dependency on `preview.items` — that would wipe the owner's edits every
  // time React re-ran the memo.
  if (preview && preview !== seeded.current) {
    seeded.current = preview;
    const guessed = guessPriceScale(preview.items.map((i) => i.rawPrice));
    setScale(guessed);
    setRows(
      preview.items.map((i, n) => ({
        id: n,
        include: true,
        name: i.name,
        category: i.category ?? "",
        description: i.description,
        imageUrl: i.imageUrl,
        rawPrice: i.rawPrice,
        priceCts: i.priceCts,
      }))
    );
  }

  React.useEffect(() => {
    if (commitState?.ok && onDone) onDone();
  }, [commitState?.ok, onDone]);

  function rescale(next: PriceScale) {
    setScale(next);
    setRows((rs) => rs.map((r) => ({ ...r, priceCts: applyPriceScale(r.rawPrice, next) })));
  }

  function patch(id: number, change: Partial<Row>) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...change } : r)));
  }

  const chosen = rows.filter((r) => r.include);
  const payload = JSON.stringify(
    chosen.map((r) => ({
      name: r.name,
      priceCts: r.priceCts,
      category: r.category.trim() || null,
      description: r.description,
      imageUrl: r.imageUrl,
      available: true,
      featured: false,
    }))
  );

  const blocked = Boolean(preview && !preview.ok && preview.suggestPaste);

  return (
    <div className="space-y-5">
      {/* ── Stage 1: the link ─────────────────────────────────────────── */}
      {rows.length === 0 && (
        <>
          <form action={urlFormAction} className="space-y-3">
            <label className="block text-[12px] font-medium text-ink" htmlFor="menu-url">
              Link to your menu on another platform
            </label>
            <input
              id="menu-url"
              name="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.doordash.com/store/your-restaurant"
              className="w-full rounded-sm border border-line2 bg-surface2 px-3 py-2 text-[13px] text-ink placeholder:text-mute focus:border-accent focus:outline-none"
              autoComplete="off"
              spellCheck={false}
            />
            <p className="text-[11px] leading-relaxed text-mute">
              Works with {PLATFORM_EXAMPLES.join(", ")} and most ordering pages. We read the menu
              and show it to you before anything is added.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <PreviewSubmit label="Read menu" />
              <button
                type="button"
                onClick={() => setShowPaste((v) => !v)}
                className="text-[12px] text-dim underline decoration-line2 underline-offset-2 hover:text-ink"
              >
                {showPaste ? "Hide paste option" : "Paste the page instead"}
              </button>
            </div>
          </form>

          {preview?.error && (
            <p
              className={cx(
                "rounded-sm px-3 py-2 text-[12px] leading-relaxed",
                blocked ? "border border-warnLine bg-warnBg text-warnInk" : "text-badInk"
              )}
            >
              {preview.error}
            </p>
          )}

          {/* ── The fallback, opened by the owner or by a block ──────────── */}
          {(showPaste || blocked) && (
            <form
              action={pasteFormAction}
              className="space-y-3 rounded-sm border border-line bg-surface2 p-4"
            >
              <div>
                <p className="text-[12px] font-medium text-ink">Paste the page</p>
                <ol className="mt-2 space-y-1 text-[11px] leading-relaxed text-dim">
                  <li>1. Open your menu page in a browser and scroll to the bottom so it all loads.</li>
                  <li>
                    2. Press <span className="text-ink">Ctrl+S</span> (or{" "}
                    <span className="text-ink">Cmd+S</span>) to save the page, then open the saved
                    file in a text editor and copy everything.
                  </li>
                  <li>3. Paste it below. Nothing is sent anywhere except to us.</li>
                </ol>
              </div>
              <input type="hidden" name="url" value={url} />
              <textarea
                name="html"
                rows={4}
                placeholder="Paste the saved page here…"
                className="w-full rounded-sm border border-line2 bg-base px-3 py-2 font-mono text-[11px] text-ink placeholder:text-mute focus:border-accent focus:outline-none"
                spellCheck={false}
              />
              <PreviewSubmit label="Read pasted page" />
            </form>
          )}
        </>
      )}

      {/* ── Stage 2: review ───────────────────────────────────────────── */}
      {rows.length > 0 && (
        <form action={commitFormAction} className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[13px] font-medium text-ink">
                Found {rows.length} item{rows.length === 1 ? "" : "s"}
                {preview?.platformLabel ? ` on ${preview.platformLabel}` : ""}
              </p>
              <p className="text-[11px] text-mute">
                Check the prices, untick anything that isn&apos;t a real menu item, then import.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setRows([]);
                seeded.current = undefined;
              }}
              className="text-[12px] text-dim underline decoration-line2 underline-offset-2 hover:text-ink"
            >
              Start over
            </button>
          </div>

          {preview?.warnings.map((w, i) => (
            <p key={i} className="text-[11px] leading-relaxed text-warn">
              {w}
            </p>
          ))}

          {/* The single most important control on the screen: a whole menu
              priced 100x wrong is one click from being priced correctly. */}
          <div className="flex flex-wrap items-center gap-2 rounded-sm border border-line bg-surface2 px-3 py-2">
            <span className="text-[11px] text-dim">Prices on that page were in</span>
            {(["dollars", "cents"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => rescale(s)}
                className={cx(
                  "rounded-sm px-2 py-1 text-[11px] font-medium transition-colors",
                  scale === s ? "bg-accent text-[#ffffff]" : "text-dim hover:text-ink"
                )}
              >
                {s === "dollars" ? "dollars (12.99)" : "cents (1299)"}
              </button>
            ))}
            <span className="text-[11px] text-mute">
              — first item shows as ${money(rows[0]?.priceCts ?? 0)}
            </span>
          </div>

          <div className="max-h-[380px] overflow-y-auto rounded-sm border border-line">
            <table className="w-full border-collapse text-left text-[12px]">
              <thead className="sticky top-0 bg-surface2">
                <tr className="border-b border-line">
                  <th scope="col" className="w-8 px-2 py-2" />
                  <th scope="col" className="px-2 py-2 text-[10px] uppercase tracking-wide text-mute">
                    Item
                  </th>
                  <th scope="col" className="px-2 py-2 text-[10px] uppercase tracking-wide text-mute">
                    Section
                  </th>
                  <th
                    scope="col"
                    className="w-24 px-2 py-2 text-right text-[10px] uppercase tracking-wide text-mute"
                  >
                    Price
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    className={cx("border-b border-line last:border-0", !r.include && "opacity-40")}
                  >
                    <td className="px-2 py-1.5 align-middle">
                      <input
                        type="checkbox"
                        checked={r.include}
                        onChange={(e) => patch(r.id, { include: e.target.checked })}
                        aria-label={`Import ${r.name}`}
                        className="accent-accent"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        value={r.name}
                        onChange={(e) => patch(r.id, { name: e.target.value })}
                        className="w-full bg-transparent text-[12px] text-ink focus:outline-none"
                      />
                      {r.description && (
                        <p className="truncate text-[10px] text-mute" title={r.description}>
                          {r.description}
                        </p>
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        value={r.category}
                        onChange={(e) => patch(r.id, { category: e.target.value })}
                        placeholder="—"
                        className="w-full bg-transparent text-[12px] text-dim placeholder:text-mute focus:outline-none"
                      />
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <input
                        inputMode="decimal"
                        value={money(r.priceCts)}
                        onChange={(e) => {
                          const n = Number(e.target.value.replace(/[^0-9.]/g, ""));
                          if (Number.isFinite(n)) patch(r.id, { priceCts: Math.round(n * 100) });
                        }}
                        className="w-20 bg-transparent text-right text-[12px] tabular-nums text-ink focus:outline-none"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <input type="hidden" name="rows" value={payload} />

          <div className="flex flex-wrap items-center gap-3">
            <CommitSubmit count={chosen.length} />
            <button
              type="button"
              onClick={() => setRows((rs) => rs.map((r) => ({ ...r, include: !chosen.length })))}
              className="text-[12px] text-dim underline decoration-line2 underline-offset-2 hover:text-ink"
            >
              {chosen.length ? "Untick all" : "Tick all"}
            </button>
          </div>

          {note && <p className="text-[11px] text-mute">{note}</p>}
        </form>
      )}

      {/* ── Stage 3: what happened ────────────────────────────────────── */}
      {commitState?.error && <p className="text-[12px] text-badInk">{commitState.error}</p>}
      {commitState?.ok && (
        <div className="space-y-2 rounded-sm border border-goodLine bg-goodBg px-3 py-2.5">
          <p className="text-[12px] font-medium text-accent">{commitState.ok}</p>
          {commitState.imagesFailed > 0 && (
            <p className="text-[11px] text-warn">
              {commitState.imagesFailed} photo
              {commitState.imagesFailed === 1 ? "" : "s"} couldn&apos;t be fetched — those items
              imported without one.
            </p>
          )}
          {commitState.warnings.length > 0 && (
            <details className="text-[11px] text-dim">
              <summary className="cursor-pointer text-mute hover:text-dim">
                {commitState.warnings.length} note
                {commitState.warnings.length === 1 ? "" : "s"}
              </summary>
              <ul className="mt-1.5 space-y-1 pl-1">
                {commitState.warnings.slice(0, 30).map((w, i) => (
                  <li key={i}>• {w}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function CommitSubmit({ count }: { count: number }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || count === 0}>
      {pending ? "Importing…" : `Import ${count} item${count === 1 ? "" : "s"}`}
    </Button>
  );
}
