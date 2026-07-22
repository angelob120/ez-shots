import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOwner } from "@/lib/auth";
import { centsToMoney, displayPhone } from "@/lib/money";
import { customerDetail, listTags } from "@/lib/customers";
import { Card, SectionTitle, Stat, Table, Td, Th } from "@/components/hearth/ui";
import TagChip from "@/components/hearth/TagChip";
import ActionForm from "@/components/hearth/ActionForm";
import {
  addCustomerNoteAction,
  deleteCustomerNoteAction,
  toggleCustomerTagAction,
} from "@/app/dashboard/actions";

export const dynamic = "force-dynamic";

/**
 * One customer, everything we know.
 *
 * The page is organised around the question that brings somebody here, which
 * is almost never "what is their email address" — it's "who is this person on
 * the phone, and what happened last time". So order history and the message
 * log are the body, and the contact fields are a sidebar.
 *
 * **The consent block is the part to leave alone.** It shows the status, the
 * timestamp, the source and the exact disclosure text the customer agreed to,
 * because that quartet *is* the TCPA proof — `Customer.optInStatus` on its own
 * is a claim, and the other three are the evidence for it. There is
 * deliberately no control here to change any of it. Consent is written by
 * checkout and by an inbound STOP, and nowhere else; an owner toggle would
 * make every record on the page unfalsifiable, which is the same as having no
 * records. See `lib/sms.ts` and `docs/customer-import.md`.
 */
