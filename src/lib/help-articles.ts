/**
 * Owner help articles — **the one list of things we've already explained.**
 *
 * Pure: no database, no `server-only`. Articles are content, and content that
 * changes when a support agent notices a gap does not want a migration. The
 * search box is a client component and imports `searchArticles` directly, which
 * is the second reason there is no database here.
 *
 * ## Why this exists at all
 *
 * `docs/admin-roadmap.md` item 7 was written "articles first, tickets only if
 * articles don't absorb it", and was deliberately built the other way round —
 * tickets first. That was the right order: you cannot write a useful article
 * before you know what people actually ask, and the ticket `category`
 * distribution is what tells you. This is the other half, and the categories
 * below are the ticket categories rather than a fresh taxonomy, so an article
 * can be pointed at from the ticket form later without a remapping.
 *
 * ## The rules
 *
 * **An article is data, not JSX**, for the same reason a policy is
 * (`lib/legal.ts`): the same source has to render as a page and as plain text
 * an agent can paste into a reply. If an answer is worth writing once it is
 * worth being quotable.
 *
 * **Every article names the thing that would otherwise be a support ticket.**
 * `symptom` is what the owner would type into the search box in their own
 * words, not what we'd call it internally. The search index is built from
 * symptom and body together precisely because owners search for "customers
 * can't pay", never for "Stripe Connect onboarding incomplete".
 *
 * **An article that cannot resolve the problem says so and hands off.** Every
 * one ends in either a concrete fix or a route to a human. A help centre whose
 * failure mode is a dead end trains owners to skip it, and then we get the
 * ticket anyway, later and angrier.
 */

export type HelpCategory =
  | "ORDERS"
  | "PAYMENTS"
  | "MENU"
  | "MESSAGING"
  | "ACCOUNT"
  | "STOREFRONT";

export const HELP_CATEGORY_LABELS: Record<HelpCategory, string> = {
  ORDERS: "Orders & refunds",
  PAYMENTS: "Payments & payouts",
  MENU: "Menu & hours",
  MESSAGING: "Texts & email",
  ACCOUNT: "Account & access",
  STOREFRONT: "Your website",
};

export type HelpSection = {
  heading?: string;
  /** Paragraphs. Rendered in order, one `<p>` each. */
  body: string[];
  /** An optional ordered list of steps, rendered after the paragraphs. */
  steps?: string[];
};

export type HelpArticle = {
  slug: string;
  title: string;
  category: HelpCategory;
  /** The owner's words for the problem. Feeds search and the list subtitle. */
  symptom: string;
  /**
   * Extra search terms that don't appear in the prose — synonyms, the wrong
   * word people reach for, the thing another platform calls it. Never shown.
   */
  keywords?: string[];
  sections: HelpSection[];
  /** Where to go if the article didn't do it. Empty means "file a ticket". */
  nextStep?: string;
};

/* ── The articles ───────────────────────────────────────────────────────── */

