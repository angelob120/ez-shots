"use client";

import { useMemo, useState } from "react";
import { Card, Field, Input, Select } from "@/components/hearth/ui";
import { centsToMoney, computeTotals, moneyToCents, type SurchargeConfig } from "@/lib/money";

export type Tenant = SurchargeConfig & {
  id: string;
  name: string;
  surchargeLabel: string;
};

/**
 * Models the surcharge against a subtotal you type. It calls the same
 * `computeTotals` the checkout does rather than restating the formula — a
 * calculator that drifts from the real pricing is worse than none.
 */
export default function FeeCalculator({ tenants }: { tenants: Tenant[] }) {
  const [tenantId, setTenantId] = useState(tenants[0]?.id ?? "");
  const [amount, setAmount] = useState("32.00");

  const tenant = tenants.find((t) => t.id === tenantId) ?? tenants[0];
  const subtotalCts = moneyToCents(amount);
  const totals = useMemo(
    () => (tenant ? computeTotals(subtotalCts, tenant) : null),
    [subtotalCts, tenant],
  );

  if (!tenant || !totals) {
    return <Card>No restaurants yet — nothing to model against.</Card>;
  }

  // Which end of the clamp we landed on, so it's obvious when the percentage
  // isn't what's actually driving the number.
  const rawCts = Math.round(subtotalCts * tenant.surchargePct);
  const clampNote =
    subtotalCts <= 0
      ? null
      : rawCts < tenant.surchargeMinCts
        ? `At the ${centsToMoney(tenant.surchargeMinCts)} floor — the percentage would give ${centsToMoney(rawCts)}.`
        : rawCts > tenant.surchargeMaxCts
          ? `At the ${centsToMoney(tenant.surchargeMaxCts)} ceiling — the percentage would give ${centsToMoney(rawCts)}.`
          : `${(tenant.surchargePct * 100).toFixed(1)}% of subtotal, inside the floor and ceiling.`;

  const takeRate = subtotalCts > 0 ? (totals.surchargeCts / subtotalCts) * 100 : 0;

  return (
    <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
      <Card>
        <div className="space-y-4">
          <Field label="Restaurant">
            <Select value={tenantId} onChange={(e) => setTenantId(e.target.value)}>
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Order subtotal">
            <Input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="32.00"
            />
          </Field>
          <div className="flex flex-wrap gap-1.5">
            {[8, 15, 32, 75, 150, 500].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setAmount(d.toFixed(2))}
                className="rounded-sm border border-line2 px-2 py-1 text-[12px] text-dim hover:text-ink"
              >
                ${d}
              </button>
            ))}
          </div>
          <p className="text-[12px] leading-relaxed text-mute">
            {(tenant.surchargePct * 100).toFixed(1)}% · floor {centsToMoney(tenant.surchargeMinCts)} · ceiling{" "}
            {centsToMoney(tenant.surchargeMaxCts)} · tax {(tenant.taxPct * 100).toFixed(2)}%
          </p>
        </div>
      </Card>

      <Card>
        <dl className="max-w-sm space-y-1.5 text-[13px]">
          <div className="flex justify-between">
            <dt className="text-dim">Subtotal</dt>
            <dd className="font-mono text-ink">{centsToMoney(totals.subtotalCts)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-dim">{tenant.surchargeLabel}</dt>
            <dd className="font-mono text-accent">{centsToMoney(totals.surchargeCts)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-dim">Tax</dt>
            <dd className="font-mono text-ink">{centsToMoney(totals.taxCts)}</dd>
          </div>
          <div className="flex justify-between border-t border-line pt-1.5 font-semibold">
            <dt className="text-ink">Customer pays</dt>
            <dd className="font-mono text-ink">{centsToMoney(totals.totalCts)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-dim">Restaurant keeps</dt>
            <dd className="font-mono text-ink">{centsToMoney(totals.subtotalCts + totals.taxCts)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-accent">We keep</dt>
            <dd className="font-mono text-accent">{centsToMoney(totals.surchargeCts)}</dd>
          </div>
        </dl>
        <p className="mt-4 text-[12px] leading-relaxed text-mute">
          {clampNote}
          {subtotalCts > 0 && ` Effective take rate ${takeRate.toFixed(2)}% of subtotal.`}
        </p>
      </Card>
    </div>
  );
}
