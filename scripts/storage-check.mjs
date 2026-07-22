/**
 * Boot-time storage self-test.
 *
 * The storage driver picks itself based on env (see src/lib/storage.ts) and
 * does so silently, which means a typo'd bucket name or a rotated-away key
 * doesn't surface until a restaurant owner uploads a photo and it fails. That
 * is a bad place to find out.
 *
 * So at boot we round-trip a small object through R2 — PUT, GET, compare bytes,
 * DELETE — and log the result. The deploy log then tells you plainly whether
 * media storage works.
 *
 * Deliberately NON-FATAL. A storage problem shouldn't take the whole ordering
 * app down: menus, carts and checkout all work fine without images. We log
 * loudly and let the app boot. Set STORAGE_CHECK_STRICT=1 to fail the deploy
 * instead.
 *
 * Talks to R2 directly rather than importing src/lib/storage.ts, which is
 * marked "server-only" and can't be pulled into a plain node script.
 */

import { AwsClient } from "aws4fetch";

const {
  R2_ACCOUNT_ID,
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY,
  R2_BUCKET,
  R2_PUBLIC_BASE_URL,
  STORAGE_CHECK_STRICT,
} = process.env;

const log = (msg) => console.log(`[storage] ${msg}`);

function finish(ok) {
  if (!ok && STORAGE_CHECK_STRICT === "1") process.exit(1);
  process.exit(0);
}

const configured =
  R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET;

if (!configured) {
  // Mirrors r2Enabled() in src/lib/storage.ts: all four or none.
  const missing = Object.entries({
    R2_ACCOUNT_ID,
    R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY,
    R2_BUCKET,
  })
    .filter(([, v]) => !v)
    .map(([k]) => k);

  log(`driver=local — R2 not configured (missing: ${missing.join(", ")})`);
  log("uploads will write to the container filesystem and be LOST on redeploy.");
  finish(true);
}

const client = new AwsClient({
  accessKeyId: R2_ACCESS_KEY_ID,
  secretAccessKey: R2_SECRET_ACCESS_KEY,
  service: "s3",
  region: "auto",
});

// Namespaced under a dot-prefixed key so it never collides with real media and
// is obvious in a bucket listing if a delete ever fails.
const key = `.healthcheck/${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const url = `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${R2_BUCKET}/${key}`;
const payload = `hearth storage check ${new Date().toISOString()}`;

log(`driver=r2 bucket=${R2_BUCKET} account=${R2_ACCOUNT_ID.slice(0, 8)}…`);
log(
  R2_PUBLIC_BASE_URL
    ? `serving=direct base=${R2_PUBLIC_BASE_URL}`
    : "serving=proxy via /api/media (set R2_PUBLIC_BASE_URL to bypass Railway egress)"
);

try {
  const put = await client.fetch(url, {
    method: "PUT",
    body: payload,
    headers: { "Content-Type": "text/plain" },
  });
  if (!put.ok) throw new Error(`PUT ${put.status} ${await put.text()}`);

  const get = await client.fetch(url);
  if (!get.ok) throw new Error(`GET ${get.status} ${await get.text()}`);

  const body = await get.text();
  if (body !== payload) throw new Error("GET returned different bytes than PUT wrote");

  const del = await client.fetch(url, { method: "DELETE" });
  if (!del.ok && del.status !== 404) throw new Error(`DELETE ${del.status}`);

  log("✓ round-trip OK (put → get → verify → delete). Media storage is live.");
  finish(true);
} catch (err) {
  log(`✗ round-trip FAILED: ${err instanceof Error ? err.message : String(err)}`);
  log("uploads will fail. Check R2 credentials, bucket name, and token permissions");
  log("(the token needs Object Read & Write on this bucket, not just Read).");
  finish(false);
}
