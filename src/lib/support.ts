import "server-only";
import { notify } from "@/lib/notifications";

/**
 * Support tickets, contact enquiries, and the only module that writes either.
 *
 * Same shape as `lib/orders.ts` and `lib/entitlements.ts`, for the same reason:
 * the properties below are only properties because there is one place to
 * enforce them.
 *
 *   - **Status moves through a state machine.** `canTransition` decides; no
 *     route sets `status` directly. The timestamps that hang off a status
 *     (`resolvedAt`, `archivedAt`, `firstReadAt`) are written by the same call
 *     that moves it, so a resolved ticket with no resolution time can't exist.
 *
 *   - **Tenant scope is supplied by the caller's auth, never by the caller.**
 *     Every owner-facing function takes a `restaurantId` that came from
 *     `requireOwner()` and filters on it in the same query that fetches the
 *     row. There is no "load then check" path, because the version of that
 *     with the check missing looks identical.
 *
 *   - **Internal notes are a different table, not a flag.** See the comment on
 *     `SupportMessage` in the schema. Nothing in this module returns a note
 *     from a function an owner route can reach; `ownerTicketThread` physically
 *     cannot select one.
 *
 * The contact form is the one unauthenticated writer in here. It gets its own
 * validation, its own throttle, and its own table, and nothing it submits is
 * ever trusted to name a tenant.
 */

import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import type {
  SupportCategory,
  SupportPriority,
  SupportStatus,
} from "@prisma/client";

// ── The pure half ────────────────────────────────────────────────────────
//
// Labels, limits, validators and the status machine live in
// `lib/support-labels.ts` because the ticket form is a client component and
// this module is `server-only`. They're re-exported here so server code can
// keep importing everything from the one door — see that file for the full
// reasoning.

export {
  CATEGORY_LABELS,
  PRIORITY_LABELS,
  STATUS_LABELS,
  CATEGORIES,
  PRIORITIES,
  LIVE_STATUSES,
  MAX_SUBJECT,
  MAX_BODY,
  MAX_NAME,
  isEmailish,
  canTransition,
  stampsFor,
} from "@/lib/support-labels";

import {
  CATEGORIES,
  LIVE_STATUSES,
  MAX_BODY,
  MAX_NAME,
  MAX_SUBJECT,
  PRIORITIES,
  STATUS_LABELS,
  canTransition,
  isEmailish,
  stampsFor,
} from "@/lib/support-labels";

