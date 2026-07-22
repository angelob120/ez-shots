/**
 * Tests for the pure half of automations.
 *
 * Five groups, each guarding something that fails quietly and expensively:
 *
 *   1. **The validator's absent-graph cases.** A cycle is an infinite loop
 *      that sends a message every time round; an unbounded WAIT_UNTIL is an
 *      enrollment that never leaves the database; an unreachable node is a
 *      follow-up the owner believes they are sending and isn't. None of the
 *      three is visible in the drawing.
 *   2. **Condition evaluation, and specifically its NULLs.** A customer who
 *      has never ordered has no answer to "days since last order", and
 *      treating that as infinity sweeps every never-ordered customer into a
 *      win-back journey aimed at regulars. The empty-condition default is
 *      asserted directly for the same reason `booking-slots` asserts its
 *      fail-closed default: it looks like an oversight and inverting it sends
 *      the message to everybody.
 *   3. **Quiet hours across a DST boundary.** A single-pass offset conversion
 *      is right 363 days a year and an hour out on the other two, and the
 *      symptom — one text arriving at 8am on a Sunday in spring — is not
 *      something anybody reproduces.
 *   4. **Split assignment.** Deterministic from the enrollment id, because a
 *      retry after a crashed pass that moved somebody from A to B silently
 *      corrupts the comparison the split exists to make.
 *   5. **Graph parsing.** The tolerant reader has to drop junk without
 *      throwing, because the alternative is a 500 instead of a page telling an
 *      owner what to fix.
 *
 * Pure — no Prisma, no request context.
 *
 *   npx tsx scripts/automation-flow.test.ts
 */

import assert from "node:assert/strict";
import {
  MAX_NODES,
  assignVariant,
  durationMs,
  evaluateCondition,
  evaluateRule,
  hasCycle,
  isTimeTrigger,
  isTriggerKind,
  nextNodeId,
  nextSendTimeMs,
  parseGraph,
  reachableFrom,
  starterGraph,
  tagSlugsIn,
  validateGraph,
  withinQuietWindow,
  type Condition,
  type EvalInput,
  type FlowCustomer,
  type FlowNode,
  type Graph,
} from "../src/lib/automation-flow";

