"use client";

import { useFormState, useFormStatus } from "react-dom";
import { Badge, Button, Card, Field, Input } from "@/components/hearth/ui";
import CopyField from "@/components/hearth/CopyField";
import {
  createInviteAction,
  removeTenantUserAction,
  revokeInviteAction,
  resetOwnerPasswordAction,
} from "../../actions";

export type PersonRow = {
  id: string;
  email: string;
  name: string | null;
  role: string;
  createdAt: string;
};

export type InviteRow = {
  id: string;
  email: string;
  expiresAt: string;
};

function Submit({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <Button size="sm" variant="outline" disabled={pending}>
      {pending ? pendingLabel : label}
    </Button>
  );
}

function Msg({ state }: { state: { error?: string; ok?: string } | undefined }) {
  if (!state?.error && !state?.ok) return null;
  return (
    <p
      className={
        state.error
          ? "mt-3 rounded-sm border border-badLine bg-badBg px-3 py-2 text-[12px] text-badInk"
          : "mt-3 rounded-sm border border-goodLine bg-goodBg px-3 py-2 text-[12px] text-accent"
      }
    >
      {state.error ?? state.ok}
    </p>
  );
}

/**
 * Who can sign in to this tenant, and who's been asked to.
 *
 * The panel deliberately shows unredeemed invites next to real logins. They are
 * different things — an invite is not an account — but from an operator's point
 * of view "is anybody able to get in" is one question, and answering it from two
 * places is how a tenant sits for a week with a dead invite and nobody noticing.
 */
export default function PeoplePanel({
  restaurantId,
  people,
  invites,
}: {
  restaurantId: string;
  people: PersonRow[];
  invites: InviteRow[];
}) {
  const [inviteState, inviteAction] = useFormState(createInviteAction, undefined);
  const [removeState, removeAction] = useFormState(removeTenantUserAction, undefined);
  const [pwState, pwAction] = useFormState(resetOwnerPasswordAction, undefined);

  return (
    <div className="space-y-4">
      {/* ── Invite ─────────────────────────────────────────────────── */}
      <Card>
        <h3 className="text-[14px] font-semibold text-ink">Invite someone</h3>
        <p className="mt-1 max-w-2xl text-[12px] leading-relaxed text-mute">
          Generates a single-use link that expires in 72 hours. They choose their own
          password when they open it, so there is no credential for you to transmit or
          for either of you to store.
        </p>

        <form action={inviteAction} className="mt-4 flex flex-wrap items-end gap-3">
          <input type="hidden" name="restaurantId" value={restaurantId} />
          <div className="min-w-[240px] grow sm:grow-0">
            <Field label="Email">
              <Input name="email" type="email" placeholder="owner@restaurant.com" required />
            </Field>
          </div>
          <Submit label="Generate invite" pendingLabel="Generating…" />
        </form>

        <Msg state={inviteState} />

        {inviteState?.link && (
          <div className="mt-3">
            <CopyField
              label={inviteState.linkLabel ?? "Invite link"}
              value={inviteState.link}
              tone="accent"
              hint="Shown once. Navigate away without copying and you'll need to generate a fresh one."
            />
          </div>
        )}
      </Card>

      {/* ── Outstanding invites ────────────────────────────────────── */}
      {invites.length > 0 && (
        <Card>
          <h3 className="mb-3 text-[14px] font-semibold text-ink">Outstanding invites</h3>
          <ul className="space-y-2">
            {invites.map((i) => (
              <li
                key={i.id}
                className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-2 text-[12px] last:border-0 last:pb-0"
              >
                <div>
                  <div className="text-ink">{i.email}</div>
                  <div className="text-mute">Expires {i.expiresAt}</div>
                </div>
                <form action={revokeInviteAction}>
                  <input type="hidden" name="inviteId" value={i.id} />
                  <input type="hidden" name="restaurantId" value={restaurantId} />
                  <button className="text-[12px] text-dim hover:text-badInk">Revoke</button>
                </form>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[11px] text-mute">
            The link itself isn&rsquo;t recoverable — we store a hash of it, not the token.
            Revoke and generate a new one if it went astray.
          </p>
        </Card>
      )}

      {/* ── Existing logins ────────────────────────────────────────── */}
      <Card>
        <h3 className="mb-3 text-[14px] font-semibold text-ink">Logins</h3>

        {people.length === 0 ? (
          <p className="text-[12px] text-mute">
            Nobody can sign in to this account yet. Send an invite above.
          </p>
        ) : (
          <ul className="space-y-3">
            {people.map((p) => (
              <li key={p.id} className="border-b border-line pb-3 last:border-0 last:pb-0">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[13px] text-ink">{p.email}</span>
                      <Badge tone={p.role === "OWNER" ? "good" : "neutral"}>{p.role}</Badge>
                    </div>
                    <div className="mt-0.5 text-[11px] text-mute">
                      {p.name ? `${p.name} · ` : ""}since {p.createdAt}
                    </div>
                  </div>

                  {people.length > 1 && (
                    <form action={removeAction}>
                      <input type="hidden" name="userId" value={p.id} />
                      <input type="hidden" name="restaurantId" value={restaurantId} />
                      <button className="text-[12px] text-dim hover:text-badInk">Remove</button>
                    </form>
                  )}
                </div>

                <form action={pwAction} className="mt-2 flex flex-wrap items-center gap-2">
                  <input type="hidden" name="userId" value={p.id} />
                  <Input
                    name="password"
                    type="text"
                    placeholder="Set a password directly…"
                    minLength={8}
                    className="h-8 max-w-[240px] py-0 text-[12px]"
                  />
                  <Submit label="Set" pendingLabel="Saving…" />
                </form>
              </li>
            ))}
          </ul>
        )}

        <Msg state={removeState} />
        <Msg state={pwState} />

        <p className="mt-4 border-t border-line pt-3 text-[11px] leading-relaxed text-mute">
          Setting a password directly is the break-glass path for someone locked out with
          no working email. Prefer an invite — it leaves the password with them.
        </p>
      </Card>
    </div>
  );
}
