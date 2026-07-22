"use client";

import * as React from "react";
import { useFormState } from "react-dom";
import {
  MAX_SMS_SEGMENTS,
  MERGE_FIELDS,
  smsLength,
  worstCaseBody,
} from "@/lib/campaign-format";
import { Button, Field, Input, Select, Textarea, cx } from "@/components/hearth/ui";
import { estimateAudienceAction } from "./actions";

/**
 * The composer.
 *
 * Client-side for three things that have to be live, and only those three: the
 * segment counter, the audience estimate, and the channel switch. Everything
 * else is a plain form field posted to a server action.
 *
 * ─── Why the counter is here rather than a nicety ─────────────────────────
 *
 * SMS is billed per segment per recipient, and the boundary is invisible: a
 * curly apostrophe pasted from a word processor pushes the whole message into
 * UCS-2 and halves the budget from 160 characters to 70, so a "one text"
 * message silently becomes three across the tenant's entire list. Showing the
 * encoding and the character that caused it is the difference between an owner
 * fixing a punctuation mark and an owner getting a bill they don't understand.
 *
 * The count is computed against the *worst-case* rendering of the merge fields,
 * not the raw body — `{{name}}` is nine characters and renders to a name that
 * may be longer, and quoting a number that only holds for short names is the
 * same as quoting a wrong one.
 *
 * ─── Why the audience shows two numbers ───────────────────────────────────
 *
 * "Matched" and "can be contacted" are different, always, and the gap is often
 * large. Showing only the first would be the platform quietly implying it will
 * text 400 people when it will text 90. Showing only the second would hide the
 * fact that the tenant has 310 customers it could reach if it collected
 * consent — which is the single most valuable thing this page can tell them.
 */

type Result = { ok?: string; error?: string } | undefined;
type Action = (prev: Result, fd: FormData) => Promise<Result>;

export type Segment = { id: string; name: string; query: string };