export default async function CustomerPage({ params }: { params: { id: string } }) {
  const { restaurantId } = await requireOwner();

  const [customer, allTags] = await Promise.all([
    customerDetail(restaurantId, params.id),
    listTags(restaurantId),
  ]);
  if (!customer) notFound();

  const c = customer as any;
  const tagged = new Set<string>(c.tags.map((t: any) => t.id));

  return (
    <>
      <div className="mb-2">
        <Link href="/dashboard/customers" className="text-[12px] text-dim hover:text-ink">
          ← All customers
        </Link>
      </div>

      <SectionTitle
        title={c.name || displayPhone(c.phone)}
        subtitle={c.name ? displayPhone(c.phone) : undefined}
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Orders" value={String(c.orderCount)} />
        <Stat label="Lifetime" value={centsToMoney(c.lifetimeCts)} />
        <Stat
          label="First order"
          value={c.firstOrderAt ? c.firstOrderAt.toISOString().slice(0, 10) : "—"}
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
              <p className="text-[13px] text-dim">
                No orders yet. {c.importJob ? "This contact came from an import." : ""}
              </p>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Order</Th>
                    <Th>Status</Th>
                    <Th className="text-right">Total</Th>
                    <Th>Date</Th>
                  </tr>
                </thead>
                <tbody>
                  {c.orders.map((o: any) => (
                    <tr key={o.id}>
                      <Td>
                        <Link href={`/o/${o.publicToken}`} className="font-mono text-[12px] text-accent">
                          {o.number}
                        </Link>
                      </Td>
                      <Td className="text-dim">{o.status}</Td>
                      <Td className="text-right font-mono tabular-nums">
                        {centsToMoney(o.totalCts)}
                        {o.refundedCts > 0 && (
                          <span className="ml-1 text-[11px] text-warn">
                            −{centsToMoney(o.refundedCts)}
                          </span>
                        )}
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
                    {/* A SKIPPED row and its reason is the record of the
                        consent gate declining to send, and it's the first thing
                        anybody wants when a customer says they heard nothing. */}
                    {m.error && <span className="text-mute">{m.error}</span>}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <h3 className="mb-3 text-[14px] font-semibold text-ink">Notes</h3>
            <ActionForm action={addCustomerNoteAction} className="mb-3 space-y-2">
              <input type="hidden" name="customerId" value={c.id} />
              <textarea
                name="body"
                rows={2}
                maxLength={2000}
                required
                placeholder="Allergic to sesame. Always calls ahead on Fridays."
                className="w-full rounded-sm border border-line2 bg-surface px-3 py-2 text-[13px] text-ink outline-none placeholder:text-mute focus:border-accent"
              />
              <button
                type="submit"
                className="h-8 rounded-sm border border-line2 px-3 text-[12px] text-ink hover:border-accent"
              >
                Add note
              </button>
            </ActionForm>

            {c.notes.length === 0 ? (
              <p className="text-[13px] text-dim">No notes yet.</p>
            ) : (
              <ul className="space-y-2">
                {c.notes.map((n: any) => (
                  <li key={n.id} className="border-b border-line2 pb-2 last:border-0">
                    <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink">{n.body}</p>
                    <div className="mt-1 flex items-center gap-2 text-[11px] text-mute">
                      <span>{n.createdAt.toISOString().slice(0, 10)}</span>
                      {n.authorName && <span>{n.authorName}</span>}
                      <ActionForm action={deleteCustomerNoteAction} className="ml-auto">
                        <input type="hidden" name="noteId" value={n.id} />
                        <input type="hidden" name="customerId" value={c.id} />
                        <button type="submit" className="underline underline-offset-2 hover:text-badInk">
                          Delete
                        </button>
                      </ActionForm>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <h3 className="mb-3 text-[14px] font-semibold text-ink">Messaging consent</h3>
            <p
              className={
                c.optInStatus === "OPTED_IN"
                  ? "text-[13px] font-medium text-good"
                  : c.optInStatus === "OPTED_OUT"
                    ? "text-[13px] font-medium text-badInk"
                    : "text-[13px] font-medium text-dim"
              }
            >
              {c.optInStatus === "OPTED_IN"
                ? "Opted in"
                : c.optInStatus === "OPTED_OUT"
                  ? "Opted out — replied STOP"
                  : "No consent on record"}
            </p>

            <dl className="mt-3 space-y-1.5 text-[12px]">
              {c.optInAt && (
                <div className="flex gap-2">
                  <dt className="text-mute">When</dt>
                  <dd className="text-dim">{c.optInAt.toISOString().slice(0, 16).replace("T", " ")}</dd>
                </div>
              )}
              {c.optInSource && (
                <div className="flex gap-2">
                  <dt className="text-mute">Where</dt>
                  <dd className="text-dim">{c.optInSource}</dd>
                </div>
              )}
              {c.optOutAt && (
                <div className="flex gap-2">
                  <dt className="text-mute">Opted out</dt>
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
              Consent can only be given by the customer at checkout, or withdrawn by them replying
              STOP. It isn&apos;t editable here — the timestamp and wording above are what make it
              provable, and a record you can edit proves nothing.
            </p>
          </Card>

          <Card>
            <h3 className="mb-3 text-[14px] font-semibold text-ink">Tags</h3>
            {allTags.length === 0 ? (
              <p className="text-[13px] text-dim">No tags yet — create one on the customer list.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {allTags.map((t) => {
                  const on = tagged.has(t.id);
                  return (
                    <ActionForm key={t.id} action={toggleCustomerTagAction}>
                      <input type="hidden" name="customerId" value={c.id} />
                      <input type="hidden" name="tagId" value={t.id} />
                      <input type="hidden" name="mode" value={on ? "remove" : "add"} />
                      <button type="submit" className={on ? "" : "opacity-50 hover:opacity-100"}>
                        <TagChip
                          name={t.name}
                          color={t.color}
                          className={on ? "ring-1 ring-accent" : undefined}
                        />
                      </button>
                    </ActionForm>
                  );
                })}
              </div>
            )}
          </Card>

          <Card>
            <h3 className="mb-3 text-[14px] font-semibold text-ink">Details</h3>
            <dl className="space-y-1.5 text-[12px]">
              <div className="flex gap-2">
                <dt className="w-20 shrink-0 text-mute">Phone</dt>
                <dd className="font-mono text-dim">{displayPhone(c.phone)}</dd>
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
                <dd className="text-dim">
                  {c.importJob ? (
                    <>
                      Imported{c.importJob.filename ? ` from ${c.importJob.filename}` : ""} on{" "}
                      {c.importJob.createdAt.toISOString().slice(0, 10)}
                    </>
                  ) : (
                    "Ordered through your page"
                  )}
                </dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-20 shrink-0 text-mute">Cohort</dt>
                <dd className="text-dim">{c.cohort === "HOLDOUT" ? "Holdout" : "Treatment"}</dd>
              </div>
            </dl>
          </Card>
        </div>
      </div>
    </>
  );
}
