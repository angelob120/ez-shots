import type { Metadata } from "next";
import Link from "next/link";
import { VISIBLE_PLANS } from "@/lib/plans";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Pricing - EZ Orders",
  description:
    "Zero Monthly: the whole platform, no monthly bill. A small disclosed service fee rides on the customer's ticket instead.",
};

/** Every plan ships the identical product. The only variable is who pays. */
const INCLUDED = [
  "Branded ordering page linked from your Google and Apple listings",
  "Unlimited menu items, categories, and photos",
  "Customer list with recorded text opt-ins, exportable any time",
  "Rewards program",
  "Three automatic text campaigns: first reorder, win-back, frequency",
  "Orders dashboard",
  "Email support",
];

type Plan = {
  id: string;
  name: string;
  price: string;
  unit: string;
  pitch: string;
  rows: Array<[string, string]>;
  cta: string;
  featured?: boolean;
};

/**
 * The cards, in display order. Filtered by `VISIBLE_PLANS` below rather than
 * edited down, so re-enabling a plan is a flag flip in `lib/features.ts` and
 * not a copywriting job. `id` matches the `Plan` union lower-cased — that
 * correspondence is what makes the filter work, so keep it.
 */
const ALL_PLANS: Plan[] = [
  {
    id: "flat",
    name: "Flat Subscription",
    price: "$399",
    unit: "/ month",
    pitch: "You cover the software yourself so nothing shows up on the customer's ticket.",
    rows: [
      ["Monthly fee", "$399"],
      ["Commission on orders", "None"],
      ["Customer service fee", "None"],
      ["You pay, per month", "$399 + processing"],
    ],
    cta: "Choose Flat",
  },
  {
    id: "zero",
    name: "Zero Monthly",
    price: "$0",
    unit: "/ month, forever",
    pitch:
      "A small service fee rides on the customer's ticket, disclosed before they pay. Nothing leaves your account.",
    rows: [
      ["Monthly fee", "$0"],
      ["Commission on orders", "None"],
      ["Customer service fee", "$1–2 typical"],
      ["You pay, per month", "$0 + processing"],
    ],
    cta: "Start free",
    featured: true,
  },
  {
    id: "hybrid",
    name: "Subscription + Commission",
    price: "$149",
    unit: "/ month + 4%",
    pitch: "A lower monthly in exchange for four percent of every order that comes through.",
    rows: [
      ["Monthly fee", "$149"],
      ["Commission on orders", "4% of every order"],
      ["Customer service fee", "None"],
      ["You pay, per month", "$149 + 4% + processing"],
    ],
    cta: "Choose Hybrid",
  },
];

const PLANS: Plan[] = ALL_PLANS.filter((p) =>
  VISIBLE_PLANS.some((v) => v.toLowerCase() === p.id)
);

/** True when there is nothing to compare, which changes the page's whole pitch. */
const SINGLE_PLAN = PLANS.length === 1;

