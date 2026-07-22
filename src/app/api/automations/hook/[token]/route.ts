import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { enroll } from "@/lib/automations";
import { normalizePhone } from "@/lib/money";
import { normalizeEmail } from "@/lib/email";

/**
 * The inbound webhook trigger.
 *
 * A POST here enrolls one customer in one automation. Used to start a journey
 * from something that happened outside this product — a POS, a loyalty app, a
 * form on the restaurant's own site.
 *
 * ─── The token is the auth, and that is the whole security model ──────────
 *
 * 160 bits from the CSPRNG, minted when a WEBHOOK automation is activated, and
 * it resolves the automation *and* its tenant. Same contract `/o/[token]`
 * carries. Nothing in the body may name a restaurant, for the reason the
 * analytics beacon may not either: accepting a `restaurantId` from an
 * unauthenticated endpoint lets anybody write into anybody's account — and here
 * that means causing a text to be sent under another restaurant's name.
 *
 * ─── What this endpoint cannot do ─────────────────────────────────────────
 *
 * **It cannot create a customer, and it cannot grant consent.** It looks one
 * up by phone or email within the tenant and enrolls them if they exist. A
 * caller that could create customers is a caller that could add strangers to a
 * restaurant's list — and every row it created would land with `optInStatus:
 * UNKNOWN` anyway (only checkout writes consent, see
 * `lib/customer-import.ts`), so the journey couldn't text them regardless. An
 * endpoint that silently populates a list with people nobody may contact is
 * worse than one that says "I don't know who that is".
 */

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: { token: string } }) {
  const token = params.token;
  if (!token || token.length < 20) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const automation = await prisma.automation.findUnique({
    where: { hookToken: token },
    select: { id: true, restaurantId: true, status: true, triggerType: true },
  });

  // Same answer for a bad token and a paused journey at the 404 level, but a
  // distinct one below it: a caller integrating against this needs to know
  // whether they got the URL wrong or the owner switched the journey off, and
  // those are days of debugging apart.
  if (!automation || automation.triggerType !== "WEBHOOK") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (automation.status !== "ACTIVE") {
    return NextResponse.json({ error: "automation_not_active" }, { status: 409 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const phone = normalizePhone(String(body.phone ?? ""));
  const email = normalizeEmail(String(body.email ?? "") || null);
  if (!phone && !email) {
    return NextResponse.json({ error: "phone_or_email_required" }, { status: 400 });
  }

  // Phone first: it is the dedupe key for a `Customer` and the only identifier
  // that is unique per tenant. An email match is a convenience for callers that
  // don't hold a number, and it takes the oldest match rather than guessing
  // between duplicates.
  const customer = phone
    ? await prisma.customer.findUnique({
        where: { restaurantId_phone: { restaurantId: automation.restaurantId, phone } },
        select: { id: true },
      })
    : await prisma.customer.findFirst({
        where: { restaurantId: automation.restaurantId, email },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });

  if (!customer) {
    return NextResponse.json({ error: "customer_not_found" }, { status: 404 });
  }

  const result = await enroll(automation.id, customer.id, {
    trigger: "WEBHOOK",
    // Lets a caller make its own call idempotent under ONCE_PER_TRIGGER —
    // two deliveries of the same event enroll once.
    triggerKey: typeof body.key === "string" ? body.key : undefined,
  });

  return NextResponse.json(
    { result },
    { status: result === "enrolled" ? 202 : 200 },
  );
}
