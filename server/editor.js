// The AI photo editor. One job: take one listing photo and hand back a
// professionally edited version of the same photo. Resizing, watermarks,
// thumbnails, zips and format changes are never sent here; server/images.js
// does them for nothing.
//
// A provider is { name, model, ready, edit(input) }. OpenAI is the only one
// today. Another provider is a second object with the same shape, picked by
// IMAGE_EDITOR, and nothing in the fulfillment workflow changes.
//
// edit({ image, width, height, category, instructions, references }) resolves
// to { buffer, width, height, costEstimate, usage } or throws an Error with
//   retryable  true for a rate limit, a timeout or a server error
//   charged    false when the request certainly was not billed (a 429 or a
//              refusal before the model ran), so the attempt is not counted
//
// ENV
//   OPENAI_API_KEY
//   OPENAI_IMAGE_MODEL         default gpt-image-2. Any image edit model works;
//                              gpt-image-2 and newer take any size up to about
//                              4K, older ones only 1536x1024 and its turns.
//   OPENAI_IMAGE_QUALITY       default medium (the owner's choice, 2026-10-06)
//   OPENAI_IMAGE_SIZE          default 1024x1024, about $0.053 an edit on
//                              gpt-image-2 at medium. A photo that is not
//                              square is sent padded into the square and the
//                              padding is cut off the result, so a 3:2 photo
//                              comes back 3:2 at about 1024x683 and nothing is
//                              stretched. Set it to auto for the photo's own
//                              shape as large as the model allows (about
//                              3520x2336, sharper, costs more).
//   OPENAI_IMAGE_TIMEOUT_MS    default 240000 (an edit at 4K takes a while)
//   OPENAI_IMAGE_INPUT_PER_M   dollars per million input tokens, for the
//   OPENAI_IMAGE_OUTPUT_PER_M  cost estimate. Defaults are the published
//                              gpt-image-1 rates, 10 and 40. Set them to the
//                              model's real rates for an accurate figure.
//   OPENAI_IMAGE_COST_EACH     dollars per edit for the cost estimate. Default
//                              0.053, gpt-image-2 medium at 1024x1024. Used
//                              unless the token rates above are set, then the
//                              estimate comes from the reply's token usage.
"use strict";

// Only a real key switches the editor on. Railway holds a placeholder until
// the owner pastes one, and a placeholder must read as "not set".
const RAW_KEY = String(process.env.OPENAI_API_KEY || "").trim();
const KEY = /^sk-[A-Za-z0-9_-]{10,}/.test(RAW_KEY) ? RAW_KEY : "";
const MODEL = String(process.env.OPENAI_IMAGE_MODEL || "").trim() || "gpt-image-2";
const QUALITY = String(process.env.OPENAI_IMAGE_QUALITY || "").trim() || "medium";
const SIZE = String(process.env.OPENAI_IMAGE_SIZE || "").trim().toLowerCase() || "1024x1024";
const TIMEOUT = Math.max(30000, Number(process.env.OPENAI_IMAGE_TIMEOUT_MS) || 240000);
const API = (process.env.OPENAI_API_BASE || "https://api.openai.com").replace(/\/$/, "");
const rate = (name, def) => { const v = Number(process.env[name]); return Number.isFinite(v) && v >= 0 ? v : def; };
const BY_TOKENS = process.env.OPENAI_IMAGE_INPUT_PER_M !== undefined || process.env.OPENAI_IMAGE_OUTPUT_PER_M !== undefined;
const IN_PER_M = rate("OPENAI_IMAGE_INPUT_PER_M", 10);
const OUT_PER_M = rate("OPENAI_IMAGE_OUTPUT_PER_M", 40);
const EACH = rate("OPENAI_IMAGE_COST_EACH", 0.053);

