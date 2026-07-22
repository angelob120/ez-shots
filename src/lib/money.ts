/**
 * The surcharge is the pricing, the pitch, and the product — so it lives in
 * exactly one place and is always rendered as its own disclosed line.
 *
 * Shape: a percentage of subtotal, clamped between a floor and a ceiling.
 * Defaults give ~$1 on a small ticket and cap near $20 on a $500 order, so it
 * stays in noise territory where it must and only gets large where the order
 * can absorb it.
 */

export type SurchargeConfig = {
  surchargePct: number;
  surchargeMinCts: number;
  surchargeMaxCts: number;
  taxPct: number;
};

export function centsToMoney(cts: number): string {
  return `$${(cts / 100).toFixed(2)}`;
}

export function moneyToCents(input: string | number): number {
  const n = typeof input === "number" ? input : parseFloat(String(input).replace(/[^0-9.]/g, ""));
  if (!isFinite(n)) return 0;
  return Math.round(n * 100);
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * The price a customer actually pays for an item, before modifiers. A sale
 * price only counts when it's set and genuinely lower than the list price, so
 * a stale or fat-fingered sale can never raise a price.
 */
export function effectiveItemPriceCts(item: { priceCts: number; salePriceCts?: number | null }): number {
  if (item.salePriceCts != null && item.salePriceCts > 0 && item.salePriceCts < item.priceCts) {
    return item.salePriceCts;
  }
  return item.priceCts;
}

/** True when the item is actively discounted. */
export function isOnSale(item: { priceCts: number; salePriceCts?: number | null }): boolean {
  return item.salePriceCts != null && item.salePriceCts > 0 && item.salePriceCts < item.priceCts;
}

export function computeSurchargeCts(subtotalCts: number, cfg: SurchargeConfig): number {
  if (subtotalCts <= 0) return 0;
  const raw = Math.round(subtotalCts * cfg.surchargePct);
  return clamp(raw, cfg.surchargeMinCts, cfg.surchargeMaxCts);
}

export type Totals = {
  subtotalCts: number;
  surchargeCts: number;
  taxCts: number;
  totalCts: number;
};

export function computeTotals(subtotalCts: number, cfg: SurchargeConfig): Totals {
  const surchargeCts = computeSurchargeCts(subtotalCts, cfg);
  // Tax applies to the food subtotal, not to the service fee.
  const taxCts = Math.round(subtotalCts * cfg.taxPct);
  return { subtotalCts, surchargeCts, taxCts, totalCts: subtotalCts + surchargeCts + taxCts };
}

export function normalizePhone(input: string): string | null {
  const digits = String(input).replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length > 11 && digits.length <= 15) return `+${digits}`;
  return null;
}

export function displayPhone(e164: string): string {
  const d = e164.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  return e164;
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}
