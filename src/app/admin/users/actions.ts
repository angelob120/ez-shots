"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { hashPassword, requireAdmin } from "@/lib/auth";

type Result = { error?: string; ok?: string } | undefined;

const PATH = "/admin/users";

function normalizeRole(v: unknown): "ADMIN" | "OWNER" {
  return String(v) === "ADMIN" ? "ADMIN" : "OWNER";
}

/** Creates a staff account — either a platform admin or a restaurant owner. */
export async function createUserAction(_prev: Result, formData: FormData): Promise<Result> {
  await requireAdmin();

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const name = String(formData.get("name") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const role = normalizeRole(formData.get("role"));
  const restaurantId = String(formData.get("restaurantId") ?? "") || null;

  if (!email.includes("@")) return { error: "Enter a valid email address." };
  if (password.length < 8) return { error: "Password must be at least 8 characters." };
  if (role === "OWNER" && !restaurantId) {
    return { error: "Owners must be assigned to a restaurant." };
  }

  const taken = await prisma.user.findUnique({ where: { email } });
  if (taken) return { error: "That email already has an account." };

  await prisma.user.create({
    data: {
      email,
      name: name || null,
      passwordHash: await hashPassword(password),
      role,
      // Admins are platform-wide; they get a tenant only via impersonation.
      restaurantId: role === "ADMIN" ? null : restaurantId,
    },
  });

  revalidatePath(PATH);
  return { ok: `Created ${email} as ${role === "ADMIN" ? "an admin" : "an owner"}.` };
}

/** Changes a user's rank and/or which restaurant they're scoped to. */
export async function updateUserAction(_prev: Result, formData: FormData): Promise<Result> {
  const session = await requireAdmin();

  const userId = String(formData.get("userId") ?? "");
  const role = normalizeRole(formData.get("role"));
  const restaurantId = String(formData.get("restaurantId") ?? "") || null;

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { error: "That user no longer exists." };

  if (user.id === session.userId && role !== "ADMIN") {
    return { error: "You can't remove your own admin access." };
  }
  if (role === "OWNER" && !restaurantId) {
    return { error: "Owners must be assigned to a restaurant." };
  }
  if (user.role === "ADMIN" && role !== "ADMIN") {
    const admins = await prisma.user.count({ where: { role: "ADMIN" } });
    if (admins <= 1) return { error: "That's the last admin - promote someone else first." };
  }

  await prisma.user.update({
    where: { id: userId },
    data: { role, restaurantId: role === "ADMIN" ? null : restaurantId },
  });

  revalidatePath(PATH);
  return { ok: "Saved." };
}

export async function setUserPasswordAction(_prev: Result, formData: FormData): Promise<Result> {
  await requireAdmin();
  const userId = String(formData.get("userId") ?? "");
  const password = String(formData.get("password") ?? "");
  if (password.length < 8) return { error: "Password must be at least 8 characters." };

  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(password) },
  });
  return { ok: "Password updated. Hand it over out-of-band." };
}

export async function deleteUserAction(formData: FormData) {
  const session = await requireAdmin();
  const userId = String(formData.get("userId") ?? "");
  if (userId === session.userId) return;

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return;
  if (user.role === "ADMIN") {
    const admins = await prisma.user.count({ where: { role: "ADMIN" } });
    if (admins <= 1) return;
  }

  await prisma.user.delete({ where: { id: userId } });
  revalidatePath(PATH);
}
