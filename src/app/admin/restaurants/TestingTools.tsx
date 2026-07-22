"use client";

/**
 * DEV / TESTING ONLY — a scratch card for setting up demo data quickly.
 * Delete this component (and its usage on the page) before launch.
 */

import { useFormState, useFormStatus } from "react-dom";
import { seedTestRestaurantAction } from "../actions";
import { sampleMenuCsv } from "@/lib/test-data";
import { Button, Card } from "@/components/hearth/ui";

function SeedButton() {
  const { pending } = useFormStatus();
  return <Button disabled={pending}>{pending ? "Seeding…" : "Seed test restaurant"}</Button>;
}

function downloadSampleCsv() {
  const blob = new Blob([sampleMenuCsv()], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "hearth-test-menu.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function TestingTools() {
  const [state, action] = useFormState(seedTestRestaurantAction, undefined);

  return (
    <Card>
      <div className="mb-1 flex items-center gap-2">
        <h2 className="text-[15px] font-semibold text-ink">Testing tools</h2>
        <span className="rounded-sm border border-warnLine bg-warnBg px-2 py-0.5 text-[10px] uppercase tracking-wide text-warnInk">
          Dev only
        </span>
      </div>
      <p className="mb-4 text-[12px] text-dim">
        Seed a fully-populated demo tenant (owner login, info, branding, and a sample menu with
        photos), or grab a sample CSV to feed the menu importer. Remove this card before launch.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        {/* This card only creates the tenant. Everything that makes it look
            *used* — customers, orders, failures, the outbox — lives on the
            workbench, because those are per-tenant operations and this page is
            the tenant list. */}
        <a
          href="/admin/tools"
          className="rounded-sm border border-line px-3 py-1.5 text-[13px] text-ink hover:bg-surface2"
        >
          Order simulator &amp; sweeps →
        </a>
        <form action={action}>
          <SeedButton />
        </form>
        <button
          type="button"
          onClick={downloadSampleCsv}
          className="rounded-sm border border-line px-3 py-1.5 text-[13px] text-ink hover:bg-surface2"
        >
          Download test CSV
        </button>
      </div>

      {state?.error && (
        <p className="mt-3 rounded-sm border border-badLine bg-badBg px-3 py-2 text-[12px] text-badInk">
          {state.error}
        </p>
      )}
      {state?.ok && (
        <p className="mt-3 rounded-sm border border-goodLine bg-goodBg px-3 py-2 text-[12px] text-accent">
          {state.ok}
        </p>
      )}
    </Card>
  );
}
