"use client";

/**
 * PenMaskCanvas — CANVAS ONLY (image + bezier path + handles). Options (feather)
 * and actions (undo / clear / apply) live in the side panel and are passed in /
 * exposed via `apiRef`, matching the Recorte (SegmentCanvas) pattern.
 *   • Click = corner anchor · Click+drag = smooth anchor (handles) · drag anchor/handle
 *     to reshape · click first dot = close. Rasterizes (bezierCurveTo) → alpha mask.
 */
import { useEffect, useRef, useState, useCallback } from "react";
import { useViewerZoom } from "@/components/viewer-zoom";
import { ACC, ACC_RGB, ACC2, INK, OLIVE } from "@/lib/brand";

type Role = "surface" | "occluder";
type Pt = { x: number; y: number };
type Anchor = { x: number; y: number; hIn?: Pt; hOut?: Pt };
type Drag =
  | { kind: "anchor"; i: number; ox: number; oy: number }
  | { kind: "hOut"; i: number }
  | { kind: "hIn"; i: number }
  | { kind: "new"; i: number };
export type PenApi = { apply: (r: Role) => void; clear: () => void; undo: () => void };

const HIT = 9;

function tracePath(ctx: CanvasRenderingContext2D, a: Anchor[], closed: boolean, s: number) {
  if (a.length === 0) return;
  ctx.beginPath();
  ctx.moveTo(a[0].x * s, a[0].y * s);
  const segs = closed ? a.length : a.length - 1;
  for (let i = 0; i < segs; i++) {
    const A = a[i], B = a[(i + 1) % a.length];
    const c1 = A.hOut ?? A, c2 = B.hIn ?? B;
    if (A.hOut || B.hIn) ctx.bezierCurveTo(c1.x * s, c1.y * s, c2.x * s, c2.y * s, B.x * s, B.y * s);
    else ctx.lineTo(B.x * s, B.y * s);
  }
  if (closed) ctx.closePath();
}