export const HELP_ARTICLES: HelpArticle[] = [
  {
    slug: "orders-not-coming-through",
    title: "Orders aren't reaching the board",
    category: "ORDERS",
    symptom: "A customer says they ordered but nothing showed up on my screen.",
    keywords: ["missing order", "no orders", "screen blank", "not ringing", "didn't come through"],
    sections: [
      {
        body: [
          "Nearly every version of this is one of three things, and they're quick to tell apart. Work down the list in order — the first check rules out the most common cause in about ten seconds.",
        ],
      },
      {
        heading: "Check these in order",
        body: [],
        steps: [
          "Open the Orders page fresh rather than relying on a tab that's been open all service. A tab left open overnight can be showing you a stale board.",
          "Check whether the order is on the 'Everything' filter rather than the open one. An order that was accepted and completed leaves the default view.",
          "Ask the customer whether their card was actually charged. If it wasn't, they never finished checkout — the cart page looks a lot like a confirmation page if you're in a hurry, and this is the single most common answer.",
          "Check Settings → Payments. If card payments are switched off or your Stripe connection is incomplete, checkout fails at the last step and no order is created.",
        ],
      },
      {
        body: [
          "If the customer's card was charged and there's still no order on the board, stop and file a ticket with the order number or the charge amount and the time. That combination is what lets us read the exact timeline, and it's a case we want to see rather than have you work around.",
        ],
      },
    ],
  },
  {
    slug: "refund-a-customer",
    title: "Refunding a customer, in full or in part",
    category: "ORDERS",
    symptom: "I need to give money back for an order that went wrong.",
    keywords: ["refund", "money back", "partial refund", "overcharged", "wrong order", "chargeback"],
    sections: [
      {
        body: [
          "Refunds are issued from the order itself rather than from a separate screen, so the reason stays attached to the order and you can see later what happened and why.",
        ],
        steps: [
          "Open the order from the Orders page.",
          "Choose the refund control and pick full or partial. A partial refund is entered as an amount, not a percentage.",
          "Say what happened in the note. The customer sees a message when the refund goes through, and your wording is what they read.",
        ],
      },
      {
        heading: "The service fee",
        body: [
          "You choose whether the service fee comes back with the refund. Left off, you refund the food and the fee stays where it is; switched on, the whole ticket comes back including our cut. For a mistake on your end most owners refund the food only. For an order you never made at all, refunding everything is the fairer answer.",
        ],
      },
      {
        heading: "If a refund fails",
        body: [
          "A failed refund does not silently disappear. It stays outstanding and shows at the top of your dashboard until it settles, and it retries on its own. If one has been sitting there for more than a day, file a ticket and mark it urgent — money owed to a customer is the one category we treat differently from everything else.",
        ],
      },
    ],
  },
  {
    slug: "customer-didnt-pick-up",
    title: "The food was made and nobody collected it",
    category: "ORDERS",
    symptom: "An order has been sitting ready for an hour and the customer never came.",
    keywords: ["no show", "no-show", "abandoned", "left it", "never picked up", "waiting"],
    sections: [
      {
        body: [
          "Once an order has sat ready for about 45 minutes, a control appears on it to close it out as a no-show. It's yours to press rather than something that happens automatically, because whether to refund somebody who didn't turn up isn't a decision code should be making — a regular who got stuck in traffic and a first-timer who changed their mind are the same row in a database and very different people to you.",
        ],
      },
      {
        body: [
          "Closing it out as a no-show and keeping the charge is a completed sale: it stays in your numbers and stays counted against that customer. If you refund instead, it comes back out. Either is fine; pick deliberately.",
        ],
      },
    ],
  },
  {
    slug: "payouts-havent-arrived",
    title: "Money from orders hasn't landed in my bank",
    category: "PAYMENTS",
    symptom: "Customers are paying but I haven't seen a deposit.",
    keywords: ["payout", "deposit", "bank", "stripe", "not paid", "where's my money", "settlement"],
    sections: [
      {
        body: [
          "Card money goes from the customer to your own Stripe account and out to your bank on Stripe's schedule. It does not pass through us, which is deliberate — but it also means the answer to 'where is it' is usually in Stripe rather than here.",
        ],
        steps: [
          "Open Settings → Payments and check your connection reads as complete. An account that was connected but never finished verification accepts payments and holds the payouts.",
          "If Stripe is asking for a document — an ID, a bank statement, a business detail — payouts are paused until you give it to them. This is the most common cause by a wide margin and there's nothing we can do to lift it.",
          "Check the payout schedule on your Stripe account. A first payout is typically slower than the ones after it.",
        ],
      },
      {
        body: [
          "If Stripe shows the money as paid out and your bank doesn't have it, that's between Stripe and your bank and Stripe's support can trace it. If Stripe shows a balance that isn't moving and it isn't asking you for anything, file a ticket and we'll look at the connection from our side.",
        ],
      },
    ],
  },
  {
    slug: "service-fee-explained",
    title: "What the service fee is, and what to tell customers",
    category: "PAYMENTS",
    symptom: "A customer asked why there's an extra charge on their total.",
    keywords: ["service fee", "surcharge", "extra charge", "commission", "why am I being charged"],
    sections: [
      {
        body: [
          "You're on Zero Monthly, which means you pay us nothing each month and a small service fee rides on the customer's ticket instead. It's shown as its own line before they pay — never folded into the food price and never a surprise at the end.",
        ],
      },
      {
        heading: "What to say",
        body: [
          "The honest version works better than a hedge: it's a small fee for the ordering system, it's what keeps the restaurant off the delivery apps that take 30%, and ordering direct is still meaningfully cheaper for them than the alternative. Owners who explain it plainly get asked about it far less than owners who look uncomfortable.",
        ],
      },
      {
        body: [
          "Nothing is taken out of your side of the ticket. What the customer pays for the food, plus tax, is what lands in your account minus your own card processing.",
        ],
      },
    ],
  },
  {
    slug: "customers-cant-check-out",
    title: "Customers say they can't complete an order",
    category: "PAYMENTS",
    symptom: "People are getting stuck or seeing an error at the payment step.",
    keywords: ["can't pay", "checkout broken", "error", "card declined", "won't let me order"],
    sections: [
      {
        body: [
          "Two very different problems look identical from the customer's side, and the fix is different for each.",
        ],
      },
      {
        heading: "The kitchen is closed",
        body: [
          "If your hours say you're shut, or the pause switch is on, the storefront says so under the banner and the order button goes inert. That's working as intended — but a schedule with the wrong timezone or a pause somebody switched on days ago looks exactly like a broken site. Check Hours first.",
        ],
      },
      {
        heading: "Payment is failing",
        body: [
          "If ordering is open and the failure is at the card step, check Settings → Payments for an incomplete Stripe connection. If it reads as connected and one specific customer still can't pay, it's most likely their bank — have them try another card before you assume the site is at fault.",
        ],
      },
      {
        body: [
          "If several different customers fail on different cards within the same hour, don't wait — file a ticket and mark it urgent. That pattern is us, not them.",
        ],
      },
    ],
  },
  {
    slug: "hours-and-closing",
    title: "Setting hours, holidays, and closing early",
    category: "MENU",
    symptom: "I need to shut off ordering, or my hours are wrong on the site.",
    keywords: ["hours", "closed", "holiday", "pause", "stop orders", "last call", "timezone", "open"],
    sections: [
      {
        body: [
          "There are three separate controls on the Hours page and they answer three different questions. Using the wrong one is the usual reason hours behave oddly.",
        ],
        steps: [
          "The weekly schedule is your normal week. Everything on the storefront is judged against this, in your restaurant's own timezone — check the timezone is right before you debug anything else.",
          "A closure covers a specific date or range: a holiday, a family event, a week off. Use this rather than editing your weekly hours, or you'll have to remember to put them back.",
          "The pause switch stops orders right now for a set amount of time. It's the one to use when the kitchen is slammed or the fryer died mid-service, and it expires by itself so you can't forget it.",
        ],
      },
      {
        heading: "Last call",
        body: [
          "Last call cuts off new orders some number of minutes before you close, so nobody can order a full meal two minutes before the door shuts. The promised pickup time never runs past closing either — if there isn't time to cook it before you shut, the order isn't offered.",
        ],
      },
      {
        body: [
          "One thing worth knowing: if you have no schedule set at all, ordering stays open rather than closing. That's deliberate — the alternative would silently switch off every restaurant that never touched the setting — but it does mean 'my site takes orders at 3am' usually means no schedule rather than a wrong one.",
        ],
      },
    ],
  },
  {
    slug: "importing-your-menu",
    title: "Getting your menu in without typing it twice",
    category: "MENU",
    symptom: "I don't want to re-enter my whole menu by hand.",
    keywords: ["import menu", "doordash", "uber eats", "toast", "csv", "upload menu", "copy menu"],
    sections: [
      {
        body: [
          "Paste a link to your menu on DoorDash, Uber Eats or Toast and we'll read the items off it. You get a review table of what we found; nothing is saved until you press Import.",
        ],
      },
      {
        heading: "Check two things in the review table",
        body: [
          "The prices, and whether anything that's really an option got listed as a dish. Those are the two judgements a machine genuinely cannot make reliably — a price of 1200 is either twelve dollars or twelve hundred, and the page doesn't say which — which is why the review step exists rather than being a confirmation dialog. Prices are set for the whole menu at once, so if they're out they'll all be out the same way, which is easier to spot.",
        ],
      },
      {
        body: [
          "If the link doesn't work, paste the page contents instead. Those platforms block automated traffic routinely and it isn't a sign that anything is wrong on your end — the paste route is a proper alternative, not a consolation prize. A spreadsheet upload works too.",
        ],
      },
    ],
  },
  {
    slug: "texting-customers",
    title: "Why a text didn't reach someone",
    category: "MESSAGING",
    symptom: "I sent a campaign to 400 people and it says it reached 90.",
    keywords: ["sms", "text", "campaign", "not delivered", "skipped", "opt in", "consent", "stop"],
    sections: [
      {
        body: [
          "That gap is normal and it's shown rather than hidden. A customer can only be texted if they agreed to it at checkout — the consent is recorded with the exact wording they saw and when. Anyone who hasn't done that is skipped, and the results page gives a reason for each person.",
        ],
      },
      {
        heading: "The rules, briefly",
        body: [
          "Nobody who replied STOP gets a text again, including order notifications. That isn't us being cautious about marketing preferences: a sender that ignores STOP gets filtered by the carriers, and when that happens it takes down every message from your number, including the ones telling people their food is ready.",
          "A customer list you imported from a spreadsheet carries no consent, no matter where it came from. There's no setting that changes this. Consent has to be provable — who agreed, to what wording, when — and a spreadsheet supplies none of it. Those customers become textable when they order and opt in.",
        ],
      },
      {
        body: [
          "Email works differently: you may email your list unless somebody unsubscribes. An email unsubscribe deliberately doesn't stop their order texts, and a text opt-out doesn't stop their email.",
        ],
      },
    ],
  },
  {
    slug: "customer-list-and-tags",
    title: "Finding customers, tagging them, building an audience",
    category: "MESSAGING",
    symptom: "I want to text just my regulars, or just the people who've drifted away.",
    keywords: ["segment", "tag", "filter", "regulars", "lapsed", "win back", "audience", "search"],
    sections: [
      {
        body: [
          "Filter your customer list down to who you want, then save that filter as a segment so you don't have to rebuild it. A campaign is aimed at a segment.",
        ],
      },
      {
        body: [
          "Worth setting expectations before you send: the segment decides who's considered, and the consent rules decide who's actually contacted. A segment of 400 routinely reaches a fraction of that on text. It isn't the filter misbehaving.",
        ],
      },
      {
        heading: "If a search finds nobody",
        body: [
          "A filter that matches nothing looks identical to having no customers. Before concluding the list is empty, clear the filters and check the total. Phone searches work with or without formatting — dashes, brackets and a leading 1 all find the same person.",
        ],
      },
    ],
  },
  {
    slug: "team-access",
    title: "Getting someone else into the dashboard",
    category: "ACCOUNT",
    symptom: "My manager needs access, or I've lost my own login.",
    keywords: ["login", "password", "invite", "staff", "manager", "locked out", "access", "sign in"],
    sections: [
      {
        body: [
          "Access is granted by an invite link rather than by anyone typing a password on someone else's behalf. The link works once and then it's spent.",
        ],
      },
      {
        body: [
          "We can't retrieve an invite link after it's been created — we don't keep a usable copy of it, on purpose. If one is lost or expired, the fix is to generate a new one, which is quick.",
        ],
      },
      {
        heading: "Locked out entirely",
        body: [
          "If nobody at the restaurant can get in, file a ticket from the contact form on our website and name the restaurant. We'll verify who you are and send a fresh invite. Separate logins per person matter more than they look — a shared login means the order history can't tell you who did what when something is disputed.",
        ],
      },
    ],
    nextStep: "If you can't reach the dashboard at all, use the contact form on our website instead.",
  },
  {
    slug: "custom-domain",
    title: "Using your own web address",
    category: "STOREFRONT",
    symptom: "I want orders at my own domain instead of the default link.",
    keywords: ["domain", "dns", "url", "website address", "cname", "ssl", "certificate", "www"],
    sections: [
      {
        body: [
          "Add your domain in the dashboard and you'll get a DNS record to enter at whoever you bought the domain from. Once it verifies, every link we generate uses your address — status pages, receipts, QR codes, all of it. That's the point: you bought the domain so your customers see your name, and a receipt that advertises us instead would defeat it.",
        ],
      },
      {
        heading: "It says pending",
        body: [
          "DNS changes are slow and it's usually just that — give it an hour before assuming something's wrong. If it's still pending the next day, the record is most likely on the wrong hostname; check it's on exactly what the dashboard asked for, character for character.",
        ],
      },
      {
        body: [
          "If you're using a bare domain, the www version is set up alongside it automatically, so customers who type www don't hit a security warning.",
        ],
      },
    ],
  },
  {
    slug: "changing-how-the-site-looks",
    title: "Changing your storefront's look",
    category: "STOREFRONT",
    symptom: "I want to change the colours, logo, or overall style of my page.",
    keywords: ["branding", "logo", "colours", "colors", "theme", "design", "photo", "preview"],
    sections: [
      {
        body: [
          "Branding covers your logo, banner, accent colour and a choice of preset styles. The preview beside the editor is your actual storefront, not a mock-up — what you see is what a customer gets, which is why we don't let you rearrange the page structure. The parts holding the page together are the fastest thing to break.",
        ],
      },
      {
        body: [
          "Nothing is public until you save, and the preview doesn't count as a visit in your analytics. An afternoon spent redecorating won't wreck your conversion rate.",
        ],
      },
      {
        heading: "A note on the default style",
        body: [
          "The default follows the customer's own device, so someone browsing at night sees a dark version of your site. If you want it to look the same for everyone regardless, pick one of the fixed presets rather than the system one.",
        ],
      },
    ],
  },
];

