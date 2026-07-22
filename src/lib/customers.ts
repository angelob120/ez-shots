import "server-only";

/**
 * Querying, filtering, segmenting and tagging customer lists.
 *
 * One module, for the reason `lib/domain-ops.ts` gives: the owner's page and
 * the admin's cross-tenant page ask the same question, and two implementations
 * of "find this customer" drift until one of them can't find somebody the
 * other can — which surfaces as a support call where we insist a customer
 * doesn't exist while looking at a page that just failed to match their
 * phone number.
 *
 * **Tenant scoping is a parameter, and it is never optional.** `searchCustomers`
 * takes an explicit `restaurantId | null`, where null means "every tenant" and
 * is only reachable from an admin route that has already called
 * `requireAdmin()`. Owner routes pass the id from `requireOwner()`. There is no
 * default, so a new caller has to state which one it is rather than inherit
 * whichever is less safe.
 *
 * ─── The rule that governs everything added here ──────────────────────────
 *
 * **A tag, a segment and a filter are not consent.** It is the obvious next
 * thought — tag a group, then text the group — and it is the exact mistake
 * `lib/customer-import.ts` exists to prevent. Nothing in this file is ever an
 * input to a send decision; `lib/sms.ts` reads `optInStatus`, `optOutAt` and
 * nothing else. A "VIP" tag is the owner's opinion about a customer. Consent
 * is a record of what a specific person agreed to, in wording we can
 * reproduce, at a timestamp. Do not let the first become a source for the
 * second, however convenient the audience-builder makes it look.
 *
 * ─── Structure ────────────────────────────────────────────────────────────
 *
 * The `where` builders and the param parser are **pure and exported
 * separately** from the functions that touch Prisma, because they're where the
 * bugs live — a filter that silently matches nothing looks identical to a
 * tenant that genuinely has nobody. `scripts/customer-import.test.ts` covers
 * them without a database.
 */

import { prisma } from "@/lib/prisma";
import { normalizePhone } from "@/lib/money";
import type { Prisma } from "@prisma/client";

export type CustomerSort = "recent" | "orders" | "value" | "name" | "joined";

export type OptInFilter = "OPTED_IN" | "OPTED_OUT" | "UNKNOWN";

/**
 * Lifecycle buckets, defined on `orderCount` rather than on dates.
 *
 * "None" here means **no orders at all** — a contact record, typically
 * imported. It deliberately doesn't mean "joined recently", because the
 * question an owner is actually asking of this filter is "who have I never
 * converted", and a customer who signed up in January and has still never
 * ordered is the answer to it.
 */
export type CustomerStage = "none" | "once" | "repeat";

export type CustomerFilters = {
  /** Null means across all tenants — admin only. */
  restaurantId: string | null;
  q?: string;
  consent?: OptInFilter;
  cohort?: "TREATMENT" | "HOLDOUT";
  /**
   * Tag slugs. Multiple tags narrow (AND), they don't widen (OR). Narrowing is
   * what somebody adding a second filter expects; a list that gets *longer*
   * as you add criteria reads as broken.
   */
  tags?: string[];
  stage?: CustomerStage;
  minOrders?: number;
  minSpendCts?: number;
  /** Ordered within the last N days. */
  withinDays?: number;
  /** Has ordered, but nothing in N days — the win-back audience. */
  lapsedDays?: number;
  /** Where the row came from. `imported` means an import created it. */
  source?: "imported" | "organic";
  hasEmail?: boolean;
  /** Narrow to one upload — what the import history links to. */
  importJobId?: string;
};

export type CustomerQuery = CustomerFilters & {
  sort?: CustomerSort;
  take?: number;
  skip?: number;
};

export const DEFAULT_PAGE_SIZE = 50;

/** How long a tag name may be. Long enough to be a phrase, short enough to be a chip. */
export const MAX_TAG_NAME = 32;
/** Per tenant. A tag list nobody can scan is a filter nobody uses. */
export const MAX_TAGS_PER_TENANT = 100;
export const MAX_SEGMENTS_PER_TENANT = 40;
export const MAX_NOTE_LENGTH = 2000;

