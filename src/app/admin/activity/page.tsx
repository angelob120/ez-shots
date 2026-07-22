import { requireAdmin } from "@/lib/auth";
import { recentLogins, activitySummary, IDLE_GAP_MS } from "@/lib/activity";
import { SectionTitle, Stat } from "@/components/hearth/ui";
import { OperatorActivityTables, formatDuration } from "@/components/hearth/OperatorActivity";

export const dynamic = "force-dynamic";

const WINDOW_DAYS = 30;

/**
 * Operator login history and activity — admin only, platform-wide.
 *
 * "When did they log in and how often" comes from the LoginEvent ledger; "what
 * do they spend time doing" comes from the ActivityEvent feed, rolled up per
 * operator with a reconstructed active-time estimate. Both reads go through
 * lib/activity.ts, and the tables are the same component the per-tenant
 * Analytics tab renders — there is no second query or rendering path.
 */
export default async function ActivityPage() {
  await requireAdmin();

  const [summary, logins] = await Promise.all([
    activitySummary(WINDOW_DAYS),
    recentLogins(150),
  ]);

  const totalLogins = summary.reduce((a, s) => a + s.logins, 0);
  const totalViews = summary.reduce((a, s) => a + s.pageViews, 0);

  return (
    <>
      <SectionTitle
        title="Login history & activity"
        subtitle={`Every operator sign-in and page load over the last ${WINDOW_DAYS} days. Active time is estimated from page-load gaps and caps idle at ${Math.round(
          IDLE_GAP_MS / 60000
        )} minutes, so a tab left open doesn't read as a full shift.`}
      />

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Active operators" value={String(summary.length)} hint={`in ${WINDOW_DAYS} days`} />
        <Stat label="Logins" value={String(totalLogins)} />
        <Stat label="Page loads" value={String(totalViews)} />
        <Stat
          label="Total active time"
          value={formatDuration(summary.reduce((a, s) => a + s.activeMs, 0))}
        />
      </div>

      <OperatorActivityTables
        summary={summary}
        logins={logins}
        emptyBody="Once operators sign in and open pages, they'll show up here. If this stays empty after logins, check that migration 35_login_history has run."
      />
    </>
  );
}
