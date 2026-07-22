import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { centsToMoney, displayPhone } from "@/lib/money";
import { customerDetail, listAdminNotes } from "@/lib/customers";
import { Card, SectionTitle, Stat, Table, Td, Th } from "@/components/hearth/ui";
import TagChip from "@/components/hearth/TagChip";
import { addCustomerAdminNoteAction, deleteCustomerAdminNoteAction } from "@/app/admin/actions";

export const dynamic = "force-dynamic";

/**
 * One customer, from our side. **Read-only on everything the tenant owns.**
 *
 * The page exists because "somebody rang about an order" needs order history
 * and the message log in one place. It renders the same `customerDetail` the
 * owner's page does — one implementation, so the console can never tell us
 * something different from what the owner is looking at while we're on the
 * phone with them.
 *
 * What's different from the owner's page is what's *missing*: no consent
 * control, no tag toggles, no note box writing to the tenant's notes. The one
 * thing we can add is an internal note, and it goes in `CustomerAdminNote` —
 * a separate table, not a flag on theirs. That's the `SupportNote` rule
 * repeated: a visibility boolean puts a candid note one forgotten `where`
 * clause away from the restaurant reading it.
 */
export default async function AdminCustomerPage({ params }: { params: { id: string } }) {
  await requireAdmin();

  // Null scope — cross-tenant, and only reachable from behind `requireAdmin()`.
  const [customer, notes] = await Promise.all([
    customerDetail(null, params.id),
    listAdminNotes(params.id),
  ]);
  if (!customer) notFound();

  const c = customer as any;

  return (
    <>
      <div className="mb-2">
        <Link href="/admin/customers" className="text-[12px] text-dim hover:text-ink">
          ← Customer search
        </Link>
      </div>

      <SectionTitle
        title={c.name || displayPhone(c.phone)}
        subtitle={`${displayPhone(c.phone)} · ${c.restaurant?.name ?? "Unknown tenant"}`}
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Orders" value={String(c.orderCount)} />
        <Stat label="Lifetime" value={centsToMoney(c.lifetimeCts)} />
        <Stat
          label="Consent"
          value={
            c.optInStatus === "OPTED_IN"
              ? "Opted in"
              : c.optInStatus === "OPTED_OUT"
                ? "Opted out"
                : "None"
          }
          hint={c.optInAt ? c.optInAt.toISOString().slice(0, 10) : "No record"}
        />
        <Stat
          label="Last order"
          value={c.lastOrderAt ? c.lastOrderAt.toISOString().slice(0, 10) : "—"}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <Card>
            <h3 className="mb-3 text-[14px] font-semibold text-ink">Orders</h3>
            {c.orders.length === 0 ? (
              <p className="text-[13px] text-dim">No orders.</p>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Order</Th>
                    <Th>Status</Th>
                    <Th className="text-right">Total</Th>
                    <Th className="text-right">Refunded</Th>
                    <Th>Date</Th>
                  </tr>
                </thead>
                <tbody>
                  {c.orders.map((o: any) => (
                    <tr key={o.id}>
                      <Td>
                        <Link href={`/admin/orders?q=${o.number}`} className="font-mono text-[12px] text-accent">
                          {o.number}
                        </Link>
                      </Td>
                      <Td className="text-dim">{o.status}</Td>
                      <Td className="text-right font-mono tabular-nums">{centsToMoney(o.totalCts)}</Td>
                      <Td className="text-right font-mono tabular-nums text-dim">
                        {o.refundedCts > 0 ? centsToMoney(o.refundedCts) : "—"}
                      </Td>
                      <Td className="text-dim">{o.createdAt.toISOString().slice(0, 10)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>

          <Card>
            <h3 className="mb-3 text-[14px] font-semibold text-ink">Messages</h3>
            {c.messages.length === 0 ? (
              <p className="text-[13px] text-dim">Nothing has been sent to this customer.</p>
            ) : (
              <ul className="space-y-1.5">
                {c.messages.map((m: any) => (
                  <li key={m.id} className="flex flex-wrap items-baseline gap-2 text-[12px]">
                    <span className="text-mute">{m.createdAt.toISOString().slice(0, 10)}</span>
                    <span className="text-ink">{m.kind}</span>
                    <span className={m.status === "SKIPPED" ? "text-warn" : "text-dim"}>{m.status}</span>
                    {m.error && <span className="text-mute">{m.error}</span>}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <h3 className="mb-1 text-[14px] font-semibold text-ink">Internal notes</h3>
            <p className="mb-3 text-[12px] text-mute">
              Ours. The restaurant never sees these — they&apos;re in a different table from the
              tenant&apos;s own notes, not hidden by a flag.
            </p>

            <form action={addCustomerAdminNoteAction} className="mb-3 space-y-2">
              <input type="hidden" name="customerId" value={c.id} />
              <textarea
                name="body"
                rows={2}
                maxLength={2000}
                required
                placeholder="Called about a double charge on #A-8242. Refund issued, owner notified."
                className="w-full rounded-sm border border-line2 bg-surface px-3 py-2 text-[13px] text-ink outline-none placeholder:text-mute focus:border-accent"
              />
              <button
                type="submit"
                className="h-8 rounded-sm border border-line2 px-3 text-[12px] text-ink hover:border-accent"
              >
                Add note
              </button>
            </form>

            {notes.length === 0 ? (
              <p className="text-[13px] text-dim">No internal notes.</p>
            ) : (
              <ul className="space-y-2">
                {notes.map((n: any) => (
                  <li key={n.id} className="border-b border-line2 pb-2 last:border-0">
                    <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink">{n.body}</p>
                    <div className="mt-1 flex items-center gap-2 text-[11px] text-mute">
                      <span>{n.createdAt.toISOString().slice(0, 10)}</span>
                      {n.authorName && <span>{n.authorName}</span>}
                      <form action={deleteCustomerAdminNoteAction} className="ml-auto">
                        <input type="hidden" name="noteId" value={n.id} />
                        <input type="hidden" name="customerId" value={c.id} />
                        <button type="submit" className="underline underline-offset-2 hover:text-badInk">
                          Delete
                        </button>
                      </form>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <h3 className="mb-3 text-[14px] font-semibold text-ink">Consent record</h3>
            <dl className="space-y-1.5 text-[12px]">
              <div className="flex gap-2">
                <dt className="w-16 shrink-0 text-mute">Status</dt>
                <dd className="text-dim">{c.optInStatus}</dd>
              </div>
              {c.optInAt && (
                <div className="flex gap-2">
                  <dt className="w-16 shrink-0 text-mute">When</dt>
                  <dd className="text-dim">{c.optInAt.toISOString().slice(0, 16).replace("T", " ")}</dd>
                </div>
              )}
              {c.optInSource && (
                <div className="flex gap-2">
                  <dt className="w-16 shrink-0 text-mute">Source</dt>
                  <dd className="text-dim">{c.optInSource}</dd>
                </div>
              )}
              {c.optOutAt && (
                <div className="flex gap-2">
                  <dt className="w-16 shrink-0 text-mute">Opted out</dt>
                  <dd className="text-dim">{c.optOutAt.toISOString().slice(0, 10)}</dd>
                </div>
              )}
            </dl>
            {c.optInText && (
              <p className="mt-3 border-l-2 border-line2 pl-2 text-[11.5px] leading-relaxed text-mute">
                {c.optInText}
              </p>
            )}
            <p className="mt-3 text-[11px] leading-relaxed text-mute">
              Read-only. Consent belongs to the tenant&apos;s relationship with this customer, and
              editing it here would break the audit trail without them knowing.
            </p>
          </Card>

          <Card>
            <h3 className="mb-3 text-[14px] font-semibold text-ink">Tenant&apos;s tags</h3>
            {c.tags.length === 0 ? (
              <p className="text-[13px] text-dim">None.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {c.tags.map((t: any) => (
                  <TagChip key={t.id} name={t.name} color={t.color} />
                ))}
              </div>
            )}
            <p className="mt-3 text-[11px] leading-relaxed text-mute">
              The restaurant&apos;s own labels. Shown for context, not editable from here.
            </p>
          </Card>

          <Card>
            <h3 className="mb-3 text-[14px] font-semibold text-ink">Details</h3>
            <dl className="space-y-1.5 text-[12px]">
              <div className="flex gap-2">
                <dt className="w-20 shrink-0 text-mute">Tenant</dt>
                <dd>
                  <Link
                    href={`/admin/restaurants/${c.restaurantId}`}
                    className="text-accent underline underline-offset-2"
                  >
                    {c.restaurant?.name ?? "Unknown"}
                  </Link>
                </dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-20 shrink-0 text-mute">Email</dt>
                <dd className="break-all text-dim">{c.email || "—"}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-20 shrink-0 text-mute">Added</dt>
                <dd className="text-dim">{c.createdAt.toISOString().slice(0, 10)}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-20 shrink-0 text-mute">Source</dt>
                <dd className="text-dim">{c.importJob ? "Imported" : "Ordered"}</dd>
              </div>
            </dl>
          </Card>
        </div>
      </div>
    </>
  );
}
