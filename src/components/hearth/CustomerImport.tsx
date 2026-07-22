"use client";

import * as React from "react";
import { useFormState, useFormStatus } from "react-dom";
import { Button, Card, cx } from "@/components/hearth/ui";
import type { CustomerImportPreview, CustomerImportSummary } from "@/lib/customer-import";

type ImportAction = (
  prev: CustomerImportSummary | undefined,
  formData: FormData
) => Promise<CustomerImportSummary>;

type PreviewAction = (
  prev: CustomerImportPreview | undefined,
  formData: FormData
) => Promise<CustomerImportPreview>;

function Submit({ hasFile }: { hasFile: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || !hasFile}>
      {pending ? "Importing…" : "Import customers"}
    </Button>
  );
}

/**
 * Customer list import.
 *
 * Collapsed by default. The menu importer sits open on the menu page because
 * importing a menu is a thing owners come to that page to do; importing
 * customers is a once-ever migration task, and a permanent upload box above
 * the list would imply otherwise.
 *
 * The consent notice is not boilerplate and should not be softened. An owner
 * uploading a list overwhelmingly expects to be able to text it — that is
 * usually *why* they're uploading it — and finding out otherwise later feels
 * like the product broke a promise. Saying it before the upload turns it into
 * a known rule instead.
 */
