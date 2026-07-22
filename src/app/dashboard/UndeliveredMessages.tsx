import { displayPhone } from "@/lib/money";

/**
 * Texts a carrier reported it never delivered.
 *
 * Ranked below owed money and below complaints, because nothing here is a debt
 * or a fault — it's an answer to a question an owner couldn't previously ask:
 * "did my customer actually get their text?" A bounce usually means a landline
 * or a mistyped number, and the fix is a phone call, not a resend. So there's
 * no button — just the number, the customer, and when, quiet enough to ignore
 * on a good day and there when someone rings up asking where their order link
 * went.
 */

type Row = {
  id: string;
  to: string | null;
  customerName: string | null;
  customerPhone: string | null;
  when: string;
};

export function UndeliveredMessages({ rows }: { rows: Row[] }) {
  if (rows.length === 0) return null;

  return (
    <div className="mb-6 rounded-md border border-line bg-surface p-4">
      <h3 className="mb-1 text-[13px] font-semibold text-ink">
        {rows.length === 1
          ? "A text didn't reach its customer"
          : `${rows.length} texts didn't reach their customers`}
      </h3>
      <p className="mb-3 text-[12px] text-dim">
        The carrier reported these as undelivered — often a landline or a mistyped number. If one of
        these customers is asking where their order link went, this is why.
      </p>
      <ul className="space-y-1.5">
        {rows.map((r) => {
          const number = r.to ?? r.customerPhone;
          return (
            <li key={r.id} className="flex items-baseline justify-between gap-2 text-[12px]">
              <span className="text-dim">
                {r.customerName || "Customer"}
                {number && <span className="ml-1 font-mono text-mute">{displayPhone(number)}</span>}
              </span>
              <span className="font-mono text-[11px] text-mute">{r.when}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
