import { localNow } from "@/lib/hours";
import { MAX_EMAIL_BODY, MAX_EMAIL_SUBJECT, MAX_SMS_SEGMENTS, smsLength, worstCaseBody } from "@/lib/campaign-format";

/**
 * Re-exported so the canvas has one import for everything it needs to price a
 * message. The composer and the builder must count segments with the same
 * function — two counters is one of them being wrong about real money.
 */
export { MAX_SMS_SEGMENTS, smsLength, worstCaseBody };

/**
 * The pure half of automations: the node vocabulary, the graph validator,
 * condition evaluation, next-node resolution, wait arithmetic, quiet hours and
 * split assignment.
 *
 * **Split from `lib/automations.ts` because that module is `server-only` and
 * this half has to run in the browser.** The canvas validates the graph as the
 * owner draws it — an automation that turns out to be malformed only when the
 * sweep tries to run it three days later is a bug report nobody can act on —
 * and a `server-only` import in a client component is a build error.
 *
 * The split pays twice more. Everything here is tested by
 * `scripts/automation-flow.test.ts` with no database and no Prisma stub, which
 * is where the bugs live: a validator that lets a cycle through is a phone
 * ringing all night, and a next-node resolver that disagrees between the canvas
 * and the runtime is an owner watching a journey take a branch they can see is
 * wrong on screen.
 *
 * **Nothing in this file sends anything.** A SEND node describes a message. The
 * decision to actually contact a person is made in `lib/sms.ts` and
 * `lib/email.ts`, at the instant of the send, against current consent data.
 * That separation matters more here than it does for campaigns: an automation
 * queues a message weeks after the owner drew the box, long after a STOP may
 * have arrived.
 *
 * `lib/automations.ts` re-exports all of this so server callers have one import.
 */

// ---------------------------------------------------------------------------
// The vocabulary
// ---------------------------------------------------------------------------

/**
 * What can start a journey.
 *
 * Strings rather than a Prisma enum, and the reasoning is in
 * `docs/automations.md`: the graph is JSON either way, so an enum would put
 * half the vocabulary in the schema and half in code and make adding a block a
 * migration.
 *
 * Two groups, and the difference decides who fires them. **Event triggers** are
 * fired by the code that caused them — an order transitioning, a tag being
 * applied. **Time triggers** have no event to hang off and are found by the
 * sweep scanning for customers who now qualify.
 */
export const EVENT_TRIGGERS = [
  "ORDER_PLACED",
  "FIRST_ORDER",
  "ORDER_FULFILLED",
  "ORDER_CANCELED",
  "ORDER_REFUNDED",
  "CUSTOMER_CREATED",
  "TAG_ADDED",
  "TAG_REMOVED",
  "OPTED_IN",
  "MANUAL",
  "WEBHOOK",
] as const;

export const TIME_TRIGGERS = ["LAPSED", "ANNIVERSARY"] as const;

export const TRIGGER_KINDS = [...EVENT_TRIGGERS, ...TIME_TRIGGERS] as const;
export type TriggerKind = (typeof TRIGGER_KINDS)[number];

export function isTriggerKind(v: string): v is TriggerKind {
  return (TRIGGER_KINDS as readonly string[]).includes(v);
}

/**
 * How a trigger reads to an owner.
 *
 * Here rather than beside the canvas that draws them, and the reason is a
 * production outage rather than tidiness. This lived in `FlowCanvas.tsx`, which
 * carries `"use client"`, and three **server** components imported it to label
 * a table cell. A plain object imported from a client module across the RSC
 * boundary is not the object — the bundler hands the server a client reference
 * proxy, which then fails to serialize:
 *
 *   Could not find the module ".../FlowCanvas.tsx#TRIGGER_LABELS#FIRST_ORDER"
 *   in the React Client Manifest.
 *
 * `tsc` says nothing, the build is green, and it fails at request time on the
 * three pages nobody was looking at. Same shape as the `server-only` rule in
 * `CLAUDE.md`, pointing the other way: **a value both sides need lives in a
 * pure module, and neither side owns it.**
 *
 * Keyed by `string` rather than `TriggerKind` on purpose — every caller reads a
 * trigger off a database row and falls back to the raw value, so a trigger
 * added to the schema before this map is a slightly ugly label, not a crash.
 */
