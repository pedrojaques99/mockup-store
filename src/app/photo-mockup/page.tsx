"use client";

import { useState, useRef, useCallback, useEffect, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Upload, Loader2, AlertTriangle, CheckCircle2, RefreshCw,
  ChevronRight, Eye, Sliders, Download, Wand2, Zap, Camera,
} from "lucide-react";
import Draggable from "react-draggable";
import ArtFramePanel from "@/components/ArtFramePanel";
import ZoomPanViewer from "@/components/ZoomPanViewer";
import SegmentCanvas from "@/components/SegmentCanvas";
import BrushCanvas from "@/components/BrushCanvas";
import { DEFAULT_FRAME, type FrameConfig, renderFramedArt } from "@/lib/art-frame";

// ── Types ─────────────────────────────────────────────────────────────────────

interface QuadPt { x: number; y: number }
interface Quad { tl: QuadPt; tr: QuadPt; br: QuadPt; bl: QuadPt }

interface Analysis {
  id: string;
  quad: Quad;
  surfaceType: string;
  material: string;
  hasOcclusion: boolean;
  occlusionDesc: string;
  lightingDir: string;
  confidence: number;
  imageWidth: number;
  imageHeight: number;
  cached?: boolean;
}

type StepId = "upload" | "analyze" | "process" | "render";
type StepState = "idle" | "loading" | "done" | "error";

const LOOK_PRESETS = [
  { name: "Natural", grain: 0,  warmth: 0,   saturation: 100, brightness: 100 },
  { name: "Warm",    grain: 5,  warmth: 30,  saturation: 110, brightness: 102 },
  { name: "Cold",    grain: 5,  warmth: -30, saturation: 95,  brightness: 100 },
  { name: "Matte",   grain: 15, warmth: 5,   saturation: 75,  brightness: 95  },
  { name: "Vivid",   grain: 0,  warmth: 0,   saturation: 145, brightness: 105 },
  { name: "B&W",     grain: 18, warmth: 0,   saturation: 0,   brightness: 100 },
] as const;

const AI_BLEND_DEFAULTS: Record<string, { enabled: boolean; strength: number; texture: boolean; textureOpacity: number }> = {
  fabric:    { enabled: true,  strength: 0.40, texture: true,  textureOpacity: 0.30 },
  tshirt:    { enabled: true,  strength: 0.40, texture: true,  textureOpacity: 0.30 },
  bag:       { enabled: true,  strength: 0.35, texture: true,  textureOpacity: 0.25 },
  wall:      { enabled: true,  strength: 0.30, texture: true,  textureOpacity: 0.20 },
  box:       { enabled: true,  strength: 0.25, texture: true,  textureOpacity: 0.20 },
  billboard: { enabled: false, strength: 0.10, texture: false, textureOpacity: 0.10 },
  poster:    { enabled: false, strength: 0.10, texture: false, textureOpacity: 0.10 },
  card:      { enabled: false, strength: 0.10, texture: false, textureOpacity: 0.10 },
  paper:     { enabled: false, strength: 0.15, texture: false, textureOpacity: 0.15 },
  screen:    { enabled: false, strength: 0.10, texture: false, textureOpacity: 0.00 },
};

// ── Quad canvas overlay ───────────────────────────────────────────────────────

const CORNER_KEYS = ["tl", "tr", "br", "bl"] as const;
const HANDLE_R = 9;

const clampN = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Speed-adaptive control-display gain for pixel-perfect dragging.
 * Normal 1:1 by default — precision only engages when the user moves very
 * slowly (a few px per event), i.e. deliberately hunting for the exact pixel.
 * `speedPx` is the cursor delta magnitude (canvas px) for this move event.
 */
function precisionGain(speedPx: number): number {
  const SLOW = 3.5;       // ≥ this px/event → full 1:1 (normal drag)
  const MIN_GAIN = 0.25;  // gain at near-still → fine
  if (speedPx >= SLOW) return 1;
  return MIN_GAIN + (1 - MIN_GAIN) * (speedPx / SLOW); // linear ease in the slow band
}

type BendKey = "top" | "right" | "bottom" | "left";
const EDGES: { a: keyof Quad; b: keyof Quad; key: BendKey }[] = [
  { a: "tl", b: "tr", key: "top" },
  { a: "tr", b: "br", key: "right" },
  { a: "br", b: "bl", key: "bottom" },
  { a: "bl", b: "tl", key: "left" },
];
interface Bend { top: number; bottom: number; left: number; right: number }

function QuadEditor({
  imageUrl, imageNW, imageNH, quad, onQuadChange, bend, onBendChange,
}: {
  imageUrl: string; imageNW: number; imageNH: number; quad: Quad; onQuadChange: (q: Quad) => void;
  bend?: Bend; onBendChange?: (b: Bend) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const dragging = useRef<keyof Quad | null>(null);
  const draggingEdge = useRef<BendKey | null>(null);
  const scaleRef = useRef({ sx: 1, sy: 1, ox: 0, oy: 0 });
  const lastMouse = useRef<{ x: number; y: number } | null>(null); // canvas px
  const dragPos = useRef<QuadPt | null>(null);                     // float image coords
  const fineMode = useRef(false);                                  // precision engaged?

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
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const pts = CORNER_KEYS.map((k) => toCanvas(quad[k]));

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
    ctx.fillStyle = "rgba(34, 197, 94, 0.12)";
    ctx.fill();
    tracePath();
    ctx.strokeStyle = "#22c55e";
    ctx.lineWidth = 2;
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
        const s = active ? 7 : 5;
        ctx.fillStyle = active ? "#16a34a" : "#0a0a0a";
        ctx.strokeStyle = "#22c55e";
        ctx.lineWidth = 2;
        ctx.fillRect(-s, -s, s * 2, s * 2);
        ctx.strokeRect(-s, -s, s * 2, s * 2);
        ctx.restore();
      }
    }

    CORNER_KEYS.forEach((k, i) => {
      const { x, y } = pts[i];
      const active = dragging.current === k;
      ctx.beginPath();
      ctx.arc(x, y, active ? HANDLE_R + 2 : HANDLE_R - 2, 0, Math.PI * 2);
      ctx.fillStyle = active ? "#16a34a" : "#ffffff";
      ctx.fill();
      ctx.strokeStyle = active ? "#fff" : "#22c55e";
      ctx.lineWidth = 2;
      ctx.stroke();
    });

    if (dragging.current && imgRef.current?.complete) {
      const corner = toCanvas(quad[dragging.current]);
      const LENS_R = 72;
      const ZOOM = 5;

      let lx = corner.x + 106;
      let ly = corner.y - 106;
      if (lx + LENS_R > canvas.width - 8) lx = corner.x - 106;
      if (ly - LENS_R < 8) ly = corner.y + 106;
      lx = Math.max(LENS_R + 8, Math.min(canvas.width - LENS_R - 8, lx));
      ly = Math.max(LENS_R + 8, Math.min(canvas.height - LENS_R - 8, ly));

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
      ctx.strokeStyle = "#22c55e";
      ctx.lineWidth = 2.5;
      ctx.stroke();

      ctx.save();
      ctx.shadowColor = "#000";
      ctx.shadowBlur = 4;
      ctx.strokeStyle = "#22c55e";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(lx - 15, ly); ctx.lineTo(lx + 15, ly);
      ctx.moveTo(lx, ly - 15); ctx.lineTo(lx, ly + 15);
      ctx.stroke();
      ctx.restore();

      ctx.beginPath();
      ctx.arc(lx, ly, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = "#22c55e";
      ctx.fill();

      // Precision-mode badge — shown when slow, fine dragging is engaged
      if (fineMode.current) {
        ctx.save();
        ctx.font = "700 10px ui-monospace, monospace";
        ctx.textAlign = "center";
        const label = "FINE";
        const tw = ctx.measureText(label).width + 10;
        ctx.fillStyle = "rgba(16,185,129,0.92)";
        ctx.beginPath();
        ctx.roundRect(lx - tw / 2, ly + LENS_R + 6, tw, 15, 4);
        ctx.fill();
        ctx.fillStyle = "#06281c";
        ctx.fillText(label, lx, ly + LENS_R + 17);
        ctx.restore();
      }

      ctx.save();
      ctx.strokeStyle = "rgba(34,197,94,0.35)";
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(corner.x, corner.y);
      ctx.lineTo(lx, ly);
      ctx.stroke();
      ctx.restore();
    }
  }, [quad, toCanvas, edgeGeom, onBendChange]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const img = container.querySelector("img");
    const canvas = canvasRef.current;
    if (!canvas || !img) return;
    const update = () => {
      const r = img.getBoundingClientRect();
      const cr = container.getBoundingClientRect();
      canvas.width = cr.width;
      canvas.height = cr.height;
      scaleRef.current = { sx: r.width / imageNW, sy: r.height / imageNH, ox: r.left - cr.left, oy: r.top - cr.top };
      draw();
    };
    const ro = new ResizeObserver(update);
    ro.observe(container);
    img.onload = update;
    update();
    return () => ro.disconnect();
  }, [imageNW, imageNH, draw]);

  useEffect(() => { draw(); }, [draw]);

  const hitTest = (cx: number, cy: number): keyof Quad | null => {
    for (const k of CORNER_KEYS) {
      const p = toCanvas(quad[k]);
      if (Math.hypot(cx - p.x, cy - p.y) <= HANDLE_R + 6) return k;
    }
    return null;
  };

  const edgeHitTest = (cx: number, cy: number): BendKey | null => {
    if (!onBendChange) return null;
    for (const e of EDGES) {
      const h = toCanvas(edgeGeom(e).handle);
      if (Math.hypot(cx - h.x, cy - h.y) <= HANDLE_R + 4) return e.key;
    }
    return null;
  };

  const onMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = canvasRef.current!.getBoundingClientRect();
    const cx = e.clientX - r.left, cy = e.clientY - r.top;
    dragging.current = hitTest(cx, cy);
    if (dragging.current) {
      e.preventDefault();
      lastMouse.current = { x: cx, y: cy };
      dragPos.current = { ...quad[dragging.current] }; // start relative drag from current corner
      fineMode.current = false;
      draw();
      return;
    }
    draggingEdge.current = edgeHitTest(cx, cy);
    if (draggingEdge.current) { e.preventDefault(); draw(); }
  };

  const onMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = canvasRef.current!.getBoundingClientRect();
    const cx = e.clientX - r.left, cy = e.clientY - r.top;

    // Edge bend drag — project the cursor onto the edge's outward normal
    if (draggingEdge.current && onBendChange && bend) {
      const e2 = EDGES.find((x) => x.key === draggingEdge.current)!;
      const g = edgeGeom(e2);
      const { sx, sy, ox, oy } = scaleRef.current;
      const imgX = (cx - ox) / sx, imgY = (cy - oy) / sy;
      const d = (imgX - g.mx) * g.nx + (imgY - g.my) * g.ny; // signed distance along normal (px)
      onBendChange({ ...bend, [draggingEdge.current]: clampN(d / (g.dim || 1), -0.3, 0.3) });
      return;
    }

    if (!dragging.current || !lastMouse.current || !dragPos.current) return;
    const dcx = cx - lastMouse.current.x;
    const dcy = cy - lastMouse.current.y;
    lastMouse.current = { x: cx, y: cy };

    // Speed-adaptive gain: 1:1 normally, fine only when moving very slowly
    const gain = precisionGain(Math.hypot(dcx, dcy));
    fineMode.current = gain < 0.9;

    const { sx, sy } = scaleRef.current;
    dragPos.current.x = clampN(dragPos.current.x + (dcx * gain) / sx, 0, imageNW);
    dragPos.current.y = clampN(dragPos.current.y + (dcy * gain) / sy, 0, imageNH);

    onQuadChange({
      ...quad,
      [dragging.current]: { x: Math.round(dragPos.current.x), y: Math.round(dragPos.current.y) },
    });
  };

  const onMouseUp = () => {
    dragging.current = null; draggingEdge.current = null;
    lastMouse.current = null; dragPos.current = null; fineMode.current = false; draw();
  };

  const getCursor = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = canvasRef.current!.getBoundingClientRect();
    const cx = e.clientX - r.left, cy = e.clientY - r.top;
    return hitTest(cx, cy) || edgeHitTest(cx, cy) ? "grab" : "default";
  };

  return (
    <div ref={containerRef} className="relative select-none">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img ref={imgRef} src={imageUrl} alt="photo" className="w-full block rounded-xl" draggable={false} />
      <canvas
        ref={canvasRef}
        className="absolute inset-0"
        onMouseDown={onMouseDown}
        onMouseMove={(e) => { onMouseMove(e); (e.currentTarget.style.cursor = getCursor(e)); }}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
      />
    </div>
  );
}

