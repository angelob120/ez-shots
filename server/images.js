// Everything done to a photo that is not AI: reading it, turning an iPhone's
// HEIC into a JPEG, every size the gallery and the downloads need, and the
// preview watermark. sharp (libvips) does the work. None of it ever goes to
// the AI editor: an AI edit is paid for once per photo, and every other size
// is made from its result here, for nothing.
//
// HEIC: the sharp binaries that npm installs cannot read HEIC (the HEVC codec
// is left out for licensing), so a HEIC upload is decoded with heic-decode,
// which is libheif compiled to WebAssembly, and saved as a quality 95 JPEG
// straight away. That JPEG is the working original from then on: picking,
// the AI edit and every download are made from it. Nothing else in the
// server ever sees a HEIC.
//
// Sizes, each overridable by env var:
//   low res (MLS / web)  LOWRES_LONG_EDGE 2400px, LOWRES_QUALITY 85
//   thumbnail            THUMB_LONG_EDGE 600px WebP
//   preview              PREVIEW_LONG_EDGE 1600px with the watermark, what an
//                        unpaid gallery shows full size
//   marked thumbnail     the thumbnail with the watermark, the unpaid grid.
//                        An unpaid gallery never serves anything clean.
// Nothing is ever enlarged: a smaller photo keeps its own size.
"use strict";

// Loaded on first use, not at boot: if the native library ever failed to
// load on the server, only photo processing would stop, never the website.
let lib = null;
function sharp(...a) {
  if (!lib) {
    lib = require("sharp");
    lib.cache(false);
    lib.concurrency(2);
  }
  return lib(...a);
}

function num(name, def, lo, hi) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v >= lo && v <= hi ? Math.round(v) : def;
}
const LOW_EDGE = num("LOWRES_LONG_EDGE", 2400, 800, 6000);
const LOW_Q = num("LOWRES_QUALITY", 85, 50, 100);
const THUMB_EDGE = num("THUMB_LONG_EDGE", 600, 200, 1200);
const PREVIEW_EDGE = num("PREVIEW_LONG_EDGE", 1600, 800, 3000);
const SOURCE_THUMB_EDGE = 480;
const WATERMARK = String(process.env.PREVIEW_WATERMARK || "EZ SHOTS PREVIEW").replace(/[<>&"]/g, "").slice(0, 40);

// What the bytes are, from the bytes. The file name and the browser's type
// are only claims. RAW files, PDFs, videos and anything executable come back
// empty and are refused.
function sniff(head) {
  if (!head || head.length < 12) return "";
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
  if (head.readUInt32BE(0) === 0x89504e47) return "image/png";
  if (head.toString("latin1", 0, 4) === "RIFF" && head.toString("latin1", 8, 12) === "WEBP") return "image/webp";
  if (head.toString("latin1", 4, 8) === "ftyp") {
    const brand = head.toString("latin1", 8, 12);
    if (["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"].includes(brand)) return "image/heic";
  }
  return "";
}

// A video the gallery can play: MP4 or QuickTime.
function sniffVideo(head) {
  if (!head || head.length < 12 || head.toString("latin1", 4, 8) !== "ftyp") return "";
  const brand = head.toString("latin1", 8, 12);
  if (brand === "qt  ") return "video/quicktime";
  if (/^(isom|iso2|iso4|iso5|iso6|mp41|mp42|avc1|M4V |MSNV|dash|3gp)/.test(brand)) return "video/mp4";
  return "";
}

// HEIC to a JPEG buffer. Anything else is returned as null and used as it is.
async function convertHeic(buf) {
  const decode = require("heic-decode");
  const img = await decode({ buffer: buf });
  return sharp(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength), {
    raw: { width: img.width, height: img.height, channels: 4 }
  }).removeAlpha().jpeg({ quality: 95, mozjpeg: true }).toBuffer();
}

// The upright size of an image, after the camera's orientation flag.
async function dims(input) {
  const m = await sharp(input).metadata();
  const swap = m.orientation >= 5 && m.orientation <= 8;
  return { width: swap ? m.height : m.width, height: swap ? m.width : m.height, format: m.format };
}

function fit(edge) { return { width: edge, height: edge, fit: "inside", withoutEnlargement: true }; }

// Made at upload from the original, so picking and Compare never load a 30 MB
// file in the browser.
async function sourceViews(input) {
  const [thumb, preview] = await Promise.all([
    sharp(input).rotate().resize(fit(SOURCE_THUMB_EDGE)).webp({ quality: 72 }).toBuffer(),
    sharp(input).rotate().resize(fit(PREVIEW_EDGE)).jpeg({ quality: 82, mozjpeg: true }).toBuffer()
  ]);
  return { thumb, preview };
}

// A photo delivered as shot, with no AI edit: upright, sRGB, a clean quality
// 95 JPEG with the camera's metadata (GPS included) stripped.
function cleanJpeg(input) {
  return sharp(input).rotate().toColorspace("srgb").jpeg({ quality: 95, mozjpeg: true, chromaSubsampling: "4:4:4" }).toBuffer();
}

// What goes to the AI editor: upright, at most `edge` on the long side, a
// high quality JPEG. Sending a 45 MP original would cost more input and the
// model cannot return more than it is allowed to anyway.
async function aiInput(input, edge) {
  const out = await sharp(input).rotate().resize(fit(edge)).toColorspace("srgb")
    .jpeg({ quality: 92, mozjpeg: true }).toBuffer({ resolveWithObject: true });
  return { buffer: out.data, width: out.info.width, height: out.info.height };
}

// The preview watermark, drawn as SVG so it scales with the photo: the words
// tiled at an angle, light enough to judge the photo through and hard to crop
// out of any useful part of it.
function watermarkSvg(w, h) {
  const size = Math.max(18, Math.round(Math.min(w, h) / 16));
  const stepX = size * (WATERMARK.length * 0.95 + 3), stepY = size * 5;
  let rows = "";
  for (let y = -h; y < h * 2; y += stepY) {
    for (let x = -w; x < w * 2; x += stepX) {
      rows += `<text x="${x}" y="${y}">${WATERMARK}</text>`;
    }
  }
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
    `<g transform="rotate(-28 ${w / 2} ${h / 2})" font-family="Helvetica, Arial, sans-serif" font-weight="700" ` +
    `font-size="${size}" fill="#ffffff" fill-opacity="0.32" stroke="#000000" stroke-opacity="0.18" stroke-width="${Math.max(1, size / 24)}" letter-spacing="${size / 6}">` +
    rows + `</g></svg>`);
}

