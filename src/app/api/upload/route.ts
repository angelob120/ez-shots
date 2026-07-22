import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getStorageProvider, mediaUrl } from "@/lib/storage";
import {
  MAX_UPLOAD_BYTES,
  extForType,
  isMediaKind,
  sniffImageType,
  STORED_TYPES,
} from "@/lib/media";

export const runtime = "nodejs";
// Uploads mutate the volume; never let this be cached or statically analyzed.
export const dynamic = "force-dynamic";

function bad(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

/**
 * POST /api/upload
 * multipart/form-data: file, kind (ITEM|LOGO|HERO), width, height,
 *                      restaurantId (admin only, optional)
 *
 * Returns { url, key, id, width, height, bytes }.
 *
 * The client re-encodes through a canvas before sending, so what arrives is
 * already cropped, resized and compressed. The server does not trust that —
 * it re-checks size and magic bytes — but it does not need an image library.
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return bad(401, "You need to be signed in to upload.");

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return bad(400, "Malformed upload.");
  }

  const kind = form.get("kind");
  if (!isMediaKind(kind)) return bad(400, "Unknown image slot.");

  const file = form.get("file");
  if (!(file instanceof File)) return bad(400, "No file received.");
  if (file.size === 0) return bad(400, "That file is empty.");
  if (file.size > MAX_UPLOAD_BYTES) return bad(413, "That image is too large after compression.");

  // Tenant scoping: an owner can only ever write into their own restaurant.
  // An admin may name one, or omit it while creating a restaurant that does
  // not exist yet (the asset is backfilled on create).
  let restaurantId: string | null;
  if (session.role === "ADMIN") {
    const requested = String(form.get("restaurantId") || "") || null;
    if (requested) {
      const exists = await prisma.restaurant.findUnique({
        where: { id: requested },
        select: { id: true },
      });
      if (!exists) return bad(404, "That restaurant doesn't exist.");
    }
    restaurantId = requested;
  } else {
    if (!session.restaurantId) return bad(403, "No restaurant on this account.");
    restaurantId = session.restaurantId;
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const sniffed = sniffImageType(bytes);
  if (!sniffed || !(STORED_TYPES as readonly string[]).includes(sniffed)) {
    return bad(415, "That doesn't look like a supported image.");
  }

  const width = parseInt(String(form.get("width") ?? "0"), 10);
  const height = parseInt(String(form.get("height") ?? "0"), 10);
  if (!width || !height || width > 4000 || height > 4000) {
    return bad(400, "Missing or implausible image dimensions.");
  }

  const id = crypto.randomUUID().replace(/-/g, "");
  const key = `${restaurantId ?? "_unassigned"}/${kind}/${id}.${extForType(sniffed)}`;

  try {
    await getStorageProvider().put({ key, body: bytes, contentType: sniffed });
  } catch (e) {
    console.error("[upload] storage write failed", e);
    return bad(500, "Couldn't save that image. Try again.");
  }

  const asset = await prisma.mediaAsset.create({
    data: {
      restaurantId,
      key,
      url: mediaUrl(key),
      kind,
      mimeType: sniffed,
      bytes: bytes.length,
      width,
      height,
      createdById: session.userId ?? null,
    },
    select: { id: true, url: true, key: true, width: true, height: true, bytes: true },
  });

  return NextResponse.json(asset, { status: 201 });
}
