"use client";

/**
 * CalibrateStage — viewer unificado do /calibrate em react-konva (tudo VETOR, nítido
 * em qualquer zoom: sem mais alças/linhas pixeladas do canvas raster + CSS transform).
 *
 * Desenha: imagem base (cena ou render final) + 1 overlay opcional (magenta/disp/material,
 * com blend) + o editor — modo "cantos" (4 cantos + arestas) ou "mesh" (grade Coons +
 * hastes Bézier + marquee/shift). Zoom (roda) e pan (Espaço/botão-meio) próprios do Konva.
 */
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Stage, Layer, Image as KImage, Circle, Line, Rect } from "react-konva";
import type Konva from "konva";
import {
  evalCell, ensureTangents, meshCorners, bilinearQuad,
  hOutOf, hInOf, vOutOf, vInOf, type WarpMesh, type Tangent,
} from "@/lib/mesh-core";

/* Redeclaração local do mesmo shape que o `key-color-core` exporta — ver o
 * comentário em `stores/editorDoc.ts`. */
import type { Pt, QuadCorners as Quad } from "@/lib/key-color-core";
import { wheelZoomFactor } from "@/components/viewer-zoom";
import {
  HANDLE_ACCENT, HANDLE_ACCENT_RGB, HANDLE_ACTIVE, HANDLE_TANGENT, HANDLE_BROKEN, HANDLE_FILL,
} from "@/components/photo-tools/handle-style";
const QK = ["tl", "tr", "br", "bl"] as const;

function useImg(url: string | undefined): HTMLImageElement | null {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!url) { setImg(null); return; }
    const im = new window.Image(); im.crossOrigin = "anonymous";
    im.onload = () => setImg(im); im.src = url;
    return () => { im.onload = null; };
  }, [url]);
  return img;
}

