"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { setServiceSuspensionAction } from "../../actions";
import { Badge, Button, Card } from "@/components/hearth/ui";
import type { ServiceKind } from "@prisma/client";

export type ServiceRow = {
  service: ServiceKind;
  label: string;
  consequence: string;
  suspended: boolean;
  reason: string | null;
  internalNote: string | null;
  suspendedAt: string | null;
  /** The owner's own switch for services that have one; null where they don't. */
  ownerSetting: boolean | null;
};

function Submit({ suspend }: { suspend: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button size="sm" variant={suspend ? "danger" : "primary"} disabled={pending}>
      {pending ? "Working…" : suspend ? "Suspend service" : "Restore service"}
    </Button>
  );
}

/**
 * One card per service. Suspending asks for a reason before it will commit —
 * not validation theatre: the owner is shown that text verbatim, and "your
 * account has been suspended" with no explanation generates the support ticket
 * this panel exists to prevent.
 */
function ServiceCard({ restaurantId, row }: { restaurantId: string; row: ServiceRow }) {
  const [state, action] = useFormState(setServiceSuspensionAction, undefined);
  const [open, setOpen] = useState(false);

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-[14px] font-semibold text-ink">{row.label}</h3>
            <Badge tone={row.suspended ? "warn" : "good"}>
              {row.suspended ? "Suspended" : "Active"}
            </Badge>
            {row.ownerSetting !== null && (
              <span className="text-[11px] text-mute">
                owner&rsquo;s switch: {row.ownerSetting ? "on" : "off"}
              </span>
            )}
          </div>
          <p className="mt-1 max-w-xl text-[12px] leading-relaxed text-mute">{row.consequence}</p>
        </div>

        {row.suspended ? (
          <form action={action} className="shrink-0">
            <input type="hidden" name="id" value={restaurantId} />
            <input type="hidden" name="service" value={row.service} />
            <input type="hidden" name="suspend" value="false" />
            <Submit suspend={false} />
          </form>
        ) : (
          <Button size="sm" variant="ghost" type="button" onClick={() => setOpen((v) => !v)}>
            {open ? "Cancel" : "Suspend"}
          </Button>
        )}
      </div>

      {row.suspended && (
        <div className="mt-3 rounded-sm border border-line2 bg-base px-3 py-2 text-[12px] text-dim">
          <div>
            <span className="text-mute">Owner sees:</span> {row.reason || <em>no reason given</em>}
          </div>
          {row.internalNote && (
            <div className="mt-1">
              <span className="text-mute">Internal:</span> {row.internalNote}
            </div>
          )}
          {row.suspendedAt && <div className="mt-1 text-mute">Since {row.suspendedAt}</div>}
        </div>
      )}

      {!row.suspended && open && (
        <form action={action} className="mt-4 space-y-3 border-t border-line pt-4">
          <input type="hidden" name="id" value={restaurantId} />
          <input type="hidden" name="service" value={row.service} />
          <input type="hidden" name="suspend" value="true" />
          <label className="block">
            <span className="mb-1 block text-[11px] text-mute">
              Reason shown to the owner (required)
            </span>
            <input
              name="reason"
              required
              maxLength={200}
              placeholder="Payment for June is 30 days overdue."
              className="h-8 w-full rounded-sm border border-line2 bg-surface2 px-2 text-[12px] text-ink outline-none focus:border-accentDim"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] text-mute">Internal note (optional)</span>
            <input
              name="internalNote"
              maxLength={200}
              placeholder="Third failed charge; Ana is calling them Monday."
              className="h-8 w-full rounded-sm border border-line2 bg-surface2 px-2 text-[12px] text-ink outline-none focus:border-accentDim"
            />
          </label>
          <Submit suspend />
        </form>
      )}

      {state?.error && <p className="mt-2 text-[12px] text-badInk">{state.error}</p>}
      {state?.ok && <p className="mt-2 text-[12px] text-accent">{state.ok}</p>}
    </Card>
  );
}

export default function ServicesPanel({
  restaurantId,
  rows,
}: {
  restaurantId: string;
  rows: ServiceRow[];
}) {
  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <ServiceCard key={row.service} restaurantId={restaurantId} row={row} />
      ))}
    </div>
  );
}
