import { Table, Th, Td, Empty, Badge } from "@/components/hearth/ui";
import type { LoginRow, UserActivitySummary } from "@/lib/activity";
import type { LoginMethod } from "@prisma/client";

/**
 * Presentational tables for operator login history — the per-operator rollup
 * and the recent sign-ins feed. Server-rendered, no client JS, no data access:
 * it takes what `lib/activity.ts` already computed. Shared by the platform-wide
 * `/admin/activity` page and the per-tenant Analytics tab so the two never
 * drift into two different renderings of the same numbers.
 */
export function OperatorActivityTables({
  summary,
  logins,
  emptyBody,
}: {
  summary: UserActivitySummary[];
  logins: LoginRow[];
  emptyBody?: string;
}) {
  return (
    <>
      <div className="mb-3 text-[13px] font-medium text-ink">Per operator</div>
      {summary.length === 0 ? (
        <Empty title="No activity yet" body={emptyBody} />
      ) : (
        <div className="mb-8">
          <Table>
            <thead>
              <tr>
                <Th>Operator</Th>
                <Th>Role</Th>
                <Th className="text-right">Logins</Th>
                <Th className="text-right">Page loads</Th>
                <Th className="text-right">Active time</Th>
                <Th className="text-right">Last seen</Th>
              </tr>
            </thead>
            <tbody>
              {summary.map((s) => (
                <tr key={s.userId}>
                  <Td>
                    <div className="text-ink">{s.name || s.email}</div>
                    {s.name && <div className="text-[11px] text-dim">{s.email}</div>}
                  </Td>
                  <Td>
                    <Badge tone={s.role === "ADMIN" ? "warn" : "neutral"}>{s.role}</Badge>
                  </Td>
                  <Td className="text-right font-mono tabular-nums">{s.logins}</Td>
                  <Td className="text-right font-mono tabular-nums">{s.pageViews}</Td>
                  <Td className="text-right font-mono tabular-nums">{formatDuration(s.activeMs)}</Td>
                  <Td className="text-right text-dim">{s.lastSeenAt ? relative(s.lastSeenAt) : "—"}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}

      <div className="mb-3 text-[13px] font-medium text-ink">Recent sign-ins</div>
      {logins.length === 0 ? (
        <Empty title="No sign-ins recorded yet" />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>When</Th>
              <Th>Operator</Th>
              <Th>Method</Th>
              <Th>IP</Th>
              <Th>Device</Th>
            </tr>
          </thead>
          <tbody>
            {logins.map((l) => (
              <tr key={l.id}>
                <Td className="whitespace-nowrap text-dim">{l.at.toLocaleString()}</Td>
                <Td>{l.user.name || l.user.email}</Td>
                <Td>
                  <Badge tone={methodTone(l.method)}>{l.method}</Badge>
                </Td>
                <Td className="font-mono text-[12px] text-dim">{l.ip || "—"}</Td>
                <Td className="text-[12px] text-dim">{shortAgent(l.userAgent)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}

export function methodTone(m: LoginMethod): "neutral" | "good" | "warn" | "bad" {
  if (m === "IMPERSONATE") return "warn";
  if (m === "OAUTH") return "good";
  return "neutral";
}

export function formatDuration(ms: number): string {
  if (ms <= 0) return "0m";
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export function relative(d: Date): string {
  const diff = Date.now() - d.getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.round(h / 24);
  return `${days}d ago`;
}

/** A crude but readable device label from a user-agent string. */
export function shortAgent(ua: string | null): string {
  if (!ua) return "—";
  const os =
    /iPhone|iPad/.test(ua) ? "iOS" :
    /Android/.test(ua) ? "Android" :
    /Mac OS X/.test(ua) ? "Mac" :
    /Windows/.test(ua) ? "Windows" :
    /Linux/.test(ua) ? "Linux" : "";
  const browser =
    /Edg\//.test(ua) ? "Edge" :
    /Chrome\//.test(ua) ? "Chrome" :
    /Safari\//.test(ua) ? "Safari" :
    /Firefox\//.test(ua) ? "Firefox" : "";
  return [browser, os].filter(Boolean).join(" · ") || "Unknown";
}
