/**
 * Check top-level `select:` keys against `schema.prisma`.
 *
 * ## Why this exists
 *
 * `npx prisma generate` cannot run in the Claude sandbox — `binaries.prisma.sh`
 * returns 403 — so the generated client there is a 4KB stub. The practical
 * consequence is that **`tsc` cannot see Prisma field names**: a query selecting
 * a column that does not exist typechecks in the sandbox and then fails the
 * Railway build, where `prisma generate` runs for real. That has already cost
 * one red build — `Order.token` does not exist, the field is `publicToken` —
 * and the failure arrives minutes later in a completely different place.
 *
 * This is a cheap substitute for the type checking that environment cannot do.
 *
 * ## Scope, and why it is this narrow
 *
 * It checks **only** the keys directly inside a `select: { ... }` block that
 * belongs to a `prisma.<model>.<method>(...)` call, and **only** those whose
 * value is a boolean literal. It skips every nested block.
 *
 * The first version of this file tried to follow relations into nested selects
 * and produced twenty-odd false positives against code that was entirely
 * correct. A checker that cries wolf gets ignored within a week, at which point
 * it is worse than not having one — so this version gives up early and often.
 * It still catches the case that actually broke the build, which is a
 * misremembered scalar field name, and that is the common one.
 *
 * Once `prisma generate` has run on a real machine, `tsc` supersedes this
 * entirely. This is scaffolding for a broken environment, not a permanent part
 * of the design.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(__dirname, "..");

/* ── Schema ─────────────────────────────────────────────────────────────── */

function parseSchema(): Map<string, Set<string>> {
  const text = readFileSync(join(ROOT, "prisma/schema.prisma"), "utf8");
  const models = new Map<string, Set<string>>();

  for (const [, name, body] of text.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    const fields = new Set<string>();
    for (const raw of body.split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("//") || line.startsWith("@@")) continue;
      const m = line.match(/^(\w+)\s+\w/);
      if (m) fields.add(m[1]);
    }
    models.set(name, fields);
  }
  return models;
}

/* ── Brace matching ─────────────────────────────────────────────────────── */

