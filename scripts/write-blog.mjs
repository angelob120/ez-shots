// Writes the blog with MiniMax, the same way the EZ Orders blog agent does:
// one article per topic as structured JSON blocks (never HTML), checked by a
// validator that refuses dashes, links, invented prices and AI tell words,
// plus a flat illustration for the hero and for every second section.
//
//   MINIMAX_API_KEY=... node scripts/write-blog.mjs          writes missing posts
//   MINIMAX_API_KEY=... node scripts/write-blog.mjs --redo x  rewrites one slug
//
// `npm run blog:write` reads the key from the gitignored .env. The key never
// goes in a file that is committed. Output is scripts/blog-posts.json (scripts/
// is never served) and img/blog/*.webp. Then `npm run blog:build` turns the
// JSON into the static pages.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "scripts", "blog-posts.json");
const IMG = path.join(ROOT, "img", "blog");
const KEY = (process.env.MINIMAX_API_KEY || "").trim();
const MODEL = process.env.MINIMAX_MODEL || "MiniMax-M2";
if (!KEY) { console.error("MINIMAX_API_KEY is not set"); process.exit(1); }

// One topic per post, each with the search phrase it is written to rank for.
// Fixed rather than random so twenty posts never cover the same ground twice.
export const TOPICS = [
  ["Why real estate photography sells Metro Detroit listings faster", "real estate photography Metro Detroit"],
  ["How to prep a house for listing photos the night before", "prep house for listing photos"],
  ["Drone photos for real estate: when aerials actually help a listing", "drone photos for real estate"],
  ["What MLS ready photos really means and why it matters", "MLS ready photos"],
  ["Phone photos vs a professional real estate photographer", "professional real estate photographer"],
  ["Twilight exterior photos: which listings deserve them", "twilight real estate photos"],
  ["How many photos a listing needs, and which ones to lead with", "how many listing photos"],
  ["Listing video for realtors: what a one minute walkthrough does", "listing video for realtors"],
  ["Photographing a small house so it does not look small", "photographing small homes"],
  ["Shooting a listing in a Michigan winter without gloomy photos", "winter real estate photography Michigan"],
  ["The first listing photo decides the click. Pick it on purpose", "first listing photo"],
  ["How fast you should expect real estate photos back", "real estate photo turnaround time"],
  ["What a realtor should send the photographer before a shoot", "real estate photographer checklist"],
  ["Vacant vs furnished: photographing an empty listing well", "photographing vacant homes"],
  ["How listing photos help you win the next listing appointment", "listing presentation photos"],
  ["Hiring a real estate photographer in Oakland County: what to ask", "real estate photographer Oakland County"],
  ["Why FAA Part 107 matters when you hire a drone photographer", "FAA Part 107 drone photographer"],
  ["Bright, true to life editing vs overdone HDR in listing photos", "real estate photo editing"],
  ["Getting a seller on board with a professional photo shoot", "seller listing photos"],
  ["What you are really paying for with real estate photography pricing. Only quote the EZ Shots package prices, never what other photographers charge", "real estate photography pricing"],
].map(([brief, keyword]) => ({ brief, keyword }));

const ALLOWED_PRICES = ["$0", "$20", "$100", "$199", "$299"];
const TELLS = ["delve", "leverage", "seamless", "robust", "elevate", "unlock", "navigate the landscape",
  "fast-paced world", "when it comes to", "at the end of the day", "game-changer", "game changer", "tapestry",
  "testament", "realm", "embark", "foster", "streamline", "empower", "moreover", "furthermore", "in conclusion"];