// The default editing profile, "Real Estate Natural". Preservation first: an
// accurate photo of the real property matters more than a dramatic one.
const PROMPT = [
  "Professionally edit this real estate listing photograph while preserving the actual property exactly as photographed.",
  "",
  "Improve: exposure, white balance, highlight recovery, shadow detail, natural contrast, color accuracy, moderate sharpness and clarity,",
  "window exposure balance so the view outside reads naturally, lens distortion, perspective, and vertical architectural lines (make verticals truly vertical).",
  "Make the finished image clean, bright, realistic, professional, MLS ready, and high end without looking artificial.",
  "",
  "Do NOT: add or remove furniture or objects; change flooring, countertops, cabinets, appliances, fixtures, walls, windows or doors;",
  "alter room dimensions or make rooms look materially larger; invent property features; remove neighboring properties;",
  "materially alter landscaping; change the architecture; create fake views; create unrealistic HDR; oversaturate colors;",
  "add text, logos or watermarks; perform virtual staging; or produce an obviously AI generated look.",
  "Keep the exact framing and composition of the original photo. Maintain the property's factual appearance."
].join("\n");

const EXTERIOR = [
  "",
  "This is an exterior or aerial photo. Improve the sky naturally only if it is dull or blown out, keep the real weather and time of day,",
  "improve foliage and lawn color naturally, reduce haze where reasonable, and keep roofs, lot lines, neighboring homes and streets exactly as they are."
].join("\n");

function promptFor(category, instructions, refCount) {
  let p = PROMPT;
  if (category === "exterior" || category === "drone") p += "\n" + EXTERIOR;
  if (refCount) p += `\n\nThe ${refCount === 1 ? "second image is a reference" : "other images are references"} from the client showing the editing style they like. Match their tone and brightness only. Never copy content from them.`;
  const extra = String(instructions || "").trim();
  if (extra) p += "\n\nThe photographer's notes for this shoot (style only, the rules above still win): " + extra.slice(0, 1000);
  return p;
}

// The output size to ask for. gpt-image-2 and newer take WIDTHxHEIGHT with
// both sides divisible by 16, the long side at most 3840, about 8.3 MP at
// most and an aspect between 1:3 and 3:1, so the photo comes back at its own
// shape and as large as the model allows. Older models only have three sizes.
const MAX_EDGE = 3840, MAX_PIXELS = 3840 * 2160;
function flexible(model) { return !/^gpt-image-1(\.5|-mini)?$/.test(model) && !/^dall-e/.test(model); }
function sizeFor(model, w, h) {
  if (/^\d+x\d+$/.test(SIZE)) return SIZE;
  if (!flexible(model)) return w > h * 1.15 ? "1536x1024" : h > w * 1.15 ? "1024x1536" : "1024x1024";
  let ratio = Math.min(3, Math.max(1 / 3, w / h));
  let W = Math.min(MAX_EDGE, ratio >= 1 ? MAX_EDGE : MAX_EDGE * ratio);
  let H = W / ratio;
  if (H > MAX_EDGE) { H = MAX_EDGE; W = H * ratio; }
  const scale = Math.min(1, Math.sqrt(MAX_PIXELS / (W * H)));
  W = Math.floor(W * scale / 16) * 16;
  H = Math.floor(H * scale / 16) * 16;
  return W + "x" + H;
}

function cost(usage) {
  if (!BY_TOKENS) return EACH;
  if (!usage || (usage.input_tokens == null && usage.output_tokens == null)) return EACH;
  return (Number(usage.input_tokens || 0) * IN_PER_M + Number(usage.output_tokens || 0) * OUT_PER_M) / 1e6;
}

function failure(message, retryable, charged) {
  const e = new Error(message);
  e.retryable = retryable;
  e.charged = charged;
  return e;
}

