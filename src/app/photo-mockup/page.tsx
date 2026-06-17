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
import SegmentCanvas, { type SegApi } from "@/components/SegmentCanvas";
import PenMaskCanvas, { type PenApi } from "@/components/PenMaskCanvas";
import BrushCanvas, { type BrushApi } from "@/components/BrushCanvas";
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
  { name: "Quente",    grain: 5,  warmth: 30,  saturation: 110, brightness: 102 },
  { name: "Cold",    grain: 5,  warmth: -30, saturation: 95,  brightness: 100 },
  { name: "Fosco",   grain: 15, warmth: 5,   saturation: 75,  brightness: 95  },
  { name: "Vívido",   grain: 0,  warmth: 0,   saturation: 145, brightness: 105 },
  { name: "P&B",     grain: 18, warmth: 0,   saturation: 0,   brightness: 100 },
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
      // Use LAYOUT size (offset*), not getBoundingClientRect — the latter reflects the
      // ZoomPanViewer CSS transform, which would double-scale the canvas. Sizing to layout
      // means the canvas (and its handles) scale uniformly WITH the transform → always aligned.
      const iw = (img as HTMLElement).offsetWidth, ih = (img as HTMLElement).offsetHeight;
      canvas.width = iw; canvas.height = ih;
      scaleRef.current = { sx: iw / imageNW, sy: ih / imageNH, ox: 0, oy: 0 };
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
      (e.currentTarget as HTMLCanvasElement).style.cursor = (hitTest(x, y, sc) || edgeHitTest(x, y, sc)) ? "grab" : "default";
      return;
    }
    // Corner follows the cursor directly in image space — robust at any zoom/pan.
    onQuadChange({ ...quad, [dragging.current]: { x: Math.round(clampN(x, 0, imageNW)), y: Math.round(clampN(y, 0, imageNH)) } });
  };

  const onMouseUp = () => { dragging.current = null; draggingEdge.current = null; draw(); };

  return (
    <div ref={containerRef} className="relative select-none">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img ref={imgRef} src={imageUrl} alt="photo" className="w-full block rounded-xl" draggable={false} />
      <canvas
        ref={canvasRef}
        className="absolute inset-0"
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
      />
    </div>
  );
}

// ── Compact pipeline dot ─────────────────────────────────────────────────────

