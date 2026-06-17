"use client";

/**
 * BrushCanvas — CANVAS ONLY. Paints a white-on-black mask over the scene; the
 * brush size / erase toggle / clear live in the side panel (controlled props +
 * `apiRef`), matching the Recorte/Caneta pattern. Left-drag paints, right-drag
 * erases. Emits the mask PNG on release.
 */
import { useEffect, useRef, useCallback } from "react";

export type BrushApi = { clear: () => void };

export default function BrushCanvas({
  imageUrl, imageW, imageH, onChange, brush, eraseMode, tint = "34,211,238", apiRef,
}: {
  imageUrl: string;
  imageW: number;
  imageH: number;
  onChange: (maskDataUrl: string | null) => void;
  brush: number;
  eraseMode: boolean;
  tint?: string;
  apiRef?: React.MutableRefObject<BrushApi | null>;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const maskRef = useRef<HTMLCanvasElement | null>(null);
  const painting = useRef(false);
  const erasing = useRef(false);
  const dirty = useRef(false);

  useEffect(() => {
    const c = document.createElement("canvas");
    c.width = imageW; c.height = imageH;
    maskRef.current = c;
  }, [imageW, imageH]);

  const redraw = useCallback(() => {
    const overlay = overlayRef.current, img = imgRef.current, mask = maskRef.current;
    if (!overlay || !img || !mask) return;
    // LAYOUT size → overlay scales with the ZoomPanViewer transform (zoom-safe).
    const w = img.offsetWidth, h = img.offsetHeight;
    if (!w || !h) return;
    if (overlay.width !== w || overlay.height !== h) { overlay.width = w; overlay.height = h; }
    const ctx = overlay.getContext("2d")!;
    ctx.clearRect(0, 0, w, h);
    ctx.globalAlpha = 0.45;
    ctx.drawImage(mask, 0, 0, w, h);
    ctx.globalCompositeOperation = "source-in";
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = `rgb(${tint})`;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
  }, [tint]);

  useEffect(() => {
    const ro = new ResizeObserver(() => redraw());
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, [redraw]);

  const paintAt = (clientX: number, clientY: number) => {
    const img = imgRef.current!, mask = maskRef.current!;
    const r = img.getBoundingClientRect();
    const x = ((clientX - r.left) / r.width) * imageW;
    const y = ((clientY - r.top) / r.height) * imageH;
    const ctx = mask.getContext("2d")!;
    ctx.globalCompositeOperation = erasing.current ? "destination-out" : "source-over";
    ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.arc(x, y, brush, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = "source-over";
    dirty.current = true;
    redraw();
  };
  const onDown = (e: React.MouseEvent) => {
    e.preventDefault();
    painting.current = true;
    erasing.current = eraseMode || e.button === 2;
    paintAt(e.clientX, e.clientY);
  };
  const onMove = (e: React.MouseEvent) => { if (painting.current) paintAt(e.clientX, e.clientY); };
  const emit = () => {
    const mask = maskRef.current!;
    const flat = document.createElement("canvas");
    flat.width = imageW; flat.height = imageH;
    const fx = flat.getContext("2d")!;
    fx.fillStyle = "#000"; fx.fillRect(0, 0, imageW, imageH);
    fx.drawImage(mask, 0, 0);
    onChange(dirty.current ? flat.toDataURL("image/png") : null);
  };
  const onUp = () => { if (!painting.current) return; painting.current = false; emit(); };

  const clear = useCallback(() => {
    const mask = maskRef.current; if (!mask) return;
    mask.getContext("2d")!.clearRect(0, 0, imageW, imageH);
    dirty.current = false; redraw(); onChange(null);
  }, [imageW, imageH, redraw, onChange]);
  useEffect(() => { if (apiRef) apiRef.current = { clear }; }, [apiRef, clear]);

  return (
    <div ref={wrapRef} className="relative select-none rounded-xl overflow-hidden touch-none">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img ref={imgRef} src={imageUrl} alt="scene" draggable={false} className="w-full block"
        onLoad={redraw}
        onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp}
        onContextMenu={(e) => e.preventDefault()}
        style={{ cursor: "crosshair" }} />
      <canvas ref={overlayRef} className="absolute inset-0 pointer-events-none" />
    </div>
  );
}