/**
 * The fixed tag palette.
 *
 * Named tones rather than hex values, resolved to `--h-*` tokens in the UI.
 * A free-text colour is how a tag ends up as dark grey on near-black in dark
 * mode — the exact failure `scripts/theme.test.ts` was written to catch, and
 * one it cannot catch if the colour lives in the database.
 *
 * The five names map onto tokens that already exist in both palettes. Adding a
 * sixth means adding a token to *both* the light and dark blocks in
 * `globals.css`; a token defined in one renders as an empty `var()` in the
 * other, which is transparent, which is a tag that vanishes on one theme.
 */
export const TAG_COLORS = ["neutral", "accent", "good", "warn", "bad"] as const;
export type TagColor = (typeof TAG_COLORS)[number];

export function isTagColor(v: string): v is TagColor {
  return (TAG_COLORS as readonly string[]).includes(v);
}

/**
 * The dedupe key for a tag name.
 *
 * "VIP", "vip" and "V.I.P." are one tag. An owner who ends up with three
 * spellings has a filter that returns a third of the people it should and no
 * indication that it did — which is worse than an error, because the number it
 * shows is plausible.
 */
export function tagSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    // Strip the combining marks NFKD just separated out, so "café" slugs to
    // "cafe" rather than "caf-".
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_TAG_NAME);
}

export function normalizeTagName(name: string): string {
  return name.trim().replace(/\s+/g, " ").slice(0, MAX_TAG_NAME);
}

/**
 * Build the `where` for the free-text search half.
 *
 * The phone handling is the part worth reading. An operator types what's in
 * front of them — `555-010-1234`, `(555) 010 1234`, or the last four digits
 * off a caller ID — but the column stores `+15550101234`. Matching the raw
 * string against it finds nothing, which is indistinguishable from the
 * customer not existing.
 *
 * So a query that looks like a phone number is tried three ways: normalised to
 * E.164 for an exact hit, digits-only as a suffix for the "I only have the
 * last four" case, and the raw text against name/email in case somebody is
 * called "0800". Cheap, and it removes the single most common way this kind of
 * search appears broken.
 */
export function customerSearchWhere(
  restaurantId: string | null,
  q: string | undefined
): Prisma.CustomerWhereInput {
  const base: Prisma.CustomerWhereInput = restaurantId ? { restaurantId } : {};
  const term = (q ?? "").trim();
  if (!term) return base;

  const or: Prisma.CustomerWhereInput[] = [
    { name: { contains: term, mode: "insensitive" } },
    { email: { contains: term, mode: "insensitive" } },
  ];

  const digits = term.replace(/\D/g, "");
  if (digits.length >= 3) {
    // `endsWith` rather than `contains`: a 4-digit fragment is almost always
    // the tail of a number, and anchoring it keeps "1234" from matching every
    // customer whose number happens to contain those digits anywhere.
    or.push({ phone: { endsWith: digits } });

    const e164 = normalizePhone(term);
    if (e164) or.push({ phone: e164 });
  }

  return { ...base, OR: or };
}

/**
 * The full `where` — search plus every filter.
 *
 * Everything that isn't the search goes into an `AND` array rather than being
 * spread onto one object. Two filters both constraining `lastOrderAt` —
 * "ordered in the last 7 days" and "nothing in 30" — would otherwise clobber
 * each other silently, and the survivor would be whichever the spread wrote
 * last. Contradictory filters should return nothing, visibly, rather than
 * quietly return the answer to a different question.
 *
 * Pure. Every clause is asserted in `scripts/customer-import.test.ts`.
 */
