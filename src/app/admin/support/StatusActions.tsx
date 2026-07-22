import { Button } from "@/components/hearth/ui";
import { canTransition } from "@/lib/support";
import type { SupportStatus } from "@prisma/client";
import { setContactStatusAction, setTicketStatusAction } from "./actions";

/**
 * Resolve / reopen / archive.
 *
 * The buttons are derived from `canTransition` rather than hard-coded, so the
 * UI can't offer a move the library will refuse — which is the failure that
 * teaches an operator the buttons are unreliable. A server-side check still
 * runs: hiding a control is a courtesy, not enforcement, exactly as with the
 * card-payments switch under a suspension.
 */

const LABELS: Partial<Record<SupportStatus, string>> = {
  RESOLVED: "Mark resolved",
  ARCHIVED: "Archive",
  OPEN: "Reopen",
};

export default function StatusActions({
  id,
  status,
  kind,
}: {
  id: string;
  status: SupportStatus;
  kind: "ticket" | "contact";
}) {
  const action = kind === "ticket" ? setTicketStatusAction : setContactStatusAction;
  const field = kind === "ticket" ? "ticketId" : "id";

  const moves = (["RESOLVED", "OPEN", "ARCHIVED"] as SupportStatus[]).filter((to) =>
    canTransition(status, to)
  );

  if (moves.length === 0) {
    return <span className="text-[11.5px] text-mute">Archived — nothing further.</span>;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {moves.map((to) => (
        <form key={to} action={action}>
          <input type="hidden" name={field} value={id} />
          <input type="hidden" name="status" value={to} />
          <Button size="sm" variant={to === "RESOLVED" ? "primary" : "ghost"}>
            {LABELS[to]}
          </Button>
        </form>
      ))}
    </div>
  );
}