function clean(v: FormDataEntryValue | null, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

export type SupportResult = { error?: string; ok?: string; id?: string };

// ── Owner side ────────────────────────────────────────────────────────────

/**
 * File a ticket. `restaurantId` comes from `requireOwner()`; there is no
 * overload that takes one from a form.
 */
export async function createTicket(input: {
  restaurantId: string;
  userId?: string | null;
  contactName: string;
  contactEmail: string;
  subject: string;
  body: string;
  category: SupportCategory;
  priority: SupportPriority;
}): Promise<SupportResult> {
  const subject = input.subject.trim().slice(0, MAX_SUBJECT);
  const body = input.body.trim().slice(0, MAX_BODY);

  if (subject.length < 3) return { error: "Give the problem a short title." };
  if (body.length < 10) {
    return { error: "Tell us what happened — a sentence or two is plenty." };
  }
  if (!isEmailish(input.contactEmail)) {
    return { error: "We need a working email address to reply to." };
  }

  // One ticket per tenant per 30s. Not a security boundary — the owner is
  // authenticated — just a guard against a double-submitted form becoming two
  // identical tickets somebody has to read twice.
  const gate = checkRateLimit(`ticket:${input.restaurantId}`, 3, 30_000);
  if (!gate.allowed) {
    return { error: "You just filed one. Give it a moment before filing another." };
  }

  const ticket = await prisma.supportTicket.create({
    data: {
      restaurantId: input.restaurantId,
      userId: input.userId ?? null,
      contactName: input.contactName.trim().slice(0, MAX_NAME) || "Owner",
      contactEmail: input.contactEmail.trim().toLowerCase(),
      subject,
      category: input.category,
      priority: input.priority,
      status: "OPEN",
      lastActivityAt: new Date(),
      // The description is the first message rather than a column on the
      // ticket. One conversation in one table beats a body field that the
      // thread view has to remember to prepend.
      messages: {
        create: {
          fromAdmin: false,
          authorName: input.contactName.trim().slice(0, MAX_NAME) || "Owner",
          body,
        },
      },
    },
    select: { id: true, number: true },
  });

  // Best-effort alert to the admins. notify() swallows its own failures, so a
  // filed ticket is never lost because the alert couldn't be raised.
  await notify({
    kind: "SUPPORT_TICKET",
    audience: { to: "ADMINS" },
    title: `Support ticket #${ticket.number}`,
    body: subject,
    link: `/admin/support?tab=tickets`,
    restaurantId: input.restaurantId,
    dedupeKey: `ticket:${ticket.id}`,
  });

  return { ok: `Ticket #${ticket.number} filed. We'll reply by email and here.`, id: ticket.id };
}

export async function createTicketFromForm(
  ctx: { restaurantId: string; userId?: string | null; name: string; email: string },
  form: FormData
): Promise<SupportResult> {
  const category = clean(form.get("category"), 20) as SupportCategory;
  const priority = clean(form.get("priority"), 20) as SupportPriority;

  return createTicket({
    restaurantId: ctx.restaurantId,
    userId: ctx.userId,
    contactName: clean(form.get("contactName"), MAX_NAME) || ctx.name,
    contactEmail: clean(form.get("contactEmail"), MAX_NAME) || ctx.email,
    subject: clean(form.get("subject"), MAX_SUBJECT),
    body: clean(form.get("body"), MAX_BODY),
    category: CATEGORIES.includes(category) ? category : "OTHER",
    priority: PRIORITIES.includes(priority) ? priority : "NORMAL",
  });
}

/** A tenant's own tickets. The `restaurantId` filter is not optional. */
export async function ownerTickets(restaurantId: string, includeClosed = false) {
  return prisma.supportTicket.findMany({
    where: {
      restaurantId,
      ...(includeClosed ? {} : { status: { in: LIVE_STATUSES } }),
    },
    orderBy: { lastActivityAt: "desc" },
    take: 100,
    select: {
      id: true,
      number: true,
      subject: true,
      status: true,
      priority: true,
      category: true,
      createdAt: true,
      lastActivityAt: true,
      _count: { select: { messages: true } },
    },
  });
}

/**
 * One ticket and its conversation, scoped to the tenant in the same query.
 *
 * Note what this cannot return: `SupportNote`. Not because the select omits it
 * — because the owner-facing shape has no field for it and adding one would be
 * an obvious change in review rather than a quiet `include`.
 */
export async function ownerTicketThread(restaurantId: string, ticketId: string) {
  return prisma.supportTicket.findFirst({
    where: { id: ticketId, restaurantId },
    select: {
      id: true,
      number: true,
      subject: true,
      status: true,
      priority: true,
      category: true,
      createdAt: true,
      resolvedAt: true,
      lastActivityAt: true,
      messages: {
        orderBy: { createdAt: "asc" },
        select: { id: true, fromAdmin: true, authorName: true, body: true, createdAt: true },
      },
    },
  });
}

/**
 * An owner replies. Their reply reopens a WAITING ticket — they answered the
 * question, so the ball is ours again — and a RESOLVED one, because a reply to
 * something we called finished is the owner telling us it wasn't.
 */
export async function ownerReply(
  restaurantId: string,
  ticketId: string,
  authorName: string,
  body: string
): Promise<SupportResult> {
  const text = body.trim().slice(0, MAX_BODY);
  if (text.length < 2) return { error: "Write a reply first." };

  const ticket = await prisma.supportTicket.findFirst({
    where: { id: ticketId, restaurantId },
    select: { id: true, status: true },
  });
  if (!ticket) return { error: "That ticket doesn't exist." };
  if (ticket.status === "ARCHIVED") {
    return { error: "This ticket is archived. Open a new one and we'll pick it up." };
  }

  const now = new Date();
  await prisma.$transaction([
    prisma.supportMessage.create({
      data: { ticketId: ticket.id, fromAdmin: false, authorName: authorName.slice(0, MAX_NAME), body: text },
    }),
    prisma.supportTicket.update({
      where: { id: ticket.id },
      data: { status: "OPEN", lastActivityAt: now, ...stampsFor("OPEN", now) },
    }),
  ]);

  return { ok: "Reply sent." };
}

// ── Admin side ────────────────────────────────────────────────────────────

/**
 * Marks the ticket read on first open and returns everything, notes included.
 * Only reachable behind `requireAdmin()`.
 *
 * `firstReadAt` is set with a conditional `updateMany` rather than read-then-
 * write, so opening the same ticket in two tabs doesn't reset the clock the
 * second time. The gap between it and `createdAt` is first-response time.
 */
export async function adminTicket(ticketId: string) {
  await prisma.supportTicket.updateMany({
    where: { id: ticketId, firstReadAt: null },
    data: { firstReadAt: new Date() },
  });

  return prisma.supportTicket.findUnique({
    where: { id: ticketId },
    include: {
      restaurant: { select: { id: true, name: true, slug: true, status: true } },
      messages: { orderBy: { createdAt: "asc" } },
      notes: { orderBy: { createdAt: "desc" } },
    },
  });
}

export async function adminTickets(status: SupportStatus | "LIVE" = "LIVE") {
  return prisma.supportTicket.findMany({
    where: status === "LIVE" ? { status: { in: LIVE_STATUSES } } : { status },
    orderBy: [{ priority: "desc" }, { lastActivityAt: "desc" }],
    take: 200,
    include: {
      restaurant: { select: { id: true, name: true } },
      _count: { select: { messages: true, notes: true } },
    },
  });
}

/**
 * We reply. This moves the ticket to WAITING, because an answered ticket that
 * stays OPEN makes the open count report a backlog that isn't there — and a
 * count nobody believes is a count nobody reads.
 */
export async function adminReply(
  ticketId: string,
  authorName: string,
  body: string
): Promise<SupportResult> {
  const text = body.trim().slice(0, MAX_BODY);
  if (text.length < 2) return { error: "Write a reply first." };

  const ticket = await prisma.supportTicket.findUnique({
    where: { id: ticketId },
    select: { id: true, status: true },
  });
  if (!ticket) return { error: "No such ticket." };
  if (!canTransition(ticket.status, "WAITING") && ticket.status !== "WAITING") {
    return { error: `A ${STATUS_LABELS[ticket.status].toLowerCase()} ticket can't be replied to.` };
  }

  const now = new Date();
  await prisma.$transaction([
    prisma.supportMessage.create({
      data: { ticketId, fromAdmin: true, authorName: authorName.slice(0, MAX_NAME), body: text },
    }),
    prisma.supportTicket.update({
      where: { id: ticketId },
      data: { status: "WAITING", lastActivityAt: now, ...stampsFor("WAITING", now) },
    }),
  ]);

  return { ok: "Reply sent to the owner." };
}

/**
 * Move a ticket's status.
 *
 * The current status goes in the WHERE of an `updateMany` — the same
 * optimistic lock every writer in `lib/orders.ts` takes. A zero-row result
 * means somebody else moved it while this page was open, and the honest answer
 * is to say so rather than to overwrite their decision with a stale one.
 */
export async function setTicketStatus(
  ticketId: string,
  to: SupportStatus
): Promise<SupportResult> {
  const ticket = await prisma.supportTicket.findUnique({
    where: { id: ticketId },
    select: { status: true },
  });
  if (!ticket) return { error: "No such ticket." };
  if (ticket.status === to) return { ok: `Already ${STATUS_LABELS[to].toLowerCase()}.` };
  if (!canTransition(ticket.status, to)) {
    return {
      error: `Can't go from ${STATUS_LABELS[ticket.status].toLowerCase()} to ${STATUS_LABELS[to].toLowerCase()}.`,
    };
  }

  const now = new Date();
  const res = await prisma.supportTicket.updateMany({
    where: { id: ticketId, status: ticket.status },
    data: { status: to, lastActivityAt: now, ...stampsFor(to, now) },
  });
  if (res.count === 0) return { error: "Someone else just changed this ticket. Reload." };

  return { ok: `Marked ${STATUS_LABELS[to].toLowerCase()}.` };
}

/**
 * An internal note. Append-only: there is no edit and no delete, because the
 * value of the note is what we thought at the time, and a note that can be
 * rewritten after the fact is worth nothing in the dispute it exists for.
 */
export async function addNote(
  target: { ticketId: string } | { contactId: string },
  author: { id?: string | null; email?: string | null },
  body: string
): Promise<SupportResult> {
  const text = body.trim().slice(0, MAX_BODY);
  if (text.length < 2) return { error: "Write something first." };

  await prisma.supportNote.create({
    data: {
      ...("ticketId" in target ? { ticketId: target.ticketId } : { contactId: target.contactId }),
      body: text,
      authorId: author.id ?? null,
      authorEmail: author.email ?? null,
    },
  });

  // A note is not activity the owner sees, so it doesn't bump lastActivityAt —
  // that column orders the queue by "when did somebody last say something",
  // and our own scribbling shouldn't push a ticket around in it.
  return { ok: "Note saved." };
}

// ── Contact form ──────────────────────────────────────────────────────────

/**
 * The public endpoint. Unauthenticated, so everything here assumes bad input.
 *
 * The throttle is keyed on a caller-supplied key (IP or forwarded-for) and is
 * the in-memory limiter from `lib/rate-limit.ts` — single-process, resets on
 * deploy. That's honest about what it is: a brake on a stuck retry loop and
 * casual flooding, not anti-abuse. If this repo ever runs more than one web
 * instance, this is one of the two places that needs a shared store.
 */
export async function submitContact(
  form: FormData,
  ctx: { throttleKey: string; sourcePath?: string | null }
): Promise<SupportResult> {
  const name = clean(form.get("name"), MAX_NAME);
  const email = clean(form.get("email"), MAX_NAME).toLowerCase();
  const phone = clean(form.get("phone"), 40);
  const business = clean(form.get("business"), MAX_NAME);
  const message = clean(form.get("message"), MAX_BODY);

  // A hidden field a person never sees and never fills. Bots fill everything,
  // so a non-empty value is a bot — and it gets a success message rather than
  // an error, because telling a scraper which check it failed is how it learns
  // to pass. Nothing is written.
  if (clean(form.get("company_website"), 200)) {
    return { ok: "Thanks — we'll be in touch." };
  }

  if (name.length < 2) return { error: "What should we call you?" };
  if (!isEmailish(email)) return { error: "That email address doesn't look right." };
  if (message.trim().length < 10) return { error: "Tell us a little more about what you need." };

  const gate = checkRateLimit(`contact:${ctx.throttleKey}`, 3, 10 * 60_000);
  if (!gate.allowed) {
    return { error: "You've sent a few already. Give us a chance to read them." };
  }

  // Advisory only. A matching address means the sender *might* be an existing
  // owner, which saves us a lookup when we read it — it is never treated as
  // proof, because this address was never verified.
  const existing = await prisma.user.findUnique({
    where: { email },
    select: { restaurantId: true },
  });

  const submission = await prisma.contactSubmission.create({
    data: {
      name,
      email,
      phone: phone || null,
      business: business || null,
      message,
      sourcePath: ctx.sourcePath ?? null,
      matchedRestaurantId: existing?.restaurantId ?? null,
    },
    select: { id: true },
  });

  await notify({
    kind: "CONTACT_FORM",
    audience: { to: "ADMINS" },
    title: `Contact enquiry from ${name}`,
    body: message.slice(0, 140),
    link: `/admin/support?tab=contact`,
    dedupeKey: `contact:${submission.id}`,
  });

  return { ok: "Thanks — we'll be in touch." };
}

export async function adminContacts(status: SupportStatus | "LIVE" = "LIVE") {
  return prisma.contactSubmission.findMany({
    where: status === "LIVE" ? { status: { in: LIVE_STATUSES } } : { status },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { notes: { orderBy: { createdAt: "desc" } } },
  });
}

export async function markContactRead(id: string) {
  await prisma.contactSubmission.updateMany({
    where: { id, readAt: null },
    data: { readAt: new Date() },
  });
}

/** Same lock and same machine as tickets — see `setTicketStatus`. */
export async function setContactStatus(
  id: string,
  to: SupportStatus
): Promise<SupportResult> {
  const row = await prisma.contactSubmission.findUnique({
    where: { id },
    select: { status: true },
  });
  if (!row) return { error: "No such enquiry." };
  if (row.status === to) return { ok: `Already ${STATUS_LABELS[to].toLowerCase()}.` };
  if (!canTransition(row.status, to)) {
    return {
      error: `Can't go from ${STATUS_LABELS[row.status].toLowerCase()} to ${STATUS_LABELS[to].toLowerCase()}.`,
    };
  }

  const now = new Date();
  const res = await prisma.contactSubmission.updateMany({
    where: { id, status: row.status },
    data: { status: to, readAt: row.status === "OPEN" ? now : undefined, ...stampsFor(to, now) },
  });
  if (res.count === 0) return { error: "Someone else just changed this. Reload." };

  return { ok: `Marked ${STATUS_LABELS[to].toLowerCase()}.` };
}

// ── Counts for the admin home ─────────────────────────────────────────────

export type SupportInbox = {
  openTickets: number;
  unreadTickets: number;
  urgentTickets: number;
  waitingTickets: number;
  openContacts: number;
  unreadContacts: number;
  /** Oldest unanswered ticket, in hours. Null when there isn't one. */
  oldestUnansweredHours: number | null;
};

/**
 * What the home page needs, in one round trip.
 *
 * `oldestUnansweredHours` is the number that matters and the reason this
 * function exists at all: a count of open tickets looks the same whether they
 * arrived this morning or three weeks ago, and only one of those is a problem.
 */
export async function supportInbox(): Promise<SupportInbox> {
  const [openTickets, unreadTickets, urgentTickets, waitingTickets, openContacts, unreadContacts, oldest] =
    await Promise.all([
      prisma.supportTicket.count({ where: { status: "OPEN" } }),
      prisma.supportTicket.count({ where: { status: { in: LIVE_STATUSES }, firstReadAt: null } }),
      prisma.supportTicket.count({
        where: { status: { in: LIVE_STATUSES }, priority: { in: ["HIGH", "URGENT"] } },
      }),
      prisma.supportTicket.count({ where: { status: "WAITING" } }),
      prisma.contactSubmission.count({ where: { status: { in: LIVE_STATUSES } } }),
      prisma.contactSubmission.count({ where: { status: { in: LIVE_STATUSES }, readAt: null } }),
      prisma.supportTicket.findFirst({
        where: { status: "OPEN" },
        orderBy: { createdAt: "asc" },
        select: { createdAt: true },
      }),
    ]);

  return {
    openTickets,
    unreadTickets,
    urgentTickets,
    waitingTickets,
    openContacts,
    unreadContacts,
    oldestUnansweredHours: oldest
      ? Math.floor((Date.now() - oldest.createdAt.getTime()) / 3_600_000)
      : null,
  };
}
