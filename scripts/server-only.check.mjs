/**
 * Refuses to let a client component reach a `server-only` module.
 *
 * This exists because it has already cost a red deploy. `lib/orders.ts` grew an
 * import of `lib/automations.ts` (which is `server-only`), and the status page
 * — a client component that wanted eight label strings out of `lib/orders.ts` —
 * failed the production build several minutes later, in a file nobody had
 * touched. `tsc` cannot see this: it is a bundler rule, not a type rule.
 *
 * The traversal follows **value** imports only:
 *
 *   - `import type` is erased before the bundler sees it, so it is not an edge.
 *   - A `"use server"` module is a network boundary. Next replaces it with a
 *     stub in the client bundle, so a client component importing a server
 *     action is correct and the walk stops there.
 *   - A dynamic `import("...")` **is** an edge. It defers execution, not
 *     bundling — which is the specific thing that made the first attempt at
 *     fixing the failure above not work.
 *
 * Deliberately naive about resolution: only `@/`-aliased specifiers, only the
 * obvious file extensions. A path it can't resolve is skipped rather than
 * guessed at, on the same principle as `prisma-fields.check.ts` — a checker
 * that cries wolf is one that gets ignored and then deleted.
 *
 *   node scripts/server-only.check.mjs
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
const resolve = (spec) => {
  if (!spec.startsWith("@/")) return null;
  const b = path.join("src", spec.slice(2));
  return [b + ".ts", b + ".tsx", path.join(b, "index.ts")].find((c) => src.has(c)) ?? null;
};

// Value imports only. `import type` is erased, and a "use server" module is a
// network boundary — Next replaces it with a stub in the client bundle.
const imports = new Map();
for (const [f, s] of src) {
  const out = new Set();
  for (const m of s.matchAll(/(^|\n)\s*import\s+(?!type\s)([^;]*?)from\s+"([^"]+)"/g)) {
    if (/^\s*\{[^}]*\}\s*$/.test(m[2]) && !/\{\s*\}/.test(m[2])) {
      const named = m[2].replace(/[{}]/g, "").split(",").map((x) => x.trim());
      if (named.length && named.every((n) => n.startsWith("type "))) continue;
    }
    const r = resolve(m[3]);
    if (r) out.add(r);
  }
  for (const m of s.matchAll(/import\(\s*"([^"]+)"\s*\)/g)) {
    const r = resolve(m[1]);
    if (r) out.add(r);
  }
  imports.set(f, [...out]);
}

const isServerOnly = (f) => /^\s*import\s+"server-only"/m.test(src.get(f));
const isServerAction = (f) => /^\s*["']use server["']/.test(src.get(f));
const clients = files.filter((f) => /^\s*["']use client["']/.test(src.get(f)));

let bad = 0;
for (const c of clients) {
  const seen = new Set([c]);
  const stack = [[c, [c]]];
  while (stack.length) {
    const [cur, trail] = stack.pop();
    for (const dep of imports.get(cur) ?? []) {
      if (seen.has(dep)) continue;
      seen.add(dep);
      if (isServerOnly(dep)) { console.log(`BAD: ${[...trail, dep].join(" -> ")}`); bad++; continue; }
      if (isServerAction(dep)) continue; // boundary
      stack.push([dep, [...trail, dep]]);
    }
  }
}
if (bad > 0) process.exitCode = 1;
console.log(bad === 0 ? `OK — ${clients.length} client components, no value path into a server-only module` : `${bad} bad paths`);
