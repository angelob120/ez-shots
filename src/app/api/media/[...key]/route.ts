import { NextResponse } from "next/server";
import { getStorageProvider, safeKey } from "@/lib/storage";

export const runtime = "nodejs";

/**
 * GET /api/media/<key>
 *
 * Public and deliberately so — these are menu photos on a customer-facing
 * ordering page. Keys are random, so they aren't guessable, but nothing here
 * is a secret.
 *
 * Filenames are content-addressed at write time and never rewritten, so the
 * cache lifetime is immutable. Changing a photo mints a new key.
 */
export async function GET(_req: Request, { params }: { params: { key: string[] } }) {
  const key = safeKey(params.key.join("/"));
  if (!key) return new NextResponse("Not found", { status: 404 });

  // .type sidecars are an implementation detail of the local driver.
  if (key.endsWith(".type")) return new NextResponse("Not found", { status: 404 });

  const found = await getStorageProvider().get(key);
  if (!found) return new NextResponse("Not found", { status: 404 });

    // Buffer -> Uint8Array: BodyInit accepts the latter across runtimes.
  const body = new Uint8Array(found.body);

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": found.contentType,
      "Content-Length": String(body.length),
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
