"use client";

import { Trash2, Upload } from "lucide-react";
import NextImage from "next/image";
import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent, type PointerEvent } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import {
  AVATAR_ACCEPT,
  AVATAR_OUTPUT_PX,
  MAX_ZOOM,
  clampOffset,
  clampZoom,
  coverScale,
  cropSource,
  validateAvatarFile,
  type Offset,
  type Size,
} from "@/lib/ui/avatar-crop";
import { notifyFailure } from "@/lib/ui/notify";
import { previewAvatarUrl, removalFor, type AvatarChange } from "@/lib/ui/profile-save";

const VIEW = 176;
const NUDGE = 8;

type Draft = { url: string; image: HTMLImageElement; size: Size };

function loadImage(file: File): Promise<Draft> {
  const url = URL.createObjectURL(file);
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ url, image, size: { width: image.naturalWidth, height: image.naturalHeight } });
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("unreadable image"));
    };
    image.src = url;
  });
}

function renderCrop(draft: Draft, zoom: number, offset: Offset): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_OUTPUT_PX;
  canvas.height = AVATAR_OUTPUT_PX;
  const context = canvas.getContext("2d");
  if (!context) return Promise.reject(new Error("canvas unavailable"));
  const source = cropSource(draft.size, VIEW, zoom, offset);
  context.imageSmoothingQuality = "high";
  context.drawImage(draft.image, source.x, source.y, source.size, source.size, 0, 0, AVATAR_OUTPUT_PX, AVATAR_OUTPUT_PX);
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("encode failed"))), "image/webp", 0.9),
  );
}

export function AvatarUploader({
  name,
  seed,
  currentUrl,
  change,
  onChange,
  disabled,
}: {
  name: string;
  seed: string;
  currentUrl: string | null;
  change: AvatarChange;
  onChange: (change: AvatarChange) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const drag = useRef<{ x: number; y: number; origin: Offset } | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState<Offset>({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const shownUrl = previewAvatarUrl(change, currentUrl);

  useEffect(() => {
    if (!draft) return;
    return () => URL.revokeObjectURL(draft.url);
  }, [draft]);

  async function pick(file: File | undefined) {
    if (!file || disabled) return;
    const invalid = validateAvatarFile(file);
    if (invalid) {
      notifyFailure(invalid);
      return;
    }
    try {
      const loaded = await loadImage(file);
      setZoom(1);
      setOffset({ x: 0, y: 0 });
      setDraft(loaded);
    } catch {
      notifyFailure("Couldn't read that image. Try another file.");
    }
  }

  async function confirmCrop() {
    if (!draft) return;
    try {
      const blob = await renderCrop(draft, zoom, offset);
      onChange({ kind: "replace", blob, previewUrl: URL.createObjectURL(blob) });
      setDraft(null);
    } catch {
      notifyFailure("Couldn't crop that image. Try another file.");
    }
  }

  function moveTo(next: Offset) {
    if (draft) setOffset(clampOffset(next, draft.size, VIEW, zoom));
  }

  function zoomTo(value: number) {
    if (!draft) return;
    const next = clampZoom(value);
    setZoom(next);
    setOffset((current) => clampOffset(current, draft.size, VIEW, next));
  }

  const picker = (
    <input
      ref={inputRef}
      type="file"
      accept={AVATAR_ACCEPT}
      className="hidden"
      onChange={(e) => {
        void pick(e.target.files?.[0]);
        e.target.value = "";
      }}
    />
  );

  if (draft) {
    const base = coverScale(draft.size, VIEW);
    const width = draft.size.width * base;
    const height = draft.size.height * base;
    return (
      <div className="flex animate-fade-in items-center gap-5">
        <div
          role="application"
          tabIndex={0}
          aria-label="Drag or use arrow keys to position the image"
          className="relative size-44 shrink-0 cursor-grab touch-none overflow-hidden rounded-xl bg-raised select-none focus-visible:ring-2 focus-visible:ring-fg/60 focus-visible:outline-none active:cursor-grabbing"
          onPointerDown={(e: PointerEvent<HTMLDivElement>) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            drag.current = { x: e.clientX, y: e.clientY, origin: offset };
          }}
          onPointerMove={(e) => {
            const start = drag.current;
            if (start) moveTo({ x: start.origin.x + e.clientX - start.x, y: start.origin.y + e.clientY - start.y });
          }}
          onPointerUp={() => {
            drag.current = null;
          }}
          onPointerCancel={() => {
            drag.current = null;
          }}
          onKeyDown={(e: KeyboardEvent) => {
            const step = { ArrowLeft: [-NUDGE, 0], ArrowRight: [NUDGE, 0], ArrowUp: [0, -NUDGE], ArrowDown: [0, NUDGE] }[e.key];
            if (!step) return;
            e.preventDefault();
            moveTo({ x: offset.x + step[0], y: offset.y + step[1] });
          }}
        >
          <NextImage
            src={draft.url}
            alt=""
            width={Math.round(width)}
            height={Math.round(height)}
            unoptimized
            draggable={false}
            className="pointer-events-none absolute top-0 left-0 max-w-none origin-center"
            style={{
              width,
              height,
              transform: `translate(${(VIEW - width) / 2 + offset.x}px, ${(VIEW - height) / 2 + offset.y}px) scale(${zoom})`,
            }}
          />
          <span className="pointer-events-none absolute inset-0 rounded-full shadow-[0_0_0_9999px_rgb(0_0_0/0.6)] ring-1 ring-white/30" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <label className="flex flex-col gap-2 text-xs text-muted">
            Zoom
            <input type="range" min={1} max={MAX_ZOOM} step={0.01} value={zoom} onChange={(e) => zoomTo(Number(e.target.value))} />
          </label>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button variant="outline" size="sm" onClick={() => void confirmCrop()}>
              Done
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const dropProps = {
    onDragOver: (e: DragEvent) => {
      e.preventDefault();
      if (!disabled) setDragging(true);
    },
    onDragLeave: () => setDragging(false),
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      setDragging(false);
      void pick(e.dataTransfer.files[0]);
    },
  };

  const hasAvatar = shownUrl !== null;

  return (
    <div className="flex items-center gap-4">
      <div
        {...dropProps}
        className={cn("shrink-0 rounded-full transition-shadow duration-150 ease-snappy", dragging && "ring-2 ring-fg/60 ring-offset-2 ring-offset-surface")}
      >
        <Avatar key={shownUrl ?? "none"} name={name} url={shownUrl} seed={seed} size="editor" className="animate-crossfade" />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" disabled={disabled} onClick={() => inputRef.current?.click()}>
          <Upload className="h-4 w-4" />
          {hasAvatar ? "Replace avatar" : "Upload avatar"}
        </Button>
        {hasAvatar && (
          <Button variant="ghost" size="sm" disabled={disabled} onClick={() => onChange(removalFor(currentUrl))}>
            <Trash2 className="h-4 w-4" />
            Delete avatar
          </Button>
        )}
      </div>
      {picker}
    </div>
  );
}
