"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { hashPassword, setSession } from "@/lib/auth";
import { recordLogin } from "@/lib/activity";
import { slugify } from "@/lib/money";

type Result = { error?: string } | undefined;

const RESERVED = new Set([
  "admin",
  "dashboard",
  "login",
  "logout",
  "signup",
  "onboarding",
  "api",
  "r",
  "_next",
  "static",
  "public",
]);

/**
 * Self-serve owner signup. Creates the tenant in PENDING (not orderable yet),
 * creates the OWNER user, signs them in, and drops them into the wizard.
 * Nothing here can create an ADMIN.
 */
export async function signupAction(_prev: Result, formData: FormData): Promise<Result> {
  const name = String(formData.get("name") ?? "").trim();
  const ownerName = String(formData.get("ownerName") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  const slugRaw = String(formData.get("slug") ?? "").trim();

  if (!name) return { error: "Restaurant name is required." };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "Enter a valid email address." };
  if (password.length < 8) return { error: "Password must be at least 8 characters." };
  if (password !== confirm) return { error: "Those passwords don't match." };

  const base = slugify(slugRaw || name);
  if (!base) return { error: "Pick a web address made of letters and numbers." };
  if (RESERVED.has(base)) return { error: `"${base}" is reserved - try another web address.` };

  const emailTaken = await prisma.user.findUnique({ where: { email } });
  if (emailTaken) return { error: "That email already has an account. Sign in instead." };

  // If the owner typed a slug explicitly, don't silently move them off it.
  if (slugRaw) {
    const taken = await prisma.restaurant.findUnique({ where: { slug: base } });
    if (taken) return { error: `hearth.app/r/${base} is taken. Try another.` };
  }

  const slug = slugRaw ? base : await freeSlug(base);

  const restaurant = await prisma.restaurant.create({
    data: {
      name,
      slug,
      status: "PENDING",
      onboardingStep: 0,
      categories: {
        create: [
          { name: "Featured", sort: 0 },
          { name: "Mains", sort: 1 },
          { name: "Sides", sort: 2 },
          { name: "Drinks", sort: 3 },
        ],
      },
    },
  });

  const user = await prisma.user.create({
    data: {
      email,
      name: ownerName || null,
      passwordHash: await hashPassword(password),
      role: "OWNER",
      restaurantId: restaurant.id,
    },
  });

  await setSession({
    userId: user.id,
    email: user.email,
    role: "OWNER",
    restaurantId: restaurant.id,
  });
  await recordLogin({ userId: user.id, method: "SIGNUP" });

  redirect("/onboarding");
}

async function freeSlug(base: string): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    const hit = await prisma.restaurant.findUnique({ where: { slug: candidate } });
    if (!hit) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}
