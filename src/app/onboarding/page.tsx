import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/auth";
import { Button, Card, cx } from "@/components/hearth/ui";
import CopyField from "@/components/hearth/CopyField";
import { centsToMoney } from "@/lib/money";
import { BasicsStep, BrandingStep, HoursStep, MenuChoice, ReorderStep, SeedMenuCard } from "./Steps";
import { finishMenuStepAction, launchAction } from "./actions";
import MenuManager from "../dashboard/menu/MenuManager";
import StepRail, { type StepDef } from "./StepRail";
import { canonicalOrigin, platformOrigin } from "@/lib/domains";
import { parseWeeklyHours, hasSchedule, describeWeek } from "@/lib/hours";
import { parseSiteContent } from "@/lib/site-content";
import {
  blockingSteps,
  canLaunch,
  LAUNCH_STEP,
  onboardingSteps,
  progress,
  resolveStep,
  type OnboardingSnapshot,
} from "@/lib/onboarding";
import BlockedNotice from "./BlockedNotice";
import {
  availableSlots,
  bookingTypeBySlug,
  nextBookingForRestaurant,
} from "@/lib/bookings";
import { countSlots } from "@/lib/booking-slots";
import BookingForm from "../(site)/book/[slug]/BookingForm";

export const dynamic = "force-dynamic";

/**
 * The step list is derived from `lib/onboarding.ts` rather than declared here.
 *
 * It used to be a literal array in this file while the *rules* about which
 * steps mattered lived in the actions and the dashboard redirect — so "which
 * steps exist" and "which steps are required" were three separate opinions
 * that could disagree. They're one now.
 */