export const TRIGGER_LABELS: Record<string, string> = {
  ORDER_PLACED: "Any order is placed",
  FIRST_ORDER: "Someone orders for the first time",
  ORDER_FULFILLED: "An order is picked up",
  ORDER_CANCELED: "An order is canceled",
  ORDER_REFUNDED: "An order is refunded",
  CUSTOMER_CREATED: "A new customer appears",
  TAG_ADDED: "A tag is added",
  TAG_REMOVED: "A tag is removed",
  OPTED_IN: "Someone opts into texts",
  LAPSED: "Someone hasn't ordered in a while",
  ANNIVERSARY: "Anniversary of their first order",
  MANUAL: "You add them by hand",
  WEBHOOK: "Another system calls us",
};

export function isTimeTrigger(v: string): boolean {
  return (TIME_TRIGGERS as readonly string[]).includes(v);
}

/** Every node kind, trigger included. The trigger is a node so the canvas has
 *  something to draw and so the entry point is addressable like anything else. */
export const NODE_KINDS = [
  "TRIGGER",
  "SEND_SMS",
  "SEND_EMAIL",
  "WAIT",
  "WAIT_UNTIL",
  "IF_ELSE",
  "SPLIT",
  "ADD_TAG",
  "REMOVE_TAG",
  "GOAL",
  "NOTIFY_OWNER",
  "WEBHOOK_OUT",
  "EXIT",
] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

export function isNodeKind(v: string): v is NodeKind {
  return (NODE_KINDS as readonly string[]).includes(v);
}

/** Owner-facing labels and one-line explanations, used by both builders. */
export const NODE_META: Record<NodeKind, { label: string; blurb: string; group: "trigger" | "send" | "wait" | "logic" | "action" }> = {
  TRIGGER: { label: "Trigger", blurb: "What starts this journey.", group: "trigger" },
  SEND_SMS: { label: "Send text", blurb: "Only to customers who opted in.", group: "send" },
  SEND_EMAIL: { label: "Send email", blurb: "Skips anyone who unsubscribed.", group: "send" },
  WAIT: { label: "Wait", blurb: "Pause for a set amount of time.", group: "wait" },
  WAIT_UNTIL: { label: "Wait until", blurb: "Pause until something is true, or give up.", group: "wait" },
  IF_ELSE: { label: "If / else", blurb: "Two paths, one condition.", group: "logic" },
  SPLIT: { label: "A / B split", blurb: "Send people down two paths to compare them.", group: "logic" },
  ADD_TAG: { label: "Add tag", blurb: "Tag the customer.", group: "action" },
  REMOVE_TAG: { label: "Remove tag", blurb: "Untag the customer.", group: "action" },
  GOAL: { label: "Goal", blurb: "They did the thing. Record it and stop.", group: "logic" },
  NOTIFY_OWNER: { label: "Notify me", blurb: "Email the restaurant, not the customer.", group: "action" },
  WEBHOOK_OUT: { label: "Call a webhook", blurb: "POST to another system.", group: "action" },
  EXIT: { label: "Exit", blurb: "End the journey here.", group: "logic" },
};

/**
 * Which outgoing ports a node has.
 *
 * The validator uses this rather than counting edges, so "an IF_ELSE with only
 * a true branch" is a specific, nameable error instead of a journey that
 * silently ends for half the people who enter it.
 */
export const NODE_PORTS: Record<NodeKind, string[]> = {
  TRIGGER: ["out"],
  SEND_SMS: ["out"],
  SEND_EMAIL: ["out"],
  WAIT: ["out"],
  WAIT_UNTIL: ["met", "timeout"],
  IF_ELSE: ["true", "false"],
  SPLIT: ["a", "b"],
  ADD_TAG: ["out"],
  REMOVE_TAG: ["out"],
  GOAL: [],
  NOTIFY_OWNER: ["out"],
  WEBHOOK_OUT: ["out"],
  EXIT: [],
};

// ---------------------------------------------------------------------------
// The graph
// ---------------------------------------------------------------------------

export type DurationUnit = "minutes" | "hours" | "days";

export type Comparator =
  | "eq"
  | "ne"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "contains"
  | "is_set"
  | "not_set";

