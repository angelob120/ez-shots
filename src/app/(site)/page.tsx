import type { Metadata } from "next";
import Link from "next/link";
import { CheckoutReceipt, OwnerLedger, TextBubble } from "@/components/site/mocks";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "EZ Orders - your own ordering app, no monthly fee",
  description:
    "Take orders from your Google listing, keep every customer's number, and bring them back with automatic texts. Free for the restaurant.",
};

export default function HomePage() {
  return (
    <>
      <Hero />
      <TrustBar />
      <How />
      <Numbers />
      <Features />
      <Compare />
      <Faq />
      <FinalCta />
    </>
  );
}

/* ---------------------------------------------------------------- hero */

function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-line">
      <div
        className="pointer-events-none absolute inset-x-0 top-[-180px] h-[420px] opacity-[0.16]"
        style={{
          background:
            "radial-gradient(560px 260px at 50% 50%, #3b82f6 0%, rgba(61,220,132,0) 70%)",
        }}
        aria-hidden
      />
      <div className="relative mx-auto grid max-w-[1140px] gap-14 px-6 py-20 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:py-28">
        <div>
          <span className="inline-flex items-center gap-2 rounded-full border border-line2 bg-surface px-3 py-1 text-[12px] text-dim">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
            No monthly fee. No contract.
          </span>

          <h1 className="mt-5 text-[40px] font-semibold leading-[1.05] tracking-[-0.03em] text-ink sm:text-[54px]">
            Your own ordering app.
            <br />
            <span className="text-accent">$0 a month</span> to run it.
          </h1>

          <p className="mt-5 max-w-[520px] text-[16px] leading-relaxed text-dim">
            Customers order straight from your Google listing instead of a delivery app. You get
            their phone number, and EZ Orders texts them back when they stop coming in. We&apos;re
            paid by a small service fee on the customer&apos;s ticket - never out of your margin.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              href="/signup"
              className="inline-flex h-11 items-center rounded-sm bg-accent px-6 text-[14px] font-semibold text-[#ffffff] transition-colors hover:bg-[#60a5fa]"
            >
              Start free
            </Link>
            <Link
              href="#how"
              className="inline-flex h-11 items-center rounded-sm border border-line2 px-5 text-[14px] font-medium text-ink transition-colors hover:bg-surface2"
            >
              See how it works
            </Link>
          </div>

          <p className="mt-4 text-[12px] text-mute">
            Setup takes about five minutes. Nothing to install on your counter.
          </p>
        </div>

        <div className="relative flex justify-center lg:justify-end">
          <div className="relative">
            <CheckoutReceipt />
            <div className="mt-[-28px] ml-[-24px] hidden sm:block lg:ml-[-64px]">
              <OwnerLedger />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------ trust bar */