function systemPrompt() {
  return [
    "You are the best blog writer at EZ Shots, a one person real estate photography business serving realtors in Metro Detroit (Wayne, Oakland and Macomb counties, Michigan). You write for real estate agents. Every article is genuinely useful, honest, and worth an agent's time. You do not sell hard; being helpful is the sell.",
    "",
    "The business, so you never invent a feature:",
    "- Real estate photography, a one minute listing video, and drone aerials by an FAA Part 107 certified pilot.",
    "- One package: the Real Estate Media Package, $199, interior, exterior and drone photos, professionally edited, up to 75 finished images. Drone aerials are always included, never an add on.",
    "- One add on: a one minute listing video for $100 more, $299 in total. There is no first shoot discount.",
    "- $0 to book. The agent pays after the shoot, once they have seen the photos.",
    "- If the agent is not happy with a gallery they do not pay, and they get $20 cash on top. Every gallery.",
    "- Photos back in 24 to 48 hours in an online gallery, and if they are not delivered within 72 hours of the booked time the shoot is free.",
    "- Book online at the booking page; no call needed.",
    "Mention the business at most once or twice, near the end, lightly. Most of the article is advice that is useful even to an agent who never books.",
    "",
    "Sound like a real person, not a content generator. This matters more than anything.",
    "- Write the way the photographer would talk to one agent over coffee. Contractions. Varied sentence length. It is fine to start a sentence with And or But.",
    "- Open with a concrete scene, or a small true observation. Never a dictionary definition or a rhetorical question.",
    `- Never use these AI tell words or phrases: ${TELLS.join(", ")}.`,
    "- Give at least one specific, do it this week takeaway. Vague is worse than short.",
    "- Do not end with a tidy summary paragraph. Stop when you are done.",
    "",
    "Quality bar:",
    "- Tight and well spaced. Short paragraphs, two to four sentences each. Use three or four h2 subheadings so it scans. Use a short list only where a list genuinely helps.",
    "- To the point. Do not pad. Better a sharp 500 words than a soft 800.",
    "",
    "Hard rules. An article that breaks any of these is discarded:",
    "- Title 30 to 75 characters. Body 380 to 800 words.",
    "- Never use an em dash or an en dash. Use a plain hyphen, or two sentences.",
    `- The only prices that exist are ${ALLOWED_PRICES.join(", ")}. Never write any other amount of money, and no percentages.`,
    "- No links, no URLs, no email addresses, no phone numbers, no HTML, no emoji, no markdown.",
    "- Do not invent statistics, studies, named clients, testimonials or quotes. If you do not know a number, do not use one.",
    "- Never mention dates, years or seasons as news. The article must read as evergreen.",
    "",
    "Structure the body as blocks. Each block is one of:",
    '- {"type":"h2","text":"a subheading"}',
    '- {"type":"p","text":"a paragraph"}',
    '- {"type":"ul","items":["a point","another point"]}',
    '- {"type":"ol","items":["step one","step two"]}',
    "Do not write a title block; the title is separate.",
    "",
    "Answer with JSON only. No preamble, no explanation outside the JSON.",
  ].join("\n");
}

function userPrompt(topic, otherTitles) {
  return [
    `Write one article on this topic: ${topic.brief}`,
    `Search keyword: "${topic.keyword}". Use it in the title or close to it, and once or twice in the body, worked in naturally.`,
    "",
    "Other articles on the blog, so you do not overlap with them:",
    ...otherTitles.map((t) => `- ${t}`),
    "",
    "Reply with exactly this JSON and nothing else:",
    JSON.stringify({
      title: "the headline you wrote",
      description: "a meta description, 120 to 158 characters",
      excerpt: "one or two sentences for the blog index card",
      blocks: [
        { type: "p", text: "a concrete opening" },
        { type: "h2", text: "a subheading" },
        { type: "p", text: "a short paragraph" },
        { type: "ul", items: ["a specific point", "another"] },
      ],
    }, null, 2),
  ].join("\n");
}

// The same picture brief as EZ Orders, pointed at houses instead of food.
function imagePrompt(subject) {
  return [
    "A clean, modern, friendly flat-style illustration for a blog article about real estate photography and selling homes.",
    `The subject is: "${subject}".`,
    // Without this MiniMax often returned a near empty cream canvas for an
    // abstract heading. A concrete scene that fills the frame fixes most of it.
    "Draw a concrete, fully drawn scene that fills the whole frame: a house, its rooms or its yard, and where it fits, a real estate photographer with a camera, tripod or drone, or an agent with a seller.",
    "Warm colors, simple shapes, inviting but not photorealistic. Absolutely no text, no words, no letters, no numbers anywhere in the image.",
  ].join(" ");
}

