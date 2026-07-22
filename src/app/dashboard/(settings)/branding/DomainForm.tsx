"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import {
  saveCustomDomainAction,
  verifyCustomDomainAction,
  removeCustomDomainAction,
} from "@/app/dashboard/actions";
import { Badge, Button, Card, Field, Input } from "@/components/hearth/ui";

export type DomainInitial = { domain: string; verified: boolean; token: string };
type Initial = DomainInitial;

type Mode = "subdomain" | "apex";

/**
 * Guess which setup an already-saved domain represents, so re-visiting the page
 * doesn't reset the owner's choice. Label counting is a heuristic: it reads
 * "shop.co.uk" as a subdomain. Harmless — the owner can flip the toggle, and
 * the DNS records we render don't depend on the guess being right.
 */
function guessMode(domain: string): Mode {
  return domain.split(".").length > 2 ? "subdomain" : "apex";
}

function SaveButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button disabled={pending}>{pending ? "Working…" : label}</Button>
  );
}

/**
 * Most registrars want the record name *relative to the zone* — "@" for the
 * apex, or just the sub-label. Showing the full name alone is the single
 * biggest source of mis-entered records, so we show both.
 */
function relativeName(host: string, domain: string): string {
  if (!host || !domain) return host;
  if (host === domain) return "@";
  const suffix = `.${domain}`;
  return host.endsWith(suffix) ? host.slice(0, -suffix.length) : host;
}

function ModeCard({
  selected,
  onSelect,
  title,
  body,
  example,
  recommended,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  body: string;
  example: string;
  recommended?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`w-full rounded-sm border px-3 py-3 text-left transition ${
        selected ? "border-accent bg-surface2" : "border-line hover:border-line2"
      }`}
    >
      <span className="flex items-center gap-2">
        <span
          className={`grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full border ${
            selected ? "border-accent" : "border-line2"
          }`}
        >
          {selected && <span className="h-1.5 w-1.5 rounded-full bg-accent" />}
        </span>
        <span className="text-[13px] font-medium text-ink">{title}</span>
        {recommended && (
          <span className="rounded-sm border border-line2 px-1.5 py-0.5 text-[10px] text-accent">
            Recommended
          </span>
        )}
      </span>
      <span className="mt-1.5 block pl-[22px] font-mono text-[11px] text-mute">{example}</span>
      <span className="mt-1 block pl-[22px] text-[12px] leading-relaxed text-dim">{body}</span>
    </button>
  );
}

function Row({
  type,
  host,
  value,
  domain,
}: {
  type: string;
  host: string;
  value: string;
  domain: string;
}) {
  const rel = relativeName(host, domain);
  return (
    <div className="grid grid-cols-[64px_1fr] gap-x-3 gap-y-1 border-t border-line py-2.5 text-[12px] sm:grid-cols-[64px_180px_1fr]">
      <span className="font-mono text-mute">Type</span>
      <span className="font-mono text-ink">{type}</span>
      <span className="hidden sm:block" />
      <span className="font-mono text-mute">Name</span>
      <code className="col-span-1 break-all font-mono text-ink sm:col-span-2">
        {host}
        {rel !== host && (
          <span className="ml-2 font-mono text-mute">
            (most registrars: <span className="text-ink">{rel}</span>)
          </span>
        )}
      </code>
      <span className="font-mono text-mute">Value</span>
      <code className="col-span-1 break-all font-mono text-accent sm:col-span-2">{value}</code>
    </div>
  );
}

