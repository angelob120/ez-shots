import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { tenantWhere, DOMAIN_HEADER } from "@/lib/domains";

export const dynamic = "force-dynamic";

/**
 * One installable app per tenant. The customer who adds this to their home
 * screen is the whole point of the ordering flow.
 */
export async function GET(_req: Request, { params }: { params: { slug: string } }) {
  const r = await prisma.restaurant.findFirst({ where: tenantWhere(params.slug) });
  if (!r) return new NextResponse("Not found", { status: 404 });

  // On a custom domain the store lives at the site root; on the platform host
  // it's namespaced under /r/<slug>.
  const base = headers().get(DOMAIN_HEADER) ? "" : `/r/${r.slug}`;

  return NextResponse.json({
    name: r.name,
    short_name: r.name.slice(0, 12),
    description: r.tagline ?? `Order pickup from ${r.name}.`,
    start_url: base || "/",
    scope: base || "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#FAF7F2",
    theme_color: r.accentColor,
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any maskable" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
    ],
  });
}
