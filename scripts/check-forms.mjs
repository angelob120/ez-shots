// Checks every form.lead-form against what js/contact-form.js expects.
//
// Why this exists: the handler folds unknown fields into the email body by
// reading each one's label. Nothing errors when that goes wrong. A field with
// no label, a name that collides, or a data-required naming a field that is
// not on the page all produce a form that submits happily and quietly drops
// an answer, or a required check that can never pass. The first you hear of
// it is a client saying they told you about the dog.
//
// Run: npm run check:forms
import { readFileSync, readdirSync } from "node:fs";

const CORE = ["name", "email", "phone", "message", "_hp"];
let failures = 0;
const fail = (file, msg) => { console.log(`  FAIL  ${file}: ${msg}`); failures++; };

for (const file of readdirSync(".").filter(f => f.endsWith(".html")).sort()) {
  const html = readFileSync(file, "utf8");

  for (const form of html.match(/<form class="lead-form[\s\S]*?<\/form>/g) || []) {
    const attr = n => (form.match(new RegExp(`${n}="([^"]*)"`)) || [])[1] || "";
    const required = (attr("data-required") || "name,email,message").split(",").map(s => s.trim()).filter(Boolean);
    const subjectField = attr("data-subject-field");

    // Every named control, in document order.
    const controls = [...form.matchAll(/<(input|select|textarea)\b([^>]*)>/g)]
      .map(m => ({ tag: m[1], attrs: m[2], at: m.index }))
      .filter(c => /\sname="/.test(c.attrs) && !/type="(submit|button)"/.test(c.attrs));

    const names = controls.map(c => c.attrs.match(/name="([^"]+)"/)[1]);
    console.log(`\n${file}  (${names.length} fields, requires: ${required.join(", ")})`);

    // 1. Duplicate names silently collapse into a RadioNodeList and the
    //    handler reads the wrong value off it.
    const dupes = names.filter((n, i) => names.indexOf(n) !== i);
    if (dupes.length) fail(file, `duplicate field name(s): ${[...new Set(dupes)].join(", ")}`);

    // 2. Duplicate ids break every <label for>, which is what the handler
    //    reads to name a field in the email.
    const ids = [...form.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
    const dupeIds = ids.filter((n, i) => ids.indexOf(n) !== i);
    if (dupeIds.length) fail(file, `duplicate id(s): ${[...new Set(dupeIds)].join(", ")}`);

    // 3. data-required must name fields that actually exist, or the form can
    //    never be submitted and the error names a field nobody can see.
    for (const r of required) {
      if (!names.includes(r)) fail(file, `data-required names "${r}" but no such field exists`);
    }
    if (subjectField && !names.includes(subjectField)) {
      fail(file, `data-subject-field is "${subjectField}" but no such field exists`);
    }

    // 4. The template only has variables for the core fields. Everything else
    //    reaches the inbox through its label, so it needs one.
    for (const c of controls) {
      const name = c.attrs.match(/name="([^"]+)"/)[1];
      if (CORE.includes(name)) continue;
      const id = (c.attrs.match(/\sid="([^"]+)"/) || [])[1];
      const hasDataLabel = /data-label="/.test(c.attrs);
      const hasLabel = id && new RegExp(`<label[^>]*for="${id}"`).test(form);
      if (!hasDataLabel && !hasLabel) {
        fail(file, `field "${name}" has no <label for> and no data-label, it would reach the inbox unnamed`);
      }
    }

    // 5. The honeypot has to be present, and must never be required.
    if (!names.includes("_hp")) fail(file, "no honeypot field, this form is open to bots");
    if (required.includes("_hp")) fail(file, "_hp is in data-required, which blocks every real person");

    // 6. A form with no way to submit.
    if (!/type="submit"/.test(form)) fail(file, "no submit button");
    if (!/class="form-status"/.test(form)) fail(file, "no .form-status element, the user gets no feedback");
  }
}

console.log(failures ? `\n${failures} problem(s) found.` : "\nAll lead forms check out.");
process.exit(failures ? 1 : 0);