export default function CustomerImport({
  action,
  previewAction,
  tags = [],
}: {
  action: ImportAction;
  /** Optional dry-run. When absent the "check first" button isn't offered. */
  previewAction?: PreviewAction;
  tags?: { id: string; name: string }[];
}) {
  const [state, formAction] = useFormState(action, undefined);
  const [open, setOpen] = React.useState(false);
  const [fileName, setFileName] = React.useState<string | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const [preview, setPreview] = React.useState<CustomerImportPreview | undefined>();
  const [checking, startCheck] = React.useTransition();
  const inputRef = React.useRef<HTMLInputElement>(null);

  // Reopen the panel if a submission came back with something to say, so a
  // result never lands behind a collapsed section.
  React.useEffect(() => {
    if (state?.ok || state?.error) setOpen(true);
  }, [state]);

  function setFile(file: File | null | undefined) {
    if (!file) return;
    if (inputRef.current) {
      const dt = new DataTransfer();
      dt.items.add(file);
      inputRef.current.files = dt.files;
    }
    setFileName(file.name);
    // A preview of the previous file next to the name of a new one is worse
    // than no preview: it's a set of counts that look like they describe what
    // is about to happen and don't.
    setPreview(undefined);
  }

  if (!open) {
    return (
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-sm border border-line2 px-3 py-1.5 text-[12px] text-dim transition-colors hover:text-ink"
        >
          Import customers from a file
        </button>
        <a
          href="/api/customers/csv"
          className="rounded-sm border border-line2 px-3 py-1.5 text-[12px] text-dim transition-colors hover:text-ink"
        >
          Export my list
        </a>
      </div>
    );
  }

  return (
    <Card className="mb-6">
      <div className="mb-3 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-[14px] font-semibold text-ink">Import customers</h3>
          <p className="mt-1 text-[13px] leading-relaxed text-dim">
            A CSV with a <code className="font-mono text-[12px] text-ink">phone</code> column. Name,
            email and notes are optional. Matching numbers update the customer already on file
            rather than creating a second one.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="shrink-0 text-[12px] text-mute hover:text-ink"
        >
          Close
        </button>
      </div>

      <div className="mb-4 rounded-sm border border-warnLine bg-warnBg px-3 py-2.5">
        <p className="text-[12.5px] font-medium text-warnInk">Imported customers can&apos;t be texted</p>
        <p className="mt-1 text-[12px] leading-relaxed text-warnDim">
          Messaging consent has to be given by the customer, with a record of what they agreed to
          and when — a spreadsheet can&apos;t carry that proof, so imported numbers arrive marked
          &ldquo;no consent&rdquo;. They&apos;ll become reachable as they order through your page and opt
          in there. This protects your sending number: texting a list that never opted in gets it
          filtered by the carriers, which would stop your order updates reaching everyone else.
        </p>
      </div>

      <form action={formAction} className="space-y-3">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            setFile(e.dataTransfer.files?.[0]);
          }}
          className={cx(
            "flex w-full flex-col items-center justify-center rounded-sm border border-dashed px-4 py-8 text-center transition-colors",
            dragging ? "border-accent bg-accent/10" : "border-line2 bg-surface2 hover:border-line2"
          )}
        >
          <span className="text-[13px] font-medium text-ink">
            {fileName ?? "Drop a CSV here, or click to choose one"}
          </span>
          <span className="mt-1 text-[12px] text-mute">Up to 2 MB, 5,000 rows per file</span>
        </button>

        <input
          ref={inputRef}
          type="file"
          name="csv"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            setFileName(e.target.files?.[0]?.name ?? null);
            setPreview(undefined);
          }}
        />

        {tags.length > 0 && (
          <label className="flex flex-wrap items-center gap-2 text-[12px] text-dim">
            Tag everyone in this file
            <input
              name="tagName"
              list="customer-import-tags"
              placeholder="e.g. Toast migration"
              maxLength={32}
              className="h-8 w-[220px] rounded-sm border border-line2 bg-surface px-2 text-[12px] text-ink outline-none placeholder:text-mute focus:border-accent"
            />
            <datalist id="customer-import-tags">
              {tags.map((t) => (
                <option key={t.id} value={t.name} />
              ))}
            </datalist>
            <span className="text-mute">
              Optional — a dated tag naming this upload is added either way.
            </span>
          </label>
        )}

        {preview && !preview.error && (
          <div className="space-y-2 rounded-sm border border-line2 bg-surface2 px-3 py-2.5">
            <p className="text-[12.5px] font-medium text-ink">
              {/* The counts are the check. "900 rows, 900 new" on a list you
                  already have means the phone column didn't match anything. */}
              {preview.usableRows.toLocaleString()} usable row
              {preview.usableRows === 1 ? "" : "s"} — {preview.willCreate} new,{" "}
              {preview.willUpdate} filled in, {preview.unchanged} already up to date
            </p>
            <p className="text-[12px] text-dim">
              Columns read:{" "}
              {preview.columns
                .map((c) => `${c.header}${c.mappedTo ? ` → ${c.mappedTo}` : " → ignored"}`)
                .join(", ")}
            </p>
            {preview.sample.length > 0 && (
              <ul className="space-y-0.5">
                {preview.sample.map((s, i) => (
                  <li key={i} className="font-mono text-[11px] text-mute">
                    {s.phone} {s.name ? `· ${s.name}` : ""} {s.existing ? "· already on file" : ""}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-[11px] text-mute">
              Check the numbers above are phone numbers before importing. Nothing has been saved yet.
            </p>
          </div>
        )}
        {preview?.error && <p className="text-[12px] text-badInk">{preview.error}</p>}

        <div className="flex flex-wrap items-center gap-3">
          <Submit hasFile={!!fileName} />
          {previewAction && (
            <button
              type="button"
              disabled={!fileName || checking}
              onClick={() => {
                const file = inputRef.current?.files?.[0];
                if (!file) return;
                const fd = new FormData();
                fd.set("csv", file);
                startCheck(async () => setPreview(await previewAction(undefined, fd)));
              }}
              className="rounded-sm border border-line2 px-3 py-1.5 text-[12px] text-dim transition-colors hover:text-ink disabled:opacity-50"
            >
              {checking ? "Checking…" : "Check this file first"}
            </button>
          )}
          <a
            href="/api/customers/csv?template=1"
            className="text-[12px] text-dim underline underline-offset-2 hover:text-ink"
          >
            Download a template
          </a>
          <a
            href="/api/customers/csv"
            className="text-[12px] text-dim underline underline-offset-2 hover:text-ink"
          >
            Export my current list
          </a>
        </div>

        {state?.error && <p className="text-[12px] text-badInk">{state.error}</p>}

        {state?.ok && (
          <div className="space-y-2 rounded-sm border border-goodLine bg-goodBg px-3 py-2.5">
            <p className="text-[12.5px] font-medium text-good">{state.ok}</p>
            {state.warnings.length > 0 && (
              <ul className="space-y-1">
                {state.warnings.map((w, i) => (
                  <li key={i} className="text-[12px] leading-relaxed text-dim">
                    {w}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </form>
    </Card>
  );
}
