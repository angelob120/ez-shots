/**
 * Shared media rules. Imported by both the client uploader and the API route
 * so the limits can't drift apart.
 */

export const MEDIA_KINDS = ["ITEM", "LOGO", "HERO"] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

/** Aspect ratio (w/h) and the longest edge we store, per slot. */
export const KIND_SPEC: Record<MediaKind, { aspect: number; maxW: number; maxH: number; label: string }> = {
  // Square tiles on the menu grid and in the item sheet.
  ITEM: { aspect: 1, maxW: 1200, maxH: 1200, label: "Square" },
  // Logo keeps its own shape — we letterbox rather than crop a wordmark.
  LOGO: { aspect: 1, maxW: 512, maxH: 512, label: "Square" },
  // Wide banner behind the store name.
  HERO: { aspect: 16 / 9, maxW: 1920, maxH: 1080, label: "Wide" },
};

/** What the file picker accepts, and what the server will store. */
export const ACCEPTED_INPUT_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
export const STORED_TYPES = ["image/jpeg", "image/webp"] as const;

/** Pre-compression ceiling on the raw file the user picks. */
export const MAX_INPUT_BYTES = 20 * 1024 * 1024; // 20 MB
/** Post-compression ceiling on what actually reaches the server. */
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024; // 2 MB

export function isMediaKind(v: unknown): v is MediaKind {
  return typeof v === "string" && (MEDIA_KINDS as readonly string[]).includes(v);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Magic-byte check. The client always re-encodes through a canvas, so anything
 * that isn't a real JPEG/WebP here did not come from our uploader.
 */
export function sniffImageType(buf: Uint8Array): string | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  )
    return "image/png";
  const ascii = (i: number, s: string) =>
    s.split("").every((c, k) => buf[i + k] === c.charCodeAt(0));
  if (ascii(0, "RIFF") && ascii(8, "WEBP")) return "image/webp";
  return null;
}

export function extForType(type: string): string {
  if (type === "image/webp") return "webp";
  if (type === "image/png") return "png";
  return "jpg";
}