export default function DomainForm({
  initial,
  appHost,
  challengePrefix,
}: {
  initial: Initial;
  appHost: string;
  challengePrefix: string;
}) {
  const [saveState, saveAction] = useFormState(saveCustomDomainAction, undefined);
  const [verifyState, verifyAction] = useFormState(verifyCustomDomainAction, undefined);
  const [domain, setDomain] = useState(initial.domain);
  const [mode, setMode] = useState<Mode>(guessMode(initial.domain));

  const hasDomain = Boolean(initial.domain);
  const challengeHost = initial.domain ? `${challengePrefix}.${initial.domain}` : "";
  // The DNS panel describes what was actually saved, not what the picker is
  // currently set to — those can differ while an owner is mid-edit.
  const savedMode = guessMode(initial.domain);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-6">
        <Card>
          <form action={saveAction} className="space-y-4">
            <div className="space-y-2">
              <p className="text-[13px] font-medium text-ink">Where should ordering live?</p>
              <ModeCard
                selected={mode === "subdomain"}
                onSelect={() => setMode("subdomain")}
                title="On a subdomain"
                recommended
                example="order.yourrestaurant.com"
                body="Your current website stays exactly where it is. You give us one address just for ordering — customers who visit your main site see no change. Your email is unaffected."
              />
              <ModeCard
                selected={mode === "apex"}
                onSelect={() => setMode("apex")}
                title="On my whole domain"
                example="yourrestaurant.com"
                body="Your ordering page becomes your website. Anyone visiting your domain lands here instead of your current site. Choose this only if you don't have a website you want to keep."
              />
            </div>

            <Field
              label="Your domain"
              hint={
                mode === "subdomain"
                  ? "Type the full address including the part before the dot."
                  : "Type your domain on its own, with no www."
              }
            >
              <Input
                name="domain"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder={
                  mode === "subdomain" ? "order.yourrestaurant.com" : "yourrestaurant.com"
                }
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
            </Field>

            {mode === "apex" && (
              <p className="rounded-sm border border-line2 bg-surface2 px-3 py-2 text-[12px] leading-relaxed text-dim">
                <span className="text-ink">Heads up:</span> some registrars won't let you put a
                CNAME on a bare domain. GoDaddy is the common one. If yours refuses the record,
                switch to a subdomain — it works everywhere and takes the same two minutes.
              </p>
            )}

            <div className="flex items-center gap-3">
              <SaveButton label={hasDomain ? "Update domain" : "Add domain"} />
              {hasDomain &&
                (initial.verified ? (
                  <Badge tone="good">Live</Badge>
                ) : (
                  <Badge tone="warn">Pending verification</Badge>
                ))}
            </div>

            {saveState?.error && <p className="text-[12px] text-badInk">{saveState.error}</p>}
            {saveState?.ok && <p className="text-[12px] text-accent">{saveState.ok}</p>}
          </form>
        </Card>

        {hasDomain && (
          <Card>
            <h3 className="text-[14px] font-semibold text-ink">2 · Add these DNS records</h3>
            <p className="mt-1 text-[12px] leading-relaxed text-dim">
              Add both records at your domain registrar. The CNAME routes visitors to us; the TXT
              record proves you own the domain. DNS changes can take a few minutes.
            </p>
            <p className="mt-2 text-[12px] leading-relaxed text-mute">
              Registrars ask for the <span className="text-ink">Name</span> relative to your
              domain — they add the rest for you. Paste the short version shown in grey, not the
              full address, or you&apos;ll end up with the domain doubled.
              {savedMode === "subdomain" && (
                <>
                  {" "}
                  Only these two records change; the rest of your DNS, including email, stays as
                  it is.
                </>
              )}
            </p>

            <div className="mt-3">
              <Row type="CNAME" host={initial.domain} value={appHost} domain={initial.domain} />
              <Row type="TXT" host={challengeHost} value={initial.token} domain={initial.domain} />
            </div>

            <form action={verifyAction} className="mt-4 flex items-center gap-3 border-t border-line pt-4">
              <SaveButton label={initial.verified ? "Re-check" : "Verify domain"} />
              {verifyState?.error && <p className="text-[12px] text-badInk">{verifyState.error}</p>}
              {verifyState?.ok && <p className="text-[12px] text-accent">{verifyState.ok}</p>}
            </form>

            <form action={removeCustomDomainAction} className="mt-3">
              <button className="text-[12px] text-mute underline underline-offset-2 hover:text-ink">
                Remove this domain
              </button>
            </form>
          </Card>
        )}
      </div>

      <div className="space-y-4">
        <Card>
          <h3 className="mb-2 text-[14px] font-semibold text-ink">How it works</h3>
          <ol className="space-y-2 text-[12px] leading-relaxed text-dim">
            <li>
              <span className="text-ink">1.</span> Pick a subdomain or your whole domain, then
              save.
            </li>
            <li>
              <span className="text-ink">2.</span> Add the CNAME and TXT records shown, at your
              registrar (GoDaddy, Namecheap, Cloudflare, etc.).
            </li>
            <li>
              <span className="text-ink">3.</span> Click verify. Once it passes, ordering runs on
              your address.
            </li>
          </ol>
          <p className="mt-3 text-[12px] leading-relaxed text-mute">
            Your shared link keeps working the whole time, so nothing breaks while DNS propagates.
            Removing the domain later hands traffic straight back to your old site.
          </p>
        </Card>

        {initial.verified && (
          <Card>
            <h3 className="mb-2 text-[14px] font-semibold text-ink">Live at</h3>
            <a
              href={`https://${initial.domain}`}
              target="_blank"
              rel="noreferrer"
              className="block break-all font-mono text-[12px] text-accent underline underline-offset-2"
            >
              https://{initial.domain}
            </a>
          </Card>
        )}
      </div>
    </div>
  );
}