function stepDefs(snapshot: OnboardingSnapshot): StepDef[] {
  return onboardingSteps(snapshot).map((x) => ({
    n: x.n,
    label: x.label,
    blurb: x.blurb,
    hint: x.hint,
  }));
}

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: { step?: string; blocked?: string };
}) {
  const { session, restaurantId } = await requireOwner();
  const restaurant = await prisma.restaurant.findUnique({
    where: { id: restaurantId },
    include: {
      categories: { orderBy: { sort: "asc" } },
      items: {
        orderBy: [{ sort: "asc" }, { name: "asc" }],
        include: {
          category: true,
          modifierGroups: {
            orderBy: { sort: "asc" },
            include: { options: { orderBy: [{ sort: "asc" }, { name: "asc" }] } },
          },
          links: { orderBy: { sort: "asc" } },
        },
      },
    },
  });
  if (!restaurant) notFound();

  // Already launched — the wizard is done, don't let it be re-entered. This is
  // the "never visible again" half of the gate: once onboardedAt is set there
  // is no path back into this UI, for anyone, ever.
  if (restaurant.onboardedAt) redirect("/dashboard");

  // Whether they've already booked the setup call, and whether they've asked us
  // to build their menu. Both feed the gate — booking is required, and a menu
  // submission satisfies the menu step in place of typed items.
  const [callBooked, menuSubmissionCount] = await Promise.all([
    nextBookingForRestaurant(restaurantId).then((b) => b !== null),
    prisma.menuSubmission.count({ where: { restaurantId } }),
  ]);

  const snapshot: OnboardingSnapshot = {
    onboardedAt: restaurant.onboardedAt,
    onboardingStep: restaurant.onboardingStep,
    name: restaurant.name,
    phone: restaurant.phone,
    address: restaurant.address,
    hasSchedule: hasSchedule(parseWeeklyHours(restaurant.hoursJson)),
    itemCount: restaurant.items.length,
    menuSubmitted: menuSubmissionCount > 0,
    callBooked,
    reorderChosen: restaurant.reorderChoiceAt !== null,
    logoUrl: restaurant.logoUrl,
    heroUrl: restaurant.heroUrl,
  };

  const STEPS = stepDefs(snapshot);
  const requestedRaw = parseInt(searchParams.step ?? "", 10);
  const step = resolveStep(snapshot, Number.isFinite(requestedRaw) ? requestedRaw : null);
  const outstanding = blockingSteps(snapshot);
  const ready = canLaunch(snapshot);

  const bar = progress(snapshot);

  // Setup-call slots for the booking step. Fetched only when that step is on
  // screen and the call isn't already booked — no point querying the calendar
  // to render a confirmation.
  const setupType =
    step === 5 && !callBooked ? await bookingTypeBySlug("setup") : null;
  const setupDays = setupType ? await availableSlots(setupType) : [];
  const setupWire = setupDays.map((d) => ({
    date: d.date,
    slots: d.slots.map((sl) => sl.startsAt.toISOString()),
  }));
  const setupHasSlots = countSlots(setupDays) > 0;

  const storeUrl = `${canonicalOrigin(restaurant) || platformOrigin()}${
    restaurant.customDomain && restaurant.domainVerifiedAt ? "" : `/r/${restaurant.slug}`
  }`;

  return (
    <div>
      <StepRail steps={STEPS} step={step} furthest={restaurant.onboardingStep} />

      {/* Shown when an owner tried to jump to launch with work outstanding —
          `launchAction` bounces them here with ?blocked=1. Saying which step
          and why beats a button that silently refuses. */}
      <BlockedNotice
        blocked={searchParams.blocked === "1"}
        steps={outstanding.map((x) => ({ n: x.n, label: x.label, todo: x.todo }))}
        progress={bar}
      />

      <Card>
        {step === 1 && (
          <BasicsStep
            defaults={{
              name: restaurant.name,
              phone: restaurant.phone ?? "",
              address: restaurant.address ?? "",
              city: restaurant.city ?? "",
              hours: restaurant.hours ?? "",
              tagline: restaurant.tagline ?? "",
            }}
          />
        )}

        {step === 2 && (
          <BrandingStep
            initial={{
              slug: restaurant.slug,
              name: restaurant.name,
              tagline: restaurant.tagline ?? "",
              logoUrl: restaurant.logoUrl ?? "",
              heroUrl: restaurant.heroUrl ?? "",
              accentColor: restaurant.accentColor,
              themePreset: restaurant.themePreset,
              theme: (["LIGHT", "DARK", "SYSTEM"].includes(restaurant.theme)
                ? restaurant.theme
                : "SYSTEM") as "LIGHT" | "DARK" | "SYSTEM",
              address: restaurant.address ?? "",
              city: restaurant.city ?? "",
              phone: restaurant.phone ?? "",
              hours: restaurant.hours ?? "",
              heroHeadline: restaurant.heroHeadline ?? "",
              heroCtaLabel: restaurant.heroCtaLabel ?? "",
              aboutTitle: restaurant.aboutTitle ?? "",
              aboutBody: restaurant.aboutBody ?? "",
              gallery: restaurant.galleryUrls ?? [],
              showAbout: restaurant.showAbout,
              showGallery: restaurant.showGallery,
              content: parseSiteContent(restaurant.siteContent),
            }}
          />
        )}

        {step === 3 && (
          <div className="space-y-6">
            <div>
              <h2 className="text-[17px] font-semibold tracking-tight text-ink">Your menu</h2>
              <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-dim">
                The slowest part of setup — so don&apos;t do it the hard way. Let us build it from
                what you already have, or add items yourself if you&apos;d rather. Either way you can
                keep editing after you&apos;re live.
              </p>
            </div>

            <MenuChoice>
            <div className="space-y-6">
            <div className="flex items-start gap-3 rounded-md border border-line2 bg-surface2 px-4 py-3">
              <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent/10 text-[13px]">
                🍽️
              </span>
              <p className="text-[12px] leading-relaxed text-dim">
                Build your menu just like the live dashboard - add photos, sizes and add-ons on each
                item, group things into categories, or import a CSV. Everything here is exactly what
                customers will see. You can keep editing after you launch.
              </p>
            </div>

            <SeedMenuCard />

            <MenuManager
              categories={restaurant.categories.map((c) => ({ id: c.id, name: c.name }))}
              items={restaurant.items.map((i) => ({
                id: i.id,
                name: i.name,
                description: i.description,
                price: (i.priceCts / 100).toFixed(2),
                salePrice: i.salePriceCts != null ? (i.salePriceCts / 100).toFixed(2) : null,
                imageUrl: i.imageUrl,
                color: i.color,
                categoryId: i.categoryId,
                available: i.available,
                featured: i.featured,
                sort: i.sort,
                groups: i.modifierGroups.map((g) => ({
                  id: g.id,
                  name: g.name,
                  minSelect: g.minSelect,
                  maxSelect: g.maxSelect,
                  options: g.options.map((o) => ({
                    id: o.id,
                    name: o.name,
                    priceDelta: (o.priceDeltaCts / 100).toFixed(2),
                    isDefault: o.isDefault,
                    available: o.available,
                  })),
                })),
                links: i.links.map((l) => ({ id: l.id, linkedItemId: l.linkedItemId, kind: l.kind })),
              }))}
            />
            </div>
            </MenuChoice>

            <div className="border-t border-line pt-5">
              <form action={finishMenuStepAction} className="flex items-center gap-3">
                <Button type="submit" disabled={restaurant.items.length === 0 && menuSubmissionCount === 0}>
                  Continue
                </Button>
                {restaurant.items.length === 0 && menuSubmissionCount === 0 && (
                  <span className="text-[12px] text-mute">
                    Add an item, or send us your menu, to continue.
                  </span>
                )}
              </form>
            </div>
          </div>
        )}

        {step === 4 && (
          <HoursStep
            hours={parseWeeklyHours(restaurant.hoursJson)}
            timezone={restaurant.timezone}
          />
        )}

        {step === 5 && (
          <div className="space-y-6">
            <div>
              <h2 className="text-[17px] font-semibold tracking-tight text-ink">
                Book your setup call
              </h2>
              <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-dim">
                Almost done. Before your page goes live, we hop on a quick call — about twenty
                minutes — to look over your menu and hours together and switch your account on. Pick
                any time that works. You&apos;ll get a link to join, and you can reschedule later if
                you need to.
              </p>
            </div>

            {callBooked ? (
              <div className="space-y-5">
                <div className="rounded-md border border-goodLine bg-goodBg px-4 py-3.5 text-[13px] leading-relaxed text-accent">
                  Your setup call is booked. Check your email for the details and the join link —
                  you&apos;re all set to finish up.
                </div>
                <Link href="/onboarding?step=6">
                  <Button>Continue</Button>
                </Link>
              </div>
            ) : setupHasSlots && setupType ? (
              <div className="rounded-md border border-line bg-surface p-5">
                <BookingForm
                  typeSlug={setupType.slug}
                  days={setupWire}
                  hostTimezone={setupType.timezone}
                  restaurantId={restaurantId}
                  prefill={{
                    name: restaurant.name,
                    email: session.email ?? null,
                    phone: restaurant.phone,
                  }}
                />
              </div>
            ) : (
              <div className="rounded-md border border-warnLine bg-warnBg px-4 py-3.5 text-[13px] leading-relaxed text-warnInk">
                Nothing&apos;s open on the calendar right now.{" "}
                <Link href="/contact" className="underline underline-offset-2">
                  Send us a message
                </Link>{" "}
                and we&apos;ll sort out a time directly, then come back here to finish.
              </div>
            )}
          </div>
        )}

        {step === 6 && (
          <ReorderStep
            initialOn={restaurant.reorderCampaigns}
            initialMode={restaurant.reorderMode}
          />
        )}

        {step === LAUNCH_STEP && (
          <div className="space-y-6">
            <div>
              <h2 className="text-[15px] font-semibold text-ink">Here&rsquo;s your link</h2>
              <p className="mt-1 text-[12.5px] leading-relaxed text-dim">
                This is your page. Nothing about it changes later — put it on a sticker if you
                want. It goes live once we activate your account after the setup call.
              </p>
              <div className="mt-3">
                <CopyField value={storeUrl} tone="accent" />
              </div>
            </div>

            <div className="border-t border-line pt-5">
              <h3 className="text-[13px] font-semibold text-ink">What you set up</h3>
              <dl className="mt-3 grid gap-3 text-[13px] sm:grid-cols-2">
                <Row label="Restaurant" value={restaurant.name} />
                <Row
                  label="Pickup"
                  value={[restaurant.address, restaurant.city].filter(Boolean).join(", ")}
                />
                <Row label="Phone" value={restaurant.phone ?? "-"} />
                <Row label="Menu items" value={String(restaurant.items.length)} />
                <Row
                  label="Open"
                  value={
                    describeWeek(parseWeeklyHours(restaurant.hoursJson))
                      .filter((d) => d.text !== "Closed")
                      .map((d) => d.label)
                      .join(", ") || "-"
                  }
                />
              </dl>
            </div>

            <div className="rounded-md border border-line2 bg-surface2 p-4 text-[12px] leading-relaxed text-dim">
              Orders carry a disclosed{" "}
              <span className="text-ink">{restaurant.surchargeLabel.toLowerCase()}</span> paid by the
              customer — {(restaurant.surchargePct * 100).toFixed(1)}% of the subtotal, between{" "}
              {centsToMoney(restaurant.surchargeMinCts)} and {centsToMoney(restaurant.surchargeMaxCts)}.
              It shows as its own line at checkout. You pay no monthly fee and keep your full margin.
            </div>

            <div className="border-t border-line pt-5">
              <h3 className="text-[13px] font-semibold text-ink">Once you&rsquo;re live, do these three things</h3>
              <p className="mt-1 text-[12px] leading-relaxed text-mute">
                After we activate your page, these are what actually bring people to it —
                the first one matters more than the other two together.
              </p>
              <ol className="mt-3 space-y-2.5 text-[12.5px] leading-relaxed text-dim">
                <li className="flex gap-2.5">
                  <span className="mt-[3px] grid h-4 w-4 shrink-0 place-items-center rounded-full border border-line2 text-[9px] text-mute">
                    1
                  </span>
                  <span>
                    <span className="text-ink">Paste it into Google Business Profile</span> — the
                    &ldquo;Order online&rdquo; field. That&rsquo;s where people already search for you.
                  </span>
                </li>
                <li className="flex gap-2.5">
                  <span className="mt-[3px] grid h-4 w-4 shrink-0 place-items-center rounded-full border border-line2 text-[9px] text-mute">
                    2
                  </span>
                  <span>
                    <span className="text-ink">Put it in your Instagram bio</span> and pin a post
                    about it. The people already following you are the cheapest orders
                    you&rsquo;ll ever get.
                  </span>
                </li>
                <li className="flex gap-2.5">
                  <span className="mt-[3px] grid h-4 w-4 shrink-0 place-items-center rounded-full border border-line2 text-[9px] text-mute">
                    3
                  </span>
                  <span>
                    <span className="text-ink">Put a QR code on the counter.</span> There&rsquo;s one
                    ready to print under Branding &rarr; Links.
                  </span>
                </li>
              </ol>
            </div>

            {/* What actually happens when they press the button. This is a
                partnership, not a self-serve launch: submitting hands the page
                to us for review, and it goes live after the setup call. Saying
                so here — right next to the button — is what stops an owner
                refreshing /r/their-slug that night wondering why it's dark. */}
            <div className="rounded-md border border-accentDim/40 bg-accent/5 px-4 py-3.5">
              <div className="text-[13px] font-semibold text-ink">What happens when you finish</div>
              <ol className="mt-2.5 space-y-2 text-[12.5px] leading-relaxed text-dim">
                <li className="flex gap-2.5">
                  <span className="mt-[3px] grid h-4 w-4 shrink-0 place-items-center rounded-full border border-line2 text-[9px] text-mute">
                    1
                  </span>
                  <span>Your page is saved and handed to us for review.</span>
                </li>
                <li className="flex gap-2.5">
                  <span className="mt-[3px] grid h-4 w-4 shrink-0 place-items-center rounded-full border border-line2 text-[9px] text-mute">
                    2
                  </span>
                  <span>
                    We meet on your setup call{callBooked ? "" : " (book it on the step before this)"} and
                    go through everything together.
                  </span>
                </li>
                <li className="flex gap-2.5">
                  <span className="mt-[3px] grid h-4 w-4 shrink-0 place-items-center rounded-full border border-line2 text-[9px] text-mute">
                    3
                  </span>
                  <span>
                    <span className="text-ink">We switch your account on</span> and your page starts
                    taking orders. You keep full dashboard access the whole time.
                  </span>
                </li>
              </ol>
            </div>

            <form action={launchAction} className="flex flex-wrap items-center gap-3 border-t border-line pt-5">
              <Button type="submit" disabled={!ready}>
                Finish setup &amp; submit for activation
              </Button>
              <Link href="/onboarding?step=1" className="text-[13px] text-dim hover:text-ink">
                Go back and edit
              </Link>
              {!ready && (
                <span className="text-[12px] text-warn">
                  {outstanding.map((x) => x.label).join(" and ")} still needed.
                </span>
              )}
            </form>
          </div>
        )}
      </Card>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-[0.08em] text-mute">{label}</dt>
      <dd className={cx("mt-0.5 text-ink", mono && "font-mono text-[12px]")}>{value || "-"}</dd>
    </div>
  );
}
