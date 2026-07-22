"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";

import { Button, Card, Field, Input, Select, Textarea, cx, inputClass } from "@/components/hearth/ui";
import {
  CONDITION_FIELDS,
  MAX_SMS_SEGMENTS,
  NODE_KINDS,
  NODE_META,
  NODE_PORTS,
  TRIGGER_KINDS,
  // Not re-exported from here. Three server components used to import it from
  // this file and got a client reference proxy instead of the object, which
  // builds clean and dies at request time. See the note beside it in
  // lib/automation-flow.ts.
  TRIGGER_LABELS,
  isTimeTrigger,
  newNodeId,
  nextNodeId,
  portLabel,
  smsLength,
  validateGraph,
  worstCaseBody,
  type Comparator,
  type ConditionField,
  type Rule,
  type FlowEdge,
  type FlowNode,
  type Graph,
  type NodeKind,
} from "@/lib/automation-flow";

/**
 * The journey builder: a canvas of draggable blocks, an inspector for the
 * selected one, and a save button.
 *
 * ─── Why this is hand-rolled ──────────────────────────────────────────────
 *
 * No `react-flow`, no graph library. Nodes are absolutely-positioned divs,
 * edges are one SVG layer behind them, dragging is pointer events writing to
 * React state. This repo has no UI dependencies and the interaction surface
 * here is genuinely small — drag a box, click to select, connect two ports.
 * A flow library is ~150KB and, more to the point, owns the data model: the
 * graph shape would live in a vendor's types rather than in
 * `lib/automation-flow.ts`, where the validator and the server runtime both
 * read it.
 *
 * **The bound on that, so it doesn't creep:** this file renders and drags.
 * Every *decision* about the graph — is it valid, what comes next, what does
 * this SMS cost — is imported from the pure module and is the same code the
 * server runs. Two implementations of "what comes next" is an owner watching a
 * journey take a branch the picture on their screen says it shouldn't.
 *
 * ─── Why the errors are live ──────────────────────────────────────────────
 *
 * `validateGraph` runs on every change, in the browser, and the SMS segment
 * counter updates as the owner types. Same reasoning as the campaign composer:
 * an automation that turns out to be malformed only when the sweep tries to
 * run it three days later is a bug report nobody can act on, and a cost
 * revealed after sending is not a cost anybody can act on.
 */

export type TagOption = { id: string; slug: string; name: string };

type SaveState = { ok?: string; error?: string } | undefined;

export type FlowBuilderProps = {
  initialGraph: Graph;
  tags: TagOption[];
  restaurantName: string;
  /** Server action. Receives `graph` as JSON plus whatever `extraFields` adds. */
  action: (prev: SaveState, fd: FormData) => Promise<SaveState>;
  /** Rendered above the canvas — name, trigger settings, quiet hours. */
  header?: React.ReactNode;
  /** Hidden inputs the owning page needs on the post (ids, and so on). */
  extraFields?: React.ReactNode;
  saveLabel?: string;
  readOnly?: boolean;
  readOnlyNote?: string;
};

const GRID = 10;
const NODE_W = 190;

