"use client";

/**
 * QuadEditor — overlay de canvas com 4 alças de canto (+ alças de bend por aresta)
 * sobre uma <img>. SSoT das alças de perspectiva: usado pelo tool Cantos, e pelo
 * warp da Luz (Ctrl). Mapeia ponteiro→imagem pela rect viva (correto em qualquer
 * zoom/pan); dimensiona o canvas pelo LAYOUT (offset*), não pela bounding rect, pra
 * não dobrar a escala do transform do ZoomPanViewer.
 *
 * Extraído de photo-mockup/page.tsx sem mudança de comportamento.
 */
import { useRef, useCallback, useEffect } from "react";
import type { Quad, QuadPt, Bend } from "@/stores/editorDoc";
import { useViewerZoom } from "@/components/viewer-zoom";
import { HANDLE_ACCENT, HANDLE_ACCENT_RGB } from "@/components/photo-tools/handle-style";

const CORNER_KEYS = ["tl", "tr", "br", "bl"] as const;
const HANDLE_R = 9;
// Margem do canvas além da imagem (fração da dimensão da img de cada lado) — deixa
// os cantos/quad saírem da imagem sem cortar no buffer. Os cantos podem ir até a
// borda dessa margem (clamp relaxado). O viewport ainda corta o que vaza dele.
const PAD = 1.0;

const clampN = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

type BendKey = "top" | "right" | "bottom" | "left";
const EDGES: { a: keyof Quad; b: keyof Quad; key: BendKey }[] = [
  { a: "tl", b: "tr", key: "top" },
  { a: "tr", b: "br", key: "right" },
  { a: "br", b: "bl", key: "bottom" },
  { a: "bl", b: "tl", key: "left" },
];