export function customerWhere(
  f: CustomerFilters,
  now: Date = new Date()
): Prisma.CustomerWhereInput {
  const and: Prisma.CustomerWhereInput[] = [];

  if (f.consent) and.push({ optInStatus: f.consent });
  if (f.cohort) and.push({ cohort: f.cohort });

  // One clause per tag. A single `some` with an `in` would mean "has any of
  // these", and adding a filter has to narrow. See the note on `tags` above.
  for (const slug of f.tags ?? []) {
    and.push({ tags: { some: { tag: { slug } } } });
  }

  if (f.stage === "none") and.push({ orderCount: 0 });
  if (f.stage === "once") and.push({ orderCount: 1 });
  if (f.stage === "repeat") and.push({ orderCount: { gt: 1 } });

  if (f.minOrders && f.minOrders > 0) and.push({ orderCount: { gte: f.minOrders } });
  if (f.minSpendCts && f.minSpendCts > 0) and.push({ lifetimeCts: { gte: f.minSpendCts } });

  if (f.withinDays && f.withinDays > 0) {
    and.push({ lastOrderAt: { gte: daysBefore(now, f.withinDays) } });
  }
  if (f.lapsedDays && f.lapsedDays > 0) {
    // `lt` against a NULL column is false in SQL, so a customer who has never
    // ordered is excluded here — which is right. They aren't lapsed, they're
    // `stage: "none"`, and lumping the two together makes a win-back list
    // mostly people who have no relationship to win back.
    and.push({ lastOrderAt: { lt: daysBefore(now, f.lapsedDays) } });
  }

  if (f.source === "imported") and.push({ importJobId: { not: null } });
  if (f.source === "organic") and.push({ importJobId: null });
  if (f.importJobId) and.push({ importJobId: f.importJobId });

  if (f.hasEmail === true) and.push({ email: { not: null } });
  if (f.hasEmail === false) and.push({ email: null });

  const base = customerSearchWhere(f.restaurantId, f.q);
  return and.length ? { ...base, AND: and } : base;
}

function daysBefore(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 864e5);
}

const ORDER_BY: Record<CustomerSort, Prisma.CustomerOrderByWithRelationInput[]> = {
  // Nulls sort last on `desc` in Postgres, which is what we want — a customer
  // who has never ordered belongs at the bottom of "most recent", not the top.
  recent: [{ lastOrderAt: "desc" }, { createdAt: "desc" }],
  orders: [{ orderCount: "desc" }, { lastOrderAt: "desc" }],
  value: [{ lifetimeCts: "desc" }, { lastOrderAt: "desc" }],
  name: [{ name: "asc" }, { phone: "asc" }],
  joined: [{ createdAt: "desc" }],
};

export type CustomerTagBadge = { id: string; name: string; slug: string; color: string };

export type CustomerRow = {
  id: string;
  restaurantId: string;
  phone: string;
  name: string | null;
  email: string | null;
  optInStatus: "UNKNOWN" | "OPTED_IN" | "OPTED_OUT";
  cohort: "TREATMENT" | "HOLDOUT";
  orderCount: number;
  lifetimeCts: number;
  firstOrderAt: Date | null;
  lastOrderAt: Date | null;
  importJobId: string | null;
  createdAt: Date;
  tags: CustomerTagBadge[];
  /** Only populated on cross-tenant (admin) searches. */
  restaurant?: { name: string; slug: string };
};

export type CustomerSearchResult = {
  rows: CustomerRow[];
  total: number;
  /** True when there are more rows past this page. */
  hasMore: boolean;
};

export async function searchCustomers(query: CustomerQuery): Promise<CustomerSearchResult> {
  const sort = query.sort ?? "recent";
  const take = Math.min(query.take ?? DEFAULT_PAGE_SIZE, 200);
  const skip = Math.max(query.skip ?? 0, 0);

  const where = customerWhere(query);

  // The count is a second query rather than a `_count` on the page, because
  // "showing 50 of 1,240" is the thing that tells an operator their search
  // didn't match everything — without it a truncated list looks complete.
  const [rows, total] = await Promise.all([
    prisma.customer.findMany({
      where,
      orderBy: ORDER_BY[sort],
      take: take + 1, // one extra to detect a next page without a second count
      skip,
      include: {
        tags: { include: { tag: { select: { id: true, name: true, slug: true, color: true } } } },
        ...(query.restaurantId ? {} : { restaurant: { select: { name: true, slug: true } } }),
      },
    }),
    prisma.customer.count({ where }),
  ]);

  const hasMore = rows.length > take;
  const page = hasMore ? rows.slice(0, take) : rows;

  return {
    rows: page.map((c: any) => ({
      ...c,
      tags: (c.tags ?? []).map((l: any) => l.tag),
    })) as CustomerRow[],
    total,
    hasMore,
  };
}