/** Index of the brace closing the one at `start`, or -1. String- and comment-aware. */
function matchBrace(s: string, start: number): number {
  let depth = 0;
  let i = start;
  while (i < s.length) {
    const c = s[i];
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      i++;
      while (i < s.length && s[i] !== quote) {
        if (s[i] === "\\") i++;
        i++;
      }
    } else if (c === "/" && s[i + 1] === "/") {
      while (i < s.length && s[i] !== "\n") i++;
    } else if (c === "/" && s[i + 1] === "*") {
      const end = s.indexOf("*/", i);
      if (end < 0) return -1;
      i = end + 1;
    } else if (c === "{") {
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

/* ── Checking ───────────────────────────────────────────────────────────── */

type Problem = { file: string; line: number; model: string; field: string };

/**
 * Keys directly inside a select block whose value is `true` or `false`.
 *
 * Returns absolute offsets into the original file so line numbers are real.
 * Anything whose value is an object is skipped along with its whole subtree —
 * that is a relation select and resolving it correctly is what went wrong last
 * time.
 */
function scalarKeys(text: string, bodyStart: number, bodyEnd: number): Array<[string, number]> {
  const out: Array<[string, number]> = [];
  let i = bodyStart;

  while (i < bodyEnd) {
    const rest = text.slice(i, bodyEnd);
    const m = rest.match(/^[\s,]*(\w+)\s*:\s*/);
    if (!m) {
      // Not sitting on a key. Skip a nested block if one is next, else give up
      // on this block entirely rather than guess.
      const nextBrace = rest.indexOf("{");
      if (nextBrace < 0) break;
      const end = matchBrace(text, i + nextBrace);
      if (end < 0 || end > bodyEnd) break;
      i = end + 1;
      continue;
    }

    const key = m[1];
    const keyOffset = i + m[0].indexOf(key);
    const valueAt = i + m[0].length;

    if (text.startsWith("true", valueAt) || text.startsWith("false", valueAt)) {
      out.push([key, keyOffset]);
      const comma = text.indexOf(",", valueAt);
      i = comma < 0 || comma > bodyEnd ? bodyEnd : comma + 1;
    } else if (text[valueAt] === "{") {
      const end = matchBrace(text, valueAt);
      if (end < 0 || end > bodyEnd) break;
      i = end + 1;
    } else {
      // A spread, a variable, a ternary — not something to judge.
      const comma = text.indexOf(",", valueAt);
      i = comma < 0 || comma > bodyEnd ? bodyEnd : comma + 1;
    }
  }

  return out;
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry === ".git") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

function modelNameFor(accessor: string, models: Map<string, Set<string>>): string | null {
  const target = accessor.toLowerCase();
  for (const name of models.keys()) if (name.toLowerCase() === target) return name;
  return null;
}

function main(): void {
  const models = parseSchema();
  if (models.size === 0) {
    console.error("prisma-fields: parsed no models out of schema.prisma");
    process.exit(1);
  }

  const problems: Problem[] = [];
  let checked = 0;

  for (const file of sourceFiles(join(ROOT, "src"))) {
    const text = readFileSync(file, "utf8");
    if (!text.includes("prisma.")) continue;

    const lineOf = (offset: number) => text.slice(0, offset).split("\n").length;

    for (const call of text.matchAll(/\bprisma\.(\w+)\s*\.\s*(\w+)\s*\(\s*\{/g)) {
      const model = modelNameFor(call[1], models);
      if (!model) continue; // $transaction, a raw query, an alias — not ours

      const argsOpen = call.index! + call[0].length - 1;
      const argsClose = matchBrace(text, argsOpen);
      if (argsClose < 0) continue;

      // The call's own top-level `select`, not one nested inside `where` or a
      // relation. Found by scanning the argument object's own keys.
      for (const [key, keyOffset] of topLevelKeys(text, argsOpen + 1, argsClose)) {
        if (key !== "select") continue;
        const braceAt = text.indexOf("{", keyOffset + key.length);
        if (braceAt < 0 || braceAt > argsClose) continue;
        const braceEnd = matchBrace(text, braceAt);
        if (braceEnd < 0) continue;

        checked++;
        const fields = models.get(model)!;
        for (const [field, offset] of scalarKeys(text, braceAt + 1, braceEnd)) {
          if (!fields.has(field)) {
            problems.push({ file: relative(ROOT, file), line: lineOf(offset), model, field });
          }
        }
      }
    }
  }

  if (problems.length > 0) {
    console.error(`\nprisma-fields: ${problems.length} unknown field(s)\n`);
    for (const p of problems) {
      const known = [...(models.get(p.model) ?? [])];
      const near = known.filter(
        (f) =>
          f.toLowerCase().includes(p.field.toLowerCase()) ||
          p.field.toLowerCase().includes(f.toLowerCase())
      );
      console.error(
        `  ${p.file}:${p.line}  ${p.model} has no field "${p.field}"` +
          (near.length ? `  — did you mean ${near.map((n) => `"${n}"`).join(", ")}?` : "")
      );
    }
    console.error("");
    process.exit(1);
  }

  console.log(`prisma-fields: ${checked} select blocks checked, ${models.size} models`);
}

/** Keys at the top level of an object literal, with absolute offsets. */
function topLevelKeys(text: string, start: number, end: number): Array<[string, number]> {
  const out: Array<[string, number]> = [];
  let i = start;
  while (i < end) {
    const rest = text.slice(i, end);
    const m = rest.match(/^[\s,]*(\w+)\s*:\s*/);
    if (!m) {
      const nextBrace = rest.indexOf("{");
      if (nextBrace < 0) break;
      const close = matchBrace(text, i + nextBrace);
      if (close < 0 || close > end) break;
      i = close + 1;
      continue;
    }
    const key = m[1];
    out.push([key, i + m[0].indexOf(key)]);

    const valueAt = i + m[0].length;
    if (text[valueAt] === "{") {
      const close = matchBrace(text, valueAt);
      if (close < 0 || close > end) break;
      i = close + 1;
    } else {
      const comma = text.indexOf(",", valueAt);
      i = comma < 0 || comma > end ? end : comma + 1;
    }
  }
  return out;
}

main();
