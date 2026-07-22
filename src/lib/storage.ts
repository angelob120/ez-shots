import "server-only";
import { promises as fs } from "fs";
import path from "path";
import { AwsClient } from "aws4fetch";

/**
 * Storage seam — same shape as PaymentProvider / SmsProvider.
 *
 * Two drivers ship:
 *
 *   - LocalDiskStorage writes to a directory on disk. On Railway that is a
 *     mounted volume (MEDIA_DIR=/data/media); locally it is ./.media.
 *   - R2Storage talks to Cloudflare R2 over the S3-compatible API. Selected
 *     automatically when the R2_* env vars are present.
 *
 * Bytes are served back through /api/media/[...key] by default, so the public
 * URL shape is stable no matter which driver is active. Setting
 * R2_PUBLIC_BASE_URL switches `put` to hand out the bucket's public URL
 * directly instead — see the note on that constant below.
 */

export type PutInput = {
  key: string;
  body: Buffer;
  contentType: string;
};

export interface StorageProvider {
  readonly name: string;
  put(input: PutInput): Promise<{ url: string }>;
  get(key: string): Promise<{ body: Buffer; contentType: string } | null>;
  delete(key: string): Promise<void>;
}

/** The public URL for a stored key. Kept in one place. */
export function mediaUrl(key: string): string {
  return `/api/media/${key}`;
}

/**
 * Reject anything that could escape the media root: absolute paths, "..",
 * backslashes, control chars. Keys we generate never contain these; keys
 * arriving from a URL might.
 */
export function safeKey(key: string): string | null {
  const k = decodeURIComponent(key).replace(/^\/+/, "");
  if (!k || k.length > 300) return null;
  if (!/^[A-Za-z0-9._\/-]+$/.test(k)) return null;
  if (k.split("/").some((seg) => seg === "" || seg === "." || seg === "..")) return null;
  return k;
}

const MEDIA_DIR = process.env.MEDIA_DIR || path.join(process.cwd(), ".media");

class LocalDiskStorage implements StorageProvider {
  readonly name = "local";

  private abs(key: string) {
    return path.join(MEDIA_DIR, key);
  }

  async put({ key, body, contentType }: PutInput) {
    const target = this.abs(key);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, body);
    // Sidecar keeps the content type without needing to sniff on every read.
    await fs.writeFile(`${target}.type`, contentType, "utf8");
    return { url: mediaUrl(key) };
  }

  async get(key: string) {
    const target = this.abs(key);
    try {
      const body = await fs.readFile(target);
      const contentType = await fs
        .readFile(`${target}.type`, "utf8")
        .catch(() => "application/octet-stream");
      return { body, contentType: contentType.trim() };
    } catch {
      return null;
    }
  }

  async delete(key: string) {
    const target = this.abs(key);
    await fs.rm(target, { force: true });
    await fs.rm(`${target}.type`, { force: true });
  }
}

/* ── R2 ───────────────────────────────────────────────────────────────
 * Cloudflare R2 over the S3-compatible API. aws4fetch handles SigV4 in ~2KB;
 * the full AWS SDK would be two orders of magnitude more dependency for the
 * three verbs we use.
 */

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET = process.env.R2_BUCKET;

/**
 * Optional. When set (e.g. https://img.blueobsidian.xyz), `put` returns a URL
 * pointing straight at the bucket, so customer image loads never touch Railway
 * or the host-rewrite Worker — which is where the egress saving actually comes
 * from. Leave it unset and images keep flowing through /api/media, which works
 * identically but bills Railway for every byte.
 *
 * Safe to turn on later: keys are unchanged, so only newly-written rows get
 * absolute URLs and old /api/media rows keep resolving.
 */
const R2_PUBLIC_BASE_URL = process.env.R2_PUBLIC_BASE_URL?.replace(/\/+$/, "");

export function r2Enabled(): boolean {
  return Boolean(R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET);
}

class R2Storage implements StorageProvider {
  readonly name = "r2";

  private readonly client = new AwsClient({
    accessKeyId: R2_ACCESS_KEY_ID!,
    secretAccessKey: R2_SECRET_ACCESS_KEY!,
    service: "s3",
    region: "auto",
  });

  private readonly base = `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${R2_BUCKET}`;

  /** Each path segment is encoded separately so "/" keeps its meaning. */
  private url(key: string) {
    return `${this.base}/${key.split("/").map(encodeURIComponent).join("/")}`;
  }

  async put({ key, body, contentType }: PutInput) {
    const res = await this.client.fetch(this.url(key), {
      method: "PUT",
      body: new Uint8Array(body),
      headers: {
        "Content-Type": contentType,
        // Content-addressed keys are never rewritten, so anything that caches
        // this object may keep it forever.
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });

    if (!res.ok) {
      throw new Error(`R2 put failed for ${key}: ${res.status} ${await res.text()}`);
    }

    return { url: R2_PUBLIC_BASE_URL ? `${R2_PUBLIC_BASE_URL}/${key}` : mediaUrl(key) };
  }

  async get(key: string) {
    const res = await this.client.fetch(this.url(key));
    if (!res.ok) return null; // 404 and 403 alike mean "no object to serve".

    const body = Buffer.from(await res.arrayBuffer());
    return {
      body,
      contentType: res.headers.get("content-type") ?? "application/octet-stream",
    };
  }

  async delete(key: string) {
    const res = await this.client.fetch(this.url(key), { method: "DELETE" });
    // R2 returns 204 for a successful delete and 404 if it was already gone;
    // both leave us where the caller wants to be.
    if (!res.ok && res.status !== 404) {
      throw new Error(`R2 delete failed for ${key}: ${res.status}`);
    }
  }
}

// R2 when it is configured, disk otherwise. This keeps local dev and any
// environment without the R2_* vars working with no code change.
let provider: StorageProvider = r2Enabled() ? new R2Storage() : new LocalDiskStorage();

export function getStorageProvider(): StorageProvider {
  return provider;
}

export function setStorageProvider(p: StorageProvider) {
  provider = p;
}