/** The headline counts above the owner's list. Scoped, always. */
export async function customerStats(restaurantId: string) {
  const [total, optedIn, optedOut, repeat, lapsed] = await Promise.all([
    prisma.customer.count({ where: { restaurantId } }),
    prisma.customer.count({ where: { restaurantId, optInStatus: "OPTED_IN" } }),
    prisma.customer.count({ where: { restaurantId, optInStatus: "OPTED_OUT" } }),
    prisma.customer.count({ where: { restaurantId, orderCount: { gt: 1 } } }),
    prisma.customer.count({
      where: { restaurantId, lastOrderAt: { lt: new Date(Date.now() - 30 * 864e5) } },
    }),
  ]);

  // Against the whole list, not the current page — a repeat rate that changes
  // when you type in the search box is a number nobody can act on.
  const repeatRate = total ? Math.round((repeat / total) * 100) : 0;

  return { total, optedIn, optedOut, repeat, lapsed, repeatRate };
}

// ---------------------------------------------------------------------------
// Param parsing
// ---------------------------------------------------------------------------

/**
 * Parse the search params every customer surface accepts, in one place.
 *
 * It is deliberately **total** — an unrecognised or malformed value falls back
 * to "no filter" rather than throwing. Two things depend on that: the URL is
 * user-editable and gets pasted into support tickets, and a saved segment
 * stores a query string that may predate a filter being renamed. A segment
 * saved last year should quietly ignore a filter that no longer exists, not
 * 500 on the page that lists it.
 */
export function readCustomerParams(sp: Record<string, string | string[] | undefined>) {
  const one = (k: string) => {
    const v = sp[k];
    return typeof v === "string" ? v : Array.isArray(v) ? v[0] : undefined;
  };

  const num = (k: string) => {
    const raw = Number(one(k));
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : undefined;
  };

  const sortRaw = one("sort");
  const sort: CustomerSort =
    sortRaw === "orders" || sortRaw === "value" || sortRaw === "name" || sortRaw === "joined"
      ? sortRaw
      : "recent";

  const consentRaw = one("consent");
  const consent: OptInFilter | undefined =
    consentRaw === "OPTED_IN" || consentRaw === "OPTED_OUT" || consentRaw === "UNKNOWN"
      ? consentRaw
      : undefined;

  const cohortRaw = one("cohort");
  const cohort: CustomerFilters["cohort"] =
    cohortRaw === "TREATMENT" || cohortRaw === "HOLDOUT" ? cohortRaw : undefined;

  const stageRaw = one("stage");
  const stage: CustomerStage | undefined =
    stageRaw === "none" || stageRaw === "once" || stageRaw === "repeat" ? stageRaw : undefined;

  const sourceRaw = one("source");
  const source: CustomerFilters["source"] =
    sourceRaw === "imported" || sourceRaw === "organic" ? sourceRaw : undefined;

  const emailRaw = one("email");
  const hasEmail = emailRaw === "yes" ? true : emailRaw === "no" ? false : undefined;

  // Repeated `tag=` params rather than a comma-joined list: a tag slug can't
  // contain a comma today, but a splitter that assumes so is one change to
  // `tagSlug` away from being wrong, and URLSearchParams already handles
  // repetition. Capped at five — past that the filter bar is unreadable and
  // the query is five joins deep.
  const rawTags = sp["tag"];
  const tags = (Array.isArray(rawTags) ? rawTags : rawTags ? [rawTags] : [])
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 5);

  // Money arrives as dollars because that's what the box says, and is stored
  // as cents because everything in this codebase is. `Math.round`, not
  // `Math.floor`: 12.99 must not become 1298.
  const spendRaw = Number(one("minSpend"));
  const minSpendCts =
    Number.isFinite(spendRaw) && spendRaw > 0 ? Math.round(spendRaw * 100) : undefined;

  const pageRaw = Number(one("page") ?? "1");
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 1;

  return {
    q: one("q")?.slice(0, 100) ?? "",
    sort,
    consent,
    cohort,
    stage,
    source,
    hasEmail,
    tags,
    minOrders: num("minOrders"),
    minSpendCts,
    withinDays: num("withinDays"),
    lapsedDays: num("lapsedDays"),
    importJobId: one("job"),
    page,
  };
}