/* ── Lookup and search ──────────────────────────────────────────────────── */

export function helpArticle(slug: string): HelpArticle | null {
  return HELP_ARTICLES.find((a) => a.slug === slug) ?? null;
}

export function helpPath(slug: string): string {
  return `/dashboard/support/help/${slug}`;
}

/** Everything an article should be findable by, lower-cased, joined once. */
function haystack(a: HelpArticle): string {
  const prose = a.sections.flatMap((s) => [s.heading ?? "", ...s.body, ...(s.steps ?? [])]);
  return [a.title, a.symptom, HELP_CATEGORY_LABELS[a.category], ...(a.keywords ?? []), ...prose]
    .join(" ")
    .toLowerCase();
}

/**
 * Substring-AND across every term.
 *
 * Deliberately simple, and deliberately AND rather than OR. With thirteen
 * articles, ranking is a solution to a problem nobody has; what people actually
 * do is type three words and expect the one article containing all three. An OR
 * search over a set this small returns most of the list for most queries, which
 * reads as the search being broken.
 *
 * Order is the registry order, so the list is stable and the categories stay
 * grouped as written rather than shuffling on every keystroke.
 */
export function searchArticles(query: string, articles = HELP_ARTICLES): HelpArticle[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return articles;
  return articles.filter((a) => {
    const hay = haystack(a);
    return terms.every((t) => hay.includes(t));
  });
}

/** The registry grouped for display, skipping categories with nothing in them. */
export function articlesByCategory(
  articles = HELP_ARTICLES
): Array<{ category: HelpCategory; label: string; articles: HelpArticle[] }> {
  return (Object.keys(HELP_CATEGORY_LABELS) as HelpCategory[])
    .map((category) => ({
      category,
      label: HELP_CATEGORY_LABELS[category],
      articles: articles.filter((a) => a.category === category),
    }))
    .filter((g) => g.articles.length > 0);
}

/**
 * An article as plain text.
 *
 * The reason articles are structured data rather than JSX: an agent answering a
 * ticket should be able to paste the canonical answer into the reply instead of
 * writing a worse version of it from memory.
 */
export function articleToText(a: HelpArticle): string {
  const out: string[] = [a.title, ""];
  for (const s of a.sections) {
    if (s.heading) out.push(s.heading, "");
    for (const p of s.body) out.push(p, "");
    if (s.steps) {
      s.steps.forEach((step, i) => out.push(`${i + 1}. ${step}`));
      out.push("");
    }
  }
  return out.join("\n").trim();
}
