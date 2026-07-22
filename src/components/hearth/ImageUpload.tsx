"use client";

import * as React from "react";
import { cx } from "@/components/hearth/ui";
import {
  ACCEPTED_INPUT_TYPES,
  KIND_SPEC,
  MAX_INPUT_BYTES,
  formatBytes,
  type MediaKind,
} from "@/lib/media";
import {
  computeCrop,
  cropAndEncode,
  loadImage,
  uploadBlob,
  type LoadedImage,
} from "@/lib/image-client";

/**
 * Drop-in replacement for the "Image URL" text inputs.
 *
 * It renders a hidden <input name={name}> holding the resulting URL, so it
 * works inside the existing server-action forms with no action changes: the
 * form still reads `formData.get("imageUrl")` and still gets a string.
 */
export default function ImageUpload({
  name,
  kind,
  value,
  restaurantId,
  label,
  hint,
  onChange,
  className,
}: {
  name: string;
  kind: MediaKind;
  value?: string | null;
  /** Admin only — upload on behalf of a tenant. */
  restaurantId?: string;
  label?: string;
  hint?: string;
  /** Fires on every committed change so parents can drive a live preview. */
  onChange?: (url: string) => void;
  className?: string;
}) {
  const spec = KIND_SPEC[kind];
  const [url, setUrl] = React.useState(value ?? "");

  // Let a parent drive the value (e.g. "fill test data") after mount — the
  // preview and the hidden submit input both follow.
  React.useEffect(() => {
    if (value != null) setUrl(value);
  }, [value]);
  const [staged, setStaged] = React.useState<LoadedImage | null>(null);
  const [progress, setProgress] = React.useState<number | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const commit = React.useCallback(
    (next: string) => {
      setUrl(next);
      onChange?.(next);
    },
    [onChange]
  );

  async function accept(file: File | undefined | null) {
    setError(null);
    if (!file) return;
    if (file.size > MAX_INPUT_BYTES) {
      setError(`That file is ${formatBytes(file.size)}. Max is ${formatBytes(MAX_INPUT_BYTES)}.`);
      return;
    }
    if (!file.type.startsWith("image/")) {
      setError("That isn't an image file.");
      return;
    }
    try {
      setStaged(await loadImage(file));
    } catch {
      setError("Couldn't read that image. Try a JPEG or PNG.");
    }
  }

  async function handleCropped(blob: Blob, width: number, height: number) {
    setStaged(null);
    setProgress(0);
    try {
      const res = await uploadBlob(blob, kind, { width, height }, {
        restaurantId,
        onProgress: setProgress,
      });
      commit(res.url);
    } catch (e: any) {
      if (e?.name !== "AbortError") setError(e?.message || "Upload failed.");
    } finally {
      setProgress(null);
    }
  }

  const busy = progress !== null;

  return (
    <div className={className}>
      {label && <span className="mb-1.5 block text-[12px] font-medium text-dim">{label}</span>}

      {/* The value the surrounding server-action form actually submits. */}
      <input type="hidden" name={name} value={url} readOnly />

      {url ? (
        <div className="overflow-hidden rounded-sm border border-line2 bg-surface2">
          <div
            className="w-full bg-surface2 bg-contain bg-center bg-no-repeat"
            style={{ aspectRatio: String(spec.aspect), backgroundImage: `url(${url})` }}
            role="img"
            aria-label="Current image"
          />
          <div className="flex items-center gap-2 border-t border-line px-3 py-2">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
              className="text-[12px] font-medium text-ink hover:text-accent disabled:opacity-50"
            >
              Replace
            </button>
            <button
              type="button"
              onClick={() => commit("")}
              disabled={busy}
              className="text-[12px] text-dim hover:text-badInk disabled:opacity-50"
            >
              Remove
            </button>
            <span className="ml-auto text-[11px] text-mute">{spec.label}</span>
          </div>
        </div>
      ) : busy ? (
        <div className="rounded-sm border border-line2 bg-surface2 px-4 py-6">
          <div className="mb-2 text-[12px] text-dim">Uploading… {progress}%</div>
          <div className="h-1 w-full overflow-hidden rounded-full bg-line">
            <div
              className="h-full bg-accent transition-[width] duration-150"
              style={{ width: `${Math.max(4, progress ?? 0)}%` }}
            />
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            void accept(e.dataTransfer.files?.[0]);
          }}
          className={cx(
            "flex w-full flex-col items-center justify-center gap-1 rounded-sm border border-dashed px-4 py-8 text-center transition-colors",
            dragging ? "border-accent bg-accent/10" : "border-line2 bg-surface2 hover:border-line2"
          )}
        >
          <span className="text-[13px] font-medium text-ink">Drop a photo, or tap to choose</span>
          <span className="text-[11px] text-mute">
            {spec.label} · JPEG, PNG or HEIC · resized automatically
          </span>
        </button>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_INPUT_TYPES.join(",")}
        className="hidden"
        onChange={(e) => {
          void accept(e.target.files?.[0]);
          e.target.value = ""; // let the same file be re-picked
        }}
      />

      {hint && !error && <span className="mt-1 block text-[11px] text-mute">{hint}</span>}
      {error && <span className="mt-1 block text-[11px] text-badInk">{error}</span>}

      {staged && (
        <CropDialog
          image={staged}
          kind={kind}
          onCancel={() => setStaged(null)}
          onDone={handleCropped}
        />
      )}
    </div>
  );
}