export default function PenMaskCanvas({
  imageUrl, imageW, imageH, onApply, feather, onMaskChange, onStatus, apiRef, transparentImg,
}: {
  imageUrl: string;
  imageW: number;
  imageH: number;
  onApply: (role: Role, maskDataUrl: string) => void;
  feather: number;
  onMaskChange?: (hasMask: boolean) => void;
  onStatus?: (s: string) => void;
  apiRef?: React.MutableRefObject<PenApi | null>;
  /** Hide this img (opacity 0) — a shared base img underneath shows the pixels. */
  transparentImg?: boolean;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<Drag | null>(null);
  const hover = useRef<Pt | null>(null); // posição do cursor (img) p/ a linha-guia
  const [anchors, setAnchors] = useState<Anchor[]>([]);
  const [closed, setClosed] = useState(false);
  const zoom = useViewerZoom(); // marcadores ÷ zoom = tamanho de tela constante

  const sc = useCallback(() => {
    const img = imgRef.current;
    return img ? img.getBoundingClientRect().width / imageW : 1;
  }, [imageW]);

  const draw = useCallback(() => {
    const canvas = overlayRef.current, img = imgRef.current;
    if (!canvas || !img) return;
    const w = img.offsetWidth, h = img.offsetHeight;
    if (!w || !h) return;
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, w, h);
    const s = w / imageW;
    const k = (px: number) => px / zoom; // tamanho de TELA constante no zoom
    if (anchors.length === 0) return;
    // Linha-guia tracejada — preview do próximo segmento (último anchor → cursor).
    if (!closed && hover.current && !drag.current) {
      const last = anchors[anchors.length - 1];
      ctx.save();
      ctx.setLineDash([k(4), k(4)]);
      ctx.lineWidth = k(1.5); ctx.strokeStyle = `rgba(${ACC_RGB},0.55)`;
      ctx.beginPath();
      ctx.moveTo(last.x * s, last.y * s);
      ctx.lineTo(hover.current.x * s, hover.current.y * s);
      ctx.stroke();
      ctx.restore();
    }
    tracePath(ctx, anchors, closed, s);
    // A caneta era toda da família ciano (#22d3ee / #67e8f9 / #0e7490), que não
    // existe na paleta da BOXY. Vira a família verde mantendo a MESMA hierarquia
    // de leitura: traço (acc) < alça de Bézier (sage) < âncora inicial (acc2).
    if (closed) { ctx.fillStyle = `rgba(${ACC_RGB},0.18)`; ctx.fill(); }
    ctx.lineWidth = k(2); ctx.strokeStyle = ACC; ctx.stroke();
    ctx.lineWidth = k(1); ctx.strokeStyle = ACC;
    anchors.forEach((p) => {
      for (const hp of [p.hIn, p.hOut]) {
        if (!hp) continue;
        ctx.beginPath(); ctx.moveTo(p.x * s, p.y * s); ctx.lineTo(hp.x * s, hp.y * s); ctx.stroke();
        ctx.fillStyle = INK; ctx.fillRect(hp.x * s - k(3), hp.y * s - k(3), k(6), k(6));
      }
    });
    anchors.forEach((p, i) => {
      ctx.beginPath();
      ctx.arc(p.x * s, p.y * s, k(i === 0 && !closed ? 7 : 5), 0, Math.PI * 2);
      ctx.fillStyle = i === 0 && !closed ? ACC2 : "#fff";
      ctx.fill();
      ctx.lineWidth = k(2); ctx.strokeStyle = OLIVE; ctx.stroke();
    });
  }, [anchors, closed, imageW, zoom]);

  useEffect(() => { draw(); }, [draw]);
  useEffect(() => {
    const ro = new ResizeObserver(() => draw());
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, [draw]);

  const hasMask = closed && anchors.length >= 2;
  useEffect(() => { onMaskChange?.(hasMask); }, [hasMask, onMaskChange]);
  useEffect(() => {
    onStatus?.(!anchors.length ? "clique = canto · clique-arraste = curva"
      : !closed ? `${anchors.length} âncoras · feche no ponto verde`
      : "fechado · arraste âncoras/handles");
  }, [anchors.length, closed, onStatus]);

  const toImg = (e: React.PointerEvent) => {
    const r = imgRef.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * imageW, y: ((e.clientY - r.top) / r.height) * imageH };
  };
  const near = (a: Pt, b: Pt, s: number) => Math.hypot((a.x - b.x) * s, (a.y - b.y) * s) <= HIT + 2;

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return; // só esquerdo cria/edita âncoras (meio = pan)
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const p = toImg(e); const s = sc();
    for (let i = 0; i < anchors.length; i++) {
      if (anchors[i].hOut && near(anchors[i].hOut!, p, s)) { drag.current = { kind: "hOut", i }; return; }
      if (anchors[i].hIn && near(anchors[i].hIn!, p, s)) { drag.current = { kind: "hIn", i }; return; }
    }
    for (let i = 0; i < anchors.length; i++) {
      if (near(anchors[i], p, s)) {
        if (i === 0 && !closed && anchors.length >= 2) { setClosed(true); return; }
        drag.current = { kind: "anchor", i, ox: p.x - anchors[i].x, oy: p.y - anchors[i].y };
        return;
      }
    }
    if (!closed) setAnchors((prev) => { drag.current = { kind: "new", i: prev.length }; return [...prev, { x: p.x, y: p.y }]; });
  };
  const onPointerMove = (e: React.PointerEvent) => {
    hover.current = toImg(e);
    const d = drag.current;
    if (!d) { draw(); return; } // sem arrastar → só atualiza a linha-guia
    const p = toImg(e);
    setAnchors((prev) => prev.map((a, i) => {
      if (i !== d.i) return a;
      if (d.kind === "anchor") {
        const dx = p.x - d.ox - a.x, dy = p.y - d.oy - a.y;
        return { x: a.x + dx, y: a.y + dy, hIn: a.hIn ? { x: a.hIn.x + dx, y: a.hIn.y + dy } : undefined, hOut: a.hOut ? { x: a.hOut.x + dx, y: a.hOut.y + dy } : undefined };
      }
      const out = d.kind === "hIn" ? { x: 2 * a.x - p.x, y: 2 * a.y - p.y } : p;
      const inn = d.kind === "hIn" ? p : { x: 2 * a.x - p.x, y: 2 * a.y - p.y };
      return { ...a, hOut: out, hIn: inn };
    }));
  };
  const onPointerUp = () => { drag.current = null; };

  const apply = useCallback((role: Role) => {
    if (!closed || anchors.length < 2) return;
    const c = document.createElement("canvas"); c.width = imageW; c.height = imageH;
    const ctx = c.getContext("2d")!;
    if (feather > 0) ctx.filter = `blur(${feather}px)`;
    ctx.fillStyle = "#fff"; tracePath(ctx, anchors, true, 1); ctx.fill(); ctx.filter = "none";
    onApply(role, c.toDataURL("image/png"));
  }, [closed, anchors, feather, imageW, imageH, onApply]);
  const clear = useCallback(() => { setAnchors([]); setClosed(false); }, []);
  const undo = useCallback(() => { setClosed(false); setAnchors((a) => a.slice(0, -1)); }, []);
  useEffect(() => { if (apiRef) apiRef.current = { apply, clear, undo }; }, [apiRef, apply, clear, undo]);

  return (
    <div ref={wrapRef} className="relative select-none rounded-xl overflow-hidden touch-none">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img ref={imgRef} src={imageUrl} alt="scene" draggable={false} className="w-full block" style={{ cursor: "crosshair", ...(transparentImg ? { opacity: 0 } : null) }} />
      <canvas
        ref={overlayRef}
        className="absolute inset-0"
        style={{ cursor: closed ? "move" : "crosshair" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => { hover.current = null; draw(); }}
        onDoubleClick={() => { if (!closed && anchors.length >= 2) setClosed(true); }}
      />
    </div>
  );
}
