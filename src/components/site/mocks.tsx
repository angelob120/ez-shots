/**
 * Hero visuals. The customer side is rendered in the warm customer-app palette
 * so the two sides of the model — what the diner sees, what the owner keeps —
 * read as two different surfaces at a glance.
 */

const CREAM = "#faf7f2";
const INK = "#1a1a1a";
const DIM = "#6b6b6b";
const LINE = "#ececec";

export function CheckoutReceipt() {
  const lines: Array<[string, string]> = [
    ["2 × Cortado", "9.00"],
    ["Everything bagel", "4.25"],
    ["Subtotal", "13.25"],
    ["Tax", "1.06"],
  ];

  return (
    <div
      className="w-full max-w-[330px] rounded-lg p-5 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.75)]"
      style={{ background: CREAM, color: INK }}
    >
      <div className="flex items-center justify-between">
        <div className="text-[15px] font-semibold tracking-tight">Ember Coffee</div>
        <div
          className="rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em]"
          style={{ background: "#eae4d9", color: DIM }}
        >
          Pickup
        </div>
      </div>
      <div className="mt-0.5 text-[11px]" style={{ color: DIM }}>
        Your order · ready in ~8 min
      </div>

      <div className="mt-4 space-y-2 font-mono text-[12px]">
        {lines.map(([label, amount], i) => (
          <div
            key={label}
            className="flex justify-between"
            style={{
              color: i >= 2 ? DIM : INK,
              paddingTop: i === 2 ? 8 : 0,
              borderTop: i === 2 ? `1px solid ${LINE}` : "none",
            }}
          >
            <span>{label}</span>
            <span className="tabular-nums">${amount}</span>
          </div>
        ))}

        <div
          className="flex items-start justify-between rounded-[8px] px-2.5 py-2"
          style={{ background: "#f0ede5" }}
        >
          <span className="max-w-[180px] leading-snug" style={{ color: DIM }}>
            Service fee
            <span className="mt-0.5 block text-[10px]">Shown before you pay</span>
          </span>
          <span className="tabular-nums" style={{ color: INK }}>
            $1.40
          </span>
        </div>

        <div
          className="flex justify-between pt-2 text-[14px] font-semibold"
          style={{ borderTop: `1px solid ${LINE}` }}
        >
          <span>Total</span>
          <span className="tabular-nums">$15.71</span>
        </div>
      </div>

      <div
        className="mt-4 rounded-[8px] px-3 py-2.5 text-[11px] leading-snug"
        style={{ background: "#efe9dd", color: DIM }}
      >
        Get a text when it&apos;s ready - and 10% off your next order.
        <span className="mt-1 block font-medium" style={{ color: INK }}>
          (313) 555-0142 · opted in
        </span>
      </div>
    </div>
  );
}

export function OwnerLedger() {
  return (
    <div className="w-full max-w-[300px] rounded-lg border border-line2 bg-surface p-5">
      <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-mute">
        What the owner sees
      </div>

      <div className="mt-4 space-y-3 font-mono text-[12px]">
        <Row label="Order total" value="$14.31" />
        <Row label="Card processing" value="−$0.71" tone="dim" />
        <Row label="EZ Orders" value="$0.00" tone="accent" />
        <div className="flex justify-between border-t border-line pt-3 text-[15px] font-semibold text-ink">
          <span>You keep</span>
          <span className="tabular-nums text-accent">$13.60</span>
        </div>
      </div>

      <p className="mt-4 text-[12px] leading-relaxed text-dim">
        The $1.40 service fee sits on the customer&apos;s side of the ticket. Your margin is
        untouched.
      </p>
    </div>
  );
}

function Row({
  label,
  value,
  tone = "ink",
}: {
  label: string;
  value: string;
  tone?: "ink" | "dim" | "accent";
}) {
  const color = tone === "accent" ? "text-accent" : tone === "dim" ? "text-dim" : "text-ink";
  return (
    <div className="flex justify-between">
      <span className="text-dim">{label}</span>
      <span className={`tabular-nums ${color}`}>{value}</span>
    </div>
  );
}

export function TextBubble({
  body,
  meta,
}: {
  body: string;
  meta: string;
}) {
  return (
    <div className="max-w-[300px]">
      <div className="rounded-[16px] rounded-bl-[5px] border border-line2 bg-surface2 px-4 py-3 text-[13px] leading-relaxed text-ink">
        {body}
      </div>
      <div className="mt-1.5 pl-1 font-mono text-[10px] uppercase tracking-[0.08em] text-mute">
        {meta}
      </div>
    </div>
  );
}