export const CONDITION_FIELDS = [
  "orderCount",
  "lifetimeCts",
  "daysSinceLastOrder",
  "daysSinceFirstOrder",
  "optInStatus",
  "emailSubscribed",
  "hasTag",
  "cohort",
  "name",
  "email",
  "phone",
  "variant",
  "orderTotalCts",
] as const;
export type ConditionField = (typeof CONDITION_FIELDS)[number];

export type Rule = { field: ConditionField; op: Comparator; value?: string | number | boolean };
export type Condition = { match: "all" | "any"; rules: Rule[] };

/**
 * Node configuration.
 *
 * Every field optional, deliberately. A graph is JSON that may have been saved
 * before a field existed, and the same contract `Campaign.audienceQuery`
 * carries applies: a graph saved against an older vocabulary should degrade
 * into something the validator can explain, not throw on read. The validator is
 * where the requirements are enforced, in one place, with a sentence per
 * failure.
 */
export type NodeConfig = {
  // Trigger
  trigger?: string;
  tagSlug?: string;
  lapsedDays?: number;
  anniversaryDays?: number;

  // Sends
  body?: string;
  subject?: string;

  // Waits
  amount?: number;
  unit?: DurationUnit;
  timeoutAmount?: number;
  timeoutUnit?: DurationUnit;

  // Logic
  condition?: Condition;
  weightA?: number;
  weightB?: number;

  // Actions
  url?: string;
  note?: string;
  exitReason?: string;
};

export type FlowNode = {
  id: string;
  kind: NodeKind;
  /** Canvas position. Presentation only — the runtime never reads these. */
  x: number;
  y: number;
  config: NodeConfig;
};

export type FlowEdge = { id: string; from: string; port: string; to: string };

export type Graph = { nodes: FlowNode[]; edges: FlowEdge[] };

export const EMPTY_GRAPH: Graph = { nodes: [], edges: [] };

/**
 * The ceiling on graph size.
 *
 * Not a technical limit. A journey with sixty boxes in it is one nobody can
 * read, including the person who drew it, and every box is a message going to
 * somebody's customers. A cap is the cheapest possible version of that
 * conversation.
 */
export const MAX_NODES = 60;

/**
 * How many nodes one enrollment may traverse, ever.
 *
 * The second belt on the acyclic check. A cycle that slipped past validation —
 * through a template import, a hand-edited blob, a bug in this file — is an
 * infinite loop that sends a message every time round. This turns that into a
 * stuck enrollment carrying an error, which somebody notices, instead of a
 * phone ringing all night.
 */
export const MAX_STEPS_PER_ENROLLMENT = 200;

/** How many nodes one drain pass may walk for one enrollment before yielding.
 *  Bounded so one pathological journey can't starve every other tenant's. */
export const MAX_STEPS_PER_PASS = 25;

/**
 * Parses whatever came out of the JSON column into a graph.
 *
 * Tolerant on purpose: unknown node kinds and dangling edges are dropped here
 * rather than thrown on, because the alternative is a page that 500s instead of
 * showing an owner the journey they need to fix. What survives this is then
 * held to the full standard by `validateGraph`.
 */
export function parseGraph(input: unknown): Graph {
  if (!input || typeof input !== "object") return { nodes: [], edges: [] };
  const raw = input as { nodes?: unknown; edges?: unknown };

  const nodes: FlowNode[] = Array.isArray(raw.nodes)
    ? raw.nodes.flatMap((n) => {
        if (!n || typeof n !== "object") return [];
        const o = n as Record<string, unknown>;
        const id = typeof o.id === "string" ? o.id : "";
        const kind = typeof o.kind === "string" ? o.kind : "";
        if (!id || !isNodeKind(kind)) return [];
        return [
          {
            id,
            kind,
            x: Number.isFinite(Number(o.x)) ? Number(o.x) : 0,
            y: Number.isFinite(Number(o.y)) ? Number(o.y) : 0,
            config: (o.config && typeof o.config === "object" ? o.config : {}) as NodeConfig,
          },
        ];
      })
    : [];

  const ids = new Set(nodes.map((n) => n.id));

  const edges: FlowEdge[] = Array.isArray(raw.edges)
    ? raw.edges.flatMap((e) => {
        if (!e || typeof e !== "object") return [];
        const o = e as Record<string, unknown>;
        const from = typeof o.from === "string" ? o.from : "";
        const to = typeof o.to === "string" ? o.to : "";
        if (!ids.has(from) || !ids.has(to)) return [];
        return [
          {
            id: typeof o.id === "string" && o.id ? o.id : `${from}:${String(o.port ?? "out")}:${to}`,
            from,
            to,
            port: typeof o.port === "string" && o.port ? o.port : "out",
          },
        ];
      })
    : [];

  return { nodes, edges };
}

