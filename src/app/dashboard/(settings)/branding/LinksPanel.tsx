"use client";

/**
 * The Links tab.
 *
 * Everything an owner hands to a customer or pastes into a listing lives here:
 * the ordering address itself (now editable), the one-tap copies of it, the
 * deep links to individual pages of their site, and a pointer to the custom
 * domain once it's live. Before this, the link was a read-only card in the
 * sidebar of every branding page — visible everywhere, changeable nowhere.
 */

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { updateSlugAction } from "@/app/dashboard/actions";
import { Badge, Button, Card, Field, Input, cx } from "@/components/hearth/ui";
import { slugify } from "@/lib/money";
import { SLUG_MAX } from "@/lib/slug-rules";

export type LinksInitial = {
  slug: string;
  /** Absolute origin the customer site is served from, e.g. https://ezorders.app */
  origin: string;
  customDomain: string;
  domainVerified: boolean;
  showAbout: boolean;
  showGallery: boolean;
};

function SaveButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return <Button disabled={pending}>{pending ? "Working…" : label}</Button>;
}

/**
 * Copy-to-clipboard with the confirmation baked in. Owners are pasting these
 * into Google and Apple listings, so "did it copy?" needs an answer.
 */
function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 1600);
        } catch {
          /* clipboard blocked (http, permissions) — the URL is on screen anyway */
        }
      }}
      className={cx(
        "shrink-0 rounded-sm border px-2.5 py-1 text-[12px] font-medium transition-colors",
        done
          ? "border-accentDim text-accent"
          : "border-line2 text-dim hover:border-accentDim hover:text-ink"
      )}
    >
      {done ? "Copied" : label}
    </button>
  );
}

/** One shareable URL: the address, a copy button, and a way to open it. */
function LinkRow({
  label,
  hint,
  url,
  tone,
}: {
  label: string;
  hint?: string;
  url: string;
  tone?: "primary";
}) {
  return (
    <div className="border-t border-line py-3 first:border-t-0 first:pt-0">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] font-medium text-ink">{label}</span>
        {hint && <span className="text-[11px] text-mute">{hint}</span>}
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        <code
          className={cx(
            "block min-w-0 flex-1 break-all rounded-sm border border-line2 bg-surface2 px-3 py-2 font-mono text-[12px]",
            tone === "primary" ? "text-accent" : "text-ink"
          )}
        >
          {url}
        </code>
        <CopyButton value={url} />
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 rounded-sm border border-line2 px-2.5 py-1 text-[12px] font-medium text-dim hover:border-accentDim hover:text-ink"
        >
          Open
        </a>
      </div>
    </div>
  );
}