export function CalibrateStage({
  width, height, imageNW, imageNH, baseUrl, overlay,
  mode, quad, onQuadChange, mesh, onMeshChange,
}: {
  width: number; height: number; imageNW: number; imageNH: number;
  baseUrl: string; overlay?: { url: string; opacity: number; blend?: string };
  mode: "cantos" | "mesh";
  quad: Quad; onQuadChange: (q: Quad) => void;
  mesh?: WarpMesh; onMeshChange?: (m: WarpMesh) => void;
}) {
  const base = useImg(baseUrl);
  const ov = useImg(overlay?.url);
  const stageRef = useRef<Konva.Stage>(null);
  const layerRef = useRef<Konva.Layer>(null);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  const fit = useMemo(() => Math.min(width / imageNW, height / imageNH) || 1, [width, height, imageNW, imageNH]);
  const [view, setView] = useState({ scale: fit, x: (width - imageNW * fit) / 2, y: (height - imageNH * fit) / 2 });
  useEffect(() => { setView({ scale: fit, x: (width - imageNW * fit) / 2, y: (height - imageNH * fit) / 2 }); }, [fit, width, height, imageNW, imageNH]);

  const r = 7 / view.scale, hr = 5 / view.scale, lw = 1.6 / view.scale;
  const relPointer = (): Pt | null => { const l = layerRef.current; const p = l?.getRelativePointerPosition(); return p ? { x: p.x, y: p.y } : null; };

  const onWheel = useCallback((e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault(); const stage = stageRef.current; if (!stage) return;
    const ptr = stage.getPointerPosition(); if (!ptr) return;
    const old = view.scale, mp = { x: (ptr.x - view.x) / old, y: (ptr.y - view.y) / old };
    // Alcance local de propósito (encaixe de canto pede mais aproximação que
    // leitura de mockup); a SENSIBILIDADE é compartilhada. Ver `viewer-zoom.tsx`.
    const next = Math.max(0.1, Math.min(40, old * wheelZoomFactor(e.evt.deltaY)));
    setView({ scale: next, x: ptr.x - mp.x * next, y: ptr.y - mp.y * next });
  }, [view]);

  const space = useRef(false);
  useEffect(() => {
    const d = (e: KeyboardEvent) => { const t = (e.target as HTMLElement)?.tagName; if (e.code === "Space" && t !== "INPUT" && t !== "TEXTAREA") space.current = true; };
    const u = (e: KeyboardEvent) => { if (e.code === "Space") space.current = false; };
    window.addEventListener("keydown", d); window.addEventListener("keyup", u);
    return () => { window.removeEventListener("keydown", d); window.removeEventListener("keyup", u); };
  }, []);
  const panning = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);

  const onDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const empty = e.target === stageRef.current || e.target.name() === "scene";
    if (e.evt.button === 1 || space.current) { const p = stageRef.current!.getPointerPosition()!; panning.current = { x: p.x, y: p.y, vx: view.x, vy: view.y }; e.evt.preventDefault(); return; }
    if (mode === "mesh" && empty && e.evt.button === 0) { const p = relPointer(); if (p) setMarquee({ x: p.x, y: p.y, w: 0, h: 0 }); if (!e.evt.shiftKey) setSel(new Set()); }
  };
  const onMove = () => {
    if (panning.current) { const p = stageRef.current!.getPointerPosition()!; setView((v) => ({ ...v, x: panning.current!.vx + (p.x - panning.current!.x), y: panning.current!.vy + (p.y - panning.current!.y) })); return; }
    if (marquee) { const p = relPointer(); if (p) setMarquee((m) => m && ({ ...m, w: p.x - m.x, h: p.y - m.y })); }
  };
  const onUp = (e: Konva.KonvaEventObject<MouseEvent>) => {
    panning.current = null;
    if (marquee && mesh) {
      const x0 = Math.min(marquee.x, marquee.x + marquee.w), x1 = Math.max(marquee.x, marquee.x + marquee.w);
      const y0 = Math.min(marquee.y, marquee.y + marquee.h), y1 = Math.max(marquee.y, marquee.y + marquee.h);
      const hit = new Set<number>(e.evt.shiftKey ? sel : []);
      mesh.points.forEach((p, k) => { if (p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1) hit.add(k); });
      if (Math.abs(marquee.w) > 2 || Math.abs(marquee.h) > 2) setSel(hit);
      setMarquee(null);
    }
  };
  const cursor = panning.current ? "grabbing" : "default";

  // ── cantos (quad) ──
  const cornerLines = useMemo(() => [quad.tl, quad.tr, quad.br, quad.bl, quad.tl].flatMap((p) => [p.x, p.y]), [quad]);

  // ── mesh drag em grupo ──
  const dragStart = useRef<{ base: Pt; pts: Map<number, Pt> } | null>(null);
  const onPtDown = (k: number, e: Konva.KonvaEventObject<MouseEvent>) => {
    if (e.evt.shiftKey) { setSel((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; }); return; }
    if (!sel.has(k)) setSel(new Set([k]));
  };
  const onPtDragStart = (k: number) => { if (!mesh) return; const g = sel.has(k) ? sel : new Set([k]); const pts = new Map<number, Pt>(); g.forEach((i) => pts.set(i, { ...mesh.points[i] })); dragStart.current = { base: { ...mesh.points[k] }, pts }; };
  const onPtDrag = (k: number, e: Konva.KonvaEventObject<DragEvent>) => {
    if (!mesh || !onMeshChange || !dragStart.current) return;
    const dx = e.target.x() - dragStart.current.base.x, dy = e.target.y() - dragStart.current.base.y;
    const next = mesh.points.slice();
    dragStart.current.pts.forEach((p0, i) => { next[i] = { x: Math.round(p0.x + dx), y: Math.round(p0.y + dy) }; });
    onMeshChange({ ...mesh, points: next });
  };
  const R = (p: Pt): Pt => ({ x: Math.round(p.x), y: Math.round(p.y) });
  const neg = (p: Pt): Pt => ({ x: -p.x, y: -p.y });
  // aplica fn(tangent) ao nó k (garante tangents) e commita
  const mutTangent = (k: number, fn: (t: Tangent) => Tangent) => {
    if (!mesh || !onMeshChange) return;
    const m2 = ensureTangents(mesh); const tg = m2.tangents!.slice();
    tg[k] = fn({ ...tg[k] });
    onMeshChange({ ...m2, tangents: tg });
  };
  // arrasta uma haste: mode "mirror" (lados simétricos, C1) ou "break" (Alt, corner)
  const setHandle = (k: number, axis: "h" | "v", side: "out" | "in", offset: Pt, mode: "mirror" | "break") => {
    const off = R(offset);
    mutTangent(k, (t) => {
      if (axis === "h") {
        if (mode === "mirror") return { ...t, h: side === "out" ? off : neg(off), hOut: undefined, hIn: undefined };
        return side === "out"
          ? { ...t, hOut: off, hIn: t.hIn ?? R(hInOf(t)) }
          : { ...t, hIn: off, hOut: t.hOut ?? R(hOutOf(t)) };
      }
      if (mode === "mirror") return { ...t, v: side === "out" ? off : neg(off), vOut: undefined, vIn: undefined };
      return side === "out"
        ? { ...t, vOut: off, vIn: t.vIn ?? R(vInOf(t)) }
        : { ...t, vIn: off, vOut: t.vOut ?? R(vOutOf(t)) };
    });
  };
  // tangente suave de um nó a partir dos vizinhos (Catmull-Rom) — usada no Alt+clique (smooth)
  const neighborTangent = (k: number): { h: Pt; v: Pt } => {
    const cols = mesh!.cols, rows = mesh!.rows, i = Math.floor(k / cols), j = k % cols;
    const P = (a: number, b: number) => mesh!.points[a * cols + b];
    const span = (n0: Pt, n1: Pt, d: number): Pt => ({ x: (n1.x - n0.x) / d, y: (n1.y - n0.y) / d });
    const h = cols < 2 ? { x: 0, y: 0 }
      : j === 0 ? span(P(i, 0), P(i, 1), 3)
      : j === cols - 1 ? span(P(i, j - 1), P(i, j), 3)
      : span(P(i, j - 1), P(i, j + 1), 6);
    const v = rows < 2 ? { x: 0, y: 0 }
      : i === 0 ? span(P(0, j), P(1, j), 3)
      : i === rows - 1 ? span(P(i - 1, j), P(i, j), 3)
      : span(P(i - 1, j), P(i + 1, j), 6);
    return { h: R(h), v: R(v) };
  };
  const hasHandles = (t?: Tangent) => !!t && [t.h, t.v, t.hOut, t.hIn, t.vOut, t.vIn].some((d) => d && (Math.abs(d.x) > 0.5 || Math.abs(d.y) > 0.5));
  // Alt+clique âncora → alterna smooth ⇄ corner (zera hastes)
  const toggleSmoothCorner = (k: number) => {
    if (!mesh) return;
    const curved = hasHandles(mesh.tangents?.[k]);
    if (curved) mutTangent(k, () => ({ h: { x: 0, y: 0 }, v: { x: 0, y: 0 } }));
    else { const nt = neighborTangent(k); mutTangent(k, () => ({ h: nt.h, v: nt.v })); }
  };
  // Ctrl+clique âncora → volta o nó à grade regular + zera hastes
  const resetNode = (k: number) => {
    if (!mesh || !onMeshChange) return;
    const reg = bilinearQuad(meshCorners(mesh), (k % mesh.cols) / (mesh.cols - 1), Math.floor(k / mesh.cols) / (mesh.rows - 1));
    const m2 = ensureTangents(mesh);
    const next = m2.points.slice(); next[k] = R(reg);
    const tg = m2.tangents!.slice(); tg[k] = { h: { x: 0, y: 0 }, v: { x: 0, y: 0 } };
    onMeshChange({ ...m2, points: next, tangents: tg });
  };
  // Alt+clique numa haste → remove só aquela direção/lado (volta reta)
  const clearHandle = (k: number, axis: "h" | "v", side: "out" | "in") =>
    setHandle(k, axis, side, { x: 0, y: 0 }, "break");

  // teclado do mesh: Esc limpa seleção · Delete zera hastes · setas dão nudge.
  // Captura (true) só "rouba" a tecla da página quando há seleção (preserva ←/→ navegação).
  useEffect(() => {
    if (mode !== "mesh") return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "Escape") { setSel(new Set()); return; }
      if (!sel.size || !mesh || !onMeshChange) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault(); e.stopImmediatePropagation();
        const m2 = ensureTangents(mesh); const tg = m2.tangents!.slice();
        sel.forEach((k) => { tg[k] = { h: { x: 0, y: 0 }, v: { x: 0, y: 0 } }; });
        onMeshChange({ ...m2, tangents: tg });
        return;
      }
      const step = e.shiftKey ? 10 : 1; let dx = 0, dy = 0;
      if (e.key === "ArrowLeft") dx = -step; else if (e.key === "ArrowRight") dx = step;
      else if (e.key === "ArrowUp") dy = -step; else if (e.key === "ArrowDown") dy = step; else return;
      e.preventDefault(); e.stopImmediatePropagation();
      const next = mesh.points.slice();
      sel.forEach((k) => { next[k] = { x: next[k].x + dx, y: next[k].y + dy }; });
      onMeshChange({ ...mesh, points: next });
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [mode, sel, mesh, onMeshChange]);

  return (
    <Stage ref={stageRef} width={width} height={height} scaleX={view.scale} scaleY={view.scale} x={view.x} y={view.y}
      onWheel={onWheel} onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} style={{ background: "#0a0a0a", cursor }}>
      <Layer ref={layerRef}>
        {base && <KImage image={base} width={imageNW} height={imageNH} name="scene" />}
        {ov && overlay && <KImage image={ov} width={imageNW} height={imageNH} opacity={overlay.opacity}
          globalCompositeOperation={(overlay.blend as any) || undefined} listening={false} />}

        {/* ── editor: CANTOS ── */}
        {mode === "cantos" && <>
          <Line points={cornerLines} stroke={HANDLE_ACCENT} strokeWidth={lw} closed fill={`rgba(${HANDLE_ACCENT_RGB}, 0.10)`} />
          {QK.map((kk) => {
            const p = quad[kk];
            return <Circle key={kk} x={p.x} y={p.y} radius={r} fill="#fff" stroke={HANDLE_ACCENT} strokeWidth={lw} draggable
              onDragMove={(e) => onQuadChange({ ...quad, [kk]: { x: Math.round(e.target.x()), y: Math.round(e.target.y()) } })} />;
          })}
        </>}

        {/* ── editor: MALHA ── */}
        {mode === "mesh" && mesh && <>
          {Array.from({ length: mesh.rows }).map((_, i) => Array.from({ length: mesh.cols - 1 }).map((__, j) => {
            const ci = Math.min(i, mesh.rows - 2), lv = i === mesh.rows - 1 ? 1 : 0; const pts: number[] = [];
            for (let s = 0; s <= 10; s++) { const p = evalCell(mesh, ci, j, s / 10, lv); pts.push(p.x, p.y); }
            return <Line key={`r${i}_${j}`} points={pts} stroke={HANDLE_ACCENT} strokeWidth={lw} opacity={0.7} listening={false} />;
          }))}
          {Array.from({ length: mesh.rows - 1 }).map((_, i) => Array.from({ length: mesh.cols }).map((__, j) => {
            const cj = Math.min(j, mesh.cols - 2), lu = j === mesh.cols - 1 ? 1 : 0; const pts: number[] = [];
            for (let s = 0; s <= 10; s++) { const p = evalCell(mesh, i, cj, lu, s / 10); pts.push(p.x, p.y); }
            return <Line key={`c${i}_${j}`} points={pts} stroke={HANDLE_ACCENT} strokeWidth={lw} opacity={0.7} listening={false} />;
          }))}
          {/* âncoras (Alt = smooth⇄corner · Ctrl = reset nó) */}
          {mesh.points.map((p, k) => (
            <Circle key={k} x={p.x} y={p.y} radius={sel.has(k) ? r + 1 / view.scale : r}
              fill={sel.has(k) ? HANDLE_ACTIVE : "#fff"} stroke={HANDLE_ACCENT} strokeWidth={lw} draggable
              onMouseDown={(e) => onPtDown(k, e)} onDragStart={() => onPtDragStart(k)} onDragMove={(e) => onPtDrag(k, e)}
              onClick={(e) => {
                if (e.evt.altKey) { e.cancelBubble = true; toggleSmoothCorner(k); }
                else if (e.evt.ctrlKey || e.evt.metaKey) { e.cancelBubble = true; resetNode(k); }
              }} />
          ))}
          {/* hastes Bézier dos nós selecionados (mirror=azul · break=âmbar) */}
          {[...sel].flatMap((k) => {
            const p = mesh.points[k]; const t: Tangent = mesh.tangents?.[k] ?? { h: { x: 0, y: 0 }, v: { x: 0, y: 0 } };
            const cols = mesh.cols, rows = mesh.rows, i = Math.floor(k / cols), j = k % cols;
            const P = (a: number, b: number) => mesh.points[a * cols + b];
            const STUB = 34 / view.scale;
            const dirTo = (q: Pt): Pt => { const dx = q.x - p.x, dy = q.y - p.y, L = Math.hypot(dx, dy) || 1; return { x: (dx / L) * STUB, y: (dy / L) * STUB }; };
            const broH = t.hOut !== undefined || t.hIn !== undefined, broV = t.vOut !== undefined || t.vIn !== undefined;
            const nodes: any[] = [];
            const addH = (id: string, axis: "h" | "v", side: "out" | "in", off: Pt, dir: Pt, broken: boolean) => {
              const o = (Math.abs(off.x) > 0.5 || Math.abs(off.y) > 0.5) ? off : dir;
              const hx = p.x + o.x, hy = p.y + o.y, col = broken ? HANDLE_BROKEN : HANDLE_TANGENT;
              nodes.push(
                <Line key={`l${id}`} points={[p.x, p.y, hx, hy]} stroke={col} strokeWidth={lw} opacity={0.8} listening={false} />,
                <Circle key={`h${id}`} x={hx} y={hy} radius={hr} fill={col} stroke={HANDLE_FILL} strokeWidth={lw} draggable
                  onMouseEnter={(e) => { const s = e.target.getStage(); if (s) s.container().style.cursor = "crosshair"; }}
                  onMouseLeave={(e) => { const s = e.target.getStage(); if (s) s.container().style.cursor = "default"; }}
                  onClick={(e) => { if (e.evt.altKey) { e.cancelBubble = true; clearHandle(k, axis, side); } }}
                  onDragMove={(e) => setHandle(k, axis, side, { x: e.target.x() - p.x, y: e.target.y() - p.y }, e.evt.altKey ? "break" : "mirror")} />,
              );
            };
            if (j < cols - 1) addH(`${k}ho`, "h", "out", hOutOf(t), dirTo(P(i, j + 1)), broH);
            if (j > 0) addH(`${k}hi`, "h", "in", hInOf(t), dirTo(P(i, j - 1)), broH);
            if (i < rows - 1) addH(`${k}vo`, "v", "out", vOutOf(t), dirTo(P(i + 1, j)), broV);
            if (i > 0) addH(`${k}vi`, "v", "in", vInOf(t), dirTo(P(i - 1, j)), broV);
            return nodes;
          })}
          {marquee && <Rect x={marquee.x} y={marquee.y} width={marquee.w} height={marquee.h} fill="rgba(34,197,94,0.12)" stroke={HANDLE_ACCENT} strokeWidth={lw} listening={false} />}
        </>}
      </Layer>
    </Stage>
  );
}