export function FlowBuilder({
  initialGraph,
  tags,
  restaurantName,
  action,
  header,
  extraFields,
  saveLabel = "Save",
  readOnly = false,
  readOnlyNote,
}: FlowBuilderProps) {
  const [graph, setGraph] = useState<Graph>(initialGraph);
  const [selected, setSelected] = useState<string | null>(null);
  const [connecting, setConnecting] = useState<{ from: string; port: string } | null>(null);
  const [state, formAction] = useFormState(action, undefined);

  const errors = useMemo(() => validateGraph(graph, restaurantName), [graph, restaurantName]);
  const errorsByNode = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const e of errors) {
      if (!e.nodeId) continue;
      m.set(e.nodeId, [...(m.get(e.nodeId) ?? []), e.message]);
    }
    return m;
  }, [errors]);

  const update = useCallback((fn: (g: Graph) => Graph) => {
    if (readOnly) return;
    setGraph((g) => fn(g));
  }, [readOnly]);

  const addNode = (kind: NodeKind) => {
    update((g) => {
      const id = newNodeId(g, kind);
      // Placed below the lowest node rather than at a fixed spot, so adding
      // five blocks in a row doesn't stack them all on top of each other.
      const y = g.nodes.reduce((max, n) => Math.max(max, n.y), 0) + 110;
      return { ...g, nodes: [...g.nodes, { id, kind, x: 80, y, config: defaultConfig(kind) }] };
    });
  };

  const removeNode = (id: string) => {
    update((g) => ({
      nodes: g.nodes.filter((n) => n.id !== id),
      edges: g.edges.filter((e) => e.from !== id && e.to !== id),
    }));
    setSelected(null);
  };

  const setConfig = (id: string, patch: Partial<FlowNode["config"]>) => {
    update((g) => ({
      ...g,
      nodes: g.nodes.map((n) => (n.id === id ? { ...n, config: { ...n.config, ...patch } } : n)),
    }));
  };

  const connect = (from: string, port: string, to: string) => {
    if (from === to) return;
    update((g) => ({
      ...g,
      // The existing edge on this port is replaced rather than added to. A port
      // with two edges is an arbitrary choice at runtime presented to the owner
      // as a drawing, and the validator rejects it — better to make it
      // unreachable than to explain it.
      edges: [
        ...g.edges.filter((e) => !(e.from === from && e.port === port)),
        { id: `${from}:${port}:${to}`, from, port, to },
      ],
    }));
    setConnecting(null);
  };

  const disconnect = (from: string, port: string) => {
    update((g) => ({ ...g, edges: g.edges.filter((e) => !(e.from === from && e.port === port)) }));
  };

  const moveNode = (id: string, x: number, y: number) => {
    update((g) => ({
      ...g,
      nodes: g.nodes.map((n) =>
        n.id === id
          ? { ...n, x: Math.max(0, Math.round(x / GRID) * GRID), y: Math.max(0, Math.round(y / GRID) * GRID) }
          : n,
      ),
    }));
  };

  const selectedNode = graph.nodes.find((n) => n.id === selected) ?? null;
  const height = Math.max(520, ...graph.nodes.map((n) => n.y + 160));

  return (
    <form action={formAction} className="space-y-4">
      {extraFields}
      {/* The graph travels as one JSON field. A form with a field per node
          would have to be reassembled server-side into the same shape the pure
          module already defines, and the reassembly would be a second parser. */}
      <input type="hidden" name="graph" value={JSON.stringify(graph)} />

      {header}

      {readOnly && readOnlyNote ? (
        <p className="rounded-sm border border-line bg-surface2 px-3 py-2 text-[12px] text-dim">{readOnlyNote}</p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        <Card padded={false} className="overflow-hidden">
          {!readOnly ? <Palette onAdd={addNode} /> : null}

          <div className="relative overflow-auto bg-surface2/40" style={{ height }}>
            <Edges graph={graph} />

            {graph.nodes.map((n) => (
              <NodeBox
                key={n.id}
                node={n}
                graph={graph}
                selected={selected === n.id}
                problems={errorsByNode.get(n.id) ?? []}
                connecting={connecting}
                readOnly={readOnly}
                onSelect={() => {
                  if (connecting) connect(connecting.from, connecting.port, n.id);
                  else setSelected(n.id);
                }}
                onStartConnect={(port) => setConnecting({ from: n.id, port })}
                onMove={moveNode}
              />
            ))}

            {connecting ? (
              <div className="pointer-events-none sticky bottom-3 left-3 inline-block rounded-sm border border-accent bg-surface px-2.5 py-1.5 text-[12px] text-ink">
                Click the step this connects to.{" "}
                <button
                  type="button"
                  className="pointer-events-auto underline"
                  onClick={() => setConnecting(null)}
                >
                  Cancel
                </button>
              </div>
            ) : null}
          </div>
        </Card>

        <div className="space-y-4">
          <Inspector
            node={selectedNode}
            graph={graph}
            tags={tags}
            restaurantName={restaurantName}
            readOnly={readOnly}
            onChange={(patch) => selectedNode && setConfig(selectedNode.id, patch)}
            onDelete={() => selectedNode && removeNode(selectedNode.id)}
            onDisconnect={(port) => selectedNode && disconnect(selectedNode.id, port)}
          />

          <Problems errors={errors} />
        </div>
      </div>

      {!readOnly ? (
        <div className="flex items-center gap-3">
          <SaveButton label={saveLabel} />
          {state?.error ? <span className="text-[12px] text-badInk">{state.error}</span> : null}
          {state?.ok ? <span className="text-[12px] text-accent">{state.ok}</span> : null}
        </div>
      ) : null}
    </form>
  );
}

function SaveButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button variant="primary" disabled={pending}>
      {pending ? "Saving…" : label}
    </Button>
  );
}

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