export default function LinksPanel({
  initial,
  onGoToDomain,
}: {
  initial: LinksInitial;
  onGoToDomain: () => void;
}) {
  const [state, action] = useFormState(updateSlugAction, undefined);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initial.slug);

  const cleaned = slugify(draft);
  const changed = cleaned !== initial.slug;

  // The live domain wins as the address to advertise; the /r/ link keeps
  // working either way, which is what makes changing the slug survivable.
  const liveBase =
    initial.domainVerified && initial.customDomain
      ? `https://${initial.customDomain}`
      : `${initial.origin}/r/${initial.slug}`;

  const pages: Array<{ label: string; path: string; on: boolean }> = [
    { label: "Home", path: "", on: true },
    { label: "Menu", path: "#menu", on: true },
    { label: "About", path: "#about", on: initial.showAbout },
    { label: "Gallery", path: "#gallery", on: initial.showGallery },
    { label: "Visit", path: "#visit", on: true },
  ];

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-6">
        {/* ── The ordering address ─────────────────────────────────────── */}
        <Card>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-[15px] font-semibold text-ink">Your ordering link</h3>
              <p className="mt-0.5 text-[12px] leading-relaxed text-dim">
                This is the link that goes in the “Order online” field of your Google Business
                Profile and Apple Business Connect. Every tap on it is a customer you keep.
              </p>
            </div>
            {!editing && (
              <button
                type="button"
                onClick={() => {
                  setDraft(initial.slug);
                  setEditing(true);
                }}
                className="shrink-0 rounded-sm border border-line2 px-2.5 py-1 text-[12px] font-medium text-dim hover:border-accentDim hover:text-ink"
              >
                Change
              </button>
            )}
          </div>

          {!editing ? (
            <div className="mt-4">
              <LinkRow
                label="Ordering page"
                hint="Share this one"
                url={`${initial.origin}/r/${initial.slug}`}
                tone="primary"
              />
            </div>
          ) : (
            <form action={action} className="mt-4 space-y-4">
              <Field
                label="New address"
                hint={`Letters, numbers, and dashes. Max ${SLUG_MAX} characters.`}
              >
                <div className="flex items-center gap-2">
                  <span className="shrink-0 font-mono text-[12px] text-mute">
                    {initial.origin}/r/
                  </span>
                  <Input
                    name="slug"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    required
                  />
                </div>
              </Field>

              {changed && (
                <>
                  <div className="rounded-sm border border-warnLine bg-warnBg px-3 py-2.5 text-[12px] leading-relaxed text-warnInk">
                    Changing this breaks your old link. Anything already printed, or already saved
                    on Google, Apple, or a customer’s phone, will stop working until you update it.
                    Your new address will be{" "}
                    <span className="font-mono text-warnInk">/r/{cleaned || "…"}</span>.
                  </div>
                  <Field label="Type the new address again to confirm">
                    <Input
                      name="confirm"
                      placeholder={cleaned}
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                    />
                  </Field>
                </>
              )}

              <div className="flex items-center gap-3">
                <SaveButton label="Change my link" />
                <button
                  type="button"
                  onClick={() => {
                    setEditing(false);
                    setDraft(initial.slug);
                  }}
                  className="text-[12px] text-mute underline underline-offset-2 hover:text-ink"
                >
                  Cancel
                </button>
              </div>

              {state?.error && <p className="text-[12px] text-badInk">{state.error}</p>}
              {state?.ok && <p className="text-[12px] text-accent">{state.ok}</p>}
            </form>
          )}
        </Card>

        {/* ── Direct links to each page ────────────────────────────────── */}
        <Card>
          <h3 className="text-[15px] font-semibold text-ink">Link straight to a page</h3>
          <p className="mt-0.5 text-[12px] leading-relaxed text-dim">
            Useful in a post or a text: send someone to your menu instead of the front page. Hidden
            pages are turned off on their own tab.
          </p>
          <div className="mt-4">
            {pages
              .filter((p) => p.on)
              .map((p) => (
                <LinkRow key={p.label} label={p.label} url={`${liveBase}${p.path}`} />
              ))}
          </div>
          {pages.some((p) => !p.on) && (
            <p className="mt-3 border-t border-line pt-3 text-[12px] text-mute">
              Hidden right now:{" "}
              {pages
                .filter((p) => !p.on)
                .map((p) => p.label)
                .join(", ")}
              . Turn a page back on from its tab above.
            </p>
          )}
        </Card>
      </div>

      {/* ── Sidebar ──────────────────────────────────────────────────── */}
      <div className="space-y-4">
        <Card>
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-[14px] font-semibold text-ink">Your own domain</h3>
            {initial.customDomain ? (
              initial.domainVerified ? (
                <Badge tone="good">Live</Badge>
              ) : (
                <Badge tone="warn">Pending</Badge>
              )
            ) : null}
          </div>
          {initial.customDomain ? (
            <p className="mt-2 break-all font-mono text-[12px] text-accent">
              {initial.customDomain}
            </p>
          ) : (
            <p className="mt-2 text-[12px] leading-relaxed text-dim">
              Run everything on a domain you own, like orders.yourrestaurant.com. Your shared link
              keeps working either way.
            </p>
          )}
          <button
            type="button"
            onClick={onGoToDomain}
            className="mt-3 text-[12px] text-accent underline underline-offset-2"
          >
            {initial.customDomain ? "Manage domain" : "Set up a domain"} →
          </button>
        </Card>

        <Card>
          <h3 className="mb-2 text-[14px] font-semibold text-ink">Where to put your link</h3>
          <ul className="space-y-2 text-[12px] leading-relaxed text-dim">
            <li>
              <span className="text-ink">Google Business Profile</span> — the “Order online” field.
              This is the one that matters most.
            </li>
            <li>
              <span className="text-ink">Apple Business Connect</span> — the same field, under your
              place’s actions.
            </li>
            <li>
              <span className="text-ink">Instagram &amp; Facebook</span> — your bio link and the
              “Order food” button.
            </li>
            <li>
              <span className="text-ink">In the store</span> — a QR code on the counter, the door,
              and the receipt.
            </li>
          </ul>
        </Card>
      </div>
    </div>
  );
}