async function api(url, body, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST", signal: ctrl.signal,
      headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${res.status}: ${text.slice(0, 200)}`);
    const o = JSON.parse(text);
    if (o.base_resp && o.base_resp.status_code) throw new Error(`MiniMax ${o.base_resp.status_code}: ${o.base_resp.status_msg}`);
    return o;
  } finally { clearTimeout(t); }
}

function jsonObject(raw) {
  const s = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; }
}

const textOf = (blocks) => blocks.map((b) => b.text || (b.items || []).join(" ")).join(" ");

export function slugify(s) {
  return s.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70).replace(/-+$/, "");
}

// Returns the reason a post is refused, or null. Mirrors lib/blog-rules.ts.
function refuse(p) {
  if (!p || typeof p.title !== "string" || !Array.isArray(p.blocks)) return "not the JSON shape asked for";
  p.blocks = p.blocks.filter((b) => b && (b.type === "h2" || b.type === "p") ? typeof b.text === "string" && b.text.trim()
    : (b.type === "ul" || b.type === "ol") && Array.isArray(b.items) && b.items.length);
  const all = [p.title, p.description, p.excerpt, textOf(p.blocks)].join(" ");
  if (p.title.length < 30 || p.title.length > 80) return `title is ${p.title.length} characters`;
  if (!p.description || p.description.length < 90 || p.description.length > 165) return "meta description length";
  const words = textOf(p.blocks).split(/\s+/).filter(Boolean).length;
  if (words < 350 || words > 950) return `body is ${words} words`;
  if (p.blocks.filter((b) => b.type === "h2").length < 2) return "fewer than two subheadings";
  if (/[\u2013\u2014]/.test(all)) return "has a dash";
  if (/[<>]|https?:|www\.|\.com\b|@/.test(all)) return "has markup, a link or an email";
  if (/\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}/.test(all)) return "has a phone number";
  const prices = all.match(/\$\s?\d[\d,]*(\.\d+)?/g) || [];
  const bad = prices.map((x) => x.replace(/\s|,/g, "")).filter((x) => !ALLOWED_PRICES.includes(x));
  if (bad.length) return `invented price ${bad[0]}`;
  const pct = all.match(/\d+\s?(%|percent)/g) || [];
  if (pct.length) return `invented percentage ${pct[0]}`;
  const lower = all.toLowerCase();
  const tell = TELLS.find((w) => new RegExp(`\\b${w}\\b`).test(lower));
  if (tell) return `AI tell word "${tell}"`;
  if (/\b20\d\d\b/.test(all)) return "mentions a year";
  if (/[\u{1F300}-\u{1FAFF}]/u.test(all)) return "has an emoji";
  return null;
}

function dedash(p) {
  const fix = (s) => (typeof s === "string" ? s.replace(/\s*[\u2013\u2014]\s*/g, " - ") : s);
  p.title = fix(p.title); p.description = fix(p.description); p.excerpt = fix(p.excerpt);
  for (const b of p.blocks || []) { if (b) { b.text = fix(b.text); if (Array.isArray(b.items)) b.items = b.items.map(fix); } }
}

async function writePost(topic, otherTitles) {
  let last = "";
  for (let attempt = 1; attempt <= 4; attempt++) {
    const o = await api("https://api.minimax.io/v1/text/chatcompletion_v2", {
      // M2 reasons before it answers. 12000 was not enough for the pricing post:
      // it spent the lot thinking and sent back nothing, so the last tries get more.
      model: MODEL, temperature: 0.7, max_tokens: attempt > 2 ? 30000 : 12000,
      messages: [{ role: "system", content: systemPrompt() },
        { role: "user", content: userPrompt(topic, otherTitles) + (last ? `\n\nYour last attempt was refused because: ${last}. Fix that.` : "") }],
    }, 180000).catch((e) => ({ error: e.message }));
    if (o.error) { last = o.error; console.log(`  retry (${o.error})`); continue; }
    const p = jsonObject(o.choices?.[0]?.message?.content || "");
    // A dash is the one slip worth mending rather than refusing: the rule
    // itself says use a plain hyphen, so that is what it becomes.
    if (p) dedash(p);
    const why = refuse(p);
    if (!why) return p;
    last = why;
    console.log(`  refused "${topic.keyword}": ${why}`);
  }
  throw new Error(`gave up on "${topic.keyword}": ${last}`);
}

// A blank canvas compresses to a few KB; a real flat scene is well over this.
const BLANK_BYTES = 14000;
const isWeak = (file) => !fs.existsSync(file) || fs.statSync(file).size < BLANK_BYTES;

async function makeImage(subject, file) {
  if (!isWeak(file)) return true;
  if (fs.existsSync(file)) fs.renameSync(file, file + ".old");
  let best = file + ".old";
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const o = await api("https://api.minimax.io/v1/image_generation", {
        model: "image-01", prompt: imagePrompt(subject).slice(0, 1500), aspect_ratio: "16:9", response_format: "base64", n: 1,
      }, 180000);
      const b64 = o.data?.image_base64?.[0] || o.data?.[0]?.b64_json;
      if (!b64) throw new Error("no image in the reply");
      const jpg = file.replace(/\.webp$/, ".jpg");
      fs.writeFileSync(jpg, Buffer.from(b64, "base64"));
      // 1280 wide at quality 78 keeps each picture near 100KB.
      const out = `${file}.try${attempt}`;
      execFileSync("cwebp", ["-quiet", "-q", "78", "-resize", "1280", "0", jpg, "-o", out]);
      fs.unlinkSync(jpg);
      // Keep the fullest picture so far; stop once one is clearly not blank.
      if (!fs.existsSync(best) || fs.statSync(out).size > fs.statSync(best).size) {
        if (fs.existsSync(best)) fs.unlinkSync(best);
        best = out;
      } else fs.unlinkSync(out);
      if (fs.statSync(best).size >= BLANK_BYTES) break;
    } catch (e) { console.log(`  image retry: ${e.message}`); }
  }
  if (!fs.existsSync(best)) return false; // best effort, like EZ Orders: a post never waits on a picture
  fs.renameSync(best, file);
  return true;
}

// Hero plus one inline picture before every second h2 from the third on, at
// most two, the same slots lib/blog-rules.ts inlineImageSlots picks.
function inlineSlots(blocks) {
  const h = blocks.map((b, i) => (b.type === "h2" ? i : -1)).filter((i) => i >= 0);
  if (h.length < 3) return [];
  const out = [];
  for (let n = 2; n < h.length && out.length < 2; n += 2) out.push(h[n]);
  return out;
}

async function pool(items, size, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: size }, async () => { while (i < items.length) { const n = i++; await fn(items[n], n); } }));
}

const posts = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : [];
const redo = process.argv.includes("--redo") ? process.argv[process.argv.indexOf("--redo") + 1] : null;
fs.mkdirSync(IMG, { recursive: true });

const save = () => fs.writeFileSync(OUT, JSON.stringify(posts, null, 2) + "\n");
// --reimage redraws every picture that came back blank, and writes nothing else.
if (process.argv.includes("--reimage")) {
  const jobs = [];
  for (const p of posts) {
    if (p.image) jobs.push([p.title, path.join(ROOT, p.image)]);
    for (const b of p.blocks) if (b.type === "image") jobs.push([b.alt, path.join(ROOT, b.url)]);
  }
  const weak = jobs.filter(([, f]) => isWeak(f));
  console.log(`${weak.length} of ${jobs.length} pictures to redraw`);
  await pool(weak, 6, async ([subject, f]) => { await makeImage(subject, f); console.log(`${isWeak(f) ? "still weak" : "redrew"} ${path.basename(f)}`); });
  process.exit(0);
}

const todo = TOPICS.filter((t) => {
  const have = posts.find((p) => p.keyword === t.keyword);
  return !have || (redo && have.slug === redo);
});
console.log(`${todo.length} to write`);

await pool(todo, 5, async (topic) => {
  const others = TOPICS.filter((t) => t !== topic).map((t) => t.brief);
  // One topic giving up must not stop the other nineteen. Run again to retry it.
  const p = await writePost(topic, others).catch((e) => { console.log(e.message); return null; });
  if (!p) return;
  const slug = slugify(p.title);
  console.log(`wrote ${slug}`);

  const hero = await makeImage(p.title, path.join(IMG, `${slug}.webp`));
  const slots = inlineSlots(p.blocks);
  const placed = [];
  for (const [n, idx] of slots.entries()) {
    const file = path.join(IMG, `${slug}-${n + 1}.webp`);
    if (await makeImage(p.blocks[idx].text, file)) placed.push([idx, `/img/blog/${slug}-${n + 1}.webp`, p.blocks[idx].text]);
  }
  const blocks = [];
  p.blocks.forEach((b, i) => {
    const img = placed.find((x) => x[0] === i);
    if (img) blocks.push({ type: "image", url: img[1], alt: img[2] });
    blocks.push(b);
  });

  const at = posts.findIndex((x) => x.keyword === topic.keyword);
  const post = {
    slug, keyword: topic.keyword, title: p.title.trim(), description: p.description.trim(),
    excerpt: (p.excerpt || p.description).trim(), image: hero ? `/img/blog/${slug}.webp` : null,
    imageAlt: p.title.trim(), blocks,
  };
  if (at >= 0) posts[at] = post; else posts.push(post);
  posts.sort((a, b) => TOPICS.findIndex((t) => t.keyword === a.keyword) - TOPICS.findIndex((t) => t.keyword === b.keyword));
  save();
});
console.log(`${posts.length} posts in scripts/blog-posts.json`);
