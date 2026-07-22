import { NextRequest, NextResponse } from "next/server";
import { platformOrigin } from "@/lib/domains";
import { CUSTOMER_COOKIE } from "@/lib/customer-session";
import { safeNextPath } from "@/lib/oauth";

export const dynamic = "force-dynamic";

/**
 * Sign a customer out of a storefront.
 *
 * POST only. A GET sign-out is triggerable by any image tag on any page, which
 * is a nuisance rather than a breach — but it is a nuisance that presents as
 * "this site keeps logging me out" and is very hard to diagnose from a support
 * ticket.
 *
 * Only the customer cookie is cleared. Operator sign-out is a separate action
 * on a separate cookie, and an owner testing their own storefront should not
 * be signed out of their dashboard by using it.
 */
export async function POST(req: NextRequest) {
  const origin = platformOrigin();
  const form = await req.formData().catch(() => null);
  const next = safeNextPath(form ? String(form.get("next") ?? "") : "", "/");

  const res = NextResponse.redirect(`${origin}${next}`, { status: 303 });
  res.cookies.delete(CUSTOMER_COOKIE);
  return res;
}