export function QuadEditor({
  imageUrl, imageNW, imageNH, quad, onQuadChange, bend, onBendChange, transparentImg,
}: {
  imageUrl: string; imageNW: number; imageNH: number; quad: Quad; onQuadChange: (q: Quad) => void;
  bend?: Bend; onBendChange?: (b: Bend) => void;
  /** When true the scene img is invisible (opacity 0) — a shared base img shows the pixels;
   *  this element only provides layout/sizing + magnifier source. */
  transparentImg?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const dragging = useRef<keyof Quad | null>(null);
  const draggingEdge = useRef<BendKey | null>(null);
  const hover = useRef<keyof Quad | null>(null); // canto sob o cursor (destaque estilo Figma)
  // Zoom do viewer → desenha alças/linhas/lupa em px-de-canvas ÷ zoom = tamanho de TELA constante.
  const zoom = useViewerZoom();
  const scaleRef = useRef({ sx: 1, sy: 1, ox: 0, oy: 0 });
  const logicalRef = useRef({ cw: 0, ch: 0 }); // tamanho lógico (CSS px); backing = ×res (HiDPI)

  const toCanvas = useCallback(
    (p: QuadPt) => ({ x: p.x * scaleRef.current.sx + scaleRef.current.ox, y: p.y * scaleRef.current.sy + scaleRef.current.oy }),
    []
  );

  // Edge bend geometry (image space): midpoint, outward normal, dimension, handle pos.
  const edgeGeom = useCallback((e: { a: keyof Quad; b: keyof Quad; key: BendKey }) => {
    const a = quad[e.a], b = quad[e.b];
    const cx = (quad.tl.x + quad.tr.x + quad.br.x + quad.bl.x) / 4;
    const cy = (quad.tl.y + quad.tr.y + quad.br.y + quad.bl.y) / 4;
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    let nx = b.y - a.y, ny = -(b.x - a.x);
    const len = Math.hypot(nx, ny) || 1; nx /= len; ny /= len;
    if ((mx - cx) * nx + (my - cy) * ny < 0) { nx = -nx; ny = -ny; } // point outward
    const dist = (p: QuadPt, q: QuadPt) => Math.hypot(p.x - q.x, p.y - q.y);
    const quadW = (dist(quad.tl, quad.tr) + dist(quad.bl, quad.br)) / 2;
    const quadH = (dist(quad.tl, quad.bl) + dist(quad.tr, quad.br)) / 2;
    const dim = e.key === "top" || e.key === "bottom" ? quadH : quadW;
    const bow = (bend?.[e.key] ?? 0) * dim;
    return { mx, my, nx, ny, dim, bow, handle: { x: mx + nx * bow, y: my + ny * bow } };
  }, [quad, bend]);
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    // HiDPI: backing-store ×res (devicePixelRatio × zoom do viewer) → linhas/alças nítidas
    // sob o transform CSS do ZoomPanViewer (sem mais pixelização). Desenho em px lógico.
    const { cw, ch } = logicalRef.current;
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    const res = Math.max(1, Math.min(4, dpr * zoom));
    if (cw > 0) {
      const bw = Math.round(cw * res), bh = Math.round(ch * res);
      if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh; }
      ctx.setTransform(res, 0, 0, res, 0, 0);
      ctx.clearRect(0, 0, cw, ch);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    const k = (px: number) => px / zoom; // px-de-canvas p/ tamanho de tela constante

    const pts = CORNER_KEYS.map((kk) => toCanvas(quad[kk]));

    // Trace the quad outline — edges curve when bent (quadratic bezier through the bow).
    const tracePath = () => {
      ctx.beginPath();
      const start = toCanvas(quad.tl);
      ctx.moveTo(start.x, start.y);
      for (const e of EDGES) {
        const g = edgeGeom(e);
        const end = toCanvas(quad[e.b]);
        if (Math.abs(g.bow) > 0.01) {
          const ctrl = toCanvas({ x: g.mx + g.nx * 2 * g.bow, y: g.my + g.ny * 2 * g.bow });
          ctx.quadraticCurveTo(ctrl.x, ctrl.y, end.x, end.y);
        } else {
          ctx.lineTo(end.x, end.y);
        }
      }
      ctx.closePath();
    };

    tracePath();
    ctx.fillStyle = `rgba(${HANDLE_ACCENT_RGB}, 0.12)`;
    ctx.fill();
    tracePath();
    ctx.strokeStyle = HANDLE_ACCENT;
    ctx.lineWidth = k(2);
    ctx.stroke();

    // Edge bend handles (small diamonds at each edge midpoint)
    if (onBendChange) {
      for (const e of EDGES) {
        const g = edgeGeom(e);
        const h = toCanvas(g.handle);
        const active = draggingEdge.current === e.key;
        ctx.save();
        ctx.translate(h.x, h.y);
        ctx.rotate(Math.PI / 4);
        const s = k(active ? 7 : 5);
        ctx.fillStyle = active ? "#16a34a" : "#0a0a0a";
        ctx.strokeStyle = HANDLE_ACCENT;
        ctx.lineWidth = k(2);
        ctx.fillRect(-s, -s, s * 2, s * 2);
        ctx.strokeRect(-s, -s, s * 2, s * 2);
        ctx.restore();
      }
    }

    CORNER_KEYS.forEach((kk, i) => {
      const { x, y } = pts[i];
      const active = dragging.current === kk;
      const hovered = !active && hover.current === kk;
      ctx.beginPath();
      ctx.arc(x, y, k(active ? HANDLE_R + 2 : hovered ? HANDLE_R + 1 : HANDLE_R - 2), 0, Math.PI * 2);
      ctx.fillStyle = active ? "#16a34a" : hovered ? HANDLE_ACCENT : "#ffffff";
      ctx.fill();
      ctx.strokeStyle = active || hovered ? "#fff" : HANDLE_ACCENT;
      ctx.lineWidth = k(2);
      ctx.stroke();
    });

    if (dragging.current && imgRef.current?.complete) {
      const corner = toCanvas(quad[dragging.current]);
      const LENS_R = k(72);
      const ZOOM = 5;
      const off = k(106), pad = k(8);

      const { cw, ch } = logicalRef.current; // dims lógicas (HiDPI desenha em px lógico)
      let lx = corner.x + off;
      let ly = corner.y - off;
      if (lx + LENS_R > cw - pad) lx = corner.x - off;
      if (ly - LENS_R < pad) ly = corner.y + off;
      lx = Math.max(LENS_R + pad, Math.min(cw - LENS_R - pad, lx));
      ly = Math.max(LENS_R + pad, Math.min(ch - LENS_R - pad, ly));

      const imgX = (corner.x - scaleRef.current.ox) / scaleRef.current.sx;
      const imgY = (corner.y - scaleRef.current.oy) / scaleRef.current.sy;
      const srcW = (LENS_R * 2) / ZOOM / scaleRef.current.sx;
      const srcH = (LENS_R * 2) / ZOOM / scaleRef.current.sy;

      ctx.save();
      ctx.beginPath();
      ctx.arc(lx, ly, LENS_R, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = "#050505";
      ctx.fill();
      ctx.drawImage(
        imgRef.current,
        Math.max(0, imgX - srcW / 2), Math.max(0, imgY - srcH / 2), srcW, srcH,
        lx - LENS_R, ly - LENS_R, LENS_R * 2, LENS_R * 2,
      );
      ctx.restore();

      ctx.beginPath();
      ctx.arc(lx, ly, LENS_R, 0, Math.PI * 2);
      ctx.strokeStyle = HANDLE_ACCENT;
      ctx.lineWidth = k(2.5);
      ctx.stroke();

      ctx.save();
      ctx.shadowColor = "#000";
      ctx.shadowBlur = k(4);
      ctx.strokeStyle = HANDLE_ACCENT;
      ctx.lineWidth = k(1.5);
      const cr = k(15);
      ctx.beginPath();
      ctx.moveTo(lx - cr, ly); ctx.lineTo(lx + cr, ly);
      ctx.moveTo(lx, ly - cr); ctx.lineTo(lx, ly + cr);
      ctx.stroke();
      ctx.restore();

      ctx.beginPath();
      ctx.arc(lx, ly, k(2.5), 0, Math.PI * 2);
      ctx.fillStyle = HANDLE_ACCENT;
      ctx.fill();

      ctx.save();
      ctx.strokeStyle = `rgba(${HANDLE_ACCENT_RGB},0.35)`;
      ctx.lineWidth = k(1);
      ctx.setLineDash([k(3), k(3)]);
      ctx.beginPath();
      ctx.moveTo(corner.x, corner.y);
      ctx.lineTo(lx, ly);
      ctx.stroke();
      ctx.restore();
    }
  }, [quad, toCanvas, edgeGeom, onBendChange, zoom]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const img = container.querySelector("img");
    const canvas = canvasRef.current;
    if (!canvas || !img) return;
    const update = () => {
      // Use LAYOUT size (offset*), not getBoundingClientRect — the latter reflects the
      // ZoomPanViewer CSS transform, which would double-scale the canvas. Sizing to layout
      // means the canvas (and its handles) scale uniformly WITH the transform → always aligned.
      const iw = (img as HTMLElement).offsetWidth, ih = (img as HTMLElement).offsetHeight;
      // Canvas maior que a img (PAD de cada lado) + deslocado p/ -pad → desenha o
      // quad/cantos que vazam da imagem sem cortar no buffer. ox/oy = origem da img.
      const padX = Math.round(iw * PAD), padY = Math.round(ih * PAD);
      const cw = iw + padX * 2, ch = ih + padY * 2;
      logicalRef.current = { cw, ch };           // tamanho lógico (CSS px); draw() faz o backing ×res
      canvas.style.left = `${-padX}px`; canvas.style.top = `${-padY}px`;
      canvas.style.width = `${cw}px`; canvas.style.height = `${ch}px`;
      scaleRef.current = { sx: iw / imageNW, sy: ih / imageNH, ox: padX, oy: padY };
      draw();
    };
    const ro = new ResizeObserver(update);
    ro.observe(container);
    img.onload = update;
    update();
    return () => ro.disconnect();
  }, [imageNW, imageNH, draw]);

  useEffect(() => { draw(); }, [draw]);

  // Map a screen point to IMAGE coords using the LIVE rect (correct at any zoom),
  // plus the on-screen scale (image-px per screen-px) for tolerance conversion.
  const clientToImg = (clientX: number, clientY: number) => {
    const r = imgRef.current!.getBoundingClientRect();
    const sc = (r.width / imageNW) || 1;
    return { x: (clientX - r.left) / r.width * imageNW, y: (clientY - r.top) / r.height * imageNH, sc };
  };

  const hitTest = (ix: number, iy: number, sc: number): keyof Quad | null => {
    const tol = (HANDLE_R + 8) / sc;
    for (const k of CORNER_KEYS) if (Math.hypot(ix - quad[k].x, iy - quad[k].y) <= tol) return k;
    return null;
  };
  const edgeHitTest = (ix: number, iy: number, sc: number): BendKey | null => {
    if (!onBendChange) return null;
    const tol = (HANDLE_R + 6) / sc;
    for (const e of EDGES) { const h = edgeGeom(e).handle; if (Math.hypot(ix - h.x, iy - h.y) <= tol) return e.key; }
    return null;
  };

  const onMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return; // só botão esquerdo — meio/direito não mexem nas alças (meio = pan)
    const { x, y, sc } = clientToImg(e.clientX, e.clientY);
    const k = hitTest(x, y, sc);
    if (k) { e.preventDefault(); dragging.current = k; draw(); return; }
    const ek = edgeHitTest(x, y, sc);
    if (ek) { e.preventDefault(); draggingEdge.current = ek; draw(); }
  };

  const onMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y, sc } = clientToImg(e.clientX, e.clientY);
    // Edge bend drag — project the cursor (image space) onto the edge's outward normal
    if (draggingEdge.current && onBendChange && bend) {
      const e2 = EDGES.find((q) => q.key === draggingEdge.current)!;
      const g = edgeGeom(e2);
      const d = (x - g.mx) * g.nx + (y - g.my) * g.ny;
      onBendChange({ ...bend, [draggingEdge.current]: clampN(d / (g.dim || 1), -0.3, 0.3) });
      return;
    }
    if (!dragging.current) {
      const hit = hitTest(x, y, sc);
      (e.currentTarget as HTMLCanvasElement).style.cursor = (hit || edgeHitTest(x, y, sc)) ? "grab" : "default";
      if (hover.current !== hit) { hover.current = hit; draw(); } // destaque do canto no hover
      return;
    }
    // Corner follows the cursor directly in image space — robust at any zoom/pan.
    // Clamp relaxado: o canto pode sair da imagem até a borda da margem (PAD) do canvas.
    onQuadChange({ ...quad, [dragging.current]: { x: Math.round(clampN(x, -imageNW * PAD, imageNW * (1 + PAD))), y: Math.round(clampN(y, -imageNH * PAD, imageNH * (1 + PAD))) } });
  };

  const onMouseUp = () => { dragging.current = null; draggingEdge.current = null; draw(); };

  // Duplo-clique num canto → encaixa no canto correspondente da imagem (preenche o frame).
  const IMG_CORNER: Record<keyof Quad, [number, number]> = { tl: [0, 0], tr: [1, 0], br: [1, 1], bl: [0, 1] };
  const onDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y, sc } = clientToImg(e.clientX, e.clientY);
    const k = hitTest(x, y, sc);
    if (!k) return;
    e.preventDefault(); e.stopPropagation();
    const [fx, fy] = IMG_CORNER[k];
    onQuadChange({ ...quad, [k]: { x: Math.round(fx * imageNW), y: Math.round(fy * imageNH) } });
  };

  return (
    <div ref={containerRef} className="relative select-none">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img ref={imgRef} src={imageUrl} alt="photo" className="w-full block rounded-xl" draggable={false}
        style={transparentImg ? { opacity: 0 } : undefined} />
      <canvas
        ref={canvasRef}
        className="absolute"
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={() => { hover.current = null; onMouseUp(); }}
        onDoubleClick={onDoubleClick}
      />
    </div>
  );
}