const openai = {
  name: "openai",
  model: MODEL,
  ready: !!KEY,
  // A rough per photo figure for "this will cost about $X" before a batch.
  estimateEach: EACH,
  async edit({ image, width, height, category, instructions, references = [] }) {
    if (!KEY) throw failure("OPENAI_API_KEY is not set.", false, false);
    const size = sizeFor(MODEL, width, height);
    const [W, H] = size.split("x").map(Number);
    // A fixed size of another shape: fit the photo inside it on a plain
    // border, never stretch it, and remember where it sits to cut it out of
    // the result.
    let box = null;
    if (W && H && Math.abs(W / H - width / height) > 0.01) {
      const sharp = require("sharp");
      const s = Math.min(W / width, H / height);
      const w = Math.round(width * s), h = Math.round(height * s);
      box = { left: Math.floor((W - w) / 2), top: Math.floor((H - h) / 2), width: w, height: h, W, H };
      image = await sharp(image).resize(w, h).extend({
        top: box.top, bottom: H - h - box.top, left: box.left, right: W - w - box.left, background: { r: 128, g: 128, b: 128 }
      }).jpeg({ quality: 95 }).toBuffer();
    }
    const form = new FormData();
    form.append("model", MODEL);
    form.append("prompt", promptFor(category, instructions, references.length) +
      (box ? "\n\nThe flat gray bands at the edges are padding, not part of the photo. Leave them flat gray and edit only the photo inside them." : ""));
    form.append("n", "1");
    form.append("size", size);
    form.append("quality", QUALITY);
    form.append("output_format", "jpeg");
    form.append("output_compression", "95");
    if (/^gpt-image-1(\.5)?$/.test(MODEL)) form.append("input_fidelity", "high");
    const many = references.length > 0;
    form.append(many ? "image[]" : "image", new Blob([image], { type: "image/jpeg" }), "photo.jpg");
    references.forEach((r, i) => form.append("image[]", new Blob([r], { type: "image/jpeg" }), `reference-${i + 1}.jpg`));

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TIMEOUT);
    let r, data;
    try {
      r = await fetch(API + "/v1/images/edits", { method: "POST", headers: { authorization: "Bearer " + KEY }, body: form, signal: ac.signal });
      data = await r.json().catch(() => ({}));
    } catch (e) {
      // The request may or may not have reached the model, so it counts.
      throw failure(e.name === "AbortError" ? "The AI edit timed out." : "Could not reach OpenAI: " + e.message, true, true);
    } finally {
      clearTimeout(timer);
    }
    if (!r.ok) {
      const msg = (data.error && data.error.message) || ("OpenAI replied " + r.status);
      if (r.status === 429) throw failure("Rate limited by OpenAI: " + msg, true, false);
      if (r.status >= 500) throw failure("OpenAI server error: " + msg, true, true);
      // 400s: a refused prompt, a bad size, a model this key cannot use. Not
      // billed, and retrying the same request will not change the answer.
      throw failure(msg, false, false);
    }
    const b64 = data.data && data.data[0] && data.data[0].b64_json;
    if (!b64) throw failure("OpenAI answered without an image.", true, true);
    let buffer = Buffer.from(b64, "base64");
    if (box) {
      // Cut the photo back out, scaled to whatever size the model returned.
      const sharp = require("sharp");
      const m = await sharp(buffer).metadata();
      const kx = m.width / box.W, ky = m.height / box.H;
      const rect = {
        left: Math.round(box.left * kx), top: Math.round(box.top * ky),
        width: Math.min(m.width - Math.round(box.left * kx), Math.round(box.width * kx)),
        height: Math.min(m.height - Math.round(box.top * ky), Math.round(box.height * ky))
      };
      buffer = await sharp(buffer).extract(rect).jpeg({ quality: 95, mozjpeg: true }).toBuffer();
    }
    return { buffer, costEstimate: cost(data.usage), usage: data.usage || null, model: MODEL };
  }
};

const PROVIDERS = { openai };
const provider = PROVIDERS[String(process.env.IMAGE_EDITOR || "openai").trim()] || openai;

module.exports = { provider, promptFor, sizeFor };
