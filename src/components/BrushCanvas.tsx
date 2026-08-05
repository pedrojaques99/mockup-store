"use client";

/**
 * BrushCanvas — CANVAS ONLY. Paints a white-on-black mask over the scene; the
 * brush size / erase toggle / clear live in the side panel (controlled props +
 * `apiRef`), matching the Recorte/Caneta pattern. Left-drag paints, right-drag
 * erases. Emits the mask PNG on release.
 */
import { useEffect, useRef, useCallback } from "react";
import { useViewerZoom } from "@/components/viewer-zoom";
import { ACC_RGB } from "@/lib/brand";

export type BrushApi = { clear: () => void };

export default function BrushCanvas({
  imageUrl, imageW, imageH, onChange, brush, eraseMode, tint = ACC_RGB, apiRef, transparentImg, patchMode,
}: {
  imageUrl: string;
  imageW: number;
  imageH: number;
  onChange: (maskDataUrl: string | null) => void;
  brush: number;
  eraseMode: boolean;
  tint?: string;
  apiRef?: React.MutableRefObject<BrushApi | null>;
  /** Hide this img (opacity 0) — a shared base img underneath shows the pixels. */
  transparentImg?: boolean;
  /** Mask-editor mode: emit each stroke as an alpha PATCH then clear, so the page
   *  composites it (add/subtract) into the persistent target mask. */
  patchMode?: boolean;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const maskRef = useRef<HTMLCanvasElement | null>(null);
  const painting = useRef(false);
  const erasing = useRef(false);
  const dirty = useRef(false);
  // Anel do cursor — mostra o tamanho real do pincel (em px de layout, escala com o zoom).
  // A borda do anel, porém, fica com espessura de TELA constante (÷ zoom).
  const ringRef = useRef<HTMLDivElement>(null);
  const zoom = useViewerZoom();
  const lastPos = useRef<{ x: number; y: number } | null>(null);

  const updateRing = useCallback((clientX: number, clientY: number) => {
    const img = imgRef.current, ring = ringRef.current;
    if (!img || !ring) return;
    const r = img.getBoundingClientRect();
    const lw = img.offsetWidth, lh = img.offsetHeight;
    if (!r.width || !r.height) return;
    const lx = ((clientX - r.left) / r.width) * lw;
    const ly = ((clientY - r.top) / r.height) * lh;
    const d = brush * (lw / imageW) * 2; // diâmetro em px de layout
    ring.style.left = `${lx}px`;
    ring.style.top = `${ly}px`;
    ring.style.width = `${d}px`;
    ring.style.height = `${d}px`;
    lastPos.current = { x: clientX, y: clientY };
  }, [brush, imageW]);

  // Mudou o tamanho/modo no slider → atualiza o anel na última posição (sem precisar mexer).
  useEffect(() => {
    if (lastPos.current) updateRing(lastPos.current.x, lastPos.current.y);
    const ring = ringRef.current;
    if (ring) ring.style.borderColor = eraseMode ? "rgba(248,113,113,0.95)" : `rgb(${tint})`;
  }, [brush, eraseMode, tint, updateRing]);

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
    if (e.button === 1) return; // botão do meio = pan (ZoomPanViewer); não pinta
    e.preventDefault();
    painting.current = true;
    erasing.current = eraseMode || e.button === 2;
    paintAt(e.clientX, e.clientY);
  };
  const onMove = (e: React.MouseEvent) => { updateRing(e.clientX, e.clientY); if (painting.current) paintAt(e.clientX, e.clientY); };
  const showRing = (v: boolean) => { if (ringRef.current) ringRef.current.style.display = v ? "block" : "none"; };
  const emit = () => {
    const mask = maskRef.current!;
    if (patchMode) {
      // Emit this stroke as an alpha patch, then clear so the next stroke is fresh —
      // the page composites each patch (add/subtract) into the target mask.
      if (dirty.current) onChange(mask.toDataURL("image/png"));
      mask.getContext("2d")!.clearRect(0, 0, imageW, imageH);
      dirty.current = false; redraw();
      return;
    }
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
        onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp}
        onMouseEnter={() => showRing(true)}
        onMouseLeave={() => { showRing(false); onUp(); }}
        onContextMenu={(e) => e.preventDefault()}
        style={{ cursor: "none", ...(transparentImg ? { opacity: 0 } : null) }} />
      <canvas ref={overlayRef} className="absolute inset-0 pointer-events-none" />
      {/* Anel do cursor (tamanho real do pincel) */}
      <div ref={ringRef} aria-hidden
        style={{
          position: "absolute", display: "none", left: 0, top: 0, width: 0, height: 0,
          transform: "translate(-50%, -50%)", borderRadius: "9999px",
          border: `${1.5 / zoom}px solid ${eraseMode ? "rgba(248,113,113,0.95)" : `rgb(${tint})`}`,
          boxShadow: `0 0 0 ${1 / zoom}px rgba(0,0,0,0.45), inset 0 0 0 ${1 / zoom}px rgba(0,0,0,0.35)`,
          pointerEvents: "none", willChange: "left, top, width, height",
        }} />
    </div>
  );
}