export type CustomerParams = ReturnType<typeof readCustomerParams>;

/** True when anything is narrowing the list. Drives "clear filters" and the empty-state copy. */
export function isFiltering(p: CustomerParams): boolean {
  return Boolean(
    p.q.trim() ||
      p.consent ||
      p.cohort ||
      p.stage ||
      p.source ||
      p.hasEmail !== undefined ||
      p.tags.length ||
      p.minOrders ||
      p.minSpendCts ||
      p.withinDays ||
      p.lapsedDays ||
      p.importJobId
  );
}

/**
 * Render the active filters back to a query string — how a segment is saved.
 *
 * Built from the *parsed* params rather than by copying the incoming URL, so
 * whatever gets stored is already normalised and already validated. Copying
 * the raw URL would let a junk param round-trip into the database and back out
 * into every page load of that segment, forever.
 */
export function filtersToQuery(p: CustomerParams): string {
  const sp = new URLSearchParams();
  if (p.q.trim()) sp.set("q", p.q.trim());
  if (p.consent) sp.set("consent", p.consent);
  if (p.cohort) sp.set("cohort", p.cohort);
  if (p.stage) sp.set("stage", p.stage);
  if (p.source) sp.set("source", p.source);
  if (p.hasEmail !== undefined) sp.set("email", p.hasEmail ? "yes" : "no");
  for (const t of p.tags) sp.append("tag", t);
  if (p.minOrders) sp.set("minOrders", String(p.minOrders));
  if (p.minSpendCts) sp.set("minSpend", (p.minSpendCts / 100).toFixed(2));
  if (p.withinDays) sp.set("withinDays", String(p.withinDays));
  if (p.lapsedDays) sp.set("lapsedDays", String(p.lapsedDays));
  if (p.importJobId) sp.set("job", p.importJobId);
  if (p.sort !== "recent") sp.set("sort", p.sort);
  return sp.toString();
}