function StepPip({ label, state, active }: { label: string; state: StepState; active: boolean }) {
  const dot = state === "done"    ? "bg-acc2"
            : state === "loading" ? "bg-acc animate-pulse"
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
      {state === "loading" && <Loader2 size={9} className="animate-spin text-acc flex-none" />}
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
          ? "border-acc bg-acc/10"
          : "border-zinc-700 hover:border-zinc-500 bg-zinc-900/30 hover:bg-zinc-900/50",
        className,
      ].join(" ")}
    >
      <Upload
        size={hero ? 40 : 20}
        className={dragOver ? "text-acc" : "text-zinc-600 group-hover:text-zinc-400 transition-colors"}
      />
      <p className={[hero ? "text-base" : "text-[10px]", "font-medium transition-colors", dragOver ? "text-acc" : "text-zinc-500 group-hover:text-zinc-300"].join(" ")}>
        {dragOver ? "Solte pra renderizar" : "Solte a arte aqui"}
      </p>
      <p className={[hero ? "text-xs" : "text-[9px]", "text-zinc-700"].join(" ")}>PNG, JPG, SVG · renderiza ao soltar</p>
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
  const [highlightOpacity, setHighlightOpacity] = useState(0.10); // ambient light (screen)
  const [castOpacity,      setCastOpacity]      = useState(0.10); // scene color cast
  const [reflectionOpacity, setReflectionOpacity] = useState(0);  // reflexo (art tint on reflections)
  const [lightWrap, setLightWrap] = useState(0);  // ambient light wrap on the art edge
  const [matchScene, setMatchScene] = useState(0);  // grain + colour match to the scene
  const [contactShadow, setContactShadow] = useState(0);  // cast shadow grounding the surface
  const [realism, setRealism] = useState(0.3);   // one knob → light wrap + contact shadow + grain
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [procMs, setProcMs] = useState(0);        // live elapsed while processing/rendering
  const processingRef = useRef(false);            // re-entrancy guard for handleProcess
  const procStartRef = useRef(0);
  const extractTimer = useRef<ReturnType<typeof setTimeout> | null>(null);  // debounce re-extract
  const [reflectionBlur,    setReflectionBlur]    = useState(24);
  const [reflectionMaskUrl, setReflectionMaskUrl] = useState<string | null>(null); // brush override
  // Non-destructive layer visibility — toggling hides a mask from the bake WITHOUT discarding it.
  const [surfaceOn, setSurfaceOn] = useState(true);
  const [occluderOn, setOccluderOn] = useState(true);
  const [reflectionLayerOn, setReflectionLayerOn] = useState(true);
  // Recorte (Segment) tool options — live in the side panel (Photoshop-style),
  // controlled here; the canvas component just samples/draws and exposes apply via ref.
  const segApiRef = useRef<SegApi | null>(null);
  const [segMode, setSegMode] = useState<"sam" | "smart">("smart");
  const [segTol, setSegTol] = useState(15);
  const [segContract, setSegContract] = useState(1);
  const [segMatte, setSegMatte] = useState(true);
  const [segFeather, setSegFeather] = useState(2);
  const [segHasMask, setSegHasMask] = useState(false);
  const [segApplied, setSegApplied] = useState<{ surface?: boolean; occluder?: boolean }>({});
  const [segSwatch, setSegSwatch] = useState<[number, number, number] | null>(null);
  const [segStatus, setSegStatus] = useState<{ status: string; msg: string; device: string | null }>({ status: "loading", msg: "", device: null });
  // Caneta (Pen) + Reflexo (Brush) tool options — also in the side panel.
  const penApiRef = useRef<PenApi | null>(null);
  const [penFeather, setPenFeather] = useState(2);
  const [penHasMask, setPenHasMask] = useState(false);
  const [penStatus, setPenStatus] = useState("");
  const brushApiRef = useRef<BrushApi | null>(null);
  const [brushSize, setBrushSize] = useState(60);
  const [brushErase, setBrushErase] = useState(false);
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
  // Unified editor: which tool overlays the single fullscreen canvas.
  // "result" shows the rendered mockup; the others edit the surface over the scene photo.
  type EditorTool = "result" | "corners" | "segment" | "pen" | "reflect";
  const [tool, setTool] = useState<EditorTool>("result");
  const toolRef = useRef<EditorTool>("result"); toolRef.current = tool;
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
    setTool("result"); // new photo → land on the Resultado tab

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
  }, [fxGrain, fxWarmth, fxSaturation, fxBrightness, fxContrast, shadowOpacity, highlightOpacity, castOpacity, maskFeather, reflectionOpacity, reflectionBlur, lightWrap, matchScene, contactShadow, textureAmount, specularOpacity, frameSig, warpSig]);

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
    if (!uploadId || !quad || processingRef.current) return;  // guard re-entrancy (corner-drag storm)
    processingRef.current = true;
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
          surfaceMaskBase64: (surfaceOn && surfaceMaskUrl) ? surfaceMaskUrl : undefined,
          occluderMaskBase64: (occluderOn && occluderMaskUrl) ? occluderMaskUrl : undefined,
          reflectionMaskBase64: (reflectionLayerOn && reflectionMaskUrl) ? reflectionMaskUrl : undefined,
        }),
      });
      setShadowPreview(`/api/photo-mockup/${uploadId}/asset/shadow?t=${Date.now()}`);
      setProcessState("done");
      // Refresh the mockup with the newly extracted mask/lighting
      if (artFile) setTimeout(() => handleRenderRef.current(), 80);
    } catch (e: any) {
      setProcessErr(e.message); setProcessState("error");
    } finally {
      processingRef.current = false;
    }
  }, [uploadId, quad, imgDims, shadowFloor, preBlur, artFile, surfaceMaskUrl, occluderMaskUrl, reflectionMaskUrl, surfaceOn, occluderOn, reflectionLayerOn]);

  // Auto-extract → render. DEBOUNCED 700ms so dragging corners coalesces into a
  // single light/shadow re-extract after you stop (extract is the expensive pass).
  // Guarded by processingRef so calls can't stack.
  useEffect(() => {
    if (!(artFile && quad && uploadId && processState === "idle" && !processingRef.current)) return;
    if (extractTimer.current) clearTimeout(extractTimer.current);
    extractTimer.current = setTimeout(() => handleProcess(), 700);
    return () => { if (extractTimer.current) clearTimeout(extractTimer.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artFile, quad, uploadId, processState]);

  // Live elapsed timer while processing/rendering — so it never feels stuck.
  useEffect(() => {
    const busy = processState === "loading" || renderState === "loading" || autoRenderPending;
    if (!busy) { procStartRef.current = 0; setProcMs(0); return; }
    if (!procStartRef.current) procStartRef.current = Date.now();
    const id = setInterval(() => setProcMs(Date.now() - (procStartRef.current || Date.now())), 100);
    return () => clearInterval(id);
  }, [processState, renderState, autoRenderPending]);

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
          lightWrap,
          matchScene,
          contactShadow,
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

  // ── Global undo/redo — snapshots ALL editable state (params, masks, quad) ──
  const histRef = useRef<{ stack: string[]; idx: number }>({ stack: [], idx: -1 });
  const restoringRef = useRef(false);
  const snapRef = useRef<() => string>(() => "{}");
  // Latest snapshot fn (captures current state each render).
  snapRef.current = () => JSON.stringify({
    shadowOpacity, highlightOpacity, castOpacity, fxGrain, fxWarmth, fxSaturation,
    fxBrightness, fxContrast, maskFeather, shadowFloor, preBlur, reflectionOpacity,
    reflectionBlur, lightWrap, matchScene, contactShadow, cylinder, bend, textureAmount,
    specularOpacity, surfaceMaskUrl, occluderMaskUrl, reflectionMaskUrl, surfaceOn, occluderOn, reflectionLayerOn, quad, frame,
  });

  const applySnap = useCallback((s: string) => {
    const o = JSON.parse(s);
    setShadowOpacity(o.shadowOpacity); setHighlightOpacity(o.highlightOpacity); setCastOpacity(o.castOpacity);
    setFxGrain(o.fxGrain); setFxWarmth(o.fxWarmth); setFxSaturation(o.fxSaturation);
    setFxBrightness(o.fxBrightness); setFxContrast(o.fxContrast); setMaskFeather(o.maskFeather);
    setShadowFloor(o.shadowFloor); setPreBlur(o.preBlur); setReflectionOpacity(o.reflectionOpacity);
    setReflectionBlur(o.reflectionBlur); setLightWrap(o.lightWrap); setMatchScene(o.matchScene);
    setContactShadow(o.contactShadow); setCylinder(o.cylinder); setBend(o.bend);
    setTextureAmount(o.textureAmount); setSpecularOpacity(o.specularOpacity);
    setSurfaceMaskUrl(o.surfaceMaskUrl ?? null); setOccluderMaskUrl(o.occluderMaskUrl ?? null);
    setReflectionMaskUrl(o.reflectionMaskUrl ?? null);
    setSurfaceOn(o.surfaceOn ?? true); setOccluderOn(o.occluderOn ?? true); setReflectionLayerOn(o.reflectionLayerOn ?? true);
    setQuad(o.quad ?? null); setFrame(o.frame);
  }, []);

  // Capture a debounced snapshot whenever any tracked field changes.
  useEffect(() => {
    if (restoringRef.current) { restoringRef.current = false; return; }
    const t = setTimeout(() => {
      const s = snapRef.current();
      const h = histRef.current;
      if (h.stack[h.idx] !== s) { h.stack = h.stack.slice(0, h.idx + 1); h.stack.push(s); h.idx = h.stack.length - 1; }
    }, 350);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shadowOpacity, highlightOpacity, castOpacity, fxGrain, fxWarmth, fxSaturation, fxBrightness, fxContrast, maskFeather, shadowFloor, preBlur, reflectionOpacity, reflectionBlur, lightWrap, matchScene, contactShadow, cylinder, bend, textureAmount, specularOpacity, surfaceMaskUrl, occluderMaskUrl, reflectionMaskUrl, surfaceOn, occluderOn, reflectionLayerOn, quad, frame]);

  // Ctrl/Cmd+Z = undo · Ctrl+Shift+Z / Ctrl+Y = redo (whole editor state).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (!(e.ctrlKey || e.metaKey)) return;
      // In Recorte, Ctrl+Z is handled by SegmentCanvas (undo last SAM point) — yield.
      if (toolRef.current === "segment") return;
      const k = e.key.toLowerCase();
      const h = histRef.current;
      const redo = (k === "z" && e.shiftKey) || k === "y";
      const undo = k === "z" && !e.shiftKey;
      if (redo && h.idx < h.stack.length - 1) { e.preventDefault(); h.idx++; restoringRef.current = true; applySnap(h.stack[h.idx]); }
      else if (undo && h.idx > 0) { e.preventDefault(); h.idx--; restoringRef.current = true; applySnap(h.stack[h.idx]); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [applySnap]);

  // Tool shortcuts (Adobe-style): V result · C cantos · S segmentar · P caneta · R reflexo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const map: Record<string, EditorTool> = { v: "result", c: "corners", s: "segment", p: "pen", r: "reflect" };
      const tt = map[e.key.toLowerCase()];
      if (tt) { e.preventDefault(); setTool(tt); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Realism is a single knob — drives light wrap + contact shadow + grain match
  // together so mockups look grounded out of the box (no manual 3-slider hunt).
  useEffect(() => {
    setLightWrap(+(realism * 0.55).toFixed(2));
    setContactShadow(+(realism * 0.8).toFixed(2));
    setMatchScene(+(realism * 0.65).toFixed(2));
  }, [realism]);

  // Re-apply the segment mask when its refine params change — so feather / limpar /
  // matte / tolerância are LIVE after you've already applied a surface/occluder.
  useEffect(() => {
    if (tool !== "segment" || (!segApplied.surface && !segApplied.occluder)) return;
    const t = setTimeout(() => {
      if (segApplied.surface) segApiRef.current?.apply("surface");
      if (segApplied.occluder) segApiRef.current?.apply("occluder");
    }, 250);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segFeather, segContract, segMatte, segTol, segApplied.surface, segApplied.occluder]);

  const resetPhoto = useCallback(() => {
    setPhotoUrl(null); setUploadId(null); setUploadState("idle");
    setAnalyzeState("idle"); setAnalysis(null); setQuad(null);
    setProcessState("idle"); setShadowPreview(null); setRenderUrl(null);
    setTool("result");
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
      <StepPip label="Foto"  state={uploadState}  active={active === "upload"} />
      <ChevronRight size={10} className="text-zinc-800" />
      <StepPip label="Superfície"  state={analyzeState} active={active === "analyze"} />
      <ChevronRight size={10} className="text-zinc-800" />
      <StepPip label="Luz"     state={processState} active={active === "process"} />
      <ChevronRight size={10} className="text-zinc-800" />
      <StepPip label="Render"  state={renderState}  active={active === "render"} />
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

      {/* ── Phases 1–2 (upload + auto-detect) ────────────────────────── */}
      {(active === "upload" || active === "analyze") && (
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
                      <Loader2 size={32} className="animate-spin text-acc" />
                    ) : (
                      <>
                        <Upload size={32} className="text-zinc-500" />
                        <div className="text-center">
                          <p className="font-medium text-zinc-300">Solte sua foto aqui</p>
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
                        Trocar foto
                      </button>
                    </div>
                    <QuadEditor imageUrl={photoUrl} imageNW={imgDims.w} imageNH={imgDims.h} quad={quad}
                      onQuadChange={(q) => { setQuad(q); setProcessState("idle"); setRenderUrl(null); }} />
                  </div>
                )}
              </div>
            )}


          </div>
        </div>
      )}

      {/* ── Unified editor — single fullscreen canvas + side-panel tools ── */}
      {(active === "process" || active === "render") && (
        <div
          className={["fixed top-14 bottom-0 left-0 right-0 z-40 overflow-hidden transition-colors",
            !artFile && bgDragOver ? "bg-acc/10" : "bg-zinc-950"].join(" ")}
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
                {/* NB: no key={activeImageUrl} — keying here remounts the viewer on
                    every render / AI↔Original toggle, resetting zoom+pan (flicker).
                    The inner <img> swaps src in place; zoom/pan state persists. */}
                {tool === "corners" && photoUrl && quad ? (
                  // Corners — quad editor over the scene photo (wheel zooms, Space+drag pans).
                  <ZoomPanViewer requireSpaceToPan>
                    <div style={{ maxWidth: "calc(100vw - 360px)" }}>
                      {/* Show the rendered mockup (art) under the handles, not the magenta
                          base. Keep the last render visible while re-adjusting (no flash). */}
                      <QuadEditor imageUrl={activeImageUrl ?? photoUrl} imageNW={imgDims.w} imageNH={imgDims.h} quad={quad}
                        onQuadChange={(q) => { setQuad(q); setProcessState("idle"); }}
                        bend={bend} onBendChange={setBend} />
                    </div>
                  </ZoomPanViewer>
                ) : tool === "segment" && photoUrl ? (
                  // requireSpaceToPan: dragging a SAM point moves it; Space+drag pans; wheel zooms.
                  <ZoomPanViewer requireSpaceToPan>
                    <div style={{ maxWidth: "calc(100vw - 360px)" }}>
                      <SegmentCanvas imageUrl={activeImageUrl ?? photoUrl} sampleUrl={photoUrl} imageW={imgDims.w} imageH={imgDims.h}
                        mode={segMode} tolerance={segTol} contract={segContract} matte={segMatte} feather={segFeather}
                        onMaskChange={setSegHasMask} onStatusChange={setSegStatus} onSwatch={setSegSwatch} apiRef={segApiRef}
                        onApply={(role, url) => {
                          if (role === "surface") setSurfaceMaskUrl(url); else setOccluderMaskUrl(url);
                          setSegApplied((a) => ({ ...a, [role]: true }));
                          setProcessState("idle");  // re-bakes → art clips to the segment, render updates (confirmation)
                        }} />
                    </div>
                  </ZoomPanViewer>
                ) : tool === "pen" && photoUrl ? (
                  <ZoomPanViewer requireSpaceToPan>
                    <div style={{ maxWidth: "calc(100vw - 360px)" }}>
                      <PenMaskCanvas imageUrl={activeImageUrl ?? photoUrl} imageW={imgDims.w} imageH={imgDims.h}
                        feather={penFeather} onMaskChange={setPenHasMask} onStatus={setPenStatus} apiRef={penApiRef}
                        onApply={(role, url) => {
                          if (role === "surface") setSurfaceMaskUrl(url); else setOccluderMaskUrl(url);
                          setProcessState("idle");
                        }} />
                    </div>
                  </ZoomPanViewer>
                ) : tool === "reflect" && photoUrl ? (
                  <ZoomPanViewer requireSpaceToPan>
                    <div style={{ maxWidth: "calc(100vw - 360px)" }}>
                      <BrushCanvas imageUrl={activeImageUrl ?? photoUrl} imageW={imgDims.w} imageH={imgDims.h}
                        brush={brushSize} eraseMode={brushErase} apiRef={brushApiRef}
                        onChange={(url) => { setReflectionMaskUrl(url); setProcessState("idle"); }} />
                    </div>
                  </ZoomPanViewer>
                ) : activeImageUrl ? (
                  <ZoomPanViewer>
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
                          // Pulse opacity (compositor-only, cheap) — NOT the blur filter,
                          // which would repaint every frame. Gives a soft breathing shimmer.
                          className="animate-[art-blur-pulse_1.4s_ease-in-out_infinite]"
                          style={{
                            position: "absolute", inset: 0, width: "100%", height: "100%",
                            objectFit: "contain", pointerEvents: "none",
                            filter: "blur(7px) brightness(0.97)",
                            clipPath: surfaceClip, WebkitClipPath: surfaceClip,
                            willChange: "opacity",
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
                      {(renderState === "loading" || processState === "loading" || autoRenderPending) ? (
                        <div className="flex flex-col items-center gap-3 text-zinc-300">
                          <Loader2 size={30} className="animate-spin text-acc" />
                          <span className="text-sm">Renderizando…</span>
                        </div>
                      ) : artFile ? (
                        <div className="flex flex-col items-center gap-2 text-zinc-400 text-sm text-center">
                          <span>Arte carregada.</span>
                          <span className="text-zinc-600 text-xs">Clique em <span className="text-acc">Extrair luz &amp; renderizar</span> no painel.</span>
                        </div>
                      ) : (
                        <ArtDropZone onFile={handleArtFile} dragOver={bgDragOver} size="hero" />
                      )}
                    </div>
                  </div>
                )}

                {/* Subtle top progress bar — non-intrusive, image stays visible (blurred) */}
                {(renderState === "loading" || autoRenderPending) && (
                  <div className="absolute top-0 left-0 right-0 h-0.5 z-20 overflow-hidden pointer-events-none">
                    <div className="h-full w-1/3 bg-acc/80 rounded-full animate-[scene-loadbar_1.1s_ease-in-out_infinite]" />
                  </div>
                )}

                {/* AI toggle badge */}
                {aiBlendUrl && (
                  <button
                    onClick={() => setShowAiResult(v => !v)}
                    className={["absolute top-3 left-4 z-20 text-[11px] px-2 py-0.5 rounded-full backdrop-blur-sm flex items-center gap-1 transition-colors",
                      showAiResult ? "bg-acc/80 text-white" : "bg-black/50 text-zinc-400 hover:text-white"].join(" ")}
                  >
                    <Wand2 size={9} /> {showAiResult ? "AI" : "Original"}
                  </button>
                )}

                {/* Live status — processing timer (so it never feels stuck) */}
                {(processState === "loading" || renderState === "loading" || autoRenderPending) && (
                  <span className="absolute top-3 right-4 z-20 text-[11px] font-mono bg-black/60 text-acc px-2 py-0.5 rounded-full backdrop-blur-sm flex items-center gap-1">
                    <Loader2 size={9} className="animate-spin" /> {(procMs / 1000).toFixed(1)}s
                  </span>
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
                {/* key re-anchors the panel when crossing the param-count boundary
                    (Resultado = many params vs editing tools = few) so a panel dragged
                    while short never ends up with its header off-screen when it grows. */}
                <Draggable key={tool === "result" ? "panel-full" : "panel-lite"} nodeRef={panelRef as any} handle=".panel-drag" bounds="parent" defaultPosition={{ x: 0, y: 0 }}>
                  <div
                    ref={panelRef}
                    className="absolute bottom-6 right-6 z-30 w-72 bg-zinc-900/95 backdrop-blur-md border border-zinc-700/70 rounded-2xl shadow-2xl overflow-hidden flex flex-col"
                    style={{ maxHeight: "calc(100vh - 28px)" }}
                  >
                    {/* Drag handle */}
                    <div className="panel-drag cursor-grab active:cursor-grabbing flex items-center justify-between px-3 py-2 border-b border-zinc-800 select-none shrink-0">
                      <span className="text-[10px] text-zinc-500 font-medium uppercase tracking-widest">Ajustes</span>
                      <div className="flex gap-0.5 items-center">
                        <span className="w-1 h-1 rounded-full bg-zinc-600" />
                        <span className="w-1 h-1 rounded-full bg-zinc-600" />
                        <span className="w-1 h-1 rounded-full bg-zinc-600" />
                      </div>
                    </div>

                    <div className="p-3 space-y-3 overflow-y-auto flex-1 min-h-0">

                      {/* Surface tools — one canvas, switch what overlays it. */}
                      {photoUrl && (
                        <div className="space-y-2 bg-zinc-800/40 rounded-xl border border-zinc-700/40 p-2">
                          <div className="grid grid-cols-5 gap-1">
                            {([
                              ["corners", "Cantos"],
                              ["segment", "Recorte"],
                              ["pen", "Caneta"],
                              ["reflect", "Reflexo"],
                              ["result", "Render"],
                            ] as [EditorTool, string][]).map(([t, label]) => (
                              <button key={t} onClick={() => setTool(t)}
                                className={["px-0.5 py-1.5 rounded-lg text-[9px] font-medium leading-tight transition-colors border",
                                  tool === t ? "bg-acc2 text-zinc-950 border-acc2"
                                             : "bg-zinc-800/60 text-zinc-400 border-zinc-700/50 hover:bg-zinc-700/60"].join(" ")}>
                                {label}
                              </button>
                            ))}
                          </div>
                          {tool === "corners" && <p className="text-[10px] text-zinc-600">Arraste os cantos pra ajustar a superfície; losangos curvam as bordas.</p>}
                          {tool === "segment" && (
                            <div className="space-y-1.5">
                              <div className="grid grid-cols-2 gap-1">
                                {([["smart", "Varinha"], ["sam", "SAM"]] as const).map(([m, l]) => (
                                  <button key={m} onClick={() => setSegMode(m)}
                                    className={["py-1 rounded-lg text-[10px] font-medium border transition-colors",
                                      segMode === m ? "bg-acc2 text-zinc-950 border-acc2" : "bg-zinc-800/60 text-zinc-400 border-zinc-700/50 hover:bg-zinc-700/60"].join(" ")}>{l}</button>
                                ))}
                              </div>
                              {segMode === "sam"
                                ? <p className="text-[10px] text-zinc-600">Clique na <span className="text-acc2">superfície</span>; direito nos <span className="text-acc">objetos na frente</span>.</p>
                                : <p className="text-[10px] text-zinc-600 flex items-center gap-1">Clique na superfície pra selecionar a cor{segSwatch && <span className="inline-block w-3 h-3 rounded-sm border border-zinc-600 align-middle" style={{ background: `rgb(${segSwatch[0]},${segSwatch[1]},${segSwatch[2]})` }} />}</p>}
                              {segMode === "smart" && (<>
                                <label className="text-[10px] text-zinc-400 flex justify-between"><span>Tolerância</span><span className="font-mono text-zinc-500">{segTol}</span></label>
                                <input type="range" min={1} max={80} value={segTol} onChange={(e) => setSegTol(+e.target.value)} className="w-full accent-acc h-1" />
                                <label className="text-[10px] text-zinc-400 flex justify-between"><span>Limpar borda <span className="text-zinc-700">· tira franja</span></span><span className="font-mono text-zinc-500">{segContract}px</span></label>
                                <input type="range" min={0} max={8} value={segContract} onChange={(e) => setSegContract(+e.target.value)} className="w-full accent-acc h-1" />
                                <button onClick={() => setSegMatte(v => !v)}
                                  className={["w-full py-1 rounded-lg text-[10px] font-medium border transition-colors",
                                    segMatte ? "bg-acc2 text-zinc-950 border-acc2" : "bg-zinc-800/60 text-zinc-400 border-zinc-700/50 hover:bg-zinc-700/60"].join(" ")}>Refinar borda (matte) {segMatte ? "on" : "off"}</button>
                              </>)}
                              <label className="text-[10px] text-zinc-400 flex justify-between"><span>Suavizar borda</span><span className="font-mono text-zinc-500">{segFeather}px</span></label>
                              <input type="range" min={0} max={20} value={segFeather} onChange={(e) => setSegFeather(+e.target.value)} className="w-full accent-acc h-1" />
                              <div className="grid grid-cols-2 gap-1.5 pt-0.5">
                                <button onClick={() => segApiRef.current?.apply("surface")} disabled={!segHasMask}
                                  className={["py-1.5 rounded-lg text-[10px] font-medium transition-colors", segApplied.surface ? "bg-acc2 text-zinc-950" : "bg-zinc-800 hover:bg-zinc-700 text-zinc-300 disabled:opacity-40"].join(" ")}>{segApplied.surface ? "Superfície ✓" : "Usar superfície"}</button>
                                <button onClick={() => segApiRef.current?.apply("occluder")} disabled={!segHasMask}
                                  className={["py-1.5 rounded-lg text-[10px] font-medium transition-colors", segApplied.occluder ? "bg-acc2 text-zinc-950" : "bg-zinc-800 hover:bg-zinc-700 text-zinc-300 disabled:opacity-40"].join(" ")}>{segApplied.occluder ? "Oclusão ✓" : "Usar oclusão"}</button>
                              </div>
                              <button onClick={() => segApiRef.current?.clear()} disabled={!segHasMask} className="w-full text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors">Limpar seleção</button>
                              {segStatus.status !== "ready" && segMode === "sam" && <p className="text-[10px] text-zinc-500 flex items-center gap-1"><Loader2 size={9} className="animate-spin" /> {segStatus.msg}</p>}
                            </div>
                          )}
                          {tool === "pen" && (
                            <div className="space-y-1.5">
                              <p className="text-[10px] text-zinc-600">{penStatus || "clique = canto · clique-arraste = curva"}</p>
                              <label className="text-[10px] text-zinc-400 flex justify-between"><span>Suavizar borda</span><span className="font-mono text-zinc-500">{penFeather}px</span></label>
                              <input type="range" min={0} max={20} value={penFeather} onChange={(e) => setPenFeather(+e.target.value)} className="w-full accent-acc h-1" />
                              <div className="grid grid-cols-2 gap-1.5">
                                <button onClick={() => penApiRef.current?.undo()} className="py-1.5 rounded-lg text-[10px] bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors">Desfazer ponto</button>
                                <button onClick={() => penApiRef.current?.clear()} className="py-1.5 rounded-lg text-[10px] bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors">Limpar traço</button>
                              </div>
                              <div className="grid grid-cols-2 gap-1.5">
                                <button onClick={() => penApiRef.current?.apply("surface")} disabled={!penHasMask} className="py-1.5 rounded-lg text-[10px] font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 disabled:opacity-40 transition-colors">Usar superfície</button>
                                <button onClick={() => penApiRef.current?.apply("occluder")} disabled={!penHasMask} className="py-1.5 rounded-lg text-[10px] font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 disabled:opacity-40 transition-colors">Usar oclusão</button>
                              </div>
                            </div>
                          )}
                          {tool === "reflect" && (
                            <div className="space-y-1.5">
                              <p className="text-[10px] text-zinc-600">Pinte onde a arte deve <span className="text-acc">refletir</span> (chão molhado, vidro). Botão direito apaga.</p>
                              <div className="grid grid-cols-2 gap-1">
                                <button onClick={() => setBrushErase(false)} className={["py-1 rounded-lg text-[10px] font-medium border transition-colors", !brushErase ? "bg-acc2 text-zinc-950 border-acc2" : "bg-zinc-800/60 text-zinc-400 border-zinc-700/50 hover:bg-zinc-700/60"].join(" ")}>Pintar</button>
                                <button onClick={() => setBrushErase(true)} className={["py-1 rounded-lg text-[10px] font-medium border transition-colors", brushErase ? "bg-acc2 text-zinc-950 border-acc2" : "bg-zinc-800/60 text-zinc-400 border-zinc-700/50 hover:bg-zinc-700/60"].join(" ")}>Apagar</button>
                              </div>
                              <label className="text-[10px] text-zinc-400 flex justify-between"><span>Tamanho do pincel</span><span className="font-mono text-zinc-500">{brushSize}px</span></label>
                              <input type="range" min={Math.max(2, Math.round(Math.max(imgDims.w, imgDims.h) * 0.005))} max={Math.max(20, Math.round(Math.max(imgDims.w, imgDims.h) * 0.12))} value={brushSize} onChange={(e) => setBrushSize(+e.target.value)} className="w-full accent-acc h-1" />
                              <button onClick={() => brushApiRef.current?.clear()} className="w-full text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors">Limpar reflexo</button>
                            </div>
                          )}
                          {/* Apply edits → render. Lives in the editing tabs (intuitive),
                              not in the Render tab. Highlights when there are pending changes. */}
                          {tool !== "result" && artFile && quad && (
                            <button onClick={() => handleProcess()} disabled={processState === "loading"}
                              className={["w-full py-2 rounded-xl text-xs font-medium transition-colors flex items-center justify-center gap-1.5",
                                processState === "loading" ? "bg-zinc-700 text-zinc-400"
                                  : processState === "idle" ? "bg-acc2 text-zinc-950 hover:bg-acc2/90"
                                  : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"].join(" ")}>
                              {processState === "loading"
                                ? <><Loader2 size={12} className="animate-spin" /> Aplicando…</>
                                : <><RefreshCw size={12} /> Aplicar ao render</>}
                            </button>
                          )}
                          {!artFile && (
                            <p className="text-[10px] text-acc/80">Solte a arte no painel — o render acontece sozinho.</p>
                          )}
                          {(processState === "loading" || renderState === "loading" || autoRenderPending) ? (
                            <p className="text-[10px] text-acc flex items-center gap-1"><Loader2 size={9} className="animate-spin" /> Processando · {(procMs / 1000).toFixed(1)}s</p>
                          ) : (artFile && processState === "done" && renderState === "done") ? (
                            <p className="text-[10px] text-acc2 flex items-center gap-1"><CheckCircle2 size={9} /> Pronto{renderMs ? ` · ${(renderMs / 1000).toFixed(1)}s` : ""}</p>
                          ) : null}

                          {/* Layers — non-destructive: eye hides a mask from the bake without losing it. */}
                          {(surfaceMaskUrl || occluderMaskUrl || reflectionMaskUrl) && (
                            <div className="space-y-1 pt-1.5 mt-0.5 border-t border-zinc-800/60">
                              <p className="text-[9px] uppercase tracking-wider text-zinc-600">Camadas</p>
                              {([
                                { on: surfaceOn, set: setSurfaceOn, url: surfaceMaskUrl, clr: () => setSurfaceMaskUrl(null), label: "Superfície", color: "text-acc2" },
                                { on: occluderOn, set: setOccluderOn, url: occluderMaskUrl, clr: () => setOccluderMaskUrl(null), label: "Oclusão", color: "text-acc" },
                                { on: reflectionLayerOn, set: setReflectionLayerOn, url: reflectionMaskUrl, clr: () => setReflectionMaskUrl(null), label: "Reflexo", color: "text-acc" },
                              ] as const).filter((l) => l.url).map((l) => (
                                <div key={l.label} className="flex items-center gap-1.5 text-[10px]">
                                  <button onClick={() => { l.set(!l.on); setProcessState("idle"); }} title="Mostrar/ocultar"
                                    className="text-zinc-400 hover:text-white transition-colors">
                                    <Eye size={11} className={l.on ? "" : "opacity-25"} />
                                  </button>
                                  <span className={["flex-1", l.on ? l.color : "text-zinc-600 line-through"].join(" ")}>{l.label}</span>
                                  <button onClick={() => { l.clr(); setProcessState("idle"); }} title="Remover"
                                    className="text-zinc-600 hover:text-red-400 transition-colors px-0.5">×</button>
                                </div>
                              ))}
                              <div className="flex items-center gap-1.5 text-[10px] text-zinc-500">
                                <Eye size={11} /><span className="flex-1">Arte (base)</span>
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Art section — only for the rendered Resultado; hidden while in
                          the process tools (corners / segment / reflect). */}
                      {tool === "result" && (<>
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
                            Trocar arte
                          </button>
                        </div>
                      ) : (
                        <ArtDropZone onFile={handleArtFile} dragOver={false} size="panel" />
                      )}
                      </>)}

                      {/* Scene info row */}
                      <div className="flex items-center gap-2 bg-zinc-800/40 rounded-xl p-2.5 border border-zinc-700/30">
                        {photoUrl && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={photoUrl} alt="scene" className="w-12 h-12 object-cover rounded-lg flex-none border border-zinc-700/60" />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="text-[10px] font-medium text-zinc-300 truncate capitalize">{analysis?.surfaceType ?? "Foto"} · {analysis?.material}</p>
                          <p className="text-[9px] text-zinc-600">{imgDims.w}×{imgDims.h}px</p>
                          <button onClick={() => handleAnalyze(true)} disabled={analyzeState === "loading"}
                            className="text-[9px] text-zinc-500 hover:text-acc flex items-center gap-0.5 transition-colors mt-0.5">
                            <Zap size={7} /> Re-detectar superfície
                          </button>
                        </div>
                      </div>

                      {/* Render params — only for the rendered result; hidden while
                          editing corners / segment / reflect (those don't use them). */}
                      {tool === "result" && (<>
                      {/* Lighting — shadow (multiply) · ambient (screen) · color cast */}
                      <div className="space-y-2">
                        <div className="space-y-0.5">
                          <label className="text-[10px] text-zinc-400 flex items-center justify-between">
                            <span className="flex items-center gap-1"><Sliders size={9} /> Sombra</span>
                            <span className="font-mono text-zinc-500">{Math.round(shadowOpacity * 100)}%</span>
                          </label>
                          <input type="range" min={0} max={1} step={0.05} value={shadowOpacity}
                            onChange={(e) => setShadowOpacity(Number(e.target.value))}
                            className="w-full accent-acc h-1" />
                        </div>
                        {/* Realismo — single knob (primary). Drives the 3 realism passes. */}
                        <div className="space-y-0.5">
                          <label className="text-[10px] text-zinc-400 flex items-center justify-between">
                            <span className="flex items-center gap-1"><Wand2 size={9} /> Realismo <span className="text-zinc-700">· luz + sombra + grão</span></span>
                            <span className="font-mono text-zinc-500">{Math.round(realism * 100)}%</span>
                          </label>
                          <input type="range" min={0} max={1} step={0.05} value={realism}
                            onChange={(e) => setRealism(Number(e.target.value))}
                            className="w-full accent-acc2 h-1" />
                        </div>
                        <button onClick={() => setShowAdvanced(v => !v)}
                          className="w-full flex items-center justify-between text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors pt-0.5">
                          <span>Ajustes avançados</span>
                          <ChevronRight size={11} className={["transition-transform", showAdvanced ? "rotate-90" : ""].join(" ")} />
                        </button>
                        {showAdvanced && (<>
                        <div className="space-y-0.5">
                          <label className="text-[10px] text-zinc-400 flex items-center justify-between">
                            <span>Luz ambiente</span>
                            <span className="font-mono text-zinc-500">{Math.round(highlightOpacity * 100)}%</span>
                          </label>
                          <input type="range" min={0} max={1} step={0.05} value={highlightOpacity}
                            onChange={(e) => setHighlightOpacity(Number(e.target.value))}
                            className="w-full accent-acc h-1" />
                        </div>
                        <div className="space-y-0.5">
                          <label className="text-[10px] text-zinc-400 flex items-center justify-between">
                            <span>Matiz <span className="text-zinc-700">· tom da cena</span></span>
                            <span className="font-mono text-zinc-500">{Math.round(castOpacity * 100)}%</span>
                          </label>
                          <input type="range" min={0} max={0.5} step={0.02} value={castOpacity}
                            onChange={(e) => setCastOpacity(Number(e.target.value))}
                            className="w-full accent-acc h-1" />
                        </div>
                        <div className="space-y-0.5">
                          <label className="text-[10px] text-zinc-400 flex items-center justify-between">
                            <span>Suavizar borda</span>
                            <span className="font-mono text-zinc-500">{maskFeather}px</span>
                          </label>
                          <input type="range" min={0} max={30} step={1} value={maskFeather}
                            onChange={(e) => setMaskFeather(Number(e.target.value))}
                            className="w-full accent-acc h-1" />
                        </div>
                        <div className="space-y-0.5">
                          <label className="text-[10px] text-zinc-400 flex items-center justify-between">
                            <span>Reflexo <span className="text-zinc-700">· tinge reflexos com a arte</span></span>
                            <span className="font-mono text-zinc-500">{Math.round(reflectionOpacity * 100)}%</span>
                          </label>
                          <input type="range" min={0} max={1} step={0.05} value={reflectionOpacity}
                            onChange={(e) => setReflectionOpacity(Number(e.target.value))}
                            className="w-full accent-acc h-1" />
                          {reflectionOpacity > 0 && (
                            <div className="flex items-center gap-2 pt-1">
                              <span className="text-[9px] text-zinc-600 shrink-0">Espalhar</span>
                              <input type="range" min={4} max={60} step={2} value={reflectionBlur}
                                onChange={(e) => setReflectionBlur(Number(e.target.value))}
                                className="w-full accent-acc h-1" />
                            </div>
                          )}
                        </div>
                        <div className="space-y-0.5">
                          <label className="text-[10px] text-zinc-400 flex items-center justify-between">
                            <span>Light wrap <span className="text-zinc-700">· luz do ambiente na borda</span></span>
                            <span className="font-mono text-zinc-500">{Math.round(lightWrap * 100)}%</span>
                          </label>
                          <input type="range" min={0} max={1} step={0.05} value={lightWrap}
                            onChange={(e) => setLightWrap(Number(e.target.value))}
                            className="w-full accent-acc h-1" />
                        </div>
                        <div className="space-y-0.5">
                          <label className="text-[10px] text-zinc-400 flex items-center justify-between">
                            <span>Casar cena <span className="text-zinc-700">· grão + temperatura</span></span>
                            <span className="font-mono text-zinc-500">{Math.round(matchScene * 100)}%</span>
                          </label>
                          <input type="range" min={0} max={1} step={0.05} value={matchScene}
                            onChange={(e) => setMatchScene(Number(e.target.value))}
                            className="w-full accent-acc h-1" />
                        </div>
                        <div className="space-y-0.5">
                          <label className="text-[10px] text-zinc-400 flex items-center justify-between">
                            <span>Sombra de contato <span className="text-zinc-700">· aterra a superfície</span></span>
                            <span className="font-mono text-zinc-500">{Math.round(contactShadow * 100)}%</span>
                          </label>
                          <input type="range" min={0} max={1} step={0.05} value={contactShadow}
                            onChange={(e) => setContactShadow(Number(e.target.value))}
                            className="w-full accent-acc h-1" />
                        </div>
                        <div className="space-y-0.5">
                          <label className="text-[10px] text-zinc-400 flex items-center justify-between">
                            <span>Textura <span className="text-zinc-700">· arte segue o relevo</span></span>
                            <span className="font-mono text-zinc-500">{Math.round(textureAmount * 100)}%</span>
                          </label>
                          <input type="range" min={0} max={1} step={0.05} value={textureAmount}
                            onChange={(e) => setTextureAmount(Number(e.target.value))}
                            className="w-full accent-acc h-1" />
                        </div>
                        <div className="space-y-0.5">
                          <label className="text-[10px] text-zinc-400 flex items-center justify-between">
                            <span>Brilho <span className="text-zinc-700">· specular (vidro/tela)</span></span>
                            <span className="font-mono text-zinc-500">{Math.round(specularOpacity * 100)}%</span>
                          </label>
                          <input type="range" min={0} max={1} step={0.05} value={specularOpacity}
                            onChange={(e) => setSpecularOpacity(Number(e.target.value))}
                            className="w-full accent-acc h-1" />
                        </div>
                        <div className="flex items-center gap-2 text-[10px] text-zinc-500">
                          <span className="shrink-0">Cilindro <span className="text-zinc-700">· curvar</span></span>
                          <input type="range" min={0} max={1} step={0.02} value={cylinder}
                            onChange={(e) => { setCylinder(Number(e.target.value)); setRenderUrl(null); }}
                            className="flex-1 accent-acc h-1" />
                          <span className="font-mono w-7 text-right">{Math.round(cylinder * 100)}%</span>
                        </div>
                        </>)}
                      </div>

                      {/* Look presets */}
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-zinc-400">Visual</span>
                          <button onClick={() => setShowCustomFX(v => !v)}
                            className="text-[9px] text-zinc-500 hover:text-zinc-300 transition-colors flex items-center gap-1">
                            <Sliders size={8} /> {showCustomFX ? "Ocultar" : "Personalizar"}
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
                            { label: "Grão",      value: fxGrain,      set: setFxGrain,      min: 0,    max: 100, step: 1,  accent: "accent-zinc-400",   fmt: (v: number) => `${v}%` },
                            { label: "Calor",     value: fxWarmth,     set: setFxWarmth,     min: -100, max: 100, step: 5,  accent: "accent-acc", fmt: (v: number) => v > 0 ? `+${v}` : `${v}` },
                            { label: "Saturação", value: fxSaturation, set: setFxSaturation, min: 0,    max: 200, step: 5,  accent: "accent-acc", fmt: (v: number) => `${v}%` },
                            { label: "Claridade", value: fxBrightness, set: setFxBrightness, min: 50,   max: 150, step: 5,  accent: "accent-acc", fmt: (v: number) => `${v}%` },
                            { label: "Contraste",   value: fxContrast,   set: setFxContrast,   min: 50,   max: 150, step: 5,  accent: "accent-acc", fmt: (v: number) => `${v}%` },
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
                            activeImageUrl ? "bg-acc2 hover:bg-acc2/90 text-zinc-950" : "bg-zinc-800 text-zinc-500 pointer-events-none"].join(" ")}>
                          <Download size={11} /> Salvar PNG
                        </a>
                        <button onClick={handlePublish} disabled={!renderUrl || publishState === "loading"}
                          className={["px-3 py-2 rounded-xl text-[11px] transition-colors flex items-center gap-1.5",
                            publishState === "done" ? "bg-acc2 text-zinc-950" :
                            "bg-zinc-800 hover:bg-zinc-700 text-zinc-400 disabled:text-zinc-600"].join(" ")}>
                          {publishState === "done" ? <><CheckCircle2 size={11} /> Salvo!</> :
                           publishState === "loading" ? <><Loader2 size={11} className="animate-spin" /> Salvando…</> :
                           "Biblioteca"}
                        </button>
                        <button onClick={handleRender} disabled={!artFile || renderState === "loading"}
                          className="p-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-500 hover:text-zinc-300 disabled:opacity-40 transition-colors" title="Renderizar de novo">
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
                              <Eye size={9} /> Mapa de sombra
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
                      </>)}

                      {/* AI Enhance */}
                      {tool === "result" && renderUrl && (
                        <div className={["rounded-xl border transition-all overflow-hidden",
                          showAiBlend ? "border-acc/40 bg-acc/5" : "border-zinc-800"].join(" ")}>
                          <button onClick={() => setShowAiBlend(v => !v)} className="w-full flex items-center justify-between px-3 py-2">
                            <span className={["flex items-center gap-1.5 text-[11px] font-medium", showAiBlend ? "text-acc" : "text-zinc-400"].join(" ")}>
                              <Wand2 size={10} className={showAiBlend ? "text-acc" : "text-zinc-500"} />
                              Melhorar com IA
                              {analysis && AI_BLEND_DEFAULTS[analysis.surfaceType]?.enabled && !showAiBlend && (
                                <span className="text-[9px] px-1 py-0 rounded-full bg-acc/20 text-acc">rec</span>
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
                                      aiQuality === q ? "bg-acc text-zinc-950" : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"].join(" ")}>
                                    <span>{q === "fast" ? "Rápido" : q === "balanced" ? "Equilíbrio" : "Alta"}</span>
                                    <span className={["block text-[9px] font-normal", aiQuality === q ? "text-acc" : "text-zinc-600"].join(" ")}>
                                      {q === "fast" ? "$0.005" : q === "balanced" ? "$0.015" : "$0.045"}
                                    </span>
                                  </button>
                                ))}
                              </div>
                              <div className="space-y-0.5">
                                <label className="text-[10px] text-zinc-400 flex items-center justify-between">
                                  <span>Intensidade</span>
                                  <span className="text-zinc-300 font-mono">{Math.round(aiStrength * 100)}%</span>
                                </label>
                                <input type="range" min={0.05} max={0.70} step={0.05} value={aiStrength}
                                  onChange={e => setAiStrength(Number(e.target.value))}
                                  className="w-full accent-acc h-1" />
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] text-zinc-400">Texture</span>
                                <div className="flex items-center gap-2">
                                  {aiTexture && <span className="text-[9px] text-zinc-500 font-mono">{Math.round(aiTextureOpacity * 100)}%</span>}
                                  <button onClick={() => setAiTexture(v => !v)}
                                    className={["relative w-7 h-3.5 rounded-full transition-colors flex-none", aiTexture ? "bg-acc" : "bg-zinc-700"].join(" ")}>
                                    <span className={["absolute top-0.5 w-2.5 h-2.5 rounded-full bg-white shadow transition-transform",
                                      aiTexture ? "translate-x-3.5" : "translate-x-0.5"].join(" ")} />
                                  </button>
                                </div>
                              </div>
                              {aiTexture && (
                                <input type="range" min={0} max={0.6} step={0.05} value={aiTextureOpacity}
                                  onChange={e => setAiTextureOpacity(Number(e.target.value))}
                                  className="w-full accent-acc h-1" />
                              )}
                              <button onClick={handleAIBlend} disabled={aiBlendState === "loading"}
                                className="w-full py-2 rounded-xl bg-acc hover:bg-acc disabled:bg-zinc-700 disabled:text-zinc-500 text-[11px] font-medium transition-colors flex items-center justify-center gap-1.5">
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
