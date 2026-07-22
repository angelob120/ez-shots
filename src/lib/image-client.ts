"use client";

import { KIND_SPEC, MAX_UPLOAD_BYTES, type MediaKind } from "@/lib/media";

/**
 * All resizing, cropping and compression happens here, in the browser, before
 * a single byte leaves the phone. Owners photograph food on modern handsets —
 * a raw shot is 4–8 MB and 4032px wide. Uploading that over a restaurant's
 * wifi is the difference between "instant" and "broken".
 */

export type LoadedImage = {
  bitmap: ImageBitmap;
  width: number;
  height: number;
};

/** Decode a picked file, respecting EXIF rotation. */
export async function loadImage(file: File): Promise<LoadedImage> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" }).catch(
    async () => {
      // Safari < 17 and HEIC fallback: go through an <img> element.
      const url = URL.createObjectURL(file);
      try {
        const img = new Image();
        img.decoding = "async";
        await new Promise<void>((res, rej) => {
          img.onload = () => res();
          img.onerror = () => rej(new Error("decode failed"));
          img.src = url;
        });
        return createImageBitmap(img);
      } finally {
        URL.revokeObjectURL(url);
      }
    }
  );
  return { bitmap, width: bitmap.width, height: bitmap.height };
}

export type CropRect = { sx: number; sy: number; sw: number; sh: number };

/**
 * Given the natural image size, a zoom factor and a pan offset in *frame*
 * pixels, work out the source rectangle to draw. The frame is a fixed-aspect
 * viewport; the image is scaled to cover it, then panned within it.
 */
export function computeCrop(
  natW: number,
  natH: number,
  aspect: number,
  zoom: number,
  offsetX: number,
  offsetY: number,
  frameW: number,
  frameH: number
): CropRect {
  // Scale that makes the image exactly cover the frame at zoom = 1.
  const cover = Math.max(frameW / natW, frameH / natH);
  const scale = cover * zoom;

  const drawnW = natW * scale;
  const drawnH = natH * scale;

  // Clamp the pan so the frame never shows empty space.
  const maxX = Math.max(0, (drawnW - frameW) / 2);
  const maxY = Math.max(0, (drawnH - frameH) / 2);
  const dx = Math.min(maxX, Math.max(-maxX, offsetX));
  const dy = Math.min(maxY, Math.max(-maxY, offsetY));

  // Frame's top-left, expressed in source pixels.
  const sx = (drawnW / 2 - frameW / 2 - dx) / scale;
  const sy = (drawnH / 2 - frameH / 2 - dy) / scale;

  return {
    sx: Math.max(0, sx),
    sy: Math.max(0, sy),
    sw: Math.min(natW, frameW / scale),
    sh: Math.min(natH, frameH / scale),
  };
}

export type EncodedImage = { blob: Blob; width: number; height: number; type: string };

/**
 * Draw the crop into a canvas at the slot's target size and encode it,
 * stepping quality down until it fits under the wire limit.
 */
export async function cropAndEncode(
  bitmap: ImageBitmap,
  crop: CropRect,
  kind: MediaKind
): Promise<EncodedImage> {
  const spec = KIND_SPEC[kind];

  // Never upscale past the source.
  let outW = Math.min(spec.maxW, Math.round(crop.sw));
  let outH = Math.round(outW / spec.aspect);
  if (outH > spec.maxH) {
    outH = spec.maxH;
    outW = Math.round(outH * spec.aspect);
  }

  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Your browser blocked image processing.");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  // Flatten transparency onto white so PNG logos don't go black on JPEG.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, outW, outH);
  ctx.drawImage(bitmap, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, outW, outH);

  const type = supportsWebp() ? "image/webp" : "image/jpeg";

  for (const quality of [0.86, 0.76, 0.66, 0.55, 0.45]) {
    const blob = await toBlob(canvas, type, quality);
    if (blob && blob.size <= MAX_UPLOAD_BYTES) {
      return { blob, width: outW, height: outH, type };
    }
  }
  // Last resort: halve the dimensions and try once more.
  const small = document.createElement("canvas");
  small.width = Math.round(outW / 2);
  small.height = Math.round(outH / 2);
  small.getContext("2d")!.drawImage(canvas, 0, 0, small.width, small.height);
  const blob = await toBlob(small, type, 0.7);
  if (!blob) throw new Error("Couldn't process that image.");
  return { blob, width: small.width, height: small.height, type };
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((res) => canvas.toBlob(res, type, quality));
}

let webpCache: boolean | null = null;
function supportsWebp(): boolean {
  if (webpCache !== null) return webpCache;
  const c = document.createElement("canvas");
  c.width = c.height = 1;
  webpCache = c.toDataURL("image/webp").startsWith("data:image/webp");
  return webpCache;
}

export type UploadResult = { id: string; url: string; key: string; width: number; height: number };

/** POST to /api/upload with real progress. fetch() can't report it; XHR can. */
export function uploadBlob(
  blob: Blob,
  kind: MediaKind,
  dims: { width: number; height: number },
  opts: { restaurantId?: string; onProgress?: (pct: number) => void; signal?: AbortSignal } = {}
): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append("file", blob, `upload.${blob.type === "image/webp" ? "webp" : "jpg"}`);
    fd.append("kind", kind);
    fd.append("width", String(dims.width));
    fd.append("height", String(dims.height));
    if (opts.restaurantId) fd.append("restaurantId", opts.restaurantId);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) opts.onProgress?.(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      let body: any = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* fall through to generic error */
      }
      if (xhr.status >= 200 && xhr.status < 300 && body?.url) resolve(body as UploadResult);
      else reject(new Error(body?.error || "Upload failed. Try again."));
    };
    xhr.onerror = () => reject(new Error("Network error during upload."));
    xhr.onabort = () => reject(new DOMException("Aborted", "AbortError"));
    opts.signal?.addEventListener("abort", () => xhr.abort());
    xhr.send(fd);
  });
}
