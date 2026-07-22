/**
 * Refuses to let a server component import a plain **value** from a
 * `"use client"` module.
 *
 * The mirror image of `server-only.check.mjs`, and it exists for the same
 * reason: it has already cost a production outage, and `tsc` cannot see it.
 *
 * `FlowCanvas.tsx` is a client component that also exported `TRIGGER_LABELS`,
 * a plain object mapping trigger names to sentences. Three server components
 * imported it to label a table cell. That typechecks, builds green, and fails
 * at request time on every one of those pages:
 *
 *   Error: Could not find the module
 *   ".../FlowCanvas.tsx#TRIGGER_LABELS#FIRST_ORDER" in the React Client
 *   Manifest.
 *
 * What a server component receives when it imports across the client boundary
 * is not the value — it is a **client reference proxy**, a marker the RSC
 * serializer is meant to turn back into a component on the browser side. For a
 * React component that is exactly right and is the whole mechanism. For an
 * object, an array, a string or a function it is nonsense, and the failure is
 * deferred to whenever somebody loads the page.
 *
 * The rule, stated the way `CLAUDE.md` states the `server-only` one: **a value
 * both sides need lives in a pure module, and neither side owns it.** That is
 * why `lib/automation-flow.ts`, `lib/campaign-format.ts` and
 * `lib/order-labels.ts` exist. The fix when this fires is to move the value,
 * never to add `"use client"` to the page.
 *
 * ## What counts as allowed
 *
 * - **PascalCase names.** A component, which is the entire point of importing
 *   from a client module. `ThemeToggle`, `HelpBrowser`, `{ PublishForm }`.
 * - **`import type`, and `type` specifiers.** Erased before the bundler runs,
 *   so there is no runtime edge at all.
 * - **Side-effect imports** (`import "./x"`), which bind no name.
 *
 * Everything else — `camelCase`, `SCREAMING_CASE`, a default import with a
 * lowercase name — is flagged. That heuristic is deliberately crude and errs
 * towards the false positive, because the alternative is a runtime error on a
 * page nobody visits until a customer does. If it ever fires on something
 * genuinely fine, move the value to a pure module anyway; there is no case
 * where a server component *wants* a client module's constant.
 *
 * Resolution is as naive as the other checker's on purpose: `@/` and relative
 * specifiers, the obvious extensions, and anything unresolvable is skipped
 * rather than guessed at. A checker that cries wolf gets ignored and then
 * deleted.
 *
 *   node scripts/client-values.check.mjs
 */

import fs from "node:fs";
import path from "node:path";

const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(e.name)) files.push(p);
  }
})("src");

const src = new Map(files.map((f) => [f, fs.readFileSync(f, "utf8")]));
const isClient = (f) => /^\s*["']use client["']/.test(src.get(f) ?? "");

function resolve(spec, from) {
  let base;
  if (spec.startsWith("@/")) base = path.join("src", spec.slice(2));
  else if (spec.startsWith(".")) base = path.normalize(path.join(path.dirname(from), spec));
  else return null; // a package — not ours
  for (const ext of [".tsx", ".ts", "/index.tsx", "/index.ts"]) {
    if (src.has(base + ext)) return base + ext;
  }
  return src.has(base) ? base : null;
}

/** The names an import clause binds at runtime, ignoring anything type-only. */
function boundNames(clause) {
  const c = clause.trim();
  if (!c || /^type\s/.test(c)) return []; // `import type { ... }` — erased

  const names = [];
  // The braced part, split on commas. `type X` inside braces is erased too.
  const braced = c.match(/\{([\s\S]*)\}/);
  if (braced) {
    for (const raw of braced[1].split(",")) {
      const s = raw.trim();
      if (!s || /^type\s/.test(s)) continue;
      // `a as b` binds b, but either name being lowercase is the smell.
      names.push(s.split(/\s+as\s+/).pop().trim());
    }
  }
  // Default and namespace imports are whatever sits before the braces.
  const head = c.replace(/\{[\s\S]*\}/, "").replace(/,/g, " ").trim();
  for (const s of head.split(/\s+/)) {
    if (!s || s === "*" || s === "as") continue;
    names.push(s);
  }
  return names;
}

/**
 * A React component name, as opposed to a constant that merely starts with a
 * capital.
 *
 * "Starts uppercase" is not enough and the first version of this checker got it
 * wrong in the exact way that matters: `TRIGGER_LABELS` starts with a capital,
 * so the rule that shipped waved through the one import the whole file was
 * written to catch. Requiring a lowercase letter separates `ThemeToggle` from
 * `TRIGGER_LABELS` and `MAX_RETRIES`, which is the real distinction — JSX
 * requires the capital, SCREAMING_CASE is a convention for constants, and a
 * constant is precisely the thing that cannot cross this boundary.
 */
const isComponentName = (n) => /^[A-Z]/.test(n) && /[a-z]/.test(n) && !n.includes("_");

const importRe = /import\s+([^;'"]*?)\s+from\s+["']([^"']+)["']/g;

let bad = 0;
let checked = 0;

for (const f of files) {
  if (isClient(f)) continue; // client → client is fine
  checked++;
  const text = src.get(f);
  for (const [, clause, spec] of text.matchAll(importRe)) {
    const target = resolve(spec, f);
    if (!target || !isClient(target)) continue;
    for (const name of boundNames(clause)) {
      if (isComponentName(name)) continue;
      console.log(
        `BAD: ${f} imports the value \`${name}\` from the client module ${target}\n` +
          `     A server component gets a client reference proxy, not the value.\n` +
          `     Move \`${name}\` to a pure module (no "use client", no "server-only") and import it from there.`
      );
      bad++;
    }
  }
}

if (bad > 0) process.exitCode = 1;
console.log(
  bad === 0
    ? `OK — ${checked} server modules, no value imported across the client boundary`
    : `${bad} bad imports`
);