function TrustBar() {
  const items = [
    ["Built for", "coffee, fast-casual, lunch counters"],
    ["Ordering", "pickup, from your own page"],
    ["Marketing", "rewards + automatic texts"],
    ["You pay", "nothing, ever"],
  ];
  return (
    <section className="border-b border-line bg-surface/40">
      <div className="mx-auto grid max-w-[1140px] gap-6 px-6 py-8 sm:grid-cols-2 lg:grid-cols-4">
        {items.map(([label, value]) => (
          <div key={label}>
            <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-mute">
              {label}
            </div>
            <div className="mt-1 text-[13px] text-dim">{value}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ----------------------------------------------------------- how it works */

const STEPS = [
  {
    n: "01",
    title: "They tap Order on your Google listing",
    body: "Your EZ Orders page opens in one tap - your logo, your menu, your prices. No app download, no delivery marketplace putting your competitor next to you.",
  },
  {
    n: "02",
    title: "They pay and leave a phone number",
    body: "Checkout collects the number with a clear opt-in for texts. That list belongs to you. It's the part DoorDash never hands over.",
  },
  {
    n: "03",
    title: "We text them back before you lose them",
    body: "A nudge after the first order, a win-back when a regular goes quiet, a reminder when they're due. It runs on its own once your menu is up.",
  },
];

function How() {
  return (
    <section id="how" className="scroll-mt-16 border-b border-line">
      <div className="mx-auto max-w-[1140px] px-6 py-20">
        <Eyebrow>How it works</Eyebrow>
        <h2 className="mt-3 max-w-[620px] text-[30px] font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-[36px]">
          Three steps, and the third one runs without you.
        </h2>

        <div className="mt-12 grid gap-px overflow-hidden rounded-md border border-line bg-line md:grid-cols-3">
          {STEPS.map((s) => (
            <div key={s.n} className="bg-surface p-7">
              <div className="font-mono text-[12px] text-accent">{s.n}</div>
              <h3 className="mt-4 text-[16px] font-semibold leading-snug tracking-tight text-ink">
                {s.title}
              </h3>
              <p className="mt-2.5 text-[13px] leading-relaxed text-dim">{s.body}</p>
            </div>
          ))}
        </div>

        <div className="mt-10 grid gap-6 rounded-md border border-line bg-surface p-7 md:grid-cols-[auto_1fr] md:items-center">
          <div className="space-y-4">
            <TextBubble
              body="Hey Dana - your usual cortado is on us this week. 10% off any order through Sunday. Reply STOP to opt out."
              meta="Win-back · sent day 21"
            />
          </div>
          <p className="max-w-[420px] text-[14px] leading-relaxed text-dim md:justify-self-end">
            Three campaigns ship with your account: first reorder, lapsed customer, and a frequency
            nudge for regulars. You can edit the wording or leave them alone.
          </p>
        </div>
      </div>
    </section>
  );
}

/* --------------------------------------------------------------- numbers */

function Numbers() {
  return (
    <section id="numbers" className="scroll-mt-16 border-b border-line bg-surface/40">
      <div className="mx-auto max-w-[1140px] px-6 py-20">
        <Eyebrow>Why it pays</Eyebrow>
        <h2 className="mt-3 max-w-[640px] text-[30px] font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-[36px]">
          The math on a $14 coffee order.
        </h2>
        <p className="mt-4 max-w-[560px] text-[15px] leading-relaxed text-dim">
          Same ticket, three ways to sell it. The difference isn&apos;t small, and it compounds every
          time that customer comes back.
        </p>

        <div className="mt-10 grid gap-4 md:grid-cols-3">
          <MoneyCard
            label="Delivery marketplace"
            keep="$10.10"
            pct="~30% commission"
            note="They own the customer. You get an order, not a relationship."
            tone="bad"
          />
          <MoneyCard
            label="Ordering platform at $499/mo"
            keep="$13.60"
            pct="+ $499 every month"
            note="You need roughly 35 orders a month just to cover the software."
            tone="warn"
          />
          <MoneyCard
            label="EZ Orders"
            keep="$13.60"
            pct="$0 from you"
            note="The service fee sits on the customer's line. Your P&L doesn't move."
            tone="good"
          />
        </div>

        <p className="mt-6 text-[12px] leading-relaxed text-mute">
          Illustrative on a $14.31 ticket after card processing. Marketplace commissions vary by
          agreement.
        </p>
      </div>
    </section>
  );
}

function MoneyCard({
  label,
  keep,
  pct,
  note,
  tone,
}: {
  label: string;
  keep: string;
  pct: string;
  note: string;
  tone: "good" | "warn" | "bad";
}) {
  const ring =
    tone === "good" ? "border-accentDim" : tone === "warn" ? "border-line2" : "border-line2";
  const value = tone === "good" ? "text-accent" : tone === "bad" ? "text-bad" : "text-ink";
  return (
    <div className={`rounded-md border ${ring} bg-surface p-6`}>
      <div className="text-[12px] font-medium text-dim">{label}</div>
      <div className={`mt-3 font-mono text-[30px] font-semibold tabular-nums ${value}`}>{keep}</div>
      <div className="mt-1 text-[12px] text-mute">you keep · {pct}</div>
      <p className="mt-4 text-[13px] leading-relaxed text-dim">{note}</p>
    </div>
  );
}

/* -------------------------------------------------------------- features */

const FEATURES = [
  {
    title: "Ordering page",
    body: "Your logo, hero photo, and colors on a page built to load fast on a phone in line. Installs to the home screen if they want it there.",
  },
  {
    title: "Menu you control",
    body: "Add items, change prices, mark the soup sold out. Changes are live the second you save - no ticket to a support desk.",
  },
  {
    title: "Customer list",
    body: "Every order adds a name and number with a recorded opt-in. Export it whenever you want. It's yours, not ours.",
  },
  {
    title: "Rewards",
    body: "Points or punches that pull the second visit, then the fifth. Redemption happens inside the same ordering flow.",
  },
  {
    title: "Automatic texts",
    body: "First-reorder nudge, win-back, and frequency reminders. Opt-in, quiet hours, and STOP handling are built in.",
  },
  {
    title: "Orders dashboard",
    body: "New orders land on your screen with items, time, and total. No POS integration required to start taking orders today.",
  },
];

function Features() {
  return (
    <section className="border-b border-line">
      <div className="mx-auto max-w-[1140px] px-6 py-20">
        <Eyebrow>What you get</Eyebrow>
        <h2 className="mt-3 text-[30px] font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-[36px]">
          Everything on one account.
        </h2>

        <div className="mt-12 grid gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="bg-surface p-7">
              <h3 className="text-[15px] font-semibold tracking-tight text-ink">{f.title}</h3>
              <p className="mt-2 text-[13px] leading-relaxed text-dim">{f.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* --------------------------------------------------------------- compare */

const ROWS: Array<[string, string, string]> = [
  ["Monthly software fee", "$0", "$400–$700"],
  ["Commission on your orders", "None", "None"],
  ["Who owns the customer list", "You", "You"],
  ["Rewards program", "Included", "Included"],
  ["Automatic text campaigns", "Included", "Included"],
  ["How we get paid", "Customer service fee", "Your bank account, monthly"],
];

function Compare() {
  return (
    <section className="border-b border-line bg-surface/40">
      <div className="mx-auto max-w-[1140px] px-6 py-20">
        <Eyebrow>Side by side</Eyebrow>
        <h2 className="mt-3 text-[30px] font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-[36px]">
          Same toolkit. Different bill.
        </h2>

        <div className="mt-10 overflow-x-auto rounded-md border border-line bg-surface">
          <table className="w-full min-w-[560px] border-collapse text-[13px]">
            <thead>
              <tr>
                <th className="border-b border-line px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-mute">
                  &nbsp;
                </th>
                <th className="border-b border-line px-5 py-4 text-left text-[13px] font-semibold text-accent">
                  EZ Orders
                </th>
                <th className="border-b border-line px-5 py-4 text-left text-[13px] font-semibold text-dim">
                  Typical subscription platform
                </th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map(([label, ours, theirs]) => (
                <tr key={label}>
                  <td className="border-b border-line px-5 py-4 text-dim">{label}</td>
                  <td className="border-b border-line px-5 py-4 font-medium text-ink">{ours}</td>
                  <td className="border-b border-line px-5 py-4 text-dim">{theirs}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------- faq */

const FAQS: Array<[string, string]> = [
  [
    "So what does it actually cost me?",
    "Nothing. There's no subscription and we take no cut of your sales. A small service fee is added to the customer's ticket at checkout, disclosed before they pay, and that's what funds the platform. You still cover your own card processing, same as always.",
  ],
  [
    "Won't a fee scare customers off?",
    "It's sized to disappear: about $1–2 on a normal order, and it only scales up on unusually large ones. Fees on a phone checkout are familiar now, and it's shown as its own line rather than buried in the prices.",
  ],
  [
    "I already add my own surcharge. Does this stack?",
    "It can, and we'd rather talk about it upfront than surprise you. Our fee stays small and proportional. If you're already running a card surcharge, we'll walk through how the ticket reads before you launch.",
  ],
  [
    "Do I need a new POS or tablet?",
    "No. Orders show up in your dashboard on whatever you already have - laptop, phone, the tablet by the register. There's nothing to install and nothing to replace.",
  ],
  [
    "Is the text marketing legal?",
    "It's built to be. Customers opt in explicitly at checkout, every message identifies you and includes STOP, sends respect quiet hours, and the number your texts come from is properly registered with the carriers.",
  ],
  [
    "Can I leave and take my customer list?",
    "Yes. Export it any time, including on your way out. Owning that list is the entire point - holding it hostage would defeat it.",
  ],
];

function Faq() {
  return (
    <section id="faq" className="scroll-mt-16 border-b border-line">
      <div className="mx-auto max-w-[1140px] px-6 py-20">
        <Eyebrow>Questions</Eyebrow>
        <h2 className="mt-3 text-[30px] font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-[36px]">
          The ones owners ask first.
        </h2>

        <div className="mt-10 grid gap-x-10 gap-y-8 md:grid-cols-2">
          {FAQS.map(([q, a]) => (
            <div key={q}>
              <h3 className="text-[15px] font-semibold tracking-tight text-ink">{q}</h3>
              <p className="mt-2 text-[13px] leading-relaxed text-dim">{a}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------- final cta */

function FinalCta() {
  return (
    <section>
      <div className="mx-auto max-w-[1140px] px-6 py-24 text-center">
        <h2 className="mx-auto max-w-[620px] text-[32px] font-semibold leading-tight tracking-[-0.025em] text-ink sm:text-[42px]">
          Put your own ordering link on Google this week.
        </h2>
        <p className="mx-auto mt-4 max-w-[480px] text-[15px] leading-relaxed text-dim">
          Create the account, add your menu, paste the link into your Google profile. That&apos;s the
          whole setup.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link
            href="/signup"
            className="inline-flex h-11 items-center rounded-sm bg-accent px-6 text-[14px] font-semibold text-[#ffffff] transition-colors hover:bg-[#60a5fa]"
          >
            Create your account
          </Link>
          <Link
            href="/login"
            className="inline-flex h-11 items-center rounded-sm border border-line2 px-5 text-[14px] font-medium text-ink transition-colors hover:bg-surface2"
          >
            Log in
          </Link>
        </div>
      </div>
    </section>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="h-px w-6 bg-accentDim" />
      <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent">
        {children}
      </span>
    </div>
  );
}
