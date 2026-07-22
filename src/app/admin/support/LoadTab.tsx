import { prisma } from "@/lib/prisma";
import { Card, Empty, Stat, Table, Td, Th, Button } from "@/components/hearth/ui";
import { deleteSupportLogAction } from "../actions";
import SupportLogForm from "./SupportLogForm";

/**
 * Hours per account per week — the number that decides whether 40–60 accounts
 * is a cash cow or a full-time job.
 *
 * This was the whole of `/admin/support` before tickets existed. It sits as a
 * third tab rather than moving elsewhere because it answers the same question
 * as the other two from the other end: tickets are the support load arriving,
 * this is what it cost.
 */
export default async function LoadTab() {
  const [restaurants, logs] = await Promise.all([
    prisma.restaurant.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, status: true },
    }),
    prisma.supportLog.findMany({
      orderBy: { weekOf: "desc" },
      take: 60,
      include: { restaurant: { select: { name: true } } },
    }),
  ]);

  const active = restaurants.filter((r) => r.status === "ACTIVE").length;

  // Grouped by week so the trend that matters — hours per account as accounts
  // are added — is visible rather than buried in a list.
  const byWeek = new Map<string, { hours: number; accounts: Set<string> }>();
  for (const l of logs) {
    const key = l.weekOf.toISOString().slice(0, 10);
    const e = byWeek.get(key) ?? { hours: 0, accounts: new Set<string>() };
    e.hours += l.hours;
    e.accounts.add(l.restaurantId);
    byWeek.set(key, e);
  }
  const weeks = [...byWeek.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 12);

  const totalHours = logs.reduce((a, l) => a + l.hours, 0);
  const avgPerAccount = weeks.length
    ? weeks.reduce((a, [, w]) => a + w.hours / Math.max(1, w.accounts.size), 0) / weeks.length
    : 0;

  return (
    <>
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Stat label="Active accounts" value={String(active)} />
        <Stat label="Hours logged" value={totalHours.toFixed(1)} hint={`${logs.length} entries`} />
        <Stat
          label="Avg hrs / account / week"
          value={avgPerAccount.toFixed(1)}
          tone="accent"
          hint="Watch the direction, not the level"
        />
      </div>

      <div className="mb-6">
        <SupportLogForm restaurants={restaurants} />
      </div>

      {weeks.length > 0 && (
        <Card className="mb-6">
          <h3 className="mb-4 text-[14px] font-semibold text-ink">By week</h3>
          <div className="space-y-2">
            {weeks.map(([week, w]) => {
              const per = w.hours / Math.max(1, w.accounts.size);
              return (
                <div key={week} className="flex items-center gap-3 text-[12px]">
                  <span className="w-24 font-mono text-mute">{week}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-line">
                    <div
                      className="h-full rounded-full bg-accentDim"
                      style={{ width: `${Math.min(100, per * 12)}%` }}
                    />
                  </div>
                  <span className="w-28 text-right font-mono text-ink">{per.toFixed(1)} h/acct</span>
                  <span className="w-20 text-right text-mute">{w.accounts.size} acct</span>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {logs.length === 0 ? (
        <Empty
          title="No entries yet"
          body="Log hours weekly during the pilot - the trend is the whole point."
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Week of</Th>
              <Th>Restaurant</Th>
              <Th className="text-right">Hours</Th>
              <Th>Note</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.id}>
                <Td className="font-mono text-[12px]">{l.weekOf.toISOString().slice(0, 10)}</Td>
                <Td>{l.restaurant.name}</Td>
                <Td className="text-right font-mono tabular-nums">{l.hours.toFixed(1)}</Td>
                <Td className="text-dim">{l.note ?? "-"}</Td>
                <Td className="text-right">
                  <form action={deleteSupportLogAction}>
                    <input type="hidden" name="id" value={l.id} />
                    <Button size="sm" variant="ghost">
                      Remove
                    </Button>
                  </form>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
