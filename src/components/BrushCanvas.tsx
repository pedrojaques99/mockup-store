"use client";

/**
 * BrushCanvas — paint a mask over the scene photo (e.g. refine the reflection map).
 * Left-drag paints, right-drag (or Erase toggle) erases. Emits a white-on-black
 * PNG data URL at full image resolution.
 */
import { useEffect, useRef, useState, useCallback } from "react";
import { Brush, Eraser, Trash2 } from "lucide-react";

export default function BrushCanvas({
  imageUrl, imageW, imageH, onChange, tint = "236,72,153",
}: {
  imageUrl: string;
  imageW: number;
  imageH: number;
  onChange: (maskDataUrl: string | null) => void;
  tint?: string; // rgb of the overlay
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const maskRef = useRef<HTMLCanvasElement | null>(null); // full-res mask (white=on)
  const painting = useRef(false);
  const erasing = useRef(false);

  const [brush, setBrush] = useState(Math.round(Math.max(imageW, imageH) * 0.04));
  const [eraseMode, setEraseMode] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Init full-res mask canvas
  useEffect(() => {
    const c = document.createElement("canvas");
    c.width = imageW; c.height = imageH;
    maskRef.current = c;
  }, [imageW, imageH]);

  const redraw = useCallback(() => {
    const overlay = overlayRef.current, img = imgRef.current, mask = maskRef.current;
    if (!overlay || !img || !mask) return;
    const r = img.getBoundingClientRect();
    if (overlay.width !== r.width || overlay.height !== r.height) {
      overlay.width = r.width; overlay.height = r.height;
    }
    const ctx = overlay.getContext("2d")!;
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    ctx.globalAlpha = 0.45;
    ctx.drawImage(mask, 0, 0, overlay.width, overlay.height);
    // tint the white mask
    ctx.globalCompositeOperation = "source-in";
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = `rgb(${tint})`;
    ctx.fillRect(0, 0, overlay.width, overlay.height);
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
    ctx.beginPath();
    ctx.arc(x, y, brush, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";
    setDirty(true);
    redraw();
  };

  const onDown = (e: React.MouseEvent) => {
    e.preventDefault();
    painting.current = true;
    erasing.current = eraseMode || e.button === 2;
    paintAt(e.clientX, e.clientY);
  };
  const onMove = (e: React.MouseEvent) => { if (painting.current) paintAt(e.clientX, e.clientY); };
  const onUp = () => {
    if (!painting.current) return;
    painting.current = false;
    emit();
  };

  const emit = () => {
    const mask = maskRef.current!;
    // Composite onto black so the PNG carries white-on-black (server reads R channel)
    const flat = document.createElement("canvas");
    flat.width = imageW; flat.height = imageH;
    const fx = flat.getContext("2d")!;
    fx.fillStyle = "#000"; fx.fillRect(0, 0, imageW, imageH);
    fx.drawImage(mask, 0, 0);
    onChange(dirty ? flat.toDataURL("image/png") : null);
  };

  const clear = () => {
    const mask = maskRef.current!;
    mask.getContext("2d")!.clearRect(0, 0, imageW, imageH);
    setDirty(false); redraw(); onChange(null);
  };

  return (
    <div className="space-y-2">
      <div ref={wrapRef} className="relative select-none rounded-xl overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img ref={imgRef} src={imageUrl} alt="scene" draggable={false} className="w-full block"
          onLoad={redraw}
          onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp}
          onContextMenu={(e) => e.preventDefault()}
          style={{ cursor: "crosshair" }} />
        <canvas ref={overlayRef} className="absolute inset-0 pointer-events-none" />
      </div>

      <div className="flex items-center gap-2 text-[11px] text-zinc-500">
        <button onClick={() => setEraseMode(false)}
          className={["flex items-center gap-1 px-2 py-1 rounded-lg transition-colors",
            !eraseMode ? "bg-fuchsia-700/40 text-fuchsia-200" : "hover:text-zinc-300"].join(" ")}>
          <Brush size={11} /> Pintar
        </button>
        <button onClick={() => setEraseMode(true)}
          className={["flex items-center gap-1 px-2 py-1 rounded-lg transition-colors",
            eraseMode ? "bg-zinc-700 text-zinc-200" : "hover:text-zinc-300"].join(" ")}>
          <Eraser size={11} /> Apagar
        </button>
        <div className="flex items-center gap-1.5 flex-1">
          <span className="text-[10px] text-zinc-600">Tamanho</span>
          <input type="range" min={Math.round(Math.max(imageW, imageH) * 0.005)} max={Math.round(Math.max(imageW, imageH) * 0.12)}
            value={brush} onChange={(e) => setBrush(Number(e.target.value))} className="flex-1 accent-fuchsia-400 h-1" />
        </div>
        <button onClick={clear} className="flex items-center gap-1 hover:text-zinc-300 transition-colors">
          <Trash2 size={11} /> Limpar
        </button>
      </div>
    </div>
  );
}
