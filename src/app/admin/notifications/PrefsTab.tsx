import { Button } from "@/components/hearth/ui";
import { getPrefs } from "@/lib/notifications";
import { KIND_ORDER, resolveChannels, specFor } from "@/lib/notification-format";
import type { NotificationKind } from "@prisma/client";
import { savePrefsAction } from "./actions";

/**
 * Per-kind channel preferences for the signed-in admin. An unchecked-and-saved
 * box persists as an override (an off row), which is why the form upserts every
 * kind rather than only the ones that changed — see `savePrefsAction`. A kind
 * the admin never touches keeps the catalog default with zero rows written.
 *
 * SMS depends on a phone number on the account; the note says so rather than
 * silently doing nothing when the box is ticked and no number exists.
 */
export default async function PrefsTab({ userId }: { userId: string }) {
  const rows = await getPrefs(userId);
  const byKind = new Map(rows.map((r) => [r.kind, r]));

  const groups: Array<"Operations" | "Platform" | "Personal"> = [
    "Operations",
    "Platform",
    "Personal",
  ];

  return (
    <form action={savePrefsAction}>
      <p className="mb-4 text-[13px] text-dim">
        Choose how each kind of event reaches you. In-app always shows in this inbox; email and
        SMS interrupt you when you are not logged in. SMS needs a phone number on your account.
      </p>

      {groups.map((group) => {
        const kinds = KIND_ORDER.filter((k) => specFor(k).group === group);
        return (
          <div key={group} className="mb-6">
            <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-dim">
              {group}
            </h3>
            <div className="overflow-hidden rounded-md border border-line">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-line bg-surface text-[11px] uppercase tracking-wide text-dim">
                    <th className="px-3 py-2 text-left font-medium">Event</th>
                    <th className="w-16 px-2 py-2 text-center font-medium">In-app</th>
                    <th className="w-16 px-2 py-2 text-center font-medium">Email</th>
                    <th className="w-16 px-2 py-2 text-center font-medium">SMS</th>
                  </tr>
                </thead>
                <tbody>
                  {kinds.map((kind) => {
                    const pref = byKind.get(kind as NotificationKind) ?? null;
                    const ch = resolveChannels(kind as NotificationKind, pref);
                    const spec = specFor(kind);
                    return (
                      <tr key={kind} className="border-b border-line last:border-0">
                        <td className="px-3 py-2">
                          <div className="font-medium text-ink">{spec.label}</div>
                          <div className="text-[11.5px] text-dim">{spec.detail}</div>
                        </td>
                        <td className="px-2 py-2 text-center">
                          <input type="checkbox" name={`${kind}.inApp`} defaultChecked={ch.inApp} />
                        </td>
                        <td className="px-2 py-2 text-center">
                          <input type="checkbox" name={`${kind}.email`} defaultChecked={ch.email} />
                        </td>
                        <td className="px-2 py-2 text-center">
                          <input type="checkbox" name={`${kind}.sms`} defaultChecked={ch.sms} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

      <Button type="submit">Save preferences</Button>
    </form>
  );
}