/** Turn parsed params into the filter object the query layer takes. */
export function paramsToFilters(restaurantId: string | null, p: CustomerParams): CustomerFilters {
  return {
    restaurantId,
    q: p.q,
    consent: p.consent,
    cohort: p.cohort,
    stage: p.stage,
    source: p.source,
    hasEmail: p.hasEmail,
    tags: p.tags,
    minOrders: p.minOrders,
    minSpendCts: p.minSpendCts,
    withinDays: p.withinDays,
    lapsedDays: p.lapsedDays,
    importJobId: p.importJobId,
  };
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

/**
 * Every tag on a tenant, with how many customers carry it.
 *
 * The count is the whole point of showing the list: a tag on two people out of
 * 3,000 is usually a typo of one that's on 400, and seeing both side by side is
 * the only way an owner notices.
 */
export async function listTags(restaurantId: string) {
  const tags = await prisma.customerTag.findMany({
    where: { restaurantId },
    orderBy: [{ system: "asc" }, { name: "asc" }],
    include: { _count: { select: { links: true } } },
  });
  return tags.map((t: any) => ({
    id: t.id as string,
    name: t.name as string,
    slug: t.slug as string,
    color: t.color as TagColor,
    system: t.system as boolean,
    count: t._count.links as number,
  }));
}

export type TagSummary = Awaited<ReturnType<typeof listTags>>[number];

/**
 * Create a tag, or return the existing one with the same slug.
 *
 * Find-or-create rather than create-then-fail: two people tagging "VIP" from
 * two browser tabs is ordinary, and the second one getting an error about a
 * uniqueness constraint on a column they've never heard of is not something
 * anybody can act on.
 */
export async function ensureTag(
  restaurantId: string,
  name: string,
  color: TagColor = "neutral",
  system = false
): Promise<
  { ok: true; tag: { id: string; name: string; slug: string } } | { ok: false; error: string }
> {
  const clean = normalizeTagName(name);
  if (!clean) return { ok: false, error: "Give the tag a name." };

  const slug = tagSlug(clean);
  if (!slug) {
    // A name of pure punctuation slugs to an empty string, and an empty slug
    // collides with every other one. Reject rather than invent a key.
    return { ok: false, error: "That name needs at least one letter or number." };
  }

  const existing = await prisma.customerTag.findUnique({
    where: { restaurantId_slug: { restaurantId, slug } },
  });
  if (existing) return { ok: true, tag: existing };

  const count = await prisma.customerTag.count({ where: { restaurantId } });
  if (count >= MAX_TAGS_PER_TENANT) {
    return {
      ok: false,
      error: `That's the ${MAX_TAGS_PER_TENANT}-tag limit. Delete one you no longer filter on first.`,
    };
  }

  try {
    const tag = await prisma.customerTag.create({
      data: { restaurantId, name: clean, slug, color, system },
    });
    return { ok: true, tag };
  } catch {
    // Lost the race against the read above. The other writer created exactly
    // what this call wanted, so this is a success, not a failure.
    const now = await prisma.customerTag.findUnique({
      where: { restaurantId_slug: { restaurantId, slug } },
    });
    return now ? { ok: true, tag: now } : { ok: false, error: "Could not create that tag." };
  }
}

export async function renameTag(restaurantId: string, tagId: string, name: string) {
  const clean = normalizeTagName(name);
  const slug = tagSlug(clean);
  if (!slug) return { ok: false as const, error: "That name needs at least one letter or number." };

  // Scoped `updateMany`, not `update({ where: { id } })`. The id comes off a
  // form and a form is not an authorisation. With the tenant in the WHERE, a
  // forged id changes nothing rather than renaming another restaurant's tag.
  //
  // System tags are excluded: their name is a factual record of which upload
  // produced those rows, and renaming it makes the import history lie.
  const res = await prisma.customerTag.updateMany({
    where: { id: tagId, restaurantId, system: false },
    data: { name: clean, slug },
  });
  return res.count
    ? { ok: true as const }
    : { ok: false as const, error: "That tag can't be renamed." };
}

export async function setTagColor(restaurantId: string, tagId: string, color: TagColor) {
  await prisma.customerTag.updateMany({ where: { id: tagId, restaurantId }, data: { color } });
}

/**
 * Delete a tag. The links go with it via cascade; the customers do not.
 *
 * Worth stating because it's the thing an owner fears when they hover the
 * button: deleting "Catering" removes a label, not the 40 people wearing it.
 */
export async function deleteTag(restaurantId: string, tagId: string) {
  await prisma.customerTag.deleteMany({ where: { id: tagId, restaurantId } });
}

/**
 * Add or remove a tag across a set of customers.
 *
 * The customer ids are re-scoped to the tenant here rather than trusted from
 * the form. Everything else in this codebase does the same and for the same
 * reason: `restaurantId` comes from `requireOwner()`, ids come from the client,
 * and the two are never allowed to be the same kind of thing.
 *
 * Adds use `createMany({ skipDuplicates })` so re-tagging an already-tagged
 * customer is a no-op instead of an error — a bulk selection routinely includes
 * rows that already carry the tag, and that is not a mistake worth interrupting
 * somebody over.
 */
export async function tagCustomers(
  restaurantId: string,
  tagId: string,
  customerIds: string[],
  mode: "add" | "remove"
): Promise<number> {
  if (customerIds.length === 0) return 0;

  const tag = await prisma.customerTag.findFirst({ where: { id: tagId, restaurantId } });
  if (!tag) return 0;

  const owned = await prisma.customer.findMany({
    where: { id: { in: customerIds }, restaurantId },
    select: { id: true },
  });
  if (owned.length === 0) return 0;
  const ids = owned.map((c: { id: string }) => c.id);

  if (mode === "remove") {
    const res = await prisma.customerTagLink.deleteMany({
      where: { tagId, customerId: { in: ids } },
    });
    await fireTagTrigger(restaurantId, "TAG_REMOVED", tag.slug, ids);
    return res.count;
  }

  const res = await prisma.customerTagLink.createMany({
    data: ids.map((customerId: string) => ({ tagId, customerId })),
    skipDuplicates: true,
  });
  await fireTagTrigger(restaurantId, "TAG_ADDED", tag.slug, ids);
  return res.count;
}

/**
 * Lets tag-triggered journeys know.
 *
 * Fired for every id in the batch, not only the ones whose link actually
 * changed — `createMany({ skipDuplicates })` doesn't say which those were.
 * Harmless because `enroll` refuses a customer already in the journey and the
 * partial unique index refuses the rest, which is the same guard relied on
 * everywhere else. Getting the exact set would mean a read per customer, and
 * this runs behind "tag all 1,240 matches".
 *
 * Bounded, and that bound is a real decision: tagging a thousand people is a
 * thousand potential enrollments, and doing them inline would turn a tag button
 * into a request that times out. Past the cap the tagging still happens and the
 * journeys don't, which is the right way round.
 */
const MAX_TAG_TRIGGER_FANOUT = 200;

async function fireTagTrigger(
  restaurantId: string,
  trigger: "TAG_ADDED" | "TAG_REMOVED",
  tagSlug: string,
  customerIds: string[]
) {
  // Imported lazily. `lib/automations.ts` pulls in the send doors, and a
  // top-level import here would drag them into every page that lists customers.
  const { fireTrigger } = await import("@/lib/automations");
  for (const id of customerIds.slice(0, MAX_TAG_TRIGGER_FANOUT)) {
    await fireTrigger(restaurantId, trigger, id, { tagSlug, triggerKey: `${tagSlug}:${id}` });
  }
}

/**
 * Apply a tag to everything matching the current filter, not just the page.
 *
 * Separate from `tagCustomers` on purpose. "Tag all 1,240 matches" and "tag
 * these 50 checkboxes" feel like the same action and are not: the first
 * operates on rows the person never saw. So the id list never travels through
 * the browser — the *filter* does, and it is re-evaluated server-side against
 * the tenant scope, which also means the operation can't be widened by editing
 * a hidden field.
 */
export async function tagMatching(
  restaurantId: string,
  tagId: string,
  filters: CustomerFilters,
  mode: "add" | "remove",
  limit = 5000
): Promise<number> {
  const tag = await prisma.customerTag.findFirst({ where: { id: tagId, restaurantId } });
  if (!tag) return 0;

  const matches = await prisma.customer.findMany({
    where: customerWhere({ ...filters, restaurantId }),
    select: { id: true },
    take: limit,
  });

  return tagCustomers(
    restaurantId,
    tagId,
    matches.map((c: { id: string }) => c.id),
    mode
  );
}

// ---------------------------------------------------------------------------
// Saved segments
// ---------------------------------------------------------------------------

export async function listSegments(restaurantId: string) {
  return prisma.customerSegment.findMany({ where: { restaurantId }, orderBy: { name: "asc" } });
}

export async function saveSegment(restaurantId: string, name: string, query: string) {
  const clean = name.trim().replace(/\s+/g, " ").slice(0, 60);
  if (!clean) return { ok: false as const, error: "Give the segment a name." };
  if (!query) {
    // A segment with no filters is every customer, which the list already
    // shows. Saving it produces a button that visibly does nothing.
    return { ok: false as const, error: "Set at least one filter before saving a segment." };
  }

  const existing = await prisma.customerSegment.findUnique({
    where: { restaurantId_name: { restaurantId, name: clean } },
  });

  if (!existing) {
    const count = await prisma.customerSegment.count({ where: { restaurantId } });
    if (count >= MAX_SEGMENTS_PER_TENANT) {
      return { ok: false as const, error: `That's the ${MAX_SEGMENTS_PER_TENANT}-segment limit.` };
    }
  }

  // Upsert on name: saving over an existing segment is what somebody adjusting
  // a filter and hitting save again means, and a duplicate-name error there is
  // a dead end with no obvious way out.
  await prisma.customerSegment.upsert({
    where: { restaurantId_name: { restaurantId, name: clean } },
    update: { query },
    create: { restaurantId, name: clean, query },
  });
  return { ok: true as const };
}

export async function deleteSegment(restaurantId: string, id: string) {
  await prisma.customerSegment.deleteMany({ where: { id, restaurantId } });
}

// ---------------------------------------------------------------------------
// A single customer
// ---------------------------------------------------------------------------

/**
 * Everything the detail page shows, in one call.
 *
 * `restaurantId` is a parameter for the same reason it is on the search: the
 * admin's read-only view passes null, the owner's passes their own id, and a
 * null default would mean a forgotten argument silently returns another
 * tenant's customer.
 *
 * **Admin notes are not selected here.** They live in `CustomerAdminNote` and
 * the admin page fetches them separately. Folding them into this shared
 * function is exactly the drift the two-table split exists to prevent — one
 * `include` here and the owner's page is rendering our internal notes.
 */
export async function customerDetail(restaurantId: string | null, id: string) {
  const customer = await prisma.customer.findFirst({
    where: { id, ...(restaurantId ? { restaurantId } : {}) },
    include: {
      tags: { include: { tag: true } },
      restaurant: { select: { id: true, name: true, slug: true, timezone: true } },
      importJob: { select: { id: true, filename: true, createdAt: true } },
      notes: { orderBy: { createdAt: "desc" }, take: 50 },
    },
  });
  if (!customer) return null;

  const [orders, messages] = await Promise.all([
    prisma.order.findMany({
      where: { customerId: id },
      orderBy: { createdAt: "desc" },
      take: 25,
      select: {
        id: true,
        number: true,
        status: true,
        totalCts: true,
        refundedCts: true,
        createdAt: true,
        publicToken: true,
      },
    }),
    // The message log is the consent trail in practice — a SKIPPED row with a
    // reason is the record of the gate declining to send, and it's the first
    // thing anybody wants when a customer says they never heard from us.
    prisma.message.findMany({
      where: { customerId: id },
      orderBy: { createdAt: "desc" },
      take: 25,
      select: { id: true, kind: true, status: true, createdAt: true, error: true },
    }),
  ]);

  return {
    ...customer,
    tags: (customer as any).tags.map((l: any) => l.tag),
    orders,
    messages,
  };
}

export async function addCustomerNote(
  restaurantId: string,
  customerId: string,
  body: string,
  author: { id?: string; name?: string }
) {
  const clean = body.trim().slice(0, MAX_NOTE_LENGTH);
  if (!clean) return { ok: false as const, error: "Write something first." };

  // Scoped by tenant, not by id alone — same rule as everywhere else here.
  const owned = await prisma.customer.findFirst({
    where: { id: customerId, restaurantId },
    select: { id: true },
  });
  if (!owned) return { ok: false as const, error: "That customer isn't on your list." };

  await prisma.customerNote.create({
    data: {
      restaurantId,
      customerId,
      body: clean,
      authorUserId: author.id ?? null,
      authorName: author.name ?? null,
    },
  });
  return { ok: true as const };
}

export async function deleteCustomerNote(restaurantId: string, noteId: string) {
  await prisma.customerNote.deleteMany({ where: { id: noteId, restaurantId } });
}

// ---------------------------------------------------------------------------
// Admin-only notes — ours, never the tenant's
// ---------------------------------------------------------------------------

/**
 * Our internal note on a customer. **Only ever called from a route behind
 * `requireAdmin()`**, and nothing under `src/app/dashboard/` may read this
 * table — the same rule `SupportNote` carries, for the same reason.
 *
 * Note what an admin still cannot do here: change consent, tags, or any field
 * the tenant owns. `/admin/customers` stays read-only on the customer record
 * itself. An admin quietly editing an opt-in status would destroy the audit
 * trail `lib/sms.ts` depends on and the tenant would have no way to know it
 * happened. A note is additive and attributed; an edit is neither.
 */
export async function addAdminNote(
  customerId: string,
  body: string,
  author: { id?: string; name?: string }
) {
  const clean = body.trim().slice(0, MAX_NOTE_LENGTH);
  if (!clean) return { ok: false as const, error: "Write something first." };
  await prisma.customerAdminNote.create({
    data: {
      customerId,
      body: clean,
      authorUserId: author.id ?? null,
      authorName: author.name ?? null,
    },
  });
  return { ok: true as const };
}

export async function listAdminNotes(customerId: string) {
  return prisma.customerAdminNote.findMany({
    where: { customerId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}

export async function deleteAdminNote(id: string) {
  await prisma.customerAdminNote.deleteMany({ where: { id } });
}