// Every size the gallery and the downloads use, from the edited master. The
// master is already a clean JPEG (the AI returns one, cleanJpeg makes one), so
// the high resolution download IS the master: re-encoding it would only lose
// quality and store the same photo twice.
async function deliverySizes(master) {
  const meta = await dims(master);
  const low = await sharp(master).rotate().resize(fit(LOW_EDGE)).jpeg({ quality: LOW_Q, mozjpeg: true, progressive: true }).toBuffer();
  const t = await sharp(master).rotate().resize(fit(THUMB_EDGE)).toBuffer({ resolveWithObject: true });
  const thumb = await sharp(t.data).webp({ quality: 78 }).toBuffer();
  // What an unpaid gallery's grid shows: the same thumbnail, watermarked, so
  // nothing clean can be saved and upscaled before the payment.
  const thumbMarked = await sharp(t.data)
    .composite([{ input: watermarkSvg(t.info.width, t.info.height), top: 0, left: 0 }])
    .webp({ quality: 74 }).toBuffer();
  const p = await sharp(master).rotate().resize(fit(PREVIEW_EDGE)).toBuffer({ resolveWithObject: true });
  const preview = await sharp(p.data)
    .composite([{ input: watermarkSvg(p.info.width, p.info.height), top: 0, left: 0 }])
    .jpeg({ quality: 76, mozjpeg: true, progressive: true }).toBuffer();
  return { width: meta.width, height: meta.height, low, thumb, thumbMarked, preview };
}

module.exports = { sniff, sniffVideo, convertHeic, dims, sourceViews, cleanJpeg, aiInput, deliverySizes, watermarkSvg };
