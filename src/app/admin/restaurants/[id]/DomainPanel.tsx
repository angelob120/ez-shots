"use client";

import { useFormState, useFormStatus } from "react-dom";
import { Badge, Button, Card, Field, Input } from "@/components/hearth/ui";
import CopyField from "@/components/hearth/CopyField";
import {
  adminClearDomainAction,
  adminRecheckDomainAction,
  adminSaveDomainAction,
} from "../../actions";

export type DomainPanelProps = {
  restaurantId: string;
  domain: string | null;
  verifiedAt: string | null;
  challengeToken: string | null;
  challengePrefix: string;
  cfHostnameId: string | null;
  cfStatus: string | null;
  cfSslStatus: string | null;
  wwwDomain: string | null;
  cfWwwStatus: string | null;
  cfWwwSslStatus: string | null;
  cloudflare: boolean;
  cnameTarget: string;
};

function Submit({ label, pendingLabel, variant = "outline" }: { label: string; pendingLabel: string; variant?: "outline" | "primary" }) {
  const { pending } = useFormStatus();
  return (
    <Button size="sm" variant={variant} disabled={pending}>
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
          ? "mt-3 rounded-sm border border-warnLine bg-warnBg px-3 py-2 text-[12px] leading-relaxed text-warnInk"
          : "mt-3 rounded-sm border border-goodLine bg-goodBg px-3 py-2 text-[12px] text-accent"
      }
    >
      {state.error ?? state.ok}
    </p>
  );
}

/**
 * Domain state for one tenant, from our side.
 *
 * The panel shows **two** statuses because there are two independent failures
 * with one symptom. "Verified with us" means we've recorded the domain as the
 * tenant's canonical origin and started printing it on links. "Active at the
 * edge" means Cloudflare is routing it and has a certificate. A domain can be
 * the first without the second — that's the state where a customer clicks a
 * link on a receipt and gets a TLS error, and it is invisible if you only track
 * one flag.
 */