// ── Compact pipeline dot ─────────────────────────────────────────────────────

function StepPip({ label, state, active }: { label: string; state: StepState; active: boolean }) {
  const dot = state === "done"    ? "bg-green-500"
            : state === "loading" ? "bg-blue-400 animate-pulse"
            : state === "error"   ? "bg-red-500"
            : active              ? "bg-zinc-400"
            :                       "bg-zinc-700";
  const text = active || state === "loading" ? "text-zinc-200"
             : state === "done"              ? "text-zinc-500"
             :                                 "text-zinc-700";
  return (
    <div className="flex items-center gap-1.5">
      <span className={["w-1.5 h-1.5 rounded-full flex-none", dot].join(" ")} />
      <span className={["text-xs", text].join(" ")}>{label}</span>
      {state === "loading" && <Loader2 size={9} className="animate-spin text-blue-400 flex-none" />}
    </div>
  );
}

// ── Artwork drop zone (SSOT — used by panel + full-screen canvas) ─────────────

function ArtDropZone({
  onFile, dragOver, size = "panel", className = "",
}: {
  onFile: (f: File) => void;
  dragOver: boolean;
  size?: "panel" | "hero";
  className?: string;
}) {
  const hero = size === "hero";
  return (
    <div
      onClick={() => document.getElementById("art-input-fs")?.click()}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f?.type.startsWith("image/")) onFile(f); }}
      className={[
        "rounded-2xl border-2 border-dashed cursor-pointer transition-colors flex flex-col items-center justify-center text-center group",
        hero ? "gap-3 px-12 py-16 w-[min(440px,70vw)]" : "gap-1.5 p-3 h-24",
        dragOver
          ? "border-indigo-400 bg-indigo-500/10"
          : "border-zinc-700 hover:border-zinc-500 bg-zinc-900/30 hover:bg-zinc-900/50",
        className,
      ].join(" ")}
    >
      <Upload
        size={hero ? 40 : 20}
        className={dragOver ? "text-indigo-400" : "text-zinc-600 group-hover:text-zinc-400 transition-colors"}
      />
      <p className={[hero ? "text-base" : "text-[10px]", "font-medium transition-colors", dragOver ? "text-indigo-300" : "text-zinc-500 group-hover:text-zinc-300"].join(" ")}>
        {dragOver ? "Drop to render" : "Drop artwork here"}
      </p>
      <p className={[hero ? "text-xs" : "text-[9px]", "text-zinc-700"].join(" ")}>PNG, JPG, SVG · auto-renders on drop</p>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

function toBase64File(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result as string);
    fr.onerror = rej;
    fr.readAsDataURL(file);
  });
}

async function fetchJSON<T>(url: string, opts?: RequestInit): Promise<T> {
  const r = await fetch(url, opts);
  const j = await r.json();
  if (!r.ok) throw new Error((j as any).error ?? `HTTP ${r.status}`);
  return j as T;
}

