"use client";

import * as React from "react";
import { useFormState, useFormStatus } from "react-dom";
import { Button, cx } from "@/components/hearth/ui";
import type { ImportSummary } from "@/lib/menu-import";

type ImportAction = (
  prev: ImportSummary | undefined,
  formData: FormData
) => Promise<ImportSummary>;

function Submit({ hasFile }: { hasFile: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || !hasFile}>
      {pending ? "Importing…" : "Import CSV"}
    </Button>
  );
}

/**
 * A self-contained CSV import panel. Reused by onboarding and the dashboard;
 * the only difference is the server action passed in and whether re-hosting
 * of photos happens on the server (decided by that action).
 */
export default function CsvImport({
  action,
  note,
}: {
  action: ImportAction;
  /** Extra line under the dropzone, e.g. the onboarding "photos come later" note. */
  note?: string;
}) {
  const [state, formAction] = useFormState(action, undefined);
  const [fileName, setFileName] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = React.useState(false);

  function setFile(file: File | null | undefined) {
    if (!file) return;
    if (inputRef.current) {
      const dt = new DataTransfer();
      dt.items.add(file);
      inputRef.current.files = dt.files;
    }
    setFileName(file.name);
  }

  return (
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
          "flex w-full flex-col items-center justify-center gap-1 rounded-sm border border-dashed px-4 py-6 text-center transition-colors",
          dragging ? "border-accent bg-accent/10" : "border-line2 bg-surface2 hover:border-line2"
        )}
      >
        <span className="text-[13px] font-medium text-ink">
          {fileName ?? "Drop a .csv file, or tap to choose"}
        </span>
        <span className="text-[11px] text-mute">
          Columns: name, price, category, description, image_url, available, featured
        </span>
      </button>

      <input
        ref={inputRef}
        type="file"
        name="csv"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
      />

      <div className="flex flex-wrap items-center gap-3">
        <Submit hasFile={!!fileName} />
        <a
          href="/api/menu/csv?template=1"
          className="text-[12px] text-dim underline decoration-line2 underline-offset-2 hover:text-ink"
        >
          Download template
        </a>
      </div>

      {note && <p className="text-[11px] text-mute">{note}</p>}

      {state?.error && <p className="text-[12px] text-badInk">{state.error}</p>}

      {state?.ok && (
        <div className="space-y-2 rounded-sm border border-goodLine bg-goodBg px-3 py-2.5">
          <p className="text-[12px] font-medium text-accent">{state.ok}</p>
          {state.imagesFailed > 0 && (
            <p className="text-[11px] text-warn">
              {state.imagesFailed} image{state.imagesFailed === 1 ? "" : "s"} couldn&apos;t be
              fetched - those items imported without a photo.
            </p>
          )}
          {state.warnings.length > 0 && (
            <details className="text-[11px] text-dim">
              <summary className="cursor-pointer text-mute hover:text-dim">
                {state.warnings.length} note{state.warnings.length === 1 ? "" : "s"}
              </summary>
              <ul className="mt-1.5 space-y-1 pl-1">
                {state.warnings.slice(0, 30).map((w, i) => (
                  <li key={i}>• {w}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </form>
  );
}
