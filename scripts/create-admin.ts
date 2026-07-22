/**
 * Creates (or resets) a platform admin account from the command line.
 *
 *   ADMIN_EMAIL=you@you.com ADMIN_PASSWORD='something-long' npm run admin:create
 *
 * Safe to re-run — it upserts, so it doubles as a password reset if you ever
 * lock yourself out of the UI.
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const email = (process.env.ADMIN_EMAIL ?? process.argv[2] ?? "").trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? process.argv[3] ?? "";
  const name = process.env.ADMIN_NAME ?? "Hearth Admin";

  if (!email.includes("@")) throw new Error("Set ADMIN_EMAIL to a valid email address.");
  if (password.length < 8) throw new Error("Set ADMIN_PASSWORD to 8+ characters.");

  const passwordHash = await bcrypt.hash(password, 10);

  const user = await prisma.user.upsert({
    where: { email },
    update: { passwordHash, role: "ADMIN", restaurantId: null },
    create: { email, passwordHash, name, role: "ADMIN" },
  });

  console.log(`Admin ready: ${user.email}`);
  console.log("Sign in at /login — you'll land on /admin.");
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