function PhotoMockupPageInner() {
  const searchParams = useSearchParams();

  // Upload
  const [uploadId, setUploadId] = useState<string | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [imgDims, setImgDims] = useState({ w: 0, h: 0 });
  const [uploadState, setUploadState] = useState<StepState>("idle");
  const [uploadErr, setUploadErr] = useState("");

  // Analysis
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [quad, setQuad] = useState<Quad | null>(null);
  const [analyzeState, setAnalyzeState] = useState<StepState>("idle");
  const [analyzeErr, setAnalyzeErr] = useState("");
  // Curved-surface warp (cylinder + per-edge bend) — fed to engine displacement
  const [cylinder, setCylinder] = useState(0);
  const [bend, setBend] = useState({ top: 0, bottom: 0, left: 0, right: 0 });

  // Processing — extract tuning (mask + shadow-map params, lib defaults)
  const [processState, setProcessState] = useState<StepState>("idle");
  const [processErr, setProcessErr] = useState("");
  const [shadowPreview, setShadowPreview] = useState<string | null>(null);
  const [maskFeather, setMaskFeather] = useState(3);   // extractMask featherPx
  const [shadowFloor, setShadowFloor] = useState(0);   // extractGrayscaleLayers multiplyFloor
  const [preBlur,     setPreBlur]     = useState(0);   // extractGrayscaleLayers preBlur
  // SAM2 segmentation (optional) — refines lighting mask + occluder
  const [showSegment,    setShowSegment]    = useState(false);
  const [surfaceMaskUrl, setSurfaceMaskUrl] = useState<string | null>(null);
  const [occluderMaskUrl, setOccluderMaskUrl] = useState<string | null>(null);
  const [showReflBrush,  setShowReflBrush]  = useState(false);

  // Render
  const [artFile, setArtFile] = useState<File | null>(null);
  const [artPreview, setArtPreview] = useState<string | null>(null);
  const [artImg, setArtImg] = useState<HTMLImageElement | null>(null);
  const [artDims, setArtDims] = useState<{ width: number; height: number } | null>(null);
  const [frame, setFrame] = useState<FrameConfig>(DEFAULT_FRAME);
  const [shadowOpacity,    setShadowOpacity]    = useState(0.9);
  const [highlightOpacity, setHighlightOpacity] = useState(0.30); // ambient light (screen)
  const [castOpacity,      setCastOpacity]      = useState(0.10); // scene color cast
  const [reflectionOpacity, setReflectionOpacity] = useState(0);  // reflexo (art tint on reflections)
  const [reflectionBlur,    setReflectionBlur]    = useState(24);
  const [reflectionMaskUrl, setReflectionMaskUrl] = useState<string | null>(null); // brush override
  const [textureAmount,   setTextureAmount]   = useState(0);  // surface-relief displacement (art drapes)
  const [specularOpacity, setSpecularOpacity] = useState(0);  // glossy highlight preservation
  const [fxGrain,      setFxGrain]      = useState(0);
  const [fxWarmth,     setFxWarmth]     = useState(0);
  const [fxSaturation, setFxSaturation] = useState(100);
  const [fxBrightness, setFxBrightness] = useState(100);
  const [fxContrast,   setFxContrast]   = useState(100);
  const [renderState, setRenderState] = useState<StepState>("idle");
  const [renderErr, setRenderErr] = useState("");
  const [renderUrl, setRenderUrl] = useState<string | null>(null);
  const [renderMs, setRenderMs] = useState<number | null>(null);

  // AI Blend
  const [aiStrength, setAiStrength] = useState(0.35);
  const [aiTexture, setAiTexture] = useState(true);
  const [aiTextureOpacity, setAiTextureOpacity] = useState(0.25);
  const [aiBlendState, setAiBlendState] = useState<StepState>("idle");
  const [aiBlendErr, setAiBlendErr] = useState("");
  const [aiBlendUrl, setAiBlendUrl] = useState<string | null>(null);
  const [aiBlendMs, setAiBlendMs] = useState<number | null>(null);
  const [showAiResult, setShowAiResult] = useState(true);
  const [aiQuality, setAiQuality] = useState<"fast" | "balanced" | "quality">("balanced");
  const [publishState, setPublishState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [publishErr,   setPublishErr]   = useState("");

  // UI panels
  const [showCustomFX,  setShowCustomFX]  = useState(false);
  const [showShadowMap, setShowShadowMap] = useState(false);
  const [showExtractAdv, setShowExtractAdv] = useState(false);
  const [showAiBlend,   setShowAiBlend]   = useState(false);
  const [activeLook,    setActiveLook]    = useState("Natural");

  const dropRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const autoRenderTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleRenderRef  = useRef<() => void>(() => {});
  const renderStateRef   = useRef<StepState>("idle");
  const [autoRenderPending, setAutoRenderPending] = useState(false);
  const [bgDragOver, setBgDragOver] = useState(false);

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handlePhotoFile = useCallback(async (file: File) => {
    setUploadErr(""); setUploadState("loading");
    setAnalysis(null); setQuad(null); setAnalyzeState("idle"); setAnalyzeErr("");
    setProcessState("idle"); setProcessErr(""); setShadowPreview(null);
    setRenderUrl(null); setRenderState("idle");

    try {
      const form = new FormData();
      form.append("photo", file);
      const data = await fetchJSON<{ id: string; width: number; height: number }>(
        "/api/photo-mockup/upload",
        { method: "POST", body: form }
      );
      const { id, width: w, height: h } = data;
      setUploadId(id);
      setImgDims({ w, h });
      setPhotoUrl(`/api/photo-mockup/${id}/asset/photo`);
      setUploadState("done");

      const defaultQuad: Quad = {
        tl: { x: Math.round(w * 0.15), y: Math.round(h * 0.15) },
        tr: { x: Math.round(w * 0.85), y: Math.round(h * 0.15) },
        br: { x: Math.round(w * 0.85), y: Math.round(h * 0.85) },
        bl: { x: Math.round(w * 0.15), y: Math.round(h * 0.85) },
      };
      setQuad(defaultQuad);
      setAnalysis({ id, quad: defaultQuad, surfaceType: "manual", material: "unknown", hasOcclusion: false, occlusionDesc: "", lightingDir: "ambient", confidence: 0, imageWidth: w, imageHeight: h });
      setAnalyzeState("done");
    } catch (e: any) {
      setUploadErr(e.message); setUploadState("error");
    }
  }, []);

  const handleAnalyze = useCallback(async (force = false) => {
    if (!uploadId) return;
    setAnalyzeState("loading"); setAnalyzeErr("");
    try {
      const data = await fetchJSON<Analysis>("/api/photo-mockup/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: uploadId, force }),
      });
      setAnalysis(data);
      setQuad(data.quad);
      setAnalyzeState("done");
    } catch (e: any) {
      setAnalyzeErr(e.message); setAnalyzeState("error");
    }
  }, [uploadId]);

  // Pre-load scene from ?scene= query param
  useEffect(() => {
    const sceneId = searchParams.get("scene");
    if (!sceneId || uploadId) return;
    (async () => {
      try {
        const res = await fetch(`/api/photo-mockup/analyze`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: sceneId }),
        });
        if (!res.ok) return;
        const data = await res.json();

        setUploadId(sceneId);
        setAnalysis(data);
        setQuad(data.quad);
        setImgDims({ w: data.imageWidth, h: data.imageHeight });
        setUploadState("done");
        setAnalyzeState("done");
        setProcessState("done");
        setPhotoUrl(`/api/photo-mockup/${sceneId}/asset/photo-clean`);
        setShadowPreview(`/api/photo-mockup/${sceneId}/asset/shadow`);

        const settingsUrl = `/api/photo-mockup/${sceneId}/asset/settings`;
        const settingsCheck = await fetch(settingsUrl);
        if (settingsCheck.ok) {
          const s = await settingsCheck.json();
          if (typeof s.shadowOpacity    === "number") setShadowOpacity(s.shadowOpacity);
          if (typeof s.highlightOpacity === "number") setHighlightOpacity(s.highlightOpacity);
          if (typeof s.castOpacity      === "number") setCastOpacity(s.castOpacity);
          if (typeof s.fxGrain      === "number") setFxGrain(s.fxGrain);
          if (typeof s.fxWarmth     === "number") setFxWarmth(s.fxWarmth);
          if (typeof s.fxSaturation === "number") setFxSaturation(s.fxSaturation);
          if (typeof s.fxBrightness === "number") setFxBrightness(s.fxBrightness);
          if (typeof s.fxContrast   === "number") setFxContrast(s.fxContrast);
          if (typeof s.maskFeather  === "number") setMaskFeather(s.maskFeather);
          if (typeof s.shadowFloor  === "number") setShadowFloor(s.shadowFloor);
          if (typeof s.preBlur      === "number") setPreBlur(s.preBlur);
          if (typeof s.reflectionOpacity === "number") setReflectionOpacity(s.reflectionOpacity);
          if (typeof s.reflectionBlur    === "number") setReflectionBlur(s.reflectionBlur);
          if (typeof s.cylinder === "number") setCylinder(s.cylinder);
          if (s.bend && typeof s.bend === "object") setBend({ top: s.bend.top ?? 0, bottom: s.bend.bottom ?? 0, left: s.bend.left ?? 0, right: s.bend.right ?? 0 });
          if (typeof s.textureAmount   === "number") setTextureAmount(s.textureAmount);
          if (typeof s.specularOpacity === "number") setSpecularOpacity(s.specularOpacity);
        }
      } catch { /* scene not found */ }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { handleRenderRef.current = handleRender; });

  // Stable signature of `frame` — react-easy-crop emits a NEW cropPixels object on every
  // re-render with identical numbers; depending on the object identity caused an infinite
  // render loop. Round to integers so sub-pixel jitter doesn't retrigger either.
  const cp = frame.cropPixels;
  const frameSig = `${frame.mode}|${frame.bg ?? ""}|${cp ? `${Math.round(cp.x)},${Math.round(cp.y)},${Math.round(cp.width)},${Math.round(cp.height)}` : ""}`;
  const warpSig = `${cylinder}|${bend.top}|${bend.bottom}|${bend.left}|${bend.right}`;

  useEffect(() => {
    if (!renderUrl || !uploadId || !artFile) return;
    setAutoRenderPending(true);
    if (autoRenderTimer.current) clearTimeout(autoRenderTimer.current);
    autoRenderTimer.current = setTimeout(() => {
      if (renderStateRef.current === "loading") { setAutoRenderPending(false); return; }
      setAutoRenderPending(false);
      handleRenderRef.current();
    }, 600);
    return () => { if (autoRenderTimer.current) clearTimeout(autoRenderTimer.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fxGrain, fxWarmth, fxSaturation, fxBrightness, fxContrast, shadowOpacity, highlightOpacity, castOpacity, maskFeather, reflectionOpacity, reflectionBlur, textureAmount, specularOpacity, frameSig, warpSig]);

  useEffect(() => {
    if (!analysis?.surfaceType) return;
    const d = AI_BLEND_DEFAULTS[analysis.surfaceType];
    if (d) {
      setAiStrength(d.strength);
      setAiTexture(d.texture);
      setAiTextureOpacity(d.textureOpacity);
    }
  }, [analysis?.surfaceType]);

  const handleProcess = useCallback(async () => {
    if (!uploadId || !quad) return;
    setProcessState("loading"); setProcessErr(""); setShadowPreview(null);
    try {
      await fetch(`/api/photo-mockup/${uploadId}/prepare-magenta`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quad, imageWidth: imgDims.w, imageHeight: imgDims.h }),
      });
      await fetchJSON<{ ready: boolean }>("/api/photo-mockup/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Bake a crisp mask — feather is a live render-time blur, no re-extract needed
        body: JSON.stringify({
          id: uploadId, quad, featherPx: 0, multiplyFloor: shadowFloor, preBlur,
          surfaceMaskBase64: surfaceMaskUrl ?? undefined,
          occluderMaskBase64: occluderMaskUrl ?? undefined,
          reflectionMaskBase64: reflectionMaskUrl ?? undefined,
        }),
      });
      setShadowPreview(`/api/photo-mockup/${uploadId}/asset/shadow?t=${Date.now()}`);
      setProcessState("done");
      // Refresh the mockup with the newly extracted mask/lighting
      if (artFile) setTimeout(() => handleRenderRef.current(), 80);
    } catch (e: any) {
      setProcessErr(e.message); setProcessState("error");
    }
  }, [uploadId, quad, imgDims, shadowFloor, preBlur, artFile, surfaceMaskUrl, occluderMaskUrl, reflectionMaskUrl]);

  // Target surface size = quad's average edge lengths (drives art crop aspect)
  const surfaceSize = (() => {
    if (!quad) return { w: 0, h: 0 };
    const dist = (a: QuadPt, b: QuadPt) => Math.hypot(a.x - b.x, a.y - b.y);
    const top = dist(quad.tl, quad.tr), bottom = dist(quad.bl, quad.br);
    const left = dist(quad.tl, quad.bl), right = dist(quad.tr, quad.br);
    return { w: Math.round((top + bottom) / 2), h: Math.round((left + right) / 2) };
  })();

  const handleArtFile = useCallback(async (file: File) => {
    setArtFile(file);
    setRenderUrl(null); setRenderState("idle");
    setFrame(DEFAULT_FRAME);
    const url = URL.createObjectURL(file);
    setArtPreview(url);
    const img = new window.Image();
    img.onload = () => {
      setArtImg(img);
      setArtDims({ width: img.naturalWidth, height: img.naturalHeight });
      if (processState === "done") setTimeout(() => handleRenderRef.current(), 80);
    };
    img.src = url;
  }, [processState]);

  const clearArt = useCallback(() => {
    setArtFile(null); setArtPreview(null); setArtImg(null); setArtDims(null);
    setFrame(DEFAULT_FRAME); setRenderUrl(null); setRenderState("idle");
  }, []);

  const handleRender = useCallback(async () => {
    if (!uploadId || !artFile) return;
    if (autoRenderTimer.current) { clearTimeout(autoRenderTimer.current); autoRenderTimer.current = null; }
    setAutoRenderPending(false);
    setRenderState("loading"); setRenderErr("");
    renderStateRef.current = "loading";
    const t0 = Date.now();
    try {
      // Frame art to the quad's aspect (cover/contain/stretch) before warping
      const artBase64 = (artImg && surfaceSize.w && surfaceSize.h)
        ? renderFramedArt(artImg, frame, surfaceSize.w, surfaceSize.h)
        : await toBase64File(artFile);
      const res = await fetch(`/api/photo-mockup/${uploadId}/render`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          artBase64,
          shadowOpacity,
          highlightOpacity,
          castOpacity,
          maskFeather,
          reflectionOpacity,
          reflectionBlur,
          warp: { cylinder, bendTop: bend.top, bendBottom: bend.bottom, bendLeft: bend.left, bendRight: bend.right },
          textureAmount,
          specularOpacity,
          fx: { grain: fxGrain, warmth: fxWarmth, saturation: fxSaturation, brightness: fxBrightness, contrast: fxContrast },
        }),
      });
      if (!res.ok) { const j = await res.json(); throw new Error(j.error ?? `HTTP ${res.status}`); }
      const blob = await res.blob();
      setRenderUrl(URL.createObjectURL(blob));
      setRenderMs(Date.now() - t0);
      setRenderState("done");
      renderStateRef.current = "done";
      setAiBlendUrl(null); setAiBlendState("idle"); setAiBlendErr("");
    } catch (e: any) {
      setRenderErr(e.message); setRenderState("error");
      renderStateRef.current = "error";
    }
  }, [uploadId, artFile, artImg, frame, surfaceSize.w, surfaceSize.h, shadowOpacity, highlightOpacity, castOpacity, maskFeather, reflectionOpacity, reflectionBlur, cylinder, bend, textureAmount, specularOpacity, fxGrain, fxWarmth, fxSaturation, fxBrightness, fxContrast]);

  const handleAIBlend = useCallback(async () => {
    if (!uploadId || !renderUrl) return;
    setAiBlendState("loading"); setAiBlendErr(""); setAiBlendUrl(null);
    const t0 = Date.now();
    try {
      const blob = await fetch(renderUrl).then(r => r.blob());
      const compositeBase64 = await new Promise<string>((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(fr.result as string);
        fr.onerror = rej;
        fr.readAsDataURL(blob);
      });
      const res = await fetch(`/api/photo-mockup/${uploadId}/ai-blend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ compositeBase64, strength: aiStrength, textureOpacity: aiTexture ? aiTextureOpacity : 0, quality: aiQuality }),
      });
      if (!res.ok) { const j = await res.json(); throw new Error(j.error ?? `HTTP ${res.status}`); }
      const aiBlob = await res.blob();
      setAiBlendUrl(URL.createObjectURL(aiBlob));
      setAiBlendMs(Date.now() - t0);
      setAiBlendState("done");
      setShowAiResult(true);
    } catch (e: any) {
      setAiBlendErr(e.message); setAiBlendState("error");
    }
  }, [uploadId, renderUrl, aiStrength, aiTexture, aiTextureOpacity, aiQuality]);

  const handlePublish = useCallback(async () => {
    const activeUrl = (aiBlendUrl && showAiResult) ? aiBlendUrl : renderUrl;
    if (!uploadId || !activeUrl) return;
    const name = window.prompt("Name for this mockup in the library:", analysis?.surfaceType ? `${analysis.surfaceType} scene` : "Photo Mockup");
    if (!name) return;
    setPublishState("loading"); setPublishErr("");
    try {
      const renderBase64 = await fetch(activeUrl).then(r => r.blob()).then(b => new Promise<string>((res, rej) => {
        const fr = new FileReader(); fr.onload = () => res(fr.result as string); fr.onerror = rej; fr.readAsDataURL(b);
      }));
      const r = await fetch(`/api/photo-mockup/${uploadId}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, renderBase64, settings: { shadowOpacity, highlightOpacity, castOpacity, fxGrain, fxWarmth, fxSaturation, fxBrightness, fxContrast, maskFeather, shadowFloor, preBlur, reflectionOpacity, reflectionBlur, cylinder, bend, textureAmount, specularOpacity }, tags: analysis?.surfaceType ? [analysis.surfaceType] : [] }),
      });
      if (!r.ok) { const j = await r.json(); throw new Error(j.error ?? `HTTP ${r.status}`); }
      setPublishState("done");
    } catch (e: any) {
      setPublishErr(e.message); setPublishState("error");
    }
  }, [uploadId, renderUrl, aiBlendUrl, showAiResult, analysis, shadowOpacity, highlightOpacity, castOpacity, fxGrain, fxWarmth, fxSaturation, fxBrightness, fxContrast, maskFeather, shadowFloor, preBlur, reflectionOpacity, reflectionBlur, cylinder, bend, textureAmount, specularOpacity]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f?.type.startsWith("image/")) handlePhotoFile(f);
  }, [handlePhotoFile]);

  const resetPhoto = useCallback(() => {
    setPhotoUrl(null); setUploadId(null); setUploadState("idle");
    setAnalyzeState("idle"); setAnalysis(null); setQuad(null);
    setProcessState("idle"); setShadowPreview(null); setRenderUrl(null);
  }, []);

  // ── Render ───────────────────────────────────────────────────────────────────

  const active: StepId =
    uploadState !== "done" ? "upload" :
    analyzeState !== "done" ? "analyze" :
    processState !== "done" ? "process" : "render";

  const activeImageUrl = aiBlendUrl && showAiResult ? aiBlendUrl : renderUrl;

  // Quad as a CSS clip-path polygon in % of the image — used to blur only the
  // surface area while a re-render is in flight (rest of the scene stays sharp).
  const surfaceClip = quad && imgDims.w && imgDims.h
    ? `polygon(${[quad.tl, quad.tr, quad.br, quad.bl]
        .map((p) => `${((p.x / imgDims.w) * 100).toFixed(2)}% ${((p.y / imgDims.h) * 100).toFixed(2)}%`)
        .join(", ")})`
    : undefined;

  const pipelineBar = (
    <div className="flex items-center gap-2">
      <StepPip label="Upload"  state={uploadState}  active={active === "upload"} />
      <ChevronRight size={10} className="text-zinc-800" />
      <StepPip label="Quad"    state={analyzeState} active={active === "analyze"} />
      <ChevronRight size={10} className="text-zinc-800" />
      <StepPip label="Extract" state={processState} active={active === "process"} />
      <ChevronRight size={10} className="text-zinc-800" />
      <StepPip label="Render"  state={renderState}  active={active === "render"} />
      <span className="ml-2 text-[10px] font-mono text-zinc-700 bg-zinc-900 border border-zinc-800 px-1.5 py-0.5 rounded">dev</span>
    </div>
  );

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">

      {/* ── Shell Header ─────────────────────────────────────────────── */}
      <header className="h-14 border-b border-neutral-900 bg-neutral-950/80 backdrop-blur-md flex items-center justify-between px-4 shrink-0 z-50 relative">

        {/* Left: brand + nav */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 pr-4 border-r border-neutral-800">
            <div className="w-7 h-7 rounded-lg bg-white flex items-center justify-center shrink-0">
              <div className="w-3.5 h-3.5 bg-black rounded-sm" />
            </div>
            <span className="text-sm font-black tracking-tighter uppercase text-white">Boxy Store</span>
          </div>

          <nav className="flex items-center gap-1">
            <Link
              href="/"
              className="px-3 py-1.5 rounded-lg text-xs text-neutral-400 hover:text-white hover:bg-white/5 transition-all"
            >
              Store
            </Link>
            <Link
              href="/photo-mockup"
              className="px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 bg-white/8 text-white border border-white/10 transition-all"
            >
              <Camera size={11} />
              Scene Maker
            </Link>
          </nav>
        </div>

        {/* Right: pipeline */}
        <div className="flex items-center">
          {pipelineBar}
        </div>
      </header>

      {/* ── Phases 1–3 ───────────────────────────────────────────────── */}
      {active !== "render" && (
        <div className="flex-1 p-4 md:p-8">
          <div className="max-w-5xl mx-auto space-y-6">

            {/* Phase 1 & 2: Upload / Analyzing */}
            {(active === "upload" || active === "analyze") && (
              <div className="max-w-2xl mx-auto space-y-4">
                {!photoUrl && (
                  <div
                    ref={dropRef}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={handleDrop}
                    onClick={() => document.getElementById("photo-input")?.click()}
                    className="border-2 border-dashed border-zinc-700 hover:border-zinc-500 rounded-2xl flex flex-col items-center justify-center gap-3 p-12 cursor-pointer transition-colors min-h-[300px]"
                  >
                    <input
                      id="photo-input"
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) handlePhotoFile(f); }}
                    />
                    {uploadState === "loading" ? (
                      <Loader2 size={32} className="animate-spin text-blue-400" />
                    ) : (
                      <>
                        <Upload size={32} className="text-zinc-500" />
                        <div className="text-center">
                          <p className="font-medium text-zinc-300">Drop your photo here</p>
                          <p className="text-sm text-zinc-500 mt-1">Business card, poster, billboard, wall…</p>
                        </div>
                      </>
                    )}
                    {uploadErr && <p className="text-red-400 text-sm">{uploadErr}</p>}
                  </div>
                )}

                {photoUrl && quad && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-zinc-400">Drag corners to adjust · {imgDims.w}×{imgDims.h}px</span>
                      <button onClick={resetPhoto} className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">
                        Change photo
                      </button>
                    </div>
                    <QuadEditor imageUrl={photoUrl} imageNW={imgDims.w} imageNH={imgDims.h} quad={quad}
                      onQuadChange={(q) => { setQuad(q); setProcessState("idle"); setRenderUrl(null); }} />
                  </div>
                )}
              </div>
            )}

            {/* Phase 3: Quad placement + extract */}
            {active === "process" && photoUrl && quad && (
              <div className="max-w-2xl mx-auto space-y-3">
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-zinc-500">
                    <span>Drag corners to mark the surface · {imgDims.w}×{imgDims.h}px</span>
                    <button onClick={resetPhoto} className="hover:text-zinc-300 transition-colors">Change photo</button>
                  </div>
                  <QuadEditor imageUrl={photoUrl} imageNW={imgDims.w} imageNH={imgDims.h} quad={quad}
                    onQuadChange={(q) => { setQuad(q); setProcessState("idle"); setRenderUrl(null); }}
                    bend={bend} onBendChange={setBend} />
                </div>

                {/* Surface shape — cylinder + edge bend (warp via engine displacement) */}
                <div className="flex items-center gap-3 text-[11px] text-zinc-500">
                  <span className="flex items-center gap-1 shrink-0">Cilindro</span>
                  <input type="range" min={0} max={1} step={0.02} value={cylinder}
                    onChange={(e) => { setCylinder(Number(e.target.value)); setRenderUrl(null); }}
                    className="flex-1 accent-cyan-400 h-1" />
                  <span className="font-mono text-zinc-500 w-8 text-right">{Math.round(cylinder * 100)}%</span>
                  {(cylinder || bend.top || bend.bottom || bend.left || bend.right) ? (
                    <button onClick={() => { setCylinder(0); setBend({ top: 0, bottom: 0, left: 0, right: 0 }); setRenderUrl(null); }}
                      className="hover:text-zinc-300 transition-colors shrink-0">reset</button>
                  ) : null}
                </div>
                <p className="text-[10px] text-zinc-600 -mt-1">Arraste os losangos nas bordas pra curvar (caneca, lata, garrafa). Resultado aparece no render.</p>

                <div className="flex items-center justify-between">
                  {analysis?.surfaceType !== "manual" ? (
                    <div className="flex items-center gap-1.5 text-xs text-zinc-500">
                      <span className="capitalize text-zinc-300">{analysis?.surfaceType}</span>
                      <span>·</span><span>{analysis?.material}</span>
                      <span>·</span><span>{analysis?.lightingDir} light</span>
                      <span className={["px-1.5 py-px rounded-full text-[10px]",
                        (analysis?.confidence ?? 0) >= 0.85 ? "bg-green-500/20 text-green-400" : "bg-yellow-500/20 text-yellow-400"].join(" ")}>
                        {Math.round((analysis?.confidence ?? 0) * 100)}%
                      </span>
                      {analysis?.cached && <span className="font-mono text-[10px] text-zinc-700">cached·$0</span>}
                      {analysis?.hasOcclusion && <span className="text-yellow-500 text-[10px]">⚠ {analysis.occlusionDesc}</span>}
                    </div>
                  ) : (
                    <span className="text-xs text-zinc-600">Manual placement — adjust corners above</span>
                  )}
                  <button onClick={() => handleAnalyze(true)} disabled={analyzeState === "loading"}
                    className="text-xs text-zinc-500 hover:text-blue-400 disabled:opacity-50 flex items-center gap-1 transition-colors shrink-0">
                    {analyzeState === "loading"
                      ? <><Loader2 size={9} className="animate-spin text-blue-400" /> Detecting…</>
                      : <><Zap size={9} /> Detect with AI</>}
                  </button>
                </div>
                {analyzeErr && <p className="text-red-400 text-xs flex items-center gap-1"><AlertTriangle size={11} /> {analyzeErr}</p>}

                {/* Click-to-segment (SAM2) — optional: refine real surface + mark occluders */}
                <div className="rounded-xl border border-zinc-800 overflow-hidden">
                  <button onClick={() => setShowSegment(v => !v)}
                    className="w-full flex items-center justify-between px-3 py-2 text-xs text-zinc-500 hover:text-zinc-300 transition-colors">
                    <span className="flex items-center gap-1.5">
                      <Wand2 size={11} /> Segmentar com IA
                      {(surfaceMaskUrl || occluderMaskUrl) && (
                        <span className="flex items-center gap-1 text-[10px]">
                          {surfaceMaskUrl && <span className="px-1 rounded bg-green-500/20 text-green-400">superfície</span>}
                          {occluderMaskUrl && <span className="px-1 rounded bg-amber-500/20 text-amber-400">oclusão</span>}
                        </span>
                      )}
                    </span>
                    <ChevronRight size={11} className={["transition-transform", showSegment ? "rotate-90" : ""].join(" ")} />
                  </button>
                  {showSegment && (
                    <div className="px-3 pb-3 pt-1 border-t border-zinc-800 space-y-2">
                      <p className="text-[11px] text-zinc-600">
                        Clique na <span className="text-green-400">superfície real</span> (incluir) e com o direito nos
                        elementos na frente — <span className="text-amber-400">dedos, plantas</span> (excluir). Aplica como
                        máscara de iluminação / oclusão.
                      </p>
                      <SegmentCanvas
                        imageUrl={photoUrl}
                        imageW={imgDims.w}
                        imageH={imgDims.h}
                        onApply={(role, url) => {
                          if (role === "surface") setSurfaceMaskUrl(url);
                          else setOccluderMaskUrl(url);
                          setProcessState("idle");
                        }}
                      />
                      {(surfaceMaskUrl || occluderMaskUrl) && (
                        <button
                          onClick={() => { setSurfaceMaskUrl(null); setOccluderMaskUrl(null); setProcessState("idle"); }}
                          className="text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors"
                        >
                          Remover máscaras aplicadas
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Reflexo brush — paint where the artwork should tint reflections (overrides auto-detect) */}
                <div className="rounded-xl border border-zinc-800 overflow-hidden">
                  <button onClick={() => setShowReflBrush(v => !v)}
                    className="w-full flex items-center justify-between px-3 py-2 text-xs text-zinc-500 hover:text-zinc-300 transition-colors">
                    <span className="flex items-center gap-1.5">
                      <Wand2 size={11} /> Reflexo — pincel
                      {reflectionMaskUrl && <span className="px-1 rounded bg-fuchsia-500/20 text-fuchsia-400 text-[10px]">manual</span>}
                    </span>
                    <ChevronRight size={11} className={["transition-transform", showReflBrush ? "rotate-90" : ""].join(" ")} />
                  </button>
                  {showReflBrush && (
                    <div className="px-3 pb-3 pt-1 border-t border-zinc-800 space-y-2">
                      <p className="text-[11px] text-zinc-600">
                        Pinte onde a arte deve <span className="text-fuchsia-400">refletir</span> (chão molhado, vidro).
                        Substitui a detecção automática. Ajuste a intensidade no slider <span className="text-fuchsia-400">Reflexo</span> ao renderizar.
                      </p>
                      <BrushCanvas
                        imageUrl={photoUrl}
                        imageW={imgDims.w}
                        imageH={imgDims.h}
                        onChange={(url) => { setReflectionMaskUrl(url); setProcessState("idle"); }}
                      />
                    </div>
                  )}
                </div>

                {/* Advanced extract settings — only relevant before extracting (they read photo pixels) */}
                <div className="rounded-xl border border-zinc-800 overflow-hidden">
                  <button onClick={() => setShowExtractAdv(v => !v)}
                    className="w-full flex items-center justify-between px-3 py-2 text-xs text-zinc-500 hover:text-zinc-300 transition-colors">
                    <span className="flex items-center gap-1.5"><Sliders size={11} /> Extract settings</span>
                    <ChevronRight size={11} className={["transition-transform", showExtractAdv ? "rotate-90" : ""].join(" ")} />
                  </button>
                  {showExtractAdv && (
                    <div className="px-3 pb-3 pt-1 space-y-2.5 border-t border-zinc-800">
                      {([
                        { label: "Shadow floor", value: shadowFloor, set: setShadowFloor, min: 0, max: 255, step: 5, accent: "accent-indigo-400",  fmt: (v: number) => `${v}`,  hint: "clamps fake-dark stains" },
                        { label: "Pre-blur",     value: preBlur,     set: setPreBlur,     min: 0, max: 30,  step: 1, accent: "accent-fuchsia-400", fmt: (v: number) => `σ${v}`, hint: "smears baked-in text" },
                      ] as const).map(({ label, value, set, min, max, step, accent, fmt, hint }) => (
                        <div key={label} className="space-y-0.5">
                          <label className="text-[11px] text-zinc-400 flex items-center justify-between">
                            <span>{label} <span className="text-zinc-600">· {hint}</span></span>
                            <span className="font-mono text-zinc-500">{fmt(value)}</span>
                          </label>
                          <input type="range" min={min} max={max} step={step} value={value}
                            onChange={(e) => (set as (v: number) => void)(Number(e.target.value))}
                            className={["w-full h-1", accent].join(" ")} />
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <button onClick={handleProcess} disabled={processState === "loading"}
                  className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-sm font-medium transition-colors flex items-center justify-center gap-2">
                  {processState === "loading" && <Loader2 size={14} className="animate-spin" />}
                  {processState === "loading" ? "Extracting lighting…" : "Extract Lighting & Shadows →"}
                </button>
                {processErr && <p className="text-red-400 text-sm flex items-center gap-2"><AlertTriangle size={14} /> {processErr}</p>}
              </div>
            )}

          </div>
        </div>
      )}

      {/* ── Phase 4: Full-screen render (below header) ───────────────── */}
      {active === "render" && (
        <div
          className={["fixed top-14 bottom-0 left-0 right-0 z-40 overflow-hidden transition-colors",
            !artFile && bgDragOver ? "bg-indigo-950/30" : "bg-zinc-950"].join(" ")}
          onDragOver={(e) => { if (!artFile) { e.preventDefault(); setBgDragOver(true); } }}
          onDragLeave={(e) => { if (e.currentTarget === e.target) setBgDragOver(false); }}
          onDrop={(e) => {
            e.preventDefault(); setBgDragOver(false);
            const f = e.dataTransfer.files[0];
            if (f?.type.startsWith("image/")) handleArtFile(f);
          }}
        >
          <div className="w-full h-full relative">

                {/* Pan / zoom / pinch canvas */}
                {activeImageUrl ? (
                  <ZoomPanViewer key={activeImageUrl}>
                    <div style={{ position: "relative", display: "inline-block", lineHeight: 0 }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={activeImageUrl}
                        alt="mockup"
                        draggable={false}
                        style={{
                          maxWidth: "calc(100vw - 310px)",
                          maxHeight: "calc(100vh - 80px)",
                          objectFit: "contain",
                          display: "block",
                        }}
                      />
                      {/* Loading: blur ONLY the surface area (clipped to the quad), scene stays sharp */}
                      {(renderState === "loading" || autoRenderPending) && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={activeImageUrl}
                          alt=""
                          aria-hidden
                          draggable={false}
                          style={{
                            position: "absolute", inset: 0, width: "100%", height: "100%",
                            objectFit: "contain", pointerEvents: "none",
                            filter: "blur(7px) brightness(0.96)",
                            transition: "opacity 0.2s ease-out",
                            clipPath: surfaceClip, WebkitClipPath: surfaceClip,
                          }}
                        />
                      )}
                    </div>
                  </ZoomPanViewer>
                ) : (
                  <div className="w-full h-full flex items-center justify-center relative overflow-hidden">
                    {/* Scene preview — blurred, dimmed backdrop */}
                    {photoUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={photoUrl}
                        alt=""
                        aria-hidden
                        draggable={false}
                        className="absolute inset-0 w-full h-full object-cover select-none pointer-events-none"
                        style={{ filter: "blur(24px) brightness(0.4)", transform: "scale(1.1)" }}
                      />
                    )}
                    <div className="absolute inset-0 bg-zinc-950/40 pointer-events-none" />
                    <div className="relative z-10">
                      <ArtDropZone onFile={handleArtFile} dragOver={bgDragOver} size="hero" />
                    </div>
                  </div>
                )}

                {/* Subtle top progress bar — non-intrusive, image stays visible (blurred) */}
                {(renderState === "loading" || autoRenderPending) && (
                  <div className="absolute top-0 left-0 right-0 h-0.5 z-20 overflow-hidden pointer-events-none">
                    <div className="h-full w-1/3 bg-indigo-400/80 rounded-full animate-[scene-loadbar_1.1s_ease-in-out_infinite]" />
                  </div>
                )}

                {/* AI toggle badge */}
                {aiBlendUrl && (
                  <button
                    onClick={() => setShowAiResult(v => !v)}
                    className={["absolute top-3 left-4 z-20 text-[11px] px-2 py-0.5 rounded-full backdrop-blur-sm flex items-center gap-1 transition-colors",
                      showAiResult ? "bg-purple-600/80 text-white" : "bg-black/50 text-zinc-400 hover:text-white"].join(" ")}
                  >
                    <Wand2 size={9} /> {showAiResult ? "AI" : "Original"}
                  </button>
                )}

                {/* Render time */}
                {renderMs && renderState === "done" && !autoRenderPending && (
                  <span className="absolute top-3 right-4 z-20 text-[11px] font-mono bg-black/50 text-zinc-400 px-2 py-0.5 rounded-full backdrop-blur-sm">
                    {aiBlendUrl && showAiResult
                      ? `AI · ${aiBlendMs ? (aiBlendMs / 1000).toFixed(1) : "?"}s`
                      : `${(renderMs / 1000).toFixed(1)}s`}
                  </span>
                )}

                {/* Floating draggable control panel */}
                <Draggable nodeRef={panelRef as any} handle=".panel-drag" bounds="parent" defaultPosition={{ x: 0, y: 0 }}>
                  <div
                    ref={panelRef}
                    className="absolute bottom-6 right-6 z-30 w-72 bg-zinc-900/95 backdrop-blur-md border border-zinc-700/70 rounded-2xl shadow-2xl overflow-hidden"
                  >
                    {/* Drag handle */}
                    <div className="panel-drag cursor-grab active:cursor-grabbing flex items-center justify-between px-3 py-2 border-b border-zinc-800 select-none">
                      <span className="text-[10px] text-zinc-500 font-medium uppercase tracking-widest">Controls</span>
                      <div className="flex gap-0.5 items-center">
                        <span className="w-1 h-1 rounded-full bg-zinc-600" />
                        <span className="w-1 h-1 rounded-full bg-zinc-600" />
                        <span className="w-1 h-1 rounded-full bg-zinc-600" />
                      </div>
                    </div>

                    <div className="p-3 space-y-3 overflow-y-auto" style={{ maxHeight: "calc(100vh - 140px)" }}>

                      {/* Art upload + fit-mode controls (shared SSOT panel) */}
                      <input id="art-input-fs" type="file" accept="image/*" className="hidden"
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleArtFile(f); }} />
                      {artPreview ? (
                        <div className="bg-zinc-800/40 rounded-xl border border-zinc-700/40 p-2">
                          <ArtFramePanel
                            artPreview={artPreview}
                            artDims={artDims}
                            frame={frame}
                            onFrameChange={setFrame}
                            soWidth={surfaceSize.w}
                            soHeight={surfaceSize.h}
                            fileName={artFile?.name}
                            onClear={clearArt}
                            previewHeightClass="h-32"
                            compact
                          />
                          <button
                            onClick={() => document.getElementById("art-input-fs")?.click()}
                            className="mt-1.5 w-full text-[9px] text-zinc-600 hover:text-zinc-400 transition-colors"
                          >
                            Change artwork
                          </button>
                        </div>
                      ) : (
                        <ArtDropZone onFile={handleArtFile} dragOver={false} size="panel" />
                      )}

                      {/* Scene info row */}
                      <div className="flex items-center gap-2 bg-zinc-800/40 rounded-xl p-2.5 border border-zinc-700/30">
                        {photoUrl && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={photoUrl} alt="scene" className="w-12 h-12 object-cover rounded-lg flex-none border border-zinc-700/60" />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="text-[10px] font-medium text-zinc-300 truncate capitalize">{analysis?.surfaceType ?? "Photo"} · {analysis?.material}</p>
                          <p className="text-[9px] text-zinc-600">{imgDims.w}×{imgDims.h}px · {analysis?.lightingDir} light</p>
                          <button onClick={() => handleProcess()} disabled={processState === "loading"}
                            className="text-[9px] text-zinc-500 hover:text-zinc-300 flex items-center gap-0.5 transition-colors mt-0.5">
                            {processState === "loading"
                              ? <><Loader2 size={7} className="animate-spin" /> Re-extracting…</>
                              : <><RefreshCw size={7} /> Re-extract</>}
                          </button>
                        </div>
                      </div>

                      {/* Lighting — shadow (multiply) · ambient (screen) · color cast */}
                      <div className="space-y-2">
                        <div className="space-y-0.5">
                          <label className="text-[10px] text-zinc-400 flex items-center justify-between">
                            <span className="flex items-center gap-1"><Sliders size={9} /> Shadow</span>
                            <span className="font-mono text-zinc-500">{Math.round(shadowOpacity * 100)}%</span>
                          </label>
                          <input type="range" min={0} max={1} step={0.05} value={shadowOpacity}
                            onChange={(e) => setShadowOpacity(Number(e.target.value))}
                            className="w-full accent-indigo-500 h-1" />
                        </div>
                        <div className="space-y-0.5">
                          <label className="text-[10px] text-zinc-400 flex items-center justify-between">
                            <span>Ambient light</span>
                            <span className="font-mono text-zinc-500">{Math.round(highlightOpacity * 100)}%</span>
                          </label>
                          <input type="range" min={0} max={1} step={0.05} value={highlightOpacity}
                            onChange={(e) => setHighlightOpacity(Number(e.target.value))}
                            className="w-full accent-sky-400 h-1" />
                        </div>
                        <div className="space-y-0.5">
                          <label className="text-[10px] text-zinc-400 flex items-center justify-between">
                            <span>Color cast</span>
                            <span className="font-mono text-zinc-500">{Math.round(castOpacity * 100)}%</span>
                          </label>
                          <input type="range" min={0} max={0.5} step={0.02} value={castOpacity}
                            onChange={(e) => setCastOpacity(Number(e.target.value))}
                            className="w-full accent-rose-400 h-1" />
                        </div>
                        <div className="space-y-0.5">
                          <label className="text-[10px] text-zinc-400 flex items-center justify-between">
                            <span>Edge feather</span>
                            <span className="font-mono text-zinc-500">{maskFeather}px</span>
                          </label>
                          <input type="range" min={0} max={30} step={1} value={maskFeather}
                            onChange={(e) => setMaskFeather(Number(e.target.value))}
                            className="w-full accent-teal-400 h-1" />
                        </div>
                        <div className="space-y-0.5">
                          <label className="text-[10px] text-zinc-400 flex items-center justify-between">
                            <span>Reflexo <span className="text-zinc-700">· tinge reflexos com a arte</span></span>
                            <span className="font-mono text-zinc-500">{Math.round(reflectionOpacity * 100)}%</span>
                          </label>
                          <input type="range" min={0} max={1} step={0.05} value={reflectionOpacity}
                            onChange={(e) => setReflectionOpacity(Number(e.target.value))}
                            className="w-full accent-fuchsia-400 h-1" />
                          {reflectionOpacity > 0 && (
                            <div className="flex items-center gap-2 pt-1">
                              <span className="text-[9px] text-zinc-600 shrink-0">Smear</span>
                              <input type="range" min={4} max={60} step={2} value={reflectionBlur}
                                onChange={(e) => setReflectionBlur(Number(e.target.value))}
                                className="w-full accent-fuchsia-300 h-1" />
                            </div>
                          )}
                        </div>
                        <div className="space-y-0.5">
                          <label className="text-[10px] text-zinc-400 flex items-center justify-between">
                            <span>Textura <span className="text-zinc-700">· arte segue o relevo</span></span>
                            <span className="font-mono text-zinc-500">{Math.round(textureAmount * 100)}%</span>
                          </label>
                          <input type="range" min={0} max={1} step={0.05} value={textureAmount}
                            onChange={(e) => setTextureAmount(Number(e.target.value))}
                            className="w-full accent-amber-400 h-1" />
                        </div>
                        <div className="space-y-0.5">
                          <label className="text-[10px] text-zinc-400 flex items-center justify-between">
                            <span>Brilho <span className="text-zinc-700">· specular (vidro/tela)</span></span>
                            <span className="font-mono text-zinc-500">{Math.round(specularOpacity * 100)}%</span>
                          </label>
                          <input type="range" min={0} max={1} step={0.05} value={specularOpacity}
                            onChange={(e) => setSpecularOpacity(Number(e.target.value))}
                            className="w-full accent-sky-300 h-1" />
                        </div>
                      </div>

                      {/* Look presets */}
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-zinc-400">Look</span>
                          <button onClick={() => setShowCustomFX(v => !v)}
                            className="text-[9px] text-zinc-500 hover:text-zinc-300 transition-colors flex items-center gap-1">
                            <Sliders size={8} /> {showCustomFX ? "Hide" : "Custom"}
                          </button>
                        </div>
                        <div className="flex gap-1 flex-wrap">
                          {LOOK_PRESETS.map(p => (
                            <button key={p.name}
                              onClick={() => { setActiveLook(p.name); setFxGrain(p.grain); setFxWarmth(p.warmth); setFxSaturation(p.saturation); setFxBrightness(p.brightness); setFxContrast(100); }}
                              className={["px-2 py-0.5 rounded-full text-[10px] transition-colors",
                                activeLook === p.name
                                  ? "bg-zinc-200 text-zinc-900 font-medium"
                                  : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"].join(" ")}>
                              {p.name}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Custom FX */}
                      {showCustomFX && (
                        <div className="border-t border-zinc-800 pt-2 space-y-2">
                          {([
                            { label: "Grain",      value: fxGrain,      set: setFxGrain,      min: 0,    max: 100, step: 1,  accent: "accent-zinc-400",   fmt: (v: number) => `${v}%` },
                            { label: "Warmth",     value: fxWarmth,     set: setFxWarmth,     min: -100, max: 100, step: 5,  accent: "accent-orange-400", fmt: (v: number) => v > 0 ? `+${v}` : `${v}` },
                            { label: "Saturation", value: fxSaturation, set: setFxSaturation, min: 0,    max: 200, step: 5,  accent: "accent-purple-400", fmt: (v: number) => `${v}%` },
                            { label: "Brightness", value: fxBrightness, set: setFxBrightness, min: 50,   max: 150, step: 5,  accent: "accent-yellow-400", fmt: (v: number) => `${v}%` },
                            { label: "Contrast",   value: fxContrast,   set: setFxContrast,   min: 50,   max: 150, step: 5,  accent: "accent-emerald-400", fmt: (v: number) => `${v}%` },
                          ] as const).map(({ label, value, set, min, max, step, accent, fmt }) => (
                            <div key={label} className="space-y-0.5">
                              <label className="text-[10px] text-zinc-400 flex items-center justify-between">
                                <span>{label}</span>
                                <span className="font-mono text-zinc-500">{fmt(value)}</span>
                              </label>
                              <input type="range" min={min} max={max} step={step} value={value}
                                onChange={(e) => { setActiveLook("Custom"); (set as (v: number) => void)(Number(e.target.value)); }}
                                className={["w-full h-1", accent].join(" ")} />
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Actions */}
                      <div className="flex items-center gap-1.5">
                        <a href={activeImageUrl ?? "#"} download="mockup.png"
                          className={["flex-1 py-2 rounded-xl text-[11px] font-medium text-center flex items-center justify-center gap-1.5 transition-colors",
                            activeImageUrl ? "bg-green-600 hover:bg-green-500 text-white" : "bg-zinc-800 text-zinc-500 pointer-events-none"].join(" ")}>
                          <Download size={11} /> Save PNG
                        </a>
                        <button onClick={handlePublish} disabled={!renderUrl || publishState === "loading"}
                          className={["px-3 py-2 rounded-xl text-[11px] transition-colors flex items-center gap-1.5",
                            publishState === "done" ? "bg-emerald-700 text-white" :
                            "bg-zinc-800 hover:bg-zinc-700 text-zinc-400 disabled:text-zinc-600"].join(" ")}>
                          {publishState === "done" ? <><CheckCircle2 size={11} /> Saved!</> :
                           publishState === "loading" ? <><Loader2 size={11} className="animate-spin" /> Saving…</> :
                           "Library"}
                        </button>
                        <button onClick={handleRender} disabled={!artFile || renderState === "loading"}
                          className="p-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-500 hover:text-zinc-300 disabled:opacity-40 transition-colors" title="Re-render">
                          <RefreshCw size={11} />
                        </button>
                      </div>
                      {publishErr && <p className="text-red-400 text-[9px]">{publishErr}</p>}
                      {renderErr && <p className="text-red-400 text-[9px] flex items-center gap-1"><AlertTriangle size={8} /> {renderErr}</p>}
                      {processErr && <p className="text-red-400 text-[9px] flex items-center gap-1"><AlertTriangle size={8} /> {processErr}</p>}

                      {/* Cost tally */}
                      {renderState === "done" && ((): React.ReactNode => {
                        const aiDetectCost = (analysis?.surfaceType === "manual" || !analysis?.confidence) ? 0 : analysis?.cached ? 0 : 0.01;
                        const aiBlendCost = aiBlendState === "done"
                          ? (aiQuality === "fast" ? 0.005 : aiQuality === "balanced" ? 0.015 : 0.045) : 0;
                        const total = aiDetectCost + aiBlendCost;
                        return (
                          <div className="flex items-center gap-1.5 text-[9px] font-mono text-zinc-600">
                            {aiDetectCost > 0 ? <span>detect ~${aiDetectCost.toFixed(3)}</span> : <span>manual·$0</span>}
                            {aiBlendCost > 0 && <><span>+</span><span>blend ~${aiBlendCost.toFixed(3)}</span></>}
                            <span className="text-zinc-500 ml-auto">~${total.toFixed(3)}</span>
                          </div>
                        );
                      })()}

                      {/* Shadow map preview — dev (extract params live in the Extract step) */}
                      {shadowPreview && (
                        <div className="rounded-lg border border-zinc-800 overflow-hidden">
                          <button onClick={() => setShowShadowMap(v => !v)}
                            className="w-full flex items-center justify-between px-2.5 py-1.5 text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors">
                            <span className="flex items-center gap-1">
                              <Eye size={9} /> Shadow map
                              <span className="bg-zinc-800 text-zinc-500 px-1 rounded text-[9px]">dev</span>
                            </span>
                            <ChevronRight size={9} className={["transition-transform", showShadowMap ? "rotate-90" : ""].join(" ")} />
                          </button>
                          {showShadowMap && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={shadowPreview} alt="shadow map" className="w-full border-t border-dashed border-zinc-800 opacity-60" />
                          )}
                        </div>
                      )}

                      {/* AI Enhance */}
                      {renderUrl && (
                        <div className={["rounded-xl border transition-all overflow-hidden",
                          showAiBlend ? "border-purple-700/50 bg-purple-950/20" : "border-zinc-800"].join(" ")}>
                          <button onClick={() => setShowAiBlend(v => !v)} className="w-full flex items-center justify-between px-3 py-2">
                            <span className={["flex items-center gap-1.5 text-[11px] font-medium", showAiBlend ? "text-purple-300" : "text-zinc-400"].join(" ")}>
                              <Wand2 size={10} className={showAiBlend ? "text-purple-400" : "text-zinc-500"} />
                              AI Enhance
                              {analysis && AI_BLEND_DEFAULTS[analysis.surfaceType]?.enabled && !showAiBlend && (
                                <span className="text-[9px] px-1 py-0 rounded-full bg-purple-500/20 text-purple-400">rec</span>
                              )}
                            </span>
                            <ChevronRight size={9} className={["text-zinc-600 transition-transform", showAiBlend ? "rotate-90" : ""].join(" ")} />
                          </button>

                          {showAiBlend && (
                            <div className="px-3 pb-3 space-y-2.5 border-t border-zinc-800 pt-2.5">
                              <div className="grid grid-cols-3 gap-1">
                                {(["fast", "balanced", "quality"] as const).map(q => (
                                  <button key={q} onClick={() => setAiQuality(q)}
                                    className={["py-1 rounded-lg text-[10px] font-medium transition-colors",
                                      aiQuality === q ? "bg-purple-700 text-white" : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"].join(" ")}>
                                    <span className="capitalize">{q}</span>
                                    <span className={["block text-[9px] font-normal", aiQuality === q ? "text-purple-300" : "text-zinc-600"].join(" ")}>
                                      {q === "fast" ? "$0.005" : q === "balanced" ? "$0.015" : "$0.045"}
                                    </span>
                                  </button>
                                ))}
                              </div>
                              <div className="space-y-0.5">
                                <label className="text-[10px] text-zinc-400 flex items-center justify-between">
                                  <span>Strength</span>
                                  <span className="text-zinc-300 font-mono">{Math.round(aiStrength * 100)}%</span>
                                </label>
                                <input type="range" min={0.05} max={0.70} step={0.05} value={aiStrength}
                                  onChange={e => setAiStrength(Number(e.target.value))}
                                  className="w-full accent-purple-500 h-1" />
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] text-zinc-400">Texture</span>
                                <div className="flex items-center gap-2">
                                  {aiTexture && <span className="text-[9px] text-zinc-500 font-mono">{Math.round(aiTextureOpacity * 100)}%</span>}
                                  <button onClick={() => setAiTexture(v => !v)}
                                    className={["relative w-7 h-3.5 rounded-full transition-colors flex-none", aiTexture ? "bg-purple-600" : "bg-zinc-700"].join(" ")}>
                                    <span className={["absolute top-0.5 w-2.5 h-2.5 rounded-full bg-white shadow transition-transform",
                                      aiTexture ? "translate-x-3.5" : "translate-x-0.5"].join(" ")} />
                                  </button>
                                </div>
                              </div>
                              {aiTexture && (
                                <input type="range" min={0} max={0.6} step={0.05} value={aiTextureOpacity}
                                  onChange={e => setAiTextureOpacity(Number(e.target.value))}
                                  className="w-full accent-purple-500 h-1" />
                              )}
                              <button onClick={handleAIBlend} disabled={aiBlendState === "loading"}
                                className="w-full py-2 rounded-xl bg-purple-700 hover:bg-purple-600 disabled:bg-zinc-700 disabled:text-zinc-500 text-[11px] font-medium transition-colors flex items-center justify-center gap-1.5">
                                {aiBlendState === "loading"
                                  ? <><Loader2 size={10} className="animate-spin" /> Blending…</>
                                  : <><Zap size={10} /> {aiBlendState === "done" ? "Re-apply" : "Apply"} AI Blend</>}
                              </button>
                              {aiBlendErr && <p className="text-red-400 text-[9px] flex items-center gap-1"><AlertTriangle size={8} /> {aiBlendErr}</p>}
                            </div>
                          )}
                        </div>
                      )}

                    </div>
                  </div>
                </Draggable>

          </div>
        </div>
      )}

    </div>
  );
}

export default function PhotoMockupPage() {
  return (
    <Suspense>
      <PhotoMockupPageInner />
    </Suspense>
  );
}