export default function DomainPanel(props: DomainPanelProps) {
  const [saveState, saveAction] = useFormState(adminSaveDomainAction, undefined);
  const [checkState, checkAction] = useFormState(adminRecheckDomainAction, undefined);

  const verified = Boolean(props.verifiedAt);
  const edgeLive = props.cfStatus === "active" && props.cfSslStatus === "active";
  const wwwLive = props.cfWwwStatus === "active" && props.cfWwwSslStatus === "active";

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-[14px] font-semibold text-ink">Custom domain</h3>
            <p className="mt-1 max-w-2xl text-[12px] leading-relaxed text-mute">
              Once verified this becomes the tenant&rsquo;s canonical origin — every order
              link, QR code and receipt carries it instead of ours.
            </p>
          </div>
          {props.domain && (
            <div className="flex flex-wrap gap-2">
              <Badge tone={verified ? "good" : "warn"}>
                {verified ? "Verified with us" : "Not verified"}
              </Badge>
              {props.cloudflare && (
                <Badge tone={edgeLive ? "good" : "warn"}>
                  {edgeLive ? "Live at the edge" : "Edge pending"}
                </Badge>
              )}
              {props.cloudflare && props.wwwDomain && (
                <Badge tone={wwwLive ? "good" : "warn"}>
                  {wwwLive ? "www live" : "www pending"}
                </Badge>
              )}
            </div>
          )}
        </div>

        <form action={saveAction} className="mt-4 flex flex-wrap items-end gap-3">
          <input type="hidden" name="id" value={props.restaurantId} />
          <div className="min-w-[260px] grow sm:grow-0">
            <Field label="Domain">
              <Input
                name="domain"
                defaultValue={props.domain ?? ""}
                placeholder="order.theirplace.com"
              />
            </Field>
          </div>
          <Submit label={props.domain ? "Save domain" : "Add domain"} pendingLabel="Saving…" />
        </form>
        <Msg state={saveState} />

        {props.domain && (
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4">
            <form action={checkAction}>
              <input type="hidden" name="id" value={props.restaurantId} />
              <Submit label="Re-check now" pendingLabel="Checking…" variant="primary" />
            </form>
            <a
              href={`https://${props.domain}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-8 items-center rounded-sm border border-line2 px-3 text-[12px] text-ink hover:bg-surface2"
            >
              Open it
            </a>
            <form action={adminClearDomainAction} className="ml-auto">
              <input type="hidden" name="id" value={props.restaurantId} />
              <button className="text-[12px] text-dim hover:text-badInk">
                Clear domain
              </button>
            </form>
          </div>
        )}
        <Msg state={checkState} />
      </Card>

      {/* ── What the tenant has to do ──────────────────────────────── */}
      {props.domain && !verified && (
        <Card>
          <h3 className="mb-1 text-[14px] font-semibold text-ink">What they need at their registrar</h3>
          <p className="mb-4 max-w-2xl text-[12px] leading-relaxed text-mute">
            This is the part that goes wrong. Read it to them verbatim — most stuck
            domains are a record added at the apex instead of the subdomain, or a proxy
            toggle left on.
          </p>

          {props.cloudflare ? (
            <div className="space-y-3">
              <CopyField label="Record type" value="CNAME" mono />
              <CopyField
                label="Name / host"
                value={props.wwwDomain ? "@" : props.domain.split(".")[0]}
                hint={
                  props.wwwDomain
                    ? "The apex. Some registrars call this @, some want the bare domain, and a few won't take a CNAME at the apex at all — those need an ALIAS or ANAME record to the same target."
                    : undefined
                }
              />
              <CopyField
                label="Value / target"
                value={props.cnameTarget || "(HEARTH_FALLBACK_ORIGIN is not set)"}
                hint="Cloudflare handles ownership validation and issues the certificate automatically."
              />

              {props.wwwDomain && (
                <div className="rounded-sm border border-line2 bg-surface2 p-3">
                  <p className="mb-2.5 text-[12px] leading-relaxed text-dim">
                    <span className="text-ink">Second record, for {props.wwwDomain}.</span> We
                    registered it so it gets its own certificate — without one, anyone typing
                    &ldquo;www&rdquo; sees a browser security warning on their own domain.
                  </p>
                  <div className="space-y-2.5">
                    <CopyField label="Name / host" value="www" />
                    <CopyField
                      label="Value / target"
                      value={props.cnameTarget || "(HEARTH_FALLBACK_ORIGIN is not set)"}
                    />
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <p className="rounded-sm border border-warnLine bg-warnBg px-3 py-2 text-[12px] leading-relaxed text-warnInk">
                Cloudflare isn&rsquo;t configured on this deployment, so this falls back to
                the legacy TXT-ownership flow. That proves they own the domain but sets up
                no routing — somebody still has to point it at us by hand.
              </p>
              <CopyField label="Record type" value="TXT" />
              <CopyField label="Name / host" value={`${props.challengePrefix}.${props.domain}`} />
              <CopyField label="Value" value={props.challengeToken ?? "—"} />
            </div>
          )}
        </Card>
      )}

      {/* ── Raw state, for when the badges disagree with reality ───── */}
      {props.domain && props.cloudflare && (
        <Card>
          <h3 className="mb-3 text-[14px] font-semibold text-ink">Cloudflare record</h3>
          <dl className="grid gap-x-8 gap-y-2 text-[12px] sm:grid-cols-2">
            {[
              ["Hostname id", props.cfHostnameId ?? "not registered"],
              ["Routing status", props.cfStatus ?? "—"],
              ["Certificate", props.cfSslStatus ?? "—"],
              ...(props.wwwDomain
                ? ([
                    [`${props.wwwDomain} routing`, props.cfWwwStatus ?? "not registered"],
                    [`${props.wwwDomain} certificate`, props.cfWwwSslStatus ?? "—"],
                  ] as Array<[string, string]>)
                : []),
              ["Verified with us", props.verifiedAt ?? "never"],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 border-b border-line py-1.5">
                <dt className="text-mute">{k}</dt>
                <dd className="truncate font-mono text-ink">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-[11px] leading-relaxed text-mute">
            A missing hostname id with a domain set means registration failed at save
            time. Re-check self-heals it — it re-registers before reporting anything.
          </p>
        </Card>
      )}

      {!props.domain && (
        <Card>
          <p className="text-[12px] leading-relaxed text-mute">
            No custom domain on this tenant. That&rsquo;s a perfectly normal end state —
            most restaurants never want one, and their links stay on our host.
          </p>
        </Card>
      )}
    </div>
  );
}
