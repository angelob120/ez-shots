/**
 * The scheduled job.
 *
 * Sweeps that only matter when nobody is looking: orders the restaurant never
 * acknowledged (cancel and refund on their behalf), orders running badly late
 * (tell the customer), refunds that failed on the provider (try the payout
 * again), and texts that failed on a transient error (re-send). The first two
 * used to hang off dashboard load, which meant they ran when someone was
 * watching the board and never ran when nobody was — the exact inverse of what
 * they're for. The retry queues never ran at all: the code recorded what needed
 * re-trying and nothing consumed it.
 *
 * Runs once and exits, so it fits a cron rather than needing a supervised
 * process. On Railway: a second service off this same repo with
 *
 *   startCommand: npm run sweep
 *   cron:         *\/2 * * * *
 *
 * Every two minutes is fine — both sweeps are idempotent and cheap, and the
 * cost of running one late is a customer waiting longer than they should.
 *
 * Exits non-zero on an unhandled error so a failing job is visible in Railway's
 * cron history instead of looking like a clean run that found nothing.
 */

// Relative imports, matching the other scripts here: these run under plain
// tsx without the app's path aliases.
import { prisma } from "../src/lib/prisma";
import { runOrderSweeps } from "../src/lib/orders";
import { retryFailedMessages } from "../src/lib/sms";
import { retryFailedEmails } from "../src/lib/email";
import { drainCampaigns } from "../src/lib/campaigns";
import { drainAutomations } from "../src/lib/automations";
import { runPlanSweeps } from "../src/lib/plan-sweep";
import { resolveModeState } from "../src/lib/payments";
import { drainScheduledNotifications } from "../src/lib/notifications";

async function main() {
  const started = Date.now();

  // Applies an expired non-live payment window. The check already runs on every
  // charge and every admin page load, so this is belt and braces — but the one
  // scenario it covers is the one that matters: a quiet platform where nobody
  // places an order and nobody opens the console, which is exactly the state a
  // forgotten TEST window is likeliest to survive in.
  const mode = await resolveModeState();

  const { expired, overdue, refundsRecovered } = await runOrderSweeps();
  const messagesSent = await retryFailedMessages();
  const emailsSent = await retryFailedEmails();

  // Marketing campaigns: promote schedules that have come due, send a bounded
  // batch, close out anything with nothing left in the queue.
  //
  // Deliberately last. The three above are the platform keeping promises it
  // already made to a customer — a refund owed, an order nobody acknowledged,
  // a "your food is ready" that failed. Marketing is the restaurant asking for
  // something. If a pass runs long or a provider is struggling, the queue that
  // should back up is this one.
  const campaigns = await drainCampaigns();

  // Automations: enroll anyone who now qualifies for a time-based trigger, then
  // advance every journey whose timer has expired.
  //
  // After campaigns for the same reason campaigns come after the transactional
  // retries — this is the restaurant asking for something rather than keeping a
  // promise it already made. It is also the queue most likely to be large: a
  // LAPSED journey activated this morning qualifies most of a tenant's list at
  // once, and if a pass runs long this is the work that should back up.
  const automations = await drainAutomations();

  // Plans: land scheduled switches at the billing boundary, and drop lapsed
  // subscriptions to the free plan.
  //
  // Both are also applied on read — `effectivePlan` and `dunningState` do not
  // trust this job to have run, which is what keeps the product correct while
  // the Railway cron still doesn't exist. This makes the database agree with
  // them, keeps the audit history honest, and tells Stripe.
  const plans = await runPlanSweeps();
  for (const err of plans.errors) console.error(`[sweep] plan: ${err}`);

  // Scheduled notifications: reminders and announcements whose time has come.
  // In-app they surface on any page load once their clock passes; this is what
  // sends their email/SMS. Bounded per run and claimed atomically, so an
  // overlapping pass can't double-send.
  const notifications = await drainScheduledNotifications();

  const ms = Date.now() - started;

  // One line, always — a log that only appears when something happened can't
  // be distinguished from a job that stopped running.
  console.log(
    `[sweep] mode=${mode.mode} expired=${expired} overdue=${overdue} refunds=${refundsRecovered} ` +
      `messages=${messagesSent} emails=${emailsSent} ` +
      `automations=enrolled:${automations.enrolled},advanced:${automations.advanced},ended:${automations.ended} ` +
      `campaigns=started:${campaigns.started},sent:${campaigns.sent},skipped:${campaigns.skipped},failed:${campaigns.failed},done:${campaigns.completed} ` +
      `plans=switched:${plans.switched},lapsed:${plans.lapsed},errors:${plans.errors.length} ` +
      `notifications=${notifications} ` +
      `in ${ms}ms at ${new Date().toISOString()}`
  );
}

main()
  .catch((err) => {
    console.error("[sweep] failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