/** Fixed-aspect crop stage: drag to pan, slider to zoom. */
function CropDialog({
  image,
  kind,
  onCancel,
  onDone,
}: {
  image: LoadedImage;
  kind: MediaKind;
  onCancel: () => void;
  onDone: (blob: Blob, width: number, height: number) => void;
}) {
  const spec = KIND_SPEC[kind];
  const FRAME_W = 320;
  const FRAME_H = Math.round(FRAME_W / spec.aspect);

  const [zoom, setZoom] = React.useState(1);
  const [offset, setOffset] = React.useState({ x: 0, y: 0 });
  const [working, setWorking] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const drag = React.useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const previewUrl = React.useRef<string>("");

  // A canvas-backed preview of the bitmap, so the same pixels the crop math
  // sees are the pixels on screen.
  if (!previewUrl.current) {
    const c = document.createElement("canvas");
    c.width = image.width;
    c.height = image.height;
    c.getContext("2d")!.drawImage(image.bitmap, 0, 0);
    previewUrl.current = c.toDataURL("image/jpeg", 0.7);
  }

  const cover = Math.max(FRAME_W / image.width, FRAME_H / image.height);
  const scale = cover * zoom;

  function onPointerDown(e: React.PointerEvent) {
    (e.target as Element).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
  }
  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const drawnW = image.width * scale;
    const drawnH = image.height * scale;
    const maxX = Math.max(0, (drawnW - FRAME_W) / 2);
    const maxY = Math.max(0, (drawnH - FRAME_H) / 2);
    setOffset({
      x: Math.min(maxX, Math.max(-maxX, d.ox + (e.clientX - d.x))),
      y: Math.min(maxY, Math.max(-maxY, d.oy + (e.clientY - d.y))),
    });
  }

  async function confirm() {
    setWorking(true);
    setErr(null);
    try {
      const crop = computeCrop(
        image.width,
        image.height,
        spec.aspect,
        zoom,
        offset.x,
        offset.y,
        FRAME_W,
        FRAME_H
      );
      const out = await cropAndEncode(image.bitmap, crop, kind);
      onDone(out.blob, out.width, out.height);
    } catch (e: any) {
      setErr(e?.message || "Couldn't process that image.");
      setWorking(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-black/80 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Crop image"
    >
      <div className="w-full max-w-[380px] rounded-md border border-line bg-surface p-5">
        <h3 className="mb-3 text-[14px] font-semibold text-ink">Position your photo</h3>

        <div
          className="relative mx-auto touch-none overflow-hidden rounded-sm bg-surface2"
          style={{ width: FRAME_W, height: FRAME_H, cursor: "grab" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={() => (drag.current = null)}
          onPointerCancel={() => (drag.current = null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewUrl.current}
            alt=""
            draggable={false}
            className="pointer-events-none absolute left-1/2 top-1/2 max-w-none select-none"
            style={{
              width: image.width * scale,
              height: image.height * scale,
              transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`,
            }}
          />
        </div>

        <label className="mt-4 block">
          <span className="mb-1.5 block text-[12px] font-medium text-dim">Zoom</span>
          <input
            type="range"
            min={1}
            max={3}
            step={0.01}
            value={zoom}
            onChange={(e) => setZoom(parseFloat(e.target.value))}
            className="w-full"
          />
        </label>

        {err && <p className="mt-2 text-[12px] text-badInk">{err}</p>}

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={confirm}
            disabled={working}
            className="inline-flex h-9 items-center justify-center rounded-sm bg-accentFill px-4 text-[13px] font-medium text-accentInk hover:bg-accentHover disabled:opacity-50"
          >
            {working ? "Processing…" : "Use photo"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={working}
            className="inline-flex h-9 items-center justify-center rounded-sm px-4 text-[13px] font-medium text-dim hover:text-ink disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