let passed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
  } catch (err) {
    console.error(`FAIL: ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function node(id: string, kind: FlowNode["kind"], config: FlowNode["config"] = {}): FlowNode {
  return { id, kind, x: 0, y: 0, config };
}

function graph(nodes: FlowNode[], edges: Array<[string, string, string?]>): Graph {
  return {
    nodes,
    edges: edges.map(([from, to, port]) => ({ id: `${from}-${to}`, from, to, port: port ?? "out" })),
  };
}

const customer: FlowCustomer = {
  name: "Ada",
  email: "ada@example.com",
  phone: "+15551230000",
  optInStatus: "OPTED_IN",
  emailSubscribed: true,
  cohort: "TREATMENT",
  orderCount: 4,
  lifetimeCts: 12_000,
  firstOrderAtMs: Date.parse("2025-01-01T12:00:00Z"),
  lastOrderAtMs: Date.parse("2025-06-01T12:00:00Z"),
  tagSlugs: ["vip"],
};

const NOW = Date.parse("2025-07-01T12:00:00Z");

function input(over: Partial<FlowCustomer> = {}, ctx: EvalInput["context"] = {}): EvalInput {
  return { customer: { ...customer, ...over }, context: ctx, variant: null, nowMs: NOW };
}

function valid(): Graph {
  return graph(
    [
      node("t", "TRIGGER", { trigger: "FIRST_ORDER" }),
      node("s", "SEND_SMS", { body: "Thanks for trying us, {{name}}." }),
      node("w", "WAIT", { amount: 3, unit: "days" }),
      node("e", "EXIT", {}),
    ],
    [
      ["t", "s"],
      ["s", "w"],
      ["w", "e"],
    ],
  );
}

// ---------------------------------------------------------------------------
// 1. Validation
// ---------------------------------------------------------------------------

test("a straightforward journey validates", () => {
  assert.deepEqual(validateGraph(valid()), []);
});

test("no trigger is an error", () => {
  const g = valid();
  g.nodes = g.nodes.filter((n) => n.kind !== "TRIGGER");
  g.edges = g.edges.filter((e) => e.from !== "t");
  assert.ok(validateGraph(g).some((e) => /no trigger/i.test(e.message)));
});

test("two triggers is an error — two entry points is two journeys", () => {
  const g = valid();
  g.nodes.push(node("t2", "TRIGGER", { trigger: "ORDER_PLACED" }));
  assert.ok(validateGraph(g).some((e) => /more than one trigger/i.test(e.message)));
});

test("a trigger with no kind picked is an error", () => {
  const g = graph([node("t", "TRIGGER", {})], []);
  assert.ok(validateGraph(g).some((e) => e.nodeId === "t"));
});

test("a tag trigger with no tag is an error", () => {
  const g = graph([node("t", "TRIGGER", { trigger: "TAG_ADDED" })], []);
  assert.ok(validateGraph(g).some((e) => /which tag/i.test(e.message)));
});

test("a LAPSED trigger with no day count is an error", () => {
  const g = graph([node("t", "TRIGGER", { trigger: "LAPSED" })], []);
  assert.ok(validateGraph(g).some((e) => /lapsed/i.test(e.message)));
});

test("a cycle is rejected — this is the infinite send loop", () => {
  const g = graph(
    [
      node("t", "TRIGGER", { trigger: "ORDER_PLACED" }),
      node("a", "SEND_SMS", { body: "hi" }),
      node("b", "WAIT", { amount: 1, unit: "days" }),
    ],
    [
      ["t", "a"],
      ["a", "b"],
      ["b", "a"],
    ],
  );
  assert.ok(validateGraph(g).some((e) => /loop back/i.test(e.message)));
});

test("two branches rejoining is NOT a cycle — it's the most ordinary shape there is", () => {
  const g = graph(
    [
      node("t", "TRIGGER", { trigger: "ORDER_PLACED" }),
      node("q", "IF_ELSE", { condition: { match: "all", rules: [{ field: "orderCount", op: "gte", value: 2 }] } }),
      node("a", "SEND_SMS", { body: "regular" }),
      node("b", "SEND_SMS", { body: "new" }),
      node("z", "EXIT", {}),
    ],
    [
      ["t", "q"],
      ["q", "a", "true"],
      ["q", "b", "false"],
      ["a", "z"],
      ["b", "z"],
    ],
  );
  assert.equal(hasCycle(g), false);
  assert.deepEqual(validateGraph(g), []);
});

test("an unreachable node is an error, not silently ignored", () => {
  const g = valid();
  g.nodes.push(node("orphan", "SEND_SMS", { body: "nobody gets this" }));
  assert.ok(validateGraph(g).some((e) => e.nodeId === "orphan" && /never run/i.test(e.message)));
});

test("WAIT_UNTIL without a timeout is an error — the enrollment would never leave", () => {
  const g = graph(
    [
      node("t", "TRIGGER", { trigger: "ORDER_PLACED" }),
      node("w", "WAIT_UNTIL", { condition: { match: "all", rules: [{ field: "orderCount", op: "gte", value: 5 }] } }),
    ],
    [["t", "w"]],
  );
  assert.ok(validateGraph(g).some((e) => /time limit/i.test(e.message)));
});

test("WAIT_UNTIL with a timeout and a condition is fine", () => {
  const g = graph(
    [
      node("t", "TRIGGER", { trigger: "ORDER_PLACED" }),
      node("w", "WAIT_UNTIL", {
        condition: { match: "all", rules: [{ field: "orderCount", op: "gte", value: 5 }] },
        timeoutAmount: 14,
        timeoutUnit: "days",
      }),
    ],
    [["t", "w"]],
  );
  assert.deepEqual(validateGraph(g), []);
});

test("an empty SMS is an error", () => {
  const g = graph([node("t", "TRIGGER", { trigger: "ORDER_PLACED" }), node("s", "SEND_SMS", { body: "  " })], [["t", "s"]]);
  assert.ok(validateGraph(g).some((e) => e.nodeId === "s"));
});

test("an SMS over the segment limit is an error, counted against a worst-case merge", () => {
  const g = graph(
    [node("t", "TRIGGER", { trigger: "ORDER_PLACED" }), node("s", "SEND_SMS", { body: "x".repeat(700) })],
    [["t", "s"]],
  );
  assert.ok(validateGraph(g).some((e) => /segments/i.test(e.message)));
});

test("email with no subject is an error", () => {
  const g = graph(
    [node("t", "TRIGGER", { trigger: "ORDER_PLACED" }), node("m", "SEND_EMAIL", { body: "hello" })],
    [["t", "m"]],
  );
  assert.ok(validateGraph(g).some((e) => /subject/i.test(e.message)));
});

test("a webhook URL that isn't https is an error", () => {
  const g = graph(
    [node("t", "TRIGGER", { trigger: "ORDER_PLACED" }), node("h", "WEBHOOK_OUT", { url: "http://example.com/x" })],
    [["t", "h"]],
  );
  assert.ok(validateGraph(g).some((e) => /https/i.test(e.message)));
});

test("an IF_ELSE with neither branch connected is an error", () => {
  const g = graph(
    [
      node("t", "TRIGGER", { trigger: "ORDER_PLACED" }),
      node("q", "IF_ELSE", { condition: { match: "all", rules: [{ field: "orderCount", op: "gte", value: 1 }] } }),
    ],
    [["t", "q"]],
  );
  assert.ok(validateGraph(g).some((e) => /Neither branch/i.test(e.message)));
});

test("two edges from one port is an error — the runtime would pick arbitrarily", () => {
  const g = valid();
  g.edges.push({ id: "extra", from: "s", port: "out", to: "e" });
  assert.ok(validateGraph(g).some((e) => /more than one place/i.test(e.message)));
});

test("a graph over the node cap is an error", () => {
  const nodes = [node("t", "TRIGGER", { trigger: "ORDER_PLACED" })];
  const edges: Array<[string, string]> = [];
  for (let i = 0; i < MAX_NODES + 2; i++) {
    nodes.push(node(`n${i}`, "EXIT", {}));
    edges.push([i === 0 ? "t" : `n${i - 1}`, `n${i}`]);
  }
  assert.ok(validateGraph(graph(nodes, edges)).some((e) => /limit is/i.test(e.message)));
});

test("a condition rule missing its value is an error", () => {
  const g = graph(
    [
      node("t", "TRIGGER", { trigger: "ORDER_PLACED" }),
      node("q", "IF_ELSE", { condition: { match: "all", rules: [{ field: "orderCount", op: "gte" }] } }),
      node("a", "EXIT", {}),
    ],
    [
      ["t", "q"],
      ["q", "a", "true"],
    ],
  );
  assert.ok(validateGraph(g).some((e) => /missing a value/i.test(e.message)));
});

test("the starter graph is a trigger and nothing else", () => {
  const g = starterGraph("FIRST_ORDER");
  assert.equal(g.nodes.length, 1);
  assert.equal(g.nodes[0].kind, "TRIGGER");
});

// ---------------------------------------------------------------------------
// 2. Conditions
// ---------------------------------------------------------------------------

test("an empty condition is FALSE, not true — the opposite default texts everybody", () => {
  assert.equal(evaluateCondition(undefined, input()), false);
  assert.equal(evaluateCondition({ match: "all", rules: [] }, input()), false);
});

test("all vs any", () => {
  const c: Condition = {
    match: "all",
    rules: [
      { field: "orderCount", op: "gte", value: 2 },
      { field: "cohort", op: "eq", value: "HOLDOUT" },
    ],
  };
  assert.equal(evaluateCondition(c, input()), false);
  assert.equal(evaluateCondition({ ...c, match: "any" }, input()), true);
});

test("numeric comparators", () => {
  assert.equal(evaluateRule({ field: "orderCount", op: "gt", value: 3 }, input()), true);
  assert.equal(evaluateRule({ field: "orderCount", op: "gt", value: 4 }, input()), false);
  assert.equal(evaluateRule({ field: "orderCount", op: "gte", value: 4 }, input()), true);
  assert.equal(evaluateRule({ field: "orderCount", op: "lt", value: 5 }, input()), true);
  assert.equal(evaluateRule({ field: "orderCount", op: "lte", value: 4 }, input()), true);
  assert.equal(evaluateRule({ field: "orderCount", op: "eq", value: 4 }, input()), true);
  assert.equal(evaluateRule({ field: "orderCount", op: "ne", value: 4 }, input()), false);
});

test("a value that isn't a number never matches a numeric field", () => {
  assert.equal(evaluateRule({ field: "orderCount", op: "gt", value: "lots" }, input()), false);
});

test("daysSinceLastOrder is computed against now", () => {
  assert.equal(evaluateRule({ field: "daysSinceLastOrder", op: "gte", value: 29 }, input()), true);
  assert.equal(evaluateRule({ field: "daysSinceLastOrder", op: "gte", value: 31 }, input()), false);
});

test("a customer who never ordered does NOT match a lapsed condition", () => {
  const never = input({ lastOrderAtMs: null, orderCount: 0 });
  assert.equal(evaluateRule({ field: "daysSinceLastOrder", op: "gte", value: 60 }, never), false);
  // And not via the negation either — a null is not a match on any comparator.
  assert.equal(evaluateRule({ field: "daysSinceLastOrder", op: "ne", value: 5 }, never), false);
});

test("is_set and not_set read a null honestly", () => {
  assert.equal(evaluateRule({ field: "email", op: "is_set" }, input()), true);
  assert.equal(evaluateRule({ field: "email", op: "not_set" }, input()), false);
  assert.equal(evaluateRule({ field: "email", op: "is_set" }, input({ email: null })), false);
  assert.equal(evaluateRule({ field: "email", op: "not_set" }, input({ email: "" })), true);
});

test("hasTag matches on slug, and 'is not' means they don't have it", () => {
  assert.equal(evaluateRule({ field: "hasTag", op: "eq", value: "vip" }, input()), true);
  assert.equal(evaluateRule({ field: "hasTag", op: "eq", value: "lapsed" }, input()), false);
  assert.equal(evaluateRule({ field: "hasTag", op: "ne", value: "vip" }, input()), false);
  assert.equal(evaluateRule({ field: "hasTag", op: "ne", value: "lapsed" }, input()), true);
});

test("string comparison is case-insensitive, and contains works", () => {
  assert.equal(evaluateRule({ field: "name", op: "eq", value: "ADA" }, input()), true);
  assert.equal(evaluateRule({ field: "email", op: "contains", value: "EXAMPLE" }, input()), true);
});

test("booleans read from either a boolean or a string", () => {
  assert.equal(evaluateRule({ field: "emailSubscribed", op: "eq", value: "true" }, input()), true);
  assert.equal(evaluateRule({ field: "emailSubscribed", op: "eq", value: true }, input()), true);
  assert.equal(evaluateRule({ field: "emailSubscribed", op: "eq", value: "true" }, input({ emailSubscribed: false })), false);
});

test("order total comes from the trigger context, and is absent when the trigger didn't carry one", () => {
  assert.equal(evaluateRule({ field: "orderTotalCts", op: "gte", value: 2000 }, input({}, { orderTotalCts: 2500 })), true);
  assert.equal(evaluateRule({ field: "orderTotalCts", op: "gte", value: 2000 }, input()), false);
});

// ---------------------------------------------------------------------------
// 3. Time and quiet hours
// ---------------------------------------------------------------------------

test("durations convert", () => {
  assert.equal(durationMs(30, "minutes"), 1_800_000);
  assert.equal(durationMs(2, "hours"), 7_200_000);
  assert.equal(durationMs(1, "days"), 86_400_000);
  assert.equal(durationMs(0, "days"), 0);
  assert.equal(durationMs(-3, "days"), 0);
});

test("the quiet window, including one that wraps past midnight", () => {
  assert.equal(withinQuietWindow(600, 540, 1200), true);
  assert.equal(withinQuietWindow(300, 540, 1200), false);
  assert.equal(withinQuietWindow(1200, 540, 1200), false); // half-open, like every range in this repo
  assert.equal(withinQuietWindow(60, 1200, 540), true); // 20:00–09:00
  assert.equal(withinQuietWindow(700, 1200, 540), false);
  assert.equal(withinQuietWindow(700, 600, 600), true); // zero width means "any time"
});

const NY = { startMin: 540, endMin: 1200, timezone: "America/New_York" };

test("a send inside the window is not moved", () => {
  const at = Date.parse("2025-07-01T15:00:00Z"); // 11:00 in New York
  assert.equal(nextSendTimeMs(at, NY), at);
});

test("a 3am send is pushed to the start of the window the same morning", () => {
  const at = Date.parse("2025-07-01T07:00:00Z"); // 03:00 New York
  const out = new Date(nextSendTimeMs(at, NY));
  assert.equal(out.toISOString(), "2025-07-01T13:00:00.000Z"); // 09:00 New York
});

test("a late-evening send waits for the next morning, not the same one", () => {
  const at = Date.parse("2025-07-02T02:00:00Z"); // 22:00 on the 1st, New York
  const out = new Date(nextSendTimeMs(at, NY));
  assert.equal(out.toISOString(), "2025-07-02T13:00:00.000Z"); // 09:00 on the 2nd
});

test("spring forward: the deferral still lands at 09:00 local, not 08:00", () => {
  // 2025-03-09 is the US spring-forward. A naive offset addition computed
  // before the shift lands an hour early, which is the bug this loop exists
  // for — and one text arriving at 8am on one Sunday a year is not something
  // anybody reproduces.
  const at = Date.parse("2025-03-09T07:00:00Z"); // 02:00/03:00 local, mid-shift
  const out = nextSendTimeMs(at, NY);
  assert.equal(new Date(out).toISOString(), "2025-03-09T13:00:00.000Z"); // 09:00 EDT
});

test("fall back: same, in the other direction", () => {
  const at = Date.parse("2025-11-02T07:00:00Z"); // 03:00 local, after the repeat hour
  const out = nextSendTimeMs(at, NY);
  assert.equal(new Date(out).toISOString(), "2025-11-02T14:00:00.000Z"); // 09:00 EST
});

test("an unknown timezone falls back rather than throwing", () => {
  const at = Date.parse("2025-07-01T12:00:00Z");
  assert.equal(typeof nextSendTimeMs(at, { ...NY, timezone: "Mars/Olympus" }), "number");
});

// ---------------------------------------------------------------------------
// 4. Splits
// ---------------------------------------------------------------------------

test("a split is deterministic for the same seed", () => {
  const a = assignVariant("enr_abc", 50, 50);
  assert.equal(assignVariant("enr_abc", 50, 50), a);
  assert.equal(assignVariant("enr_abc", 50, 50), a);
});

test("weights are honoured, roughly", () => {
  let a = 0;
  for (let i = 0; i < 2000; i++) if (assignVariant(`e${i}`, 80, 20) === "a") a++;
  assert.ok(a > 1500 && a < 1700, `expected roughly 80%, got ${a / 20}%`);
});

test("a zero weight is never chosen", () => {
  for (let i = 0; i < 200; i++) assert.equal(assignVariant(`e${i}`, 0, 100), "b");
});

test("two zero weights fall back to A rather than dividing by zero", () => {
  assert.equal(assignVariant("e", 0, 0), "a");
});

// ---------------------------------------------------------------------------
// 5. Parsing and traversal
// ---------------------------------------------------------------------------

test("parseGraph survives junk rather than throwing", () => {
  assert.deepEqual(parseGraph(null), { nodes: [], edges: [] });
  assert.deepEqual(parseGraph("nope"), { nodes: [], edges: [] });
  assert.deepEqual(parseGraph({ nodes: "no", edges: 5 }), { nodes: [], edges: [] });
});

test("parseGraph drops nodes with an unknown kind", () => {
  const g = parseGraph({ nodes: [{ id: "a", kind: "TELEPORT" }, { id: "b", kind: "EXIT" }], edges: [] });
  assert.deepEqual(g.nodes.map((n) => n.id), ["b"]);
});

test("parseGraph drops edges pointing at nodes that don't exist", () => {
  const g = parseGraph({
    nodes: [{ id: "a", kind: "EXIT" }],
    edges: [{ from: "a", to: "ghost" }, { from: "ghost", to: "a" }],
  });
  assert.equal(g.edges.length, 0);
});

test("parseGraph defaults a missing port to out, and missing coordinates to zero", () => {
  const g = parseGraph({
    nodes: [{ id: "a", kind: "WAIT" }, { id: "b", kind: "EXIT" }],
    edges: [{ from: "a", to: "b" }],
  });
  assert.equal(g.edges[0].port, "out");
  assert.equal(g.nodes[0].x, 0);
});

test("nextNodeId follows the named port, and null means the journey ends", () => {
  const g = graph(
    [node("q", "IF_ELSE", {}), node("a", "EXIT", {}), node("b", "EXIT", {})],
    [
      ["q", "a", "true"],
      ["q", "b", "false"],
    ],
  );
  assert.equal(nextNodeId(g, "q", "true"), "a");
  assert.equal(nextNodeId(g, "q", "false"), "b");
  assert.equal(nextNodeId(g, "a", "out"), null);
});

test("reachableFrom finds the whole downstream set and nothing else", () => {
  const g = valid();
  g.nodes.push(node("orphan", "EXIT", {}));
  const r = reachableFrom(g, "t");
  assert.equal(r.has("s"), true);
  assert.equal(r.has("e"), true);
  assert.equal(r.has("orphan"), false);
});

test("tagSlugsIn collects from tag steps and from hasTag conditions", () => {
  const g = graph(
    [
      node("t", "TRIGGER", { trigger: "TAG_ADDED", tagSlug: "vip" }),
      node("a", "ADD_TAG", { tagSlug: "welcomed" }),
      node("q", "IF_ELSE", { condition: { match: "all", rules: [{ field: "hasTag", op: "eq", value: "regular" }] } }),
    ],
    [],
  );
  assert.deepEqual(tagSlugsIn(g).sort(), ["regular", "vip", "welcomed"]);
});

test("trigger kinds are recognised, and time triggers are distinguished", () => {
  assert.equal(isTriggerKind("FIRST_ORDER"), true);
  assert.equal(isTriggerKind("SOMETHING_ELSE"), false);
  assert.equal(isTimeTrigger("LAPSED"), true);
  assert.equal(isTimeTrigger("ANNIVERSARY"), true);
  assert.equal(isTimeTrigger("ORDER_PLACED"), false);
});

console.log(`automation-flow: ${passed} passed`);