export default function PricingPage() {
  return (
    <>
      <section className="border-b border-line">
        <div className="mx-auto max-w-[1140px] px-6 py-20 text-center">
          <h1 className="text-[40px] font-semibold leading-[1.05] tracking-[-0.03em] text-ink sm:text-[52px]">
            Same platform.
            <br />
            <span className="text-accent">
              {SINGLE_PLAN ? "No monthly bill." : "Three ways to pay for it."}
            </span>
          </h1>
          <p className="mx-auto mt-5 max-w-[560px] text-[16px] leading-relaxed text-dim">
            {SINGLE_PLAN
              ? "You get the whole product and pay us nothing every month. A small service fee rides on the customer's ticket instead, disclosed before they pay, and nothing is held back behind a higher tier."
              : "Every plan below includes the identical product - nothing is held back for a higher tier. The only thing that changes is who covers the cost. Almost everyone picks the middle one."}
          </p>
        </div>
      </section>

      <section className="border-b border-line">
        <div className="mx-auto max-w-[1140px] px-6 py-16">
          <div
            className={
              SINGLE_PLAN
                ? "mx-auto grid max-w-[420px] items-start gap-5"
                : "grid items-start gap-5 lg:grid-cols-3"
            }
          >
            {PLANS.map((p) => (
              <PlanCard key={p.id} plan={p} />
            ))}
          </div>

          <p className="mt-8 text-center text-[12px] text-mute">
            Card processing is yours, the same as it is today. No contracts and no setup fee.
          </p>
        </div>
      </section>

      {/* Everything below is identical across plans — say so once, loudly. */}
      <section className="border-b border-line bg-surface/40">
        <div className="mx-auto grid max-w-[1140px] gap-10 px-6 py-16 lg:grid-cols-[0.9fr_1.1fr]">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="h-px w-6 bg-accentDim" />
              <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent">
                Included everywhere
              </span>
            </div>
            <h2 className="mt-3 text-[28px] font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-[34px]">
              No feature gates.
            </h2>
            <p className="mt-4 max-w-[380px] text-[14px] leading-relaxed text-dim">
              A cheaper plan doesn&apos;t mean a smaller product. Rewards, texts, and your customer
              list work the same whether you pay us $0 or $399.
            </p>
          </div>

          <ul className="grid gap-3 sm:grid-cols-2">
            {INCLUDED.map((item) => (
              <li key={item} className="flex gap-3 text-[13px] leading-relaxed text-dim">
                <Check />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="border-b border-line">
        <div className="mx-auto max-w-[1140px] px-6 py-16">
          <h2 className="text-[24px] font-semibold tracking-[-0.02em] text-ink sm:text-[28px]">
            How the customer service fee works
          </h2>
          <p className="mt-3 max-w-[620px] text-[14px] leading-relaxed text-dim">
            On Zero Monthly, the fee scales with the size of the order, so small tickets stay in noise
            territory and only large ones carry a real fee. It appears as its own line at checkout,
            never folded into your item prices.
          </p>

          <div className="mt-8 max-w-[560px] overflow-hidden rounded-md border border-line bg-surface">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  <th className="border-b border-line bg-surface2 px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-mute">
                    Order size
                  </th>
                  <th className="border-b border-line bg-surface2 px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-mute">
                    Customer pays
                  </th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["Under $25", "$1.00"],
                  ["$25 – $75", "$1.40 – $2.50"],
                  ["$75 – $200", "$3 – $7"],
                  ["Over $200", "Caps out around $20"],
                ].map(([range, fee]) => (
                  <tr key={range}>
                    <td className="border-b border-line px-5 py-3 text-dim">{range}</td>
                    <td className="border-b border-line px-5 py-3 font-mono tabular-nums text-ink">
                      {fee}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-5 max-w-[620px] text-[12px] leading-relaxed text-mute">
            If you already run a card surcharge, we&apos;ll go through how the full ticket reads
            before you launch. Prefer that your customers see no fee at all? Tell us — we&apos;re
            working on a plan where you cover the software yourself instead.
          </p>
        </div>
      </section>

      <section>
        <div className="mx-auto max-w-[1140px] px-6 py-20 text-center">
          <h2 className="text-[28px] font-semibold tracking-[-0.02em] text-ink sm:text-[34px]">
            Start on Zero Monthly. Move if you ever want to.
          </h2>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <Link
              href="/signup"
              className="inline-flex h-11 items-center rounded-sm bg-accent px-6 text-[14px] font-semibold text-[#ffffff] transition-colors hover:bg-[#60a5fa]"
            >
              Create your account
            </Link>
            <Link
              href="/#faq"
              className="inline-flex h-11 items-center rounded-sm border border-line2 px-5 text-[14px] font-medium text-ink transition-colors hover:bg-surface2"
            >
              Read the FAQ
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}

function PlanCard({ plan }: { plan: Plan }) {
  const featured = plan.featured;

  return (
    <div
      className={
        featured
          ? "relative rounded-md border border-accentDim bg-surface p-7 shadow-[0_0_0_1px_rgba(61,220,132,0.18),0_24px_60px_-32px_rgba(61,220,132,0.35)] lg:-mt-4 lg:pb-9"
          : "relative rounded-md border border-line bg-surface/60 p-7"
      }
    >
      {featured && (
        <span className="absolute -top-3 left-7 rounded-full bg-accent px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#ffffff]">
          Most restaurants
        </span>
      )}

      <div className={`text-[13px] font-semibold ${featured ? "text-ink" : "text-dim"}`}>
        {plan.name}
      </div>

      <div className="mt-4 flex items-baseline gap-2">
        <span
          className={`font-mono text-[40px] font-semibold leading-none ${
            featured ? "text-accent" : "text-ink"
          }`}
        >
          {plan.price}
        </span>
        <span className="text-[13px] text-mute">{plan.unit}</span>
      </div>

      <p className="mt-4 min-h-[60px] text-[13px] leading-relaxed text-dim">{plan.pitch}</p>

      <dl className="mt-5 space-y-2.5 border-t border-line pt-5 text-[12px]">
        {plan.rows.map(([label, value], i) => {
          const last = i === plan.rows.length - 1;
          return (
            <div key={label} className="flex items-baseline justify-between gap-4">
              <dt className={last ? "font-medium text-ink" : "text-dim"}>{label}</dt>
              <dd
                className={`text-right font-mono tabular-nums ${
                  last ? (featured ? "text-accent" : "text-ink") : "text-dim"
                }`}
              >
                {value}
              </dd>
            </div>
          );
        })}
      </dl>

      <Link
        href="/signup"
        className={
          featured
            ? "mt-7 inline-flex h-11 w-full items-center justify-center rounded-sm bg-accent px-6 text-[14px] font-semibold text-[#ffffff] transition-colors hover:bg-[#60a5fa]"
            : "mt-7 inline-flex h-11 w-full items-center justify-center rounded-sm border border-line2 px-6 text-[14px] font-medium text-ink transition-colors hover:bg-surface2"
        }
      >
        {plan.cta}
      </Link>
    </div>
  );
}

function Check() {
  return (
    <svg viewBox="0 0 16 16" className="mt-[3px] h-3.5 w-3.5 shrink-0" aria-hidden>
      <path
        d="M3 8.5l3.2 3.2L13 5"
        fill="none"
        stroke="#3b82f6"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
