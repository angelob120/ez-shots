/**
 * Sweeps media that nothing references any more.
 *
 * Replacing a photo doesn't delete the old one — a failed save would then have
 * destroyed the original. Instead, unreferenced assets are marked orphaned,
 * and only deleted once they've been orphaned longer than the grace period.
 *
 *   npm run media:gc          # dry run, prints what it would do
 *   npm run media:gc -- --yes # actually delete
 */

import { PrismaClient } from "@prisma/client";
import { getStorageProvider } from "../src/lib/storage";

type AssetRow = { id: string; key: string; url: string; orphanedAt: Date | null };

const prisma = new PrismaClient();
const GRACE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const APPLY = process.argv.includes("--yes");

async function main() {
  const [restaurants, items, assets] = await Promise.all([
    prisma.restaurant.findMany({ select: { logoUrl: true, heroUrl: true } }),
    prisma.menuItem.findMany({ select: { imageUrl: true } }),
    prisma.mediaAsset.findMany({ select: { id: true, key: true, url: true, orphanedAt: true } }),
  ]);

  const referenced = new Set<string>();
  for (const r of restaurants) {
    if (r.logoUrl) referenced.add(r.logoUrl);
    if (r.heroUrl) referenced.add(r.heroUrl);
  }
  for (const i of items) if (i.imageUrl) referenced.add(i.imageUrl);

  const now = Date.now();
  const rows: AssetRow[] = assets;
  const newlyOrphaned = rows.filter((a) => !referenced.has(a.url) && !a.orphanedAt);
  const revived = rows.filter((a) => referenced.has(a.url) && a.orphanedAt);
  const expired = rows.filter(
    (a: AssetRow) => !referenced.has(a.url) && a.orphanedAt && now - a.orphanedAt.getTime() > GRACE_MS
  );

  console.log(`tracked=${rows.length} referenced=${referenced.size}`);
  console.log(`newly orphaned: ${newlyOrphaned.length}`);
  console.log(`re-referenced:  ${revived.length}`);
  console.log(`past grace, deletable: ${expired.length}`);

  if (!APPLY) {
    for (const a of expired) console.log(`  would delete ${a.key}`);
    console.log("\nDry run. Pass --yes to apply.");
    return;
  }

  if (newlyOrphaned.length) {
    await prisma.mediaAsset.updateMany({
      where: { id: { in: newlyOrphaned.map((a) => a.id) } },
      data: { orphanedAt: new Date() },
    });
  }
  if (revived.length) {
    await prisma.mediaAsset.updateMany({
      where: { id: { in: revived.map((a) => a.id) } },
      data: { orphanedAt: null },
    });
  }

  const storage = getStorageProvider();
  for (const a of expired) {
    await storage.delete(a.key).catch((e) => console.warn(`  storage delete failed ${a.key}`, e));
    await prisma.mediaAsset.delete({ where: { id: a.id } });
    console.log(`  deleted ${a.key}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