export default function Composer({
  action,
  campaignId,
  restaurantName,
  segments,
  initial,
  submitLabel,
  smsLive,
  emailLive,
}: {
  action: Action;
  campaignId?: string;
  restaurantName: string;
  segments: Segment[];
  initial?: {
    name: string;
    channel: "SMS" | "EMAIL";
    subject: string | null;
    body: string;
    audienceQuery: string;
    segmentId: string | null;
  };
  submitLabel: string;
  smsLive: boolean;
  emailLive: boolean;
}) {
  const [state, formAction] = useFormState<Result, FormData>(action, undefined);

  const [channel, setChannel] = React.useState<"SMS" | "EMAIL">(initial?.channel ?? "SMS");
  const [body, setBody] = React.useState(initial?.body ?? "");
  const [audienceQuery, setAudienceQuery] = React.useState(initial?.audienceQuery ?? "");
  const [estimate, setEstimate] = React.useState<{
    matched: number;
    reachable: number;
    unreachable: number;
  } | null>(null);
  const [estimating, setEstimating] = React.useState(false);

  const len = smsLength(worstCaseBody(body, restaurantName));
  const overLimit = channel === "SMS" && len.segments > MAX_SMS_SEGMENTS;

  // Debounced, and re-run when the channel changes because reachability is a
  // per-channel question — the same audience can be 90 people over SMS and 340
  // over email, which is usually the fact that decides which one to use.
  React.useEffect(() => {
    let alive = true;
    setEstimating(true);
    const t = setTimeout(() => {
      estimateAudienceAction(audienceQuery, channel)
        .then((e) => alive && setEstimate(e))
        .catch(() => alive && setEstimate(null))
        .finally(() => alive && setEstimating(false));
    }, 300);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [audienceQuery, channel]);

  const insertMerge = (token: string) => setBody((b) => `${b}${token}`);

  return (
    <form action={formAction} className="grid gap-6 lg:grid-cols-[1fr_320px]">
      {campaignId && <input type="hidden" name="campaignId" value={campaignId} />}
      {/* The browser's offset, so a scheduled time means the owner's wall clock
          rather than the server's. See readSchedule in actions.ts. */}
      <input
        type="hidden"
        name="tzOffset"
        value={typeof window === "undefined" ? 0 : new Date().getTimezoneOffset()}
      />

      <div className="space-y-4">
        <Field label="Campaign name" hint="Internal only — your customers never see this.">
          <Input name="name" defaultValue={initial?.name ?? ""} placeholder="Tuesday win-back" required />
        </Field>

        <Field label="Send by">
          <div className="flex gap-2">
            {(["SMS", "EMAIL"] as const).map((c) => {
              const live = c === "SMS" ? smsLive : emailLive;
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => setChannel(c)}
                  className={cx(
                    "flex-1 rounded-sm border px-3 py-2 text-left text-[13px] transition-colors",
                    channel === c
                      ? "border-accent bg-surface2 text-ink"
                      : "border-line2 text-dim hover:text-ink",
                  )}
                >
                  <span className="block font-medium">{c === "SMS" ? "Text message" : "Email"}</span>
                  <span className="mt-0.5 block text-[11px] text-mute">
                    {live ? "Sending is live" : "Recorded, not sent — sending isn't switched on yet"}
                  </span>
                </button>
              );
            })}
          </div>
        </Field>
        <input type="hidden" name="channel" value={channel} />

        {channel === "EMAIL" && (
          <Field
            label="Subject line"
            hint="Required. A blank subject is the fastest way into a spam folder."
          >
            <Input name="subject" defaultValue={initial?.subject ?? ""} maxLength={150} />
          </Field>
        )}

        <Field
          label="Message"
          hint={
            channel === "EMAIL"
              ? "Plain text. We format it and add your address and an unsubscribe link — both are legally required."
              : "Keep it short. Your customers are reading this on a lock screen."
          }
        >
          <Textarea
            name="body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={channel === "EMAIL" ? 12 : 5}
            required
          />
        </Field>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-mute">Insert</span>
          {MERGE_FIELDS.map((f) => (
            <button
              key={f.token}
              type="button"
              onClick={() => insertMerge(f.token)}
              title={`${f.label}. ${f.note}`}
              className="rounded-full border border-line2 px-2 py-0.5 font-mono text-[11px] text-dim hover:text-ink"
            >
              {f.token}
            </button>
          ))}
        </div>

        {channel === "SMS" && (
          <div
            className={cx(
              "rounded-sm border px-3 py-2 text-[12px]",
              overLimit ? "border-badLine bg-badBg text-badInk" : "border-line2 text-dim",
            )}
          >
            <span className="font-mono">{len.chars}</span> characters ·{" "}
            <span className="font-mono">{len.segments}</span>{" "}
            {len.segments === 1 ? "segment" : "segments"} · {len.encoding}
            {estimate && len.segments > 0 && (
              <> · about {len.segments * estimate.reachable} billable segments across this audience</>
            )}
            {len.nonGsmSample && (
              <p className="mt-1 text-[11px]">
                The character{" "}
                <span className="font-mono text-ink">{len.nonGsmSample}</span> forced this message into
                UCS-2, which cuts each segment from 160 characters to 70. Curly quotes and em dashes
                pasted from a word processor are the usual cause — retyping them plainly will roughly
                halve the cost.
              </p>
            )}
            {overLimit && (
              <p className="mt-1 text-[11px]">
                Over the {MAX_SMS_SEGMENTS}-segment limit. You&apos;re billed per segment, per person.
              </p>
            )}
          </div>
        )}

        <Field
          label="Schedule (optional)"
          hint="Leave blank to send as soon as you press the button on the next screen."
        >
          <Input type="datetime-local" name="scheduledFor" />
        </Field>

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={overLimit}>
            {submitLabel}
          </Button>
          {state?.error && (
            <span role="status" className="text-[12px] text-badInk">
              {state.error}
            </span>
          )}
          {state?.ok && (
            <span role="status" className="text-[12px] text-dim">
              {state.ok}
            </span>
          )}
        </div>
      </div>

      <aside className="space-y-4">
        <div className="rounded-sm border border-line p-4">
          <h3 className="text-[13px] font-medium text-ink">Who gets this</h3>

          <div className="mt-3">
            <Select
              name="segmentId"
              defaultValue={initial?.segmentId ?? ""}
              onChange={(e) => {
                const seg = segments.find((s) => s.id === e.target.value);
                setAudienceQuery(seg?.query ?? "");
              }}
            >
              <option value="">Everyone on my list</option>
              {segments.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
            <p className="mt-1.5 text-[11px] text-mute">
              Segments are saved from the filters on your Customers page.
            </p>
          </div>

          <input type="hidden" name="audienceQuery" value={audienceQuery} />

          <div className="mt-4 space-y-2 border-t border-line pt-3">
            {estimating && !estimate ? (
              <p className="text-[12px] text-mute">Counting…</p>
            ) : estimate ? (
              <>
                <Row label="In this audience" value={estimate.matched} />
                <Row label="Can be contacted" value={estimate.reachable} strong />
                {estimate.unreachable > 0 && (
                  <>
                    <Row label="Can't be contacted" value={estimate.unreachable} muted />
                    <p className="pt-1 text-[11px] leading-relaxed text-mute">
                      {channel === "SMS"
                        ? "Mostly people who never agreed to receive texts. We can't text them, and nothing on this page will change that — consent is collected at checkout. It's the single biggest thing you can do to grow this number."
                        : "People with no email address on file, or who unsubscribed. Unsubscribes are permanent by law; missing addresses fill in as people order."}
                    </p>
                  </>
                )}
              </>
            ) : (
              <p className="text-[12px] text-mute">Couldn&apos;t count that audience.</p>
            )}
          </div>
        </div>

        <div className="rounded-sm border border-line p-4 text-[11px] leading-relaxed text-mute">
          <p className="text-[12px] font-medium text-dim">Before you send</p>
          <p className="mt-2">
            {channel === "SMS"
              ? "Texts go only to customers who explicitly opted in at checkout. Replying STOP removes someone permanently, including from order updates — so a message people don't want costs more than the send."
              : "Every email carries your address and a one-click unsubscribe, both required by law. Unsubscribes are honoured immediately and can't be undone by you."}
          </p>
        </div>
      </aside>
    </form>
  );
}

function Row({
  label,
  value,
  strong,
  muted,
}: {
  label: string;
  value: number;
  strong?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between">
      <span className={cx("text-[12px]", muted ? "text-mute" : "text-dim")}>{label}</span>
      <span
        className={cx(
          "font-mono text-[13px]",
          strong ? "text-ink" : muted ? "text-mute" : "text-dim",
        )}
      >
        {value.toLocaleString()}
      </span>
    </div>
  );
}
