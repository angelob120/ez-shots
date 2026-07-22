import "server-only";
import { prisma } from "@/lib/prisma";
import { getStorageProvider, mediaUrl } from "@/lib/storage";
import { sniffImageType, extForType, type MediaKind } from "@/lib/media";

/**
 * Pull an image from an external URL and re-host it inside our own media
 * system, so a CSV import ends up with self-hosted, consistent assets instead
 * of hotlinks that can rot or block us.
 *
 * We can't run the browser canvas pipeline here, and the server has no image
 * library, so we do the minimum safe thing: fetch with a hard cap and timeout,
 * confirm the bytes really are an image via magic numbers, read the intrinsic
 * dimensions from the header, and write them through the same storage seam the
 * uploader uses. Anything odd returns null and the caller just leaves the item
 * photo-less.
 */

const FETCH_TIMEOUT_MS = 8000;
const MAX_REMOTE_BYTES = 8 * 1024 * 1024; // 8 MB ceiling on a remote fetch

/** Read intrinsic width/height from JPEG, PNG, WebP or GIF header bytes. */
export function imageDimensions(buf: Buffer, mime: string): { width: number; height: number } | null {
  try {
    if (mime === "image/png") {
      // IHDR is the first chunk; width/height are big-endian at offset 16/20.
      if (buf.length < 24) return null;
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
    if (mime === "image/gif") {
      if (buf.length < 10) return null;
      return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
    }
    if (mime === "image/jpeg") {
      // Walk the marker segments until a Start-Of-Frame carries the size.
      let i = 2;
      while (i < buf.length) {
        if (buf[i] !== 0xff) {
          i++;
          continue;
        }
        const marker = buf[i + 1];
        // SOF0..SOF15 except DHT/DAC/RSTn hold the frame dimensions.
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
        }
        const len = buf.readUInt16BE(i + 2);
        i += 2 + len;
      }
      return null;
    }
    if (mime === "image/webp") {
      // RIFF container; the VP8 variant determines where the size lives.
      if (buf.length < 30) return null;
      const fourcc = buf.toString("ascii", 12, 16);
      if (fourcc === "VP8 ") {
        return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
      }
      if (fourcc === "VP8L") {
        const b = buf.readUInt32LE(21);
        return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
      }
      if (fourcc === "VP8X") {
        const w = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16));
        const h = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16));
        return { width: w, height: h };
      }
      return null;
    }
  } catch {
    return null;
  }
  return null;
}

export type RehostResult = { url: string; width: number; height: number } | null;

/**
 * Fetch `sourceUrl`, validate it's an image, and store it as `kind` media for
 * `restaurantId`. Returns the internal URL or null on any failure.
 */
export async function rehostImageFromUrl(
  sourceUrl: string,
  restaurantId: string,
  kind: MediaKind,
  createdById?: string | null
): Promise<RehostResult> {
  if (!/^https?:\/\//i.test(sourceUrl)) return null;

  let bytes: Buffer;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(sourceUrl, {
      signal: controller.signal,
      redirect: "follow",
      headers: { accept: "image/*" },
    }).finally(() => clearTimeout(timer));

    if (!res.ok || !res.body) return null;

    const declared = res.headers.get("content-length");
    if (declared && parseInt(declared, 10) > MAX_REMOTE_BYTES) return null;

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > MAX_REMOTE_BYTES) return null;
    bytes = buf;
  } catch {
    return null;
  }

  const mime = sniffImageType(bytes);
  if (!mime) return null;

  const dims = imageDimensions(bytes, mime) ?? { width: 0, height: 0 };

  const id = crypto.randomUUID().replace(/-/g, "");
  const key = `${restaurantId}/${kind}/${id}.${extForType(mime)}`;

  try {
    await getStorageProvider().put({ key, body: bytes, contentType: mime });
  } catch {
    return null;
  }

  try {
    const asset = await prisma.mediaAsset.create({
      data: {
        restaurantId,
        key,
        url: mediaUrl(key),
        kind,
        mimeType: mime,
        bytes: bytes.length,
        width: dims.width,
        height: dims.height,
        createdById: createdById ?? null,
      },
      select: { url: true, width: true, height: true },
    });
    return asset;
  } catch {
    // Storage succeeded but the row failed — best-effort clean up the blob.
    await getStorageProvider().delete(key).catch(() => {});
    return null;
  }
}