function Palette({ onAdd }: { onAdd: (k: NodeKind) => void }) {
  // The trigger is excluded: there is exactly one per journey and it is placed
  // for the owner. A palette that lets you add a second entry point is a
  // palette that lets you draw something the validator will refuse.
  const kinds = NODE_KINDS.filter((k) => k !== "TRIGGER");
  return (
    <div className="flex flex-wrap gap-1.5 border-b border-line bg-surface px-3 py-2.5">
      {kinds.map((k) => (
        <button
          key={k}
          type="button"
          onClick={() => onAdd(k)}
          title={NODE_META[k].blurb}
          className="rounded-sm border border-line px-2 py-1 text-[12px] text-dim transition-colors hover:bg-surface2 hover:text-ink"
        >
          + {NODE_META[k].label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Edges
// ---------------------------------------------------------------------------

/**
 * One SVG layer behind the nodes.
 *
 * Cubic curves rather than straight lines, because two branches leaving the
 * same box overlap almost exactly as straight lines and the picture stops
 * telling the owner anything.
 */
function Edges({ graph }: { graph: Graph }) {
  const pos = new Map(graph.nodes.map((n) => [n.id, n]));

  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
      {graph.edges.map((e) => {
        const from = pos.get(e.from);
        const to = pos.get(e.to);
        if (!from || !to) return null;

        const ports = NODE_PORTS[from.kind];
        const i = Math.max(0, ports.indexOf(e.port));
        const spread = ports.length > 1 ? (i - (ports.length - 1) / 2) * 60 : 0;

        const x1 = from.x + NODE_W / 2 + spread;
        const y1 = from.y + 74;
        const x2 = to.x + NODE_W / 2;
        const y2 = to.y;
        const mid = (y1 + y2) / 2;

        return (
          <path
            key={e.id}
            d={`M ${x1} ${y1} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}`}
            fill="none"
            stroke="rgb(var(--h-line))"
            strokeWidth={1.5}
          />
        );
      })}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

function NodeBox({
  node,
  graph,
  selected,
  problems,
  connecting,
  readOnly,
  onSelect,
  onStartConnect,
  onMove,
}: {
  node: FlowNode;
  graph: Graph;
  selected: boolean;
  problems: string[];
  connecting: { from: string; port: string } | null;
  readOnly: boolean;
  onSelect: () => void;
  onStartConnect: (port: string) => void;
  onMove: (id: string, x: number, y: number) => void;
}) {
  const dragging = useRef<{ dx: number; dy: number } | null>(null);

  const onPointerDown = (ev: React.PointerEvent) => {
    if (readOnly) return;
    // Buttons inside the box (the ports, the connect handles) must not start a
    // drag, or every click on a port nudges the node a few pixels.
    if ((ev.target as HTMLElement).closest("button")) return;
    dragging.current = { dx: ev.clientX - node.x, dy: ev.clientY - node.y };
    (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
  };

  const onPointerMove = (ev: React.PointerEvent) => {
    if (!dragging.current) return;
    onMove(node.id, ev.clientX - dragging.current.dx, ev.clientY - dragging.current.dy);
  };

  const meta = NODE_META[node.kind];
  const ports = NODE_PORTS[node.kind];

  return (
    <div
      style={{ left: node.x, top: node.y, width: NODE_W }}
      className={cx(
        "absolute select-none rounded-sm border bg-surface shadow-sm",
        selected ? "border-accent" : problems.length ? "border-badLine" : "border-line",
        connecting && connecting.from !== node.id ? "cursor-copy" : readOnly ? "" : "cursor-grab",
      )}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={() => (dragging.current = null)}
      onClick={onSelect}
    >
      <div className="px-2.5 py-2">
        <p className="text-[11px] uppercase tracking-wide text-mute">{meta.label}</p>
        <p className="mt-0.5 truncate text-[12px] text-ink">{summarize(node)}</p>
        {problems.length ? (
          <p className="mt-1 text-[11px] text-badInk">{problems[0]}</p>
        ) : null}
      </div>

      {ports.length ? (
        <div className="flex border-t border-line">
          {ports.map((p) => {
            const connected = nextNodeId(graph, node.id, p);
            return (
              <button
                key={p}
                type="button"
                disabled={readOnly}
                onClick={(ev) => {
                  ev.stopPropagation();
                  onStartConnect(p);
                }}
                className={cx(
                  "flex-1 border-r border-line px-1.5 py-1 text-[11px] last:border-r-0",
                  connected ? "text-dim" : "text-mute",
                  connecting?.from === node.id && connecting.port === p ? "bg-surface2 text-accent" : "",
                )}
                title={connected ? `Goes to ${connected}` : "Not connected — the journey ends here"}
              >
                {portLabel(node.kind, p)}
                {connected ? " ↓" : " ·"}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/** One line of the block's own settings, so the canvas is readable without
 *  clicking every box. */
function summarize(node: FlowNode): string {
  const c = node.config;
  switch (node.kind) {
    case "TRIGGER":
      return c.trigger ? TRIGGER_LABELS[c.trigger] ?? c.trigger : "Pick a trigger";
    case "SEND_SMS":
      return c.body?.trim() || "No message yet";
    case "SEND_EMAIL":
      return c.subject?.trim() || "No subject yet";
    case "WAIT":
      return c.amount ? `${c.amount} ${c.unit ?? "days"}` : "No duration";
    case "WAIT_UNTIL":
      return c.condition?.rules.length ? "Until a condition is met" : "Nothing to wait for";
    case "IF_ELSE":
      return c.condition?.rules.length ? describeCondition(c.condition.rules[0]) : "No condition";
    case "SPLIT":
      return `${c.weightA ?? 50} / ${c.weightB ?? 50}`;
    case "ADD_TAG":
    case "REMOVE_TAG":
      return c.tagSlug || "No tag picked";
    case "WEBHOOK_OUT":
      return c.url || "No URL";
    case "EXIT":
      return c.exitReason || "Ends here";
    default:
      return NODE_META[node.kind].blurb;
  }
}

// ---------------------------------------------------------------------------
// Inspector
// ---------------------------------------------------------------------------

function Inspector({
  node,
  graph,
  tags,
  restaurantName,
  readOnly,
  onChange,
  onDelete,
  onDisconnect,
}: {
  node: FlowNode | null;
  graph: Graph;
  tags: TagOption[];
  restaurantName: string;
  readOnly: boolean;
  onChange: (patch: Partial<FlowNode["config"]>) => void;
  onDelete: () => void;
  onDisconnect: (port: string) => void;
}) {
  if (!node) {
    return (
      <Card>
        <p className="text-[13px] font-medium text-ink">Nothing selected</p>
        <p className="mt-1 text-[12px] text-dim">
          Click a step to edit it, or add one from the toolbar. Click a step&rsquo;s bottom button, then another step, to
          connect them.
        </p>
      </Card>
    );
  }

  const c = node.config;
  const disabled = readOnly;

  return (
    <Card>
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <p className="text-[13px] font-medium text-ink">{NODE_META[node.kind].label}</p>
          <p className="text-[11px] text-mute">{NODE_META[node.kind].blurb}</p>
        </div>
        {node.kind !== "TRIGGER" && !readOnly ? (
          <button type="button" onClick={onDelete} className="text-[11px] text-dim underline hover:text-badInk">
            Delete
          </button>
        ) : null}
      </div>

      <div className="space-y-3">
        {node.kind === "TRIGGER" ? (
          <>
            <Field label="Starts when" hint={c.trigger && isTimeTrigger(c.trigger) ? "Checked periodically, not fired by an event." : undefined}>
              <Select
                disabled={disabled}
                value={c.trigger ?? ""}
                onChange={(e) => onChange({ trigger: e.target.value })}
              >
                <option value="">Pick one…</option>
                {TRIGGER_KINDS.map((t) => (
                  <option key={t} value={t}>
                    {TRIGGER_LABELS[t]}
                  </option>
                ))}
              </Select>
            </Field>

            {(c.trigger === "TAG_ADDED" || c.trigger === "TAG_REMOVED") && (
              <TagPicker tags={tags} value={c.tagSlug} disabled={disabled} onChange={(tagSlug) => onChange({ tagSlug })} />
            )}
            {c.trigger === "LAPSED" && (
              <Field label="Days without an order">
                <Input
                  type="number"
                  min={1}
                  disabled={disabled}
                  value={c.lapsedDays ?? 60}
                  onChange={(e) => onChange({ lapsedDays: Number(e.target.value) })}
                />
              </Field>
            )}
            {c.trigger === "ANNIVERSARY" && (
              <Field label="Days after their first order" hint="365 is a one-year anniversary.">
                <Input
                  type="number"
                  min={1}
                  disabled={disabled}
                  value={c.anniversaryDays ?? 365}
                  onChange={(e) => onChange({ anniversaryDays: Number(e.target.value) })}
                />
              </Field>
            )}
          </>
        ) : null}

        {node.kind === "SEND_SMS" ? (
          <SmsField body={c.body ?? ""} restaurantName={restaurantName} disabled={disabled} onChange={(body) => onChange({ body })} />
        ) : null}

        {node.kind === "SEND_EMAIL" ? (
          <>
            <Field label="Subject">
              <Input disabled={disabled} value={c.subject ?? ""} onChange={(e) => onChange({ subject: e.target.value })} />
            </Field>
            <Field label="Message" hint="Plain text. {{name}} and {{restaurant}} are filled in per person.">
              <Textarea rows={7} disabled={disabled} value={c.body ?? ""} onChange={(e) => onChange({ body: e.target.value })} />
            </Field>
          </>
        ) : null}

        {node.kind === "WAIT" ? <DurationFields config={c} disabled={disabled} onChange={onChange} /> : null}

        {node.kind === "WAIT_UNTIL" ? (
          <>
            <ConditionEditor condition={c.condition} tags={tags} disabled={disabled} onChange={(condition) => onChange({ condition })} />
            <p className="text-[11px] text-mute">
              Give up after — required, or anyone who never does it stays in the journey forever.
            </p>
            <DurationFields
              config={{ amount: c.timeoutAmount, unit: c.timeoutUnit }}
              disabled={disabled}
              onChange={(p) => onChange({ timeoutAmount: p.amount, timeoutUnit: p.unit })}
            />
          </>
        ) : null}

        {node.kind === "IF_ELSE" ? (
          <ConditionEditor condition={c.condition} tags={tags} disabled={disabled} onChange={(condition) => onChange({ condition })} />
        ) : null}

        {node.kind === "SPLIT" ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label="A %">
              <Input type="number" min={0} disabled={disabled} value={c.weightA ?? 50} onChange={(e) => onChange({ weightA: Number(e.target.value) })} />
            </Field>
            <Field label="B %">
              <Input type="number" min={0} disabled={disabled} value={c.weightB ?? 50} onChange={(e) => onChange({ weightB: Number(e.target.value) })} />
            </Field>
          </div>
        ) : null}

        {node.kind === "ADD_TAG" || node.kind === "REMOVE_TAG" ? (
          <TagPicker tags={tags} value={c.tagSlug} disabled={disabled} onChange={(tagSlug) => onChange({ tagSlug })} />
        ) : null}

        {node.kind === "NOTIFY_OWNER" ? (
          <Field label="What to tell yourself" hint="Goes to your reply-to address, not the customer.">
            <Textarea rows={3} disabled={disabled} value={c.note ?? ""} onChange={(e) => onChange({ note: e.target.value })} />
          </Field>
        ) : null}

        {node.kind === "WEBHOOK_OUT" ? (
          <Field label="URL" hint="https only. Private and internal addresses are refused.">
            <Input disabled={disabled} value={c.url ?? ""} onChange={(e) => onChange({ url: e.target.value })} placeholder="https://" />
          </Field>
        ) : null}

        {node.kind === "EXIT" ? (
          <Field label="Why (for your records)">
            <Input disabled={disabled} value={c.exitReason ?? ""} onChange={(e) => onChange({ exitReason: e.target.value })} />
          </Field>
        ) : null}

        {NODE_PORTS[node.kind].length ? (
          <div className="border-t border-line pt-3">
            <p className="mb-1.5 text-[11px] uppercase tracking-wide text-mute">Goes to</p>
            {NODE_PORTS[node.kind].map((p) => {
              const to = nextNodeId(graph, node.id, p);
              return (
                <div key={p} className="flex items-center justify-between py-0.5 text-[12px]">
                  <span className="text-dim">{portLabel(node.kind, p)}</span>
                  <span className="flex items-center gap-2">
                    <span className={to ? "text-ink" : "text-mute"}>{to ?? "ends here"}</span>
                    {to && !readOnly ? (
                      <button type="button" onClick={() => onDisconnect(p)} className="text-[11px] text-dim underline">
                        clear
                      </button>
                    ) : null}
                  </span>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    </Card>
  );
}

function SmsField({
  body,
  restaurantName,
  disabled,
  onChange,
}: {
  body: string;
  restaurantName: string;
  disabled: boolean;
  onChange: (v: string) => void;
}) {
  // Counted against a worst-case merge, exactly as the campaign composer does.
  // Counting the raw body understates the cost, and here the understatement is
  // charged on every send for as long as the journey runs.
  const len = smsLength(worstCaseBody(body, restaurantName));
  const over = len.segments > MAX_SMS_SEGMENTS;

  return (
    <Field label="Message" hint="{{name}} and {{restaurant}} are filled in per person.">
      <Textarea rows={5} disabled={disabled} value={body} onChange={(e) => onChange(e.target.value)} />
      <p className={cx("mt-1 text-[11px]", over ? "text-badInk" : "text-mute")}>
        {len.chars} characters · {len.segments} segment{len.segments === 1 ? "" : "s"} · {len.encoding}
        {len.nonGsmSample ? ` — “${len.nonGsmSample}” forces the expensive encoding` : ""}
      </p>
    </Field>
  );
}

function DurationFields({
  config,
  disabled,
  onChange,
}: {
  config: { amount?: number; unit?: FlowNode["config"]["unit"] };
  disabled: boolean;
  onChange: (patch: { amount: number; unit: NonNullable<FlowNode["config"]["unit"]> }) => void;
}) {
  const amount = config.amount ?? 1;
  const unit = config.unit ?? "days";
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label="Amount">
        <Input type="number" min={1} disabled={disabled} value={amount} onChange={(e) => onChange({ amount: Number(e.target.value), unit })} />
      </Field>
      <Field label="Unit">
        <Select disabled={disabled} value={unit} onChange={(e) => onChange({ amount, unit: e.target.value as "minutes" | "hours" | "days" })}>
          <option value="minutes">minutes</option>
          <option value="hours">hours</option>
          <option value="days">days</option>
        </Select>
      </Field>
    </div>
  );
}

function TagPicker({
  tags,
  value,
  disabled,
  onChange,
}: {
  tags: TagOption[];
  value?: string;
  disabled: boolean;
  onChange: (slug: string) => void;
}) {
  return (
    <Field label="Tag">
      <Select disabled={disabled} value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
        <option value="">Pick a tag…</option>
        {tags.map((t) => (
          <option key={t.id} value={t.slug}>
            {t.name}
          </option>
        ))}
      </Select>
    </Field>
  );
}

// ---------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------

const FIELD_LABELS: Record<ConditionField, string> = {
  orderCount: "Number of orders",
  lifetimeCts: "Lifetime spend (cents)",
  daysSinceLastOrder: "Days since last order",
  daysSinceFirstOrder: "Days since first order",
  optInStatus: "Text opt-in status",
  emailSubscribed: "Subscribed to email",
  hasTag: "Has tag",
  cohort: "Cohort",
  name: "Name",
  email: "Email address",
  phone: "Phone number",
  variant: "A/B variant",
  orderTotalCts: "This order's total (cents)",
};

const OPS: Array<{ value: Comparator; label: string }> = [
  { value: "eq", label: "is" },
  { value: "ne", label: "is not" },
  { value: "gt", label: "is more than" },
  { value: "gte", label: "is at least" },
  { value: "lt", label: "is less than" },
  { value: "lte", label: "is at most" },
  { value: "contains", label: "contains" },
  { value: "is_set", label: "is set" },
  { value: "not_set", label: "is empty" },
];

function describeCondition(rule: Rule): string {
  const op = OPS.find((o) => o.value === rule.op)?.label ?? rule.op;
  return `${FIELD_LABELS[rule.field] ?? rule.field} ${op} ${rule.value ?? ""}`.trim();
}

function ConditionEditor({
  condition,
  tags,
  disabled,
  onChange,
}: {
  condition?: FlowNode["config"]["condition"];
  tags: TagOption[];
  disabled: boolean;
  onChange: (c: NonNullable<FlowNode["config"]["condition"]>) => void;
}) {
  const value = condition ?? { match: "all" as const, rules: [] };

  const setRule = (i: number, patch: Partial<(typeof value.rules)[number]>) => {
    onChange({ ...value, rules: value.rules.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  };

  return (
    <div className="space-y-2">
      <Field label="Condition">
        <Select disabled={disabled} value={value.match} onChange={(e) => onChange({ ...value, match: e.target.value as "all" | "any" })}>
          <option value="all">All of these are true</option>
          <option value="any">Any of these is true</option>
        </Select>
      </Field>

      {value.rules.map((rule, i) => (
        <div key={i} className="space-y-1.5 rounded-sm border border-line p-2">
          <Select disabled={disabled} value={rule.field} onChange={(e) => setRule(i, { field: e.target.value as ConditionField })}>
            {CONDITION_FIELDS.map((f) => (
              <option key={f} value={f}>
                {FIELD_LABELS[f]}
              </option>
            ))}
          </Select>
          <div className="flex gap-1.5">
            <Select disabled={disabled} value={rule.op} onChange={(e) => setRule(i, { op: e.target.value as Comparator })}>
              {OPS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
            {rule.op !== "is_set" && rule.op !== "not_set" ? (
              rule.field === "hasTag" ? (
                <select
                  disabled={disabled}
                  className={inputClass}
                  value={String(rule.value ?? "")}
                  onChange={(e) => setRule(i, { value: e.target.value })}
                >
                  <option value="">Pick a tag…</option>
                  {tags.map((t) => (
                    <option key={t.id} value={t.slug}>
                      {t.name}
                    </option>
                  ))}
                </select>
              ) : (
                <Input disabled={disabled} value={String(rule.value ?? "")} onChange={(e) => setRule(i, { value: e.target.value })} />
              )
            ) : null}
          </div>
          {!disabled ? (
            <button
              type="button"
              className="text-[11px] text-dim underline"
              onClick={() => onChange({ ...value, rules: value.rules.filter((_, j) => j !== i) })}
            >
              Remove
            </button>
          ) : null}
        </div>
      ))}

      {!disabled ? (
        <button
          type="button"
          className="text-[12px] text-dim underline hover:text-ink"
          onClick={() => onChange({ ...value, rules: [...value.rules, { field: "orderCount", op: "gte", value: 1 }] })}
        >
          + Add a condition
        </button>
      ) : null}

      {value.rules.length === 0 ? (
        <p className="text-[11px] text-mute">
          An empty condition is treated as <em>false</em>, so everyone takes the other branch. That is deliberate — the
          alternative sends the message to everybody.
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------

function Problems({ errors }: { errors: Array<{ nodeId: string | null; message: string }> }) {
  if (errors.length === 0) {
    return (
      <Card>
        <p className="text-[12px] text-accent">This journey is ready to switch on.</p>
      </Card>
    );
  }
  return (
    <Card>
      <p className="mb-1.5 text-[12px] font-medium text-ink">
        {errors.length} thing{errors.length === 1 ? "" : "s"} to fix
      </p>
      <ul className="space-y-1">
        {errors.map((e, i) => (
          <li key={i} className="text-[12px] text-dim">
            {e.nodeId ? <span className="text-mute">{e.nodeId}: </span> : null}
            {e.message}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function defaultConfig(kind: NodeKind): FlowNode["config"] {
  switch (kind) {
    case "WAIT":
      return { amount: 1, unit: "days" };
    case "WAIT_UNTIL":
      return { timeoutAmount: 7, timeoutUnit: "days", condition: { match: "all", rules: [] } };
    case "IF_ELSE":
      return { condition: { match: "all", rules: [] } };
    case "SPLIT":
      return { weightA: 50, weightB: 50 };
    default:
      return {};
  }
}

export type { FlowEdge };