export function findNode(graph: Graph, id: string | null | undefined): FlowNode | null {
  if (!id) return null;
  return graph.nodes.find((n) => n.id === id) ?? null;
}

export function triggerNode(graph: Graph): FlowNode | null {
  return graph.nodes.find((n) => n.kind === "TRIGGER") ?? null;
}

/**
 * Where a journey goes next.
 *
 * **One implementation, used by the canvas and by the runtime.** Two would mean
 * an owner watching a journey take a branch that the picture on their screen
 * says it shouldn't, and there is no way to win the support call that follows —
 * the same reasoning that made the admin analytics drilldown render the owner's
 * components.
 *
 * Null means "the journey ends here", which is an ordinary outcome: an owner
 * who left a port unconnected has drawn an ending.
 */
export function nextNodeId(graph: Graph, fromId: string, port = "out"): string | null {
  return graph.edges.find((e) => e.from === fromId && e.port === port)?.to ?? null;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type GraphError = {
  /** The node it belongs to, so the canvas can put the marker on the box. Null
   *  for errors about the graph as a whole. */
  nodeId: string | null;
  message: string;
};

/**
 * Everything a graph must satisfy before it may be activated.
 *
 * Each branch here is a real failure mode with a real cost, so each returns a
 * sentence an owner can act on rather than a code:
 *
 *   - **No trigger, or more than one.** Two entry points is two journeys
 *     wearing one name, and the runtime would have to pick one.
 *   - **A cycle.** An infinite loop that sends a message every time round. The
 *     step budget catches it at runtime; this catches it before anyone is in it.
 *   - **An unreachable node.** Almost always a box the owner thinks is running
 *     and which nothing connects to. Silently ignoring it means they believe
 *     they sent a follow-up they never sent.
 *   - **An unbounded WAIT_UNTIL.** An enrollment that sits in the database
 *     forever; a thousand of them is a sweep that gets slower every week for a
 *     reason nobody can find.
 *   - **An oversized SMS.** Billed per segment, per person, forever, on a
 *     journey nobody is watching. This one is worse than the campaign version
 *     of the same mistake, which at least stops after one send.
 */
export function validateGraph(graph: Graph, restaurantName = "the restaurant"): GraphError[] {
  const errors: GraphError[] = [];

  const triggers = graph.nodes.filter((n) => n.kind === "TRIGGER");
  if (triggers.length === 0) {
    errors.push({ nodeId: null, message: "This journey has no trigger, so nothing would ever start it." });
  } else if (triggers.length > 1) {
    errors.push({ nodeId: null, message: "There's more than one trigger. A journey has exactly one starting point." });
  }

  const trigger = triggers[0];
  if (trigger) {
    const kind = trigger.config.trigger ?? "";
    if (!isTriggerKind(kind)) {
      errors.push({ nodeId: trigger.id, message: "Pick what starts this journey." });
    }
    if ((kind === "TAG_ADDED" || kind === "TAG_REMOVED") && !trigger.config.tagSlug) {
      errors.push({ nodeId: trigger.id, message: "Pick which tag this watches for." });
    }
    if (kind === "LAPSED" && !(Number(trigger.config.lapsedDays) > 0)) {
      errors.push({ nodeId: trigger.id, message: "Say how many days without an order counts as lapsed." });
    }
  }

  if (graph.nodes.length > MAX_NODES) {
    errors.push({
      nodeId: null,
      message: `That's ${graph.nodes.length} steps — the limit is ${MAX_NODES}. A journey nobody can read is one nobody can check.`,
    });
  }

  // Duplicate ids would make nextNodeId ambiguous and the canvas unselectable.
  const seen = new Set<string>();
  for (const n of graph.nodes) {
    if (seen.has(n.id)) errors.push({ nodeId: n.id, message: "Two steps share an id." });
    seen.add(n.id);
  }

  for (const n of graph.nodes) {
    errors.push(...validateNode(n, restaurantName));

    // A port with two edges out of it: the runtime takes the first, which is
    // whichever happened to be saved first — an arbitrary choice presented to
    // the owner as a drawing.
    for (const port of NODE_PORTS[n.kind]) {
      const outs = graph.edges.filter((e) => e.from === n.id && e.port === port);
      if (outs.length > 1) {
        errors.push({ nodeId: n.id, message: `“${portLabel(n.kind, port)}” leads to more than one place.` });
      }
    }

    if (n.kind === "IF_ELSE") {
      const t = nextNodeId(graph, n.id, "true");
      const f = nextNodeId(graph, n.id, "false");
      if (!t && !f) errors.push({ nodeId: n.id, message: "Neither branch of this condition goes anywhere." });
    }
  }

  if (trigger) {
    const reachable = reachableFrom(graph, trigger.id);
    for (const n of graph.nodes) {
      if (n.id !== trigger.id && !reachable.has(n.id)) {
        errors.push({
          nodeId: n.id,
          message: "Nothing connects to this step, so it will never run. Connect it or delete it.",
        });
      }
    }
    if (hasCycle(graph)) {
      errors.push({
        nodeId: null,
        message: "These steps loop back on themselves. A journey has to end, or it would keep messaging the same person.",
      });
    }
  }

  return errors;
}

function validateNode(n: FlowNode, restaurantName: string): GraphError[] {
  const errors: GraphError[] = [];
  const c = n.config;
  const err = (message: string) => errors.push({ nodeId: n.id, message });

  switch (n.kind) {
    case "SEND_SMS": {
      const body = (c.body ?? "").trim();
      if (!body) err("This text has no message in it.");
      else {
        const len = smsLength(worstCaseBody(body, restaurantName));
        if (len.segments > MAX_SMS_SEGMENTS) {
          err(
            `That's ${len.segments} text segments — the limit is ${MAX_SMS_SEGMENTS}. You're charged per segment, per person, every time this runs.`,
          );
        }
      }
      break;
    }
    case "SEND_EMAIL": {
      if (!(c.subject ?? "").trim()) err("Email needs a subject line.");
      else if ((c.subject ?? "").trim().length > MAX_EMAIL_SUBJECT) err("That subject line is too long.");
      if (!(c.body ?? "").trim()) err("This email has no message in it.");
      else if ((c.body ?? "").length > MAX_EMAIL_BODY) err("That email is too long.");
      break;
    }
    case "WAIT": {
      if (!(Number(c.amount) > 0)) err("Say how long to wait.");
      break;
    }
    case "WAIT_UNTIL": {
      if (!c.condition || c.condition.rules.length === 0) err("Say what this is waiting for.");
      // The one requirement worth stating loudly. See docs/automations.md.
      if (!(Number(c.timeoutAmount) > 0)) {
        err("Give this a time limit. Without one, anyone who never does it stays in the journey forever.");
      }
      break;
    }
    case "IF_ELSE": {
      if (!c.condition || c.condition.rules.length === 0) err("This condition is empty, so everyone would take the same branch.");
      break;
    }
    case "SPLIT": {
      const a = Number(c.weightA ?? 50);
      const b = Number(c.weightB ?? 50);
      if (!(a >= 0 && b >= 0 && a + b > 0)) err("The two sides of the split have to add up to something.");
      break;
    }
    case "ADD_TAG":
    case "REMOVE_TAG": {
      if (!(c.tagSlug ?? "").trim()) err("Pick a tag.");
      break;
    }
    case "WEBHOOK_OUT": {
      const url = (c.url ?? "").trim();
      if (!url) err("Give this a URL to call.");
      else if (!/^https:\/\//i.test(url)) {
        // https only, checked here so the owner is told at draw time. The
        // actual network fence is `lib/net-guard.ts` at call time — a check in
        // a form is a courtesy, never a security boundary.
        err("Webhook URLs have to start with https://.");
      }
      break;
    }
    default:
      break;
  }

  for (const rule of n.config.condition?.rules ?? []) {
    if (!(CONDITION_FIELDS as readonly string[]).includes(rule.field)) {
      err("One of the conditions refers to something that no longer exists.");
      break;
    }
    const needsValue = rule.op !== "is_set" && rule.op !== "not_set";
    if (needsValue && (rule.value === undefined || rule.value === "")) {
      err("One of the conditions is missing a value.");
      break;
    }
  }

  return errors;
}

export function portLabel(kind: NodeKind, port: string): string {
  if (kind === "IF_ELSE") return port === "true" ? "Yes" : "No";
  if (kind === "SPLIT") return port === "a" ? "A" : "B";
  if (kind === "WAIT_UNTIL") return port === "met" ? "They did it" : "Time ran out";
  return "Next";
}

/** Every node you can get to from `startId`, following edges forward. */
export function reachableFrom(graph: Graph, startId: string): Set<string> {
  const seen = new Set<string>();
  const stack = [startId];
  while (stack.length) {
    const id = stack.pop()!;
    for (const e of graph.edges) {
      if (e.from !== id || seen.has(e.to)) continue;
      seen.add(e.to);
      stack.push(e.to);
    }
  }
  return seen;
}

/** Depth-first with a colouring, so a diamond — two branches rejoining — is
 *  correctly *not* a cycle. A naive visited-set says it is, and rejoining
 *  branches are the most ordinary shape an owner draws. */
export function hasCycle(graph: Graph): boolean {
  const state = new Map<string, 0 | 1 | 2>();
  const out = new Map<string, string[]>();
  for (const e of graph.edges) {
    out.set(e.from, [...(out.get(e.from) ?? []), e.to]);
  }

  const visit = (id: string): boolean => {
    const s = state.get(id) ?? 0;
    if (s === 1) return true;
    if (s === 2) return false;
    state.set(id, 1);
    for (const next of out.get(id) ?? []) {
      if (visit(next)) return true;
    }
    state.set(id, 2);
    return false;
  };

  for (const n of graph.nodes) {
    if (visit(n.id)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------

/**
 * The customer, flattened to exactly what a condition may read.
 *
 * A flat shape rather than the Prisma row, for two reasons. It keeps this
 * module free of `@prisma/client` so it runs in the browser, and it makes the
 * set of things a condition can see an explicit, reviewable list — which is the
 * same instinct behind `VisitEvent` having typed columns rather than a JSON bag.
 */
export type FlowCustomer = {
  name: string | null;
  email: string | null;
  phone: string | null;
  optInStatus: string;
  emailSubscribed: boolean;
  cohort: string;
  orderCount: number;
  lifetimeCts: number;
  firstOrderAtMs: number | null;
  lastOrderAtMs: number | null;
  /** Tag slugs. Slugs rather than names, because `lib/customers.ts` treats the
   *  slug as the identity — "VIP" and "vip" are one tag. */
  tagSlugs: string[];
};

/** Anything the trigger or an earlier node computed. */
export type FlowContext = Record<string, string | number | boolean | null | undefined>;

export type EvalInput = {
  customer: FlowCustomer;
  context: FlowContext;
  variant: string | null;
  nowMs: number;
};

const DAY_MS = 86_400_000;

function fieldValue(field: ConditionField, input: EvalInput): string | number | boolean | null {
  const c = input.customer;
  switch (field) {
    case "orderCount":
      return c.orderCount;
    case "lifetimeCts":
      return c.lifetimeCts;
    case "daysSinceLastOrder":
      return c.lastOrderAtMs === null ? null : Math.floor((input.nowMs - c.lastOrderAtMs) / DAY_MS);
    case "daysSinceFirstOrder":
      return c.firstOrderAtMs === null ? null : Math.floor((input.nowMs - c.firstOrderAtMs) / DAY_MS);
    case "optInStatus":
      return c.optInStatus;
    case "emailSubscribed":
      return c.emailSubscribed;
    case "cohort":
      return c.cohort;
    case "name":
      return c.name;
    case "email":
      return c.email;
    case "phone":
      return c.phone;
    case "variant":
      return input.variant;
    case "hasTag":
      // Handled in evaluateRule, which needs the rule's value to answer.
      return null;
    case "orderTotalCts": {
      const v = input.context.orderTotalCts;
      return typeof v === "number" ? v : null;
    }
    default:
      return null;
  }
}

export function evaluateRule(rule: Rule, input: EvalInput): boolean {
  if (rule.field === "hasTag") {
    const slug = String(rule.value ?? "").trim();
    const has = !!slug && input.customer.tagSlugs.includes(slug);
    // `ne` reads as "doesn't have it", which is what an owner means by picking
    // it. Every other operator on a tag is nonsense and is treated as "has".
    return rule.op === "ne" || rule.op === "not_set" ? !has : has;
  }

  const actual = fieldValue(rule.field, input);

  if (rule.op === "is_set") return actual !== null && actual !== undefined && actual !== "";
  if (rule.op === "not_set") return actual === null || actual === undefined || actual === "";

  // A null on either side of a comparison is *not* a match, including for `ne`.
  //
  // This is the same NULL semantics the "lapsed" customer filter uses, and it
  // matters most for `daysSinceLastOrder`: a customer who has never ordered has
  // no answer to "how long since their last order", and treating that as
  // "infinitely long" would sweep every never-ordered customer into a win-back
  // journey aimed at people who used to come in.
  if (actual === null || actual === undefined) return false;

  const raw = rule.value;

  if (typeof actual === "number") {
    const want = Number(raw);
    if (!Number.isFinite(want)) return false;
    switch (rule.op) {
      case "eq": return actual === want;
      case "ne": return actual !== want;
      case "gt": return actual > want;
      case "gte": return actual >= want;
      case "lt": return actual < want;
      case "lte": return actual <= want;
      default: return false;
    }
  }

  if (typeof actual === "boolean") {
    const want = raw === true || raw === "true" || raw === 1 || raw === "1";
    return rule.op === "ne" ? actual !== want : actual === want;
  }

  const a = String(actual).toLowerCase();
  const b = String(raw ?? "").toLowerCase();
  switch (rule.op) {
    case "eq": return a === b;
    case "ne": return a !== b;
    case "contains": return a.includes(b);
    default: return false;
  }
}

/**
 * An empty condition is **false**, not true.
 *
 * The opposite default reads as "no restrictions, so everybody", which is the
 * reasonable-sounding choice that turns a half-configured IF_ELSE into a text
 * to the whole list. Failing closed here matches `lib/booking-slots.ts` and
 * disagrees with `lib/hours.ts` for the same reason it does: the cost of the
 * wrong answer is not symmetric.
 */
export function evaluateCondition(condition: Condition | undefined, input: EvalInput): boolean {
  const rules = condition?.rules ?? [];
  if (rules.length === 0) return false;
  return condition!.match === "any"
    ? rules.some((r) => evaluateRule(r, input))
    : rules.every((r) => evaluateRule(r, input));
}

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

export function durationMs(amount: number | undefined, unit: DurationUnit | undefined): number {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return 0;
  switch (unit) {
    case "minutes": return n * 60_000;
    case "hours": return n * 3_600_000;
    default: return n * DAY_MS;
  }
}

export function describeDuration(amount: number | undefined, unit: DurationUnit | undefined): string {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return "no time";
  const u = unit ?? "days";
  return `${n} ${n === 1 ? u.replace(/s$/, "") : u}`;
}

export type QuietHours = { startMin: number; endMin: number; timezone: string };

/** Whether a wall-clock minute falls inside the window. Windows that wrap past
 *  midnight are supported because `lib/hours.ts` supports overnight intervals
 *  and an owner who sets 20:00–09:00 has said something coherent. */
export function withinQuietWindow(minutes: number, startMin: number, endMin: number): boolean {
  if (startMin === endMin) return true; // A zero-width window means "any time".
  if (startMin < endMin) return minutes >= startMin && minutes < endMin;
  return minutes >= startMin || minutes < endMin;
}

/**
 * When a message scheduled for `atMs` may actually go out.
 *
 * A campaign is sent when a human presses a button, so a human is implicitly
 * deciding it's a reasonable hour. An automation's wait can land at 3am. A text
 * at 3am is a TCPA problem and a complaint generator, and complaints are what
 * get a sending number filtered — which takes the tenant's order notifications
 * down with it.
 *
 * The loop is the DST handling and is the reason this isn't one arithmetic
 * expression. Adding "the number of minutes until 9am" to a timestamp is right
 * 363 days a year and an hour out on the other two, and the symptom — a message
 * arriving at 8am on one Sunday in spring — is not something anybody
 * reproduces. So we add the offset, look at the local clock again, and correct.
 * Three passes is comfortably enough for a one-hour shift.
 */
export function nextSendTimeMs(atMs: number, quiet: QuietHours): number {
  let candidate = atMs;
  for (let pass = 0; pass < 3; pass++) {
    const local = localNow(new Date(candidate), quiet.timezone);
    if (withinQuietWindow(local.minutes, quiet.startMin, quiet.endMin)) return candidate;
    const delta = (quiet.startMin - local.minutes + 1440) % 1440;
    candidate += (delta === 0 ? 1440 : delta) * 60_000;
  }
  return candidate;
}

// ---------------------------------------------------------------------------
// Splits
// ---------------------------------------------------------------------------

/** FNV-1a. Small, dependency-free, and good enough to spread ids evenly. */
function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Which side of a split a customer lands on.
 *
 * Deterministic from the enrollment id rather than random, so the same
 * enrollment re-evaluated after a crashed pass lands in the same place. A
 * random draw would let a retry move somebody from A to B halfway through and
 * quietly corrupt the comparison the owner is running the split to make.
 */
export function assignVariant(seed: string, weightA = 50, weightB = 50): "a" | "b" {
  const a = Math.max(0, Number(weightA) || 0);
  const b = Math.max(0, Number(weightB) || 0);
  if (a + b <= 0) return "a";
  return hash32(seed) % (a + b) < a ? "a" : "b";
}

// ---------------------------------------------------------------------------
// Exit reasons
// ---------------------------------------------------------------------------

/**
 * Owner-facing wording, in the same spirit as `SKIP_REASON_LABELS`: a bare
 * enum value on a screen reads as the platform being broken, where a sentence
 * reads as the journey working.
 */
export const EXIT_REASON_LABELS: Record<string, string> = {
  completed: "Reached the end of the journey",
  goal: "Did the thing the journey was for",
  exit_block: "Hit an Exit step",
  timeout: "Waited as long as the journey allows",
  canceled_by_owner: "Stopped by you",
  automation_archived: "The journey was archived",
  step_budget: "Stopped for safety — this journey may loop",
  customer_removed: "Customer record was removed",
  failed: "Something went wrong and the journey stopped",
};

export function exitReasonLabel(reason: string | null): string {
  if (!reason) return "Still going";
  return EXIT_REASON_LABELS[reason] ?? reason;
}

// ---------------------------------------------------------------------------
// Starter graphs
// ---------------------------------------------------------------------------

/** A one-node graph, so a new automation opens on a canvas with a trigger on it
 *  rather than an empty screen with no obvious first move. */
export function starterGraph(trigger: TriggerKind = "FIRST_ORDER"): Graph {
  return {
    nodes: [{ id: "trigger", kind: "TRIGGER", x: 80, y: 80, config: { trigger } }],
    edges: [],
  };
}

/**
 * Every tag slug a graph refers to — in tag triggers, and in ADD_TAG /
 * REMOVE_TAG steps.
 *
 * Exists for template adoption: an ADD_TAG step in a preset silently does
 * nothing on every tenant that never happened to invent that tag, and a step
 * that quietly no-ops is worse than one that errors, because the owner believes
 * their journey is segmenting people and it isn't.
 */
export function tagSlugsIn(graph: Graph): string[] {
  const slugs = new Set<string>();
  for (const n of graph.nodes) {
    const s = (n.config.tagSlug ?? "").trim();
    if (s) slugs.add(s);
    for (const rule of n.config.condition?.rules ?? []) {
      if (rule.field === "hasTag" && rule.value) slugs.add(String(rule.value).trim());
    }
  }
  return [...slugs].filter(Boolean);
}

export function newNodeId(existing: Graph, kind: NodeKind): string {
  const base = kind.toLowerCase();
  let i = 1;
  while (existing.nodes.some((n) => n.id === `${base}_${i}`)) i++;
  return `${base}_${i}`;
}
