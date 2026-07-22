"use client";

import Link from "next/link";
import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { Badge, Button, Card, Field, Input, Select, Td } from "@/components/hearth/ui";
import {
  createUserAction,
  deleteUserAction,
  setUserPasswordAction,
  updateUserAction,
} from "./actions";

export type RestaurantOption = { id: string; name: string; slug: string };

export type UserRecord = {
  id: string;
  email: string;
  name: string | null;
  role: "ADMIN" | "OWNER";
  restaurantId: string | null;
  restaurantName: string | null;
  createdAt: string;
  isSelf: boolean;
};

function Submit({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? pendingLabel : label}
    </Button>
  );
}

function Notice({ state }: { state: { error?: string; ok?: string } | undefined }) {
  if (!state?.error && !state?.ok) return null;
  return (
    <p
      className={
        state.error
          ? "rounded-sm border border-badLine bg-badBg px-3 py-2 text-[12px] text-badInk"
          : "rounded-sm border border-goodLine bg-goodBg px-3 py-2 text-[12px] text-accent"
      }
    >
      {state.error ?? state.ok}
    </p>
  );
}

export function CreateUserForm({ restaurants }: { restaurants: RestaurantOption[] }) {
  const [state, action] = useFormState(createUserAction, undefined);
  const [role, setRole] = useState<"ADMIN" | "OWNER">("OWNER");

  return (
    <Card>
      <h3 className="mb-4 text-[14px] font-semibold text-ink">Add a user</h3>
      <form action={action} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Email">
            <Input name="email" type="email" required placeholder="person@restaurant.com" />
          </Field>
          <Field label="Name" hint="Optional">
            <Input name="name" placeholder="Angelo" />
          </Field>
          <Field label="Role">
            <Select name="role" value={role} onChange={(e) => setRole(e.target.value as "ADMIN" | "OWNER")}>
              <option value="OWNER">Owner - one restaurant</option>
              <option value="ADMIN">Admin - full platform access</option>
            </Select>
          </Field>
          <Field
            label="Restaurant"
            hint={role === "ADMIN" ? "Admins see every account." : "Required for owners."}
          >
            <Select name="restaurantId" disabled={role === "ADMIN"} defaultValue="">
              <option value="">- none -</option>
              {restaurants.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Temporary password" hint="8+ characters. They can't change it themselves yet - reset it here.">
          <Input name="password" type="text" minLength={8} required />
        </Field>
        <Notice state={state} />
        <Submit label="Create user" pendingLabel="Creating…" />
      </form>
    </Card>
  );
}

/**
 * Role, password and delete controls for one user. Extracted so the same panel
 * serves both the inline "Manage" row and the dedicated user page — one set of
 * forms, no drift between the two places you can edit a user.
 */
export function UserManagePanel({
  user,
  restaurants,
}: {
  user: UserRecord;
  restaurants: RestaurantOption[];
}) {
  const [roleState, roleAction] = useFormState(updateUserAction, undefined);
  const [pwState, pwAction] = useFormState(setUserPasswordAction, undefined);
  const [role, setRole] = useState<"ADMIN" | "OWNER">(user.role);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <form action={roleAction} className="space-y-3">
        <input type="hidden" name="userId" value={user.id} />
        <Field label="Role">
          <Select
            name="role"
            value={role}
            onChange={(e) => setRole(e.target.value as "ADMIN" | "OWNER")}
            disabled={user.isSelf}
          >
            <option value="OWNER">Owner</option>
            <option value="ADMIN">Admin</option>
          </Select>
        </Field>
        <Field label="Restaurant">
          <Select name="restaurantId" defaultValue={user.restaurantId ?? ""} disabled={role === "ADMIN"}>
            <option value="">&mdash; none &mdash;</option>
            {restaurants.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
        </Field>
        <Notice state={roleState} />
        {user.isSelf ? (
          <p className="text-[11px] text-mute">This is you &mdash; role locked.</p>
        ) : (
          <Submit label="Save role" pendingLabel="Saving…" />
        )}
      </form>

      <div className="space-y-4">
        <form action={pwAction} className="space-y-3">
          <input type="hidden" name="userId" value={user.id} />
          <Field label="Set a new password" hint="8+ characters.">
            <Input name="password" type="text" minLength={8} required />
          </Field>
          <Notice state={pwState} />
          <Submit label="Update password" pendingLabel="Updating…" />
        </form>

        {!user.isSelf && (
          <form action={deleteUserAction}>
            <input type="hidden" name="userId" value={user.id} />
            <Button variant="danger" size="sm" type="submit">
              Delete user
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}

export function UserRow({
  user,
  restaurants,
}: {
  user: UserRecord;
  restaurants: RestaurantOption[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <tr>
        <Td>
          {/* The name is the primary way in: it opens this user's page, which
              shows their login history and activity and carries the same manage
              controls. An underlined link reads as clickable in a way the old
              coloured name did not. */}
          <Link
            href={`/admin/users/${user.id}`}
            className="font-medium text-ink underline underline-offset-2 hover:text-accent"
          >
            {user.name || user.email}
          </Link>
          <div className="font-mono text-[11px] text-mute">{user.email}</div>
        </Td>
        <Td>
          <Badge tone={user.role === "ADMIN" ? "good" : "neutral"}>
            {user.role === "ADMIN" ? "Admin" : "Owner"}
          </Badge>
        </Td>
        <Td>
          {user.restaurantId ? (
            <Link
              href={`/admin/restaurants/${user.restaurantId}?tab=analytics`}
              className="text-ink underline-offset-2 hover:text-accent hover:underline"
            >
              {user.restaurantName ?? "View"}
            </Link>
          ) : (
            <span className="text-mute">Platform-wide</span>
          )}
        </Td>
        <Td className="text-right">
          <div className="inline-flex items-center gap-1">
            <Link
              href={`/admin/users/${user.id}`}
              className="rounded-sm px-2.5 py-1.5 text-[13px] text-dim transition-colors hover:bg-surface2 hover:text-ink"
            >
              View
            </Link>
            <Button variant="ghost" size="sm" onClick={() => setOpen((v) => !v)}>
              {open ? "Close" : "Quick edit"}
            </Button>
          </div>
        </Td>
      </tr>

      {open && (
        <tr>
          <td colSpan={4} className="border-b border-line bg-surface2 px-4 py-4">
            <UserManagePanel user={user} restaurants={restaurants} />
          </td>
        </tr>
      )}
    </>
  );
}
