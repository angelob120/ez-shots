import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logoutAction } from "@/app/login/actions";
import { stopImpersonatingAction } from "@/app/admin/actions";
import { resolveModeState } from "@/lib/payments";
import { cardPaymentsAllowed } from "@/lib/entitlements";
import ModeBanner from "@/components/hearth/ModeBanner";
import ThemeToggle from "@/components/hearth/ThemeToggle";
import SetupGaps from "@/components/hearth/SetupGaps";
import SetupCallBanner from "@/components/hearth/SetupCallBanner";
import { hasAttendedBooking, nextBookingForRestaurant } from "@/lib/bookings";
import { gateFor, type OnboardingSnapshot } from "@/lib/onboarding";
import { hasSchedule, parseWeeklyHours } from "@/lib/hours";
import { getTheme, themeAttr } from "@/lib/theme";

export const dynamic = "force-dynamic";

const NAV = [
  { href: "/dashboard", label: "Orders" },
  { href: "/dashboard/orders", label: "History" },
  { href: "/dashboard/analytics", label: "Analytics" },
  { href: "/dashboard/hours", label: "Hours" },
  { href: "/dashboard/menu", label: "Menu" },
  { href: "/dashboard/customers", label: "Customers" },
  // Next to Customers on purpose: an audience is built there and sent to here,
  // and separating them across the nav is how an owner ends up with segments
  // they never message and campaigns aimed at everybody.
  { href: "/dashboard/marketing", label: "Marketing" },
  // Settings lands on Branding; Payments is the second tab once you're there.
  { href: "/dashboard/branding", label: "Settings" },
  { href: "/dashboard/support", label: "Support" },
];

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { session, restaurantId } = await requireOwner();
  const restaurant = await prisma.restaurant.findUnique({ where: { id: restaurantId } });
  if (!restaurant) notFound();

  // An owner who hasn't finished setup belongs in the wizard, not here. This
  // redirect *is* the hard gate — `lib/onboarding.ts` decides what "finished"
  // means, and `/onboarding` refuses to render its launch step until the
  // required work is done, so there is no way through this without doing it.
  //
  // Admins impersonating a pending tenant are let through to look around,
  // because the person who needs to see a half-built tenant is us.
  if (!restaurant.onboardedAt && !session.impersonating) redirect("/onboarding");

  // A tenant that launched and has *since* lost something required — hours
  // cleared, last item deleted. Nagged, never blocked; see SetupGaps.tsx for
  // why that asymmetry is deliberate rather than a half-finished gate.
  const [itemCount, menuSubmissionCount, nextCallForGate] = await Promise.all([
    prisma.menuItem.count({ where: { restaurantId } }),
    prisma.menuSubmission.count({ where: { restaurantId } }),
    nextBookingForRestaurant(restaurantId),
  ]);
  const snapshot: OnboardingSnapshot = {
    onboardedAt: restaurant.onboardedAt,
    onboardingStep: restaurant.onboardingStep,
    name: restaurant.name,
    phone: restaurant.phone,
    address: restaurant.address,
    hasSchedule: hasSchedule(parseWeeklyHours(restaurant.hoursJson)),
    itemCount,
    menuSubmitted: menuSubmissionCount > 0,
    callBooked: nextCallForGate !== null,
    reorderChosen: restaurant.reorderChoiceAt !== null,
    logoUrl: restaurant.logoUrl,
    heroUrl: restaurant.heroUrl,
  };
  const gate = gateFor(snapshot);

  // Owners are told when cards aren't really charging — they're the ones
  // cooking food for orders that collected nothing, and finding that out from a
  // Stripe payout that never arrives is the worst possible way to learn it.
  //
  // Only when they'd otherwise expect money: a tenant taking cash at the
  // counter isn't affected by the platform's Stripe mode, and telling them
  // about it would be noise about a system they don't use.
  const [modeState, takesCards] = await Promise.all([
    resolveModeState(),
    cardPaymentsAllowed(restaurant),
  ]);
  const warnOwner = modeState.mode !== "LIVE" && takesCards && restaurant.stripeChargesEnabled;

  // The setup call. Lingers until a call has actually been *attended* — a
  // booking that nobody turned up to has onboarded nobody, and going quiet at
  // booking time would hide exactly the tenants worth chasing. See
  // SetupCallBanner for why this nags and never blocks.
  //
  // Skipped while impersonating: the person looking is us, and prompting
  // ourselves to book a call with ourselves is noise on the page we use to
  // diagnose a tenant's actual problem.
  const [attendedCall, nextCall] = await Promise.all([
    hasAttendedBooking(restaurantId),
    nextBookingForRestaurant(restaurantId),
  ]);
  const showCallBanner = !attendedCall && !session.impersonating;

  const theme = getTheme();

  return (
    <div className="hearth-shell" data-h-theme={themeAttr(theme)}>
      {warnOwner && (
        <ModeBanner
          mode={modeState.mode as "TEST" | "STUB"}
          expiresAt={null}
          revertTo={null}
          variant="owner"
        />
      )}

      {session.impersonating && (
        <div className="flex items-center justify-center gap-3 bg-warn/15 px-4 py-2 text-[12px] text-warn">
          <span>Viewing {restaurant.name} as admin.</span>
          <form action={stopImpersonatingAction}>
            <button className="underline underline-offset-2">Return to admin</button>
          </form>
        </div>
      )}

      <header className="sticky top-0 z-20 border-b border-line bg-base/90 backdrop-blur">
        {/* Same rule as the admin header: the nav is the only thing that gives.
            The restaurant name is the one exception — it's user-supplied and can
            be arbitrarily long, so it truncates rather than refusing to shrink. */}
        <div className="mx-auto flex h-14 max-w-[1180px] items-center gap-4 px-6">
          {/* Their brand, not ours: an uploaded logo shows here in place of the
              name. Falls back to the accent dot + name when they haven't
              uploaded one, so a new tenant still gets a sensible header rather
              than a broken image. */}
          <Link href="/dashboard" className="flex min-w-0 max-w-[220px] shrink-0 items-center gap-2">
            {restaurant.logoUrl ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={restaurant.logoUrl}
                  alt={restaurant.name}
                  className="h-7 max-w-[180px] shrink-0 object-contain"
                />
                <span className="sr-only">{restaurant.name}</span>
              </>
            ) : (
              <>
                <span
                  className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: restaurant.accentColor }}
                />
                <span className="truncate text-[13px] font-medium text-ink">{restaurant.name}</span>
              </>
            )}
          </Link>
          <nav className="hearth-rail flex min-w-0 flex-1 items-center gap-1">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className="shrink-0 whitespace-nowrap rounded-sm px-3 py-1.5 text-[13px] text-dim transition-colors hover:bg-surface2 hover:text-ink"
              >
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="flex shrink-0 items-center gap-2">
            <ThemeToggle theme={theme} />
            <Link
              href={`/r/${restaurant.slug}`}
              target="_blank"
              className="hidden whitespace-nowrap rounded-sm border border-line2 px-3 py-1.5 text-[12px] text-dim transition-colors hover:text-ink xl:inline-block"
            >
              View ordering page
            </Link>
            {!session.impersonating && (
              <form action={logoutAction}>
                <button className="whitespace-nowrap rounded-sm border border-line2 px-3 py-1.5 text-[12px] text-dim transition-colors hover:text-ink">
                  Sign out
                </button>
              </form>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1180px] px-6 py-8">
        {/* Finished setup, waiting on us to activate. This is the partnership
            gate: the owner has full dashboard access but their ordering page
            stays dark until we meet them and switch it on. Saying so here is
            what stops them thinking the product is broken. */}
        {restaurant.status === "PENDING" && restaurant.onboardedAt && !session.impersonating && (
          <div className="mb-6 rounded-md border border-accentDim/40 bg-accent/5 px-4 py-3.5">
            <div className="text-[13px] font-semibold text-ink">
              Your account is pending activation
            </div>
            <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-dim">
              You&apos;re all set on your end — explore your dashboard freely. Your ordering page
              goes live right after your setup call, once we activate your account.{" "}
              {nextCall
                ? "Your call is booked; check your email for the details."
                : "Haven't booked your call yet? "}
              {!nextCall && (
                <Link href="/book/setup" className="text-accent underline underline-offset-2">
                  Pick a time
                </Link>
              )}
            </p>
          </div>
        )}
        {gate.state === "gaps" && (
          <SetupGaps
            steps={gate.steps.map((x) => ({ key: x.key, label: x.label, todo: x.todo }))}
          />
        )}
        {/* Below SetupGaps on purpose. A missing menu breaks the storefront
            today; an unbooked call is a thing that would have helped. Ordering
            them the other way puts the softer ask above the broken thing. */}
        {showCallBanner && <SetupCallBanner booking={nextCall} bookHref="/book/setup" />}
        {children}
      </main>
    </div>
  );
}
