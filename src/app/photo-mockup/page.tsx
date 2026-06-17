"use client";

import { useState, useRef, useCallback, useEffect, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Upload, Loader2, AlertTriangle, CheckCircle2, RefreshCw,
  ChevronRight, Eye, Wand2, Camera,
} from "lucide-react";
import ZoomPanViewer from "@/components/ZoomPanViewer";
import SegmentCanvas, { type SegApi } from "@/components/SegmentCanvas";
import PenMaskCanvas, { type PenApi } from "@/components/PenMaskCanvas";
import BrushCanvas, { type BrushApi } from "@/components/BrushCanvas";
import { ToolRail } from "@/components/photo-tools/ToolRail";
import { PHOTO_TOOLS, PHOTO_TOOL_KEYS, type PhotoTool, type MaskInstrument, type MaskTarget, type MaskMode } from "@/components/photo-tools/registry";
import { CornersPanel } from "@/components/photo-tools/panels/CornersPanel";
import { MaskPanel, type MaskView } from "@/components/photo-tools/panels/MaskPanel";
import { ReflexoPanel } from "@/components/photo-tools/panels/ReflexoPanel";
import { SceneInfo } from "@/components/photo-tools/panels/SceneInfo";
import { RenderPanel } from "@/components/photo-tools/panels/RenderPanel";
import { LuzPanel } from "@/components/photo-tools/panels/LuzPanel";
import { LuzOverlay } from "@/components/LuzOverlay";
import { LuzAssetModal } from "@/components/photo-tools/LuzAssetModal";
import { LUZ_DEFAULTS, toLuzRenderLayers, type LuzLayer, type LuzLayerId } from "@/types/luz";
import { CropFrame, type CropRect } from "@/components/CropFrame";
import { CropPanel, ASPECT_VALUE, type CropAspect } from "@/components/photo-tools/panels/CropPanel";
import { UpscalePanel, type UpscaleTarget, type UpscaleMode } from "@/components/photo-tools/panels/UpscalePanel";
import { AIEditPanel, type AiEditMode } from "@/components/photo-tools/panels/AIEditPanel";
import { ArtDropZone } from "@/components/photo-tools/ArtDropZone";
import { AI_BLEND_DEFAULTS } from "@/components/photo-tools/looks";
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
      <img ref={imgRef} src={imageUrl} alt="photo" className="w-full block rounded-xl" draggable={false}
        style={transparentImg ? { opacity: 0 } : undefined} />
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

// ── Main ──────────────────────────────────────────────────────────────────────

function toBase64File(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result as string);
    fr.onerror = rej;
    fr.readAsDataURL(file);
  });
}

async function urlToDataUrl(url: string): Promise<string> {
  const blob = await (await fetch(url)).blob();
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result as string);
    fr.onerror = rej;
    fr.readAsDataURL(blob);
  });
}

function dataUrlToFile(dataUrl: string, name: string): File {
  const [head, b64] = dataUrl.split(",");
  const mime = /data:(.*?);/.exec(head)?.[1] ?? "image/png";
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], name, { type: mime });
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
  const [maskContract, setMaskContract] = useState(1); // render-side mask erosion (px) — kills edge fringe
  const [shadowFloor, setShadowFloor] = useState(0);   // extractGrayscaleLayers multiplyFloor
  const [preBlur,     setPreBlur]     = useState(0);   // extractGrayscaleLayers preBlur
  // SAM2 segmentation (optional) — refines lighting mask + occluder
  const [showSegment,    setShowSegment]    = useState(false);
  const [surfaceMaskUrl, setSurfaceMaskUrl] = useState<string | null>(null);
  const [occluderMaskUrl, setOccluderMaskUrl] = useState<string | null>(null);
  const [showReflBrush,  setShowReflBrush]  = useState(false);
  // Mask editor (Photoshop model): one persistent mask per target; instruments
  // add/subtract into it. Undo keeps a per-target snapshot stack.
  const [maskTarget, setMaskTarget] = useState<MaskTarget>("surface");
  const [maskView, setMaskView] = useState<MaskView>("overlay"); // overlay colorido vs máscara grayscale isolada
  const [maskMode, setMaskMode] = useState<MaskMode>("add");
  const maskHistory = useRef<{ surface: (string | null)[]; occluder: (string | null)[] }>({ surface: [], occluder: [] });

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
  // Mask method — Varinha / SAM (SegmentCanvas) or Caneta (PenMaskCanvas). SSoT for
  // "how the surface/occluder is defined"; Caneta is a method here, not a separate view.
  const [maskMethod, setMaskMethod] = useState<MaskInstrument>("brush");
  const segMode: "sam" | "smart" = maskMethod === "sam" ? "sam" : "smart";
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
  // Unified editor: which tool overlays the single fullscreen canvas (SSoT: PhotoTool).
  // "render" shows the rendered mockup; the others edit the surface over the scene photo.
  const [tool, setTool] = useState<PhotoTool>("render");
  const toolRef = useRef<PhotoTool>("render"); toolRef.current = tool;
  const [panelOpen, setPanelOpen] = useState(true); // tool panel popover open?

  // ── Luz — duas camadas de overlay (Sombra / Luz) ────────────────────────────
  const [luzLayers, setLuzLayers] = useState<LuzLayer[]>(LUZ_DEFAULTS);
  const [luzActive, setLuzActive] = useState<LuzLayerId>("shadow");
  const [luzModalOpen, setLuzModalOpen] = useState(false);
  const updateLuz = useCallback((id: LuzLayerId, patch: Partial<LuzLayer>) => {
    setLuzLayers((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }, []);
  const setLuzAssetFromPath = useCallback((id: LuzLayerId, path: string) => {
    updateLuz(id, { src: `/api/local-image?path=${encodeURIComponent(path)}`, srcPath: path, srcBase64: null });
  }, [updateLuz]);
  const setLuzAssetFromFile = useCallback((id: LuzLayerId, file: File) => {
    const fr = new FileReader();
    fr.onload = () => updateLuz(id, { src: URL.createObjectURL(file), srcPath: null, srcBase64: fr.result as string });
    fr.readAsDataURL(file);
  }, [updateLuz]);
  const resetLuzLayer = useCallback((id: LuzLayerId) => {
    const def = LUZ_DEFAULTS.find((d) => d.id === id)!;
    setLuzLayers((ls) => ls.map((l) => (l.id === id ? { ...def } : l)));
  }, []);

  // ── Crop — corta client-side e re-sobe como nova cena (handlePhotoFile) ──────
  const [cropAspect, setCropAspect] = useState<CropAspect>("free");
  const [cropResetKey, setCropResetKey] = useState(0);
  const [cropArea, setCropArea] = useState<CropRect | null>(null);
  const [cropApplying, setCropApplying] = useState(false);
  const [cropPrompt, setCropPrompt] = useState("");

  // ── Upscale — bicubic (local) ou IA (Visant), alvo foto/arte ─────────────────
  const [upTarget, setUpTarget] = useState<UpscaleTarget>("photo");
  const [upMode, setUpMode] = useState<UpscaleMode>("bicubic");
  const [upFactor, setUpFactor] = useState(2);
  const [upSize, setUpSize] = useState<"1K" | "2K" | "4K">("2K");
  const [upscaling, setUpscaling] = useState(false);
  const [upscaleErr, setUpscaleErr] = useState("");

  // ── AI edit — inpaint por máscara (fallback change-object) ───────────────────
  const [aiEditPrompt, setAiEditPrompt] = useState("");
  const [aiEditMode, setAiEditMode] = useState<AiEditMode>("replace");
  const [aiEditRes, setAiEditRes] = useState<"1K" | "2K" | "4K">("2K");
  const [aiEditing, setAiEditing] = useState(false);
  const [aiEditErr, setAiEditErr] = useState("");
  const [aiEditVia, setAiEditVia] = useState("");
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
  const autoRenderTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleRenderRef  = useRef<() => void>(() => {});
  const renderStateRef   = useRef<StepState>("idle");
  const [autoRenderPending, setAutoRenderPending] = useState(false);
  const [bgDragOver, setBgDragOver] = useState(false);

  // ── Mask editor (add/subtract into the persistent per-target mask) ────────────
  const maskUrlFor = (t: MaskTarget) => (t === "surface" ? surfaceMaskUrl : occluderMaskUrl);

  const applyMaskPatch = useCallback(async (patchUrl: string) => {
    const { compositeMask } = await import("@/lib/mask-compose");
    const cur = maskTarget === "surface" ? surfaceMaskUrl : occluderMaskUrl;
    const set = maskTarget === "surface" ? setSurfaceMaskUrl : setOccluderMaskUrl;
    maskHistory.current[maskTarget].push(cur);
    if (maskHistory.current[maskTarget].length > 30) maskHistory.current[maskTarget].shift();
    set(await compositeMask(cur, patchUrl, maskMode, imgDims.w, imgDims.h));
    setProcessState("idle");
  }, [maskTarget, maskMode, surfaceMaskUrl, occluderMaskUrl, imgDims.w, imgDims.h]);

  const invertMaskTarget = useCallback(async () => {
    const cur = maskTarget === "surface" ? surfaceMaskUrl : occluderMaskUrl;
    if (!cur) return;
    const { invertMask } = await import("@/lib/mask-compose");
    const set = maskTarget === "surface" ? setSurfaceMaskUrl : setOccluderMaskUrl;
    maskHistory.current[maskTarget].push(cur);
    set(await invertMask(cur, imgDims.w, imgDims.h));
    setProcessState("idle");
  }, [maskTarget, surfaceMaskUrl, occluderMaskUrl, imgDims.w, imgDims.h]);

  const clearMaskTarget = useCallback(() => {
    const cur = maskTarget === "surface" ? surfaceMaskUrl : occluderMaskUrl;
    const set = maskTarget === "surface" ? setSurfaceMaskUrl : setOccluderMaskUrl;
    maskHistory.current[maskTarget].push(cur);
    set(null);
    setProcessState("idle");
  }, [maskTarget, surfaceMaskUrl, occluderMaskUrl]);

  const undoMaskTarget = useCallback(() => {
    const stack = maskHistory.current[maskTarget];
    if (!stack.length) return;
    (maskTarget === "surface" ? setSurfaceMaskUrl : setOccluderMaskUrl)(stack.pop() ?? null);
    setProcessState("idle");
  }, [maskTarget]);

  // Push the active instrument's current selection into the mask (pen/wand/sam).
  const applyActiveInstrument = useCallback(() => {
    if (maskMethod === "pen") penApiRef.current?.apply(maskTarget);
    else if (maskMethod === "wand" || maskMethod === "sam") segApiRef.current?.apply(maskTarget);
  }, [maskMethod, maskTarget]);

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handlePhotoFile = useCallback(async (file: File) => {
    setUploadErr(""); setUploadState("loading");
    setAnalysis(null); setQuad(null); setAnalyzeState("idle"); setAnalyzeErr("");
    setProcessState("idle"); setProcessErr(""); setShadowPreview(null);
    setRenderUrl(null); setRenderState("idle");
    setTool("render"); // new photo → land on the Render tool

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

  // true quando a área de corte ultrapassa a imagem original → outpaint (expandir com IA).
  const cropExpanding = !!cropArea && imgDims.w > 0 && imgDims.h > 0 && (
    cropArea.x < -1 || cropArea.y < -1 ||
    cropArea.x + cropArea.width > imgDims.w + 1 ||
    cropArea.y + cropArea.height > imgDims.h + 1
  );

  const loadImgEl = (src: string) => new Promise<HTMLImageElement>((res, rej) => {
    const im = new Image();
    im.crossOrigin = "anonymous";
    im.onload = () => res(im);
    im.onerror = rej;
    im.src = src;
  });

  const handleApplyCrop = useCallback(async () => {
    if (!photoUrl || !cropArea || cropArea.width < 1 || cropArea.height < 1) return;
    setCropApplying(true); setUploadErr("");
    try {
      const img = await loadImgEl(photoUrl);
      const W = Math.round(cropArea.width), H = Math.round(cropArea.height);

      if (cropExpanding) {
        // Outpaint: original na posição correta + borda transparente; máscara branca
        // na borda nova (gerar) e preta sobre o original (manter).
        const base = document.createElement("canvas"); base.width = W; base.height = H;
        const bctx = base.getContext("2d")!;
        bctx.drawImage(img, -cropArea.x, -cropArea.y, img.naturalWidth, img.naturalHeight);
        const mask = document.createElement("canvas"); mask.width = W; mask.height = H;
        const mctx = mask.getContext("2d")!;
        mctx.fillStyle = "#fff"; mctx.fillRect(0, 0, W, H);
        mctx.fillStyle = "#000"; mctx.fillRect(-cropArea.x, -cropArea.y, img.naturalWidth, img.naturalHeight);

        const res = await fetchJSON<{ base64: string; via?: string }>(
          `/api/photo-mockup/${uploadId ?? "x"}/ai-edit`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              imageBase64: base.toDataURL("image/png"),
              maskBase64: mask.toDataURL("image/png"),
              prompt: cropPrompt.trim() || "extend and continue the existing scene naturally, seamless, same perspective, lighting and style",
              mode: "replace",
              resolution: "2K",
            }),
          },
        );
        const file = dataUrlToFile(res.base64, "expanded.png");
        setCropResetKey((k) => k + 1); setCropArea(null); setCropPrompt("");
        await handlePhotoFile(file);
        return;
      }

      // Corte normal
      const c = document.createElement("canvas");
      c.width = W; c.height = H;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(img, cropArea.x, cropArea.y, cropArea.width, cropArea.height, 0, 0, W, H);
      const blob = await new Promise<Blob | null>((res) => c.toBlob(res, "image/png"));
      if (blob) {
        const file = new File([blob], "cropped.png", { type: "image/png" });
        setCropResetKey((k) => k + 1); setCropArea(null);
        await handlePhotoFile(file); // re-sobe → render lê a foto cortada do disco
      }
    } catch (e: any) {
      setUploadErr(e?.message ?? "falha ao cortar/expandir");
    } finally {
      setCropApplying(false);
    }
  }, [photoUrl, cropArea, cropExpanding, cropPrompt, uploadId, handlePhotoFile]);

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
          if (typeof s.maskContract === "number") setMaskContract(s.maskContract);
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
  }, [fxGrain, fxWarmth, fxSaturation, fxBrightness, fxContrast, shadowOpacity, highlightOpacity, castOpacity, maskFeather, maskContract, reflectionOpacity, reflectionBlur, lightWrap, matchScene, contactShadow, textureAmount, specularOpacity, frameSig, warpSig]);

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

  const handleUpscale = useCallback(async () => {
    setUpscaleErr("");
    try {
      let srcB64: string | null = null;
      if (upTarget === "photo") {
        if (!photoUrl) return;
        srcB64 = await urlToDataUrl(photoUrl);
      } else {
        if (!artFile) { setUpscaleErr("Carregue uma arte primeiro."); return; }
        srcB64 = await toBase64File(artFile);
      }
      if (!srcB64) return;
      setUpscaling(true);
      const res = await fetchJSON<{ base64: string; width: number; height: number }>(
        `/api/photo-mockup/${uploadId ?? "x"}/upscale`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ base64: srcB64, mode: upMode, factor: upFactor, size: upSize }),
        },
      );
      const file = dataUrlToFile(res.base64, upTarget === "photo" ? "upscaled.png" : "art-upscaled.png");
      if (upTarget === "photo") await handlePhotoFile(file);
      else await handleArtFile(file);
    } catch (e: any) {
      setUpscaleErr(e?.message ?? "falha no upscale");
    } finally {
      setUpscaling(false);
    }
  }, [upTarget, upMode, upFactor, upSize, photoUrl, artFile, uploadId, handlePhotoFile, handleArtFile]);

  const handleAiEdit = useCallback(async () => {
    if (!photoUrl) return;
    setAiEditErr(""); setAiEditVia("");
    setAiEditing(true);
    try {
      const imageBase64 = await urlToDataUrl(photoUrl);
      const maskBase64 = surfaceMaskUrl ? await urlToDataUrl(surfaceMaskUrl) : "";
      const res = await fetchJSON<{ base64: string; via?: string; fallback?: boolean }>(
        `/api/photo-mockup/${uploadId ?? "x"}/ai-edit`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageBase64, maskBase64, prompt: aiEditPrompt, mode: aiEditMode, resolution: aiEditRes }),
        },
      );
      if (res.via) setAiEditVia(res.via);
      const file = dataUrlToFile(res.base64, "ai-edited.png");
      await handlePhotoFile(file); // baka a edição na cena (render lê do disco)
    } catch (e: any) {
      setAiEditErr(e?.message ?? "falha na edição IA");
    } finally {
      setAiEditing(false);
    }
  }, [photoUrl, surfaceMaskUrl, uploadId, aiEditPrompt, aiEditMode, aiEditRes, handlePhotoFile]);

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
          maskContract,
          reflectionOpacity,
          reflectionBlur,
          lightWrap,
          matchScene,
          contactShadow,
          warp: { cylinder, bendTop: bend.top, bendBottom: bend.bottom, bendLeft: bend.left, bendRight: bend.right },
          textureAmount,
          specularOpacity,
          fx: { grain: fxGrain, warmth: fxWarmth, saturation: fxSaturation, brightness: fxBrightness, contrast: fxContrast },
          luzOverlays: toLuzRenderLayers(luzLayers),
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
  }, [uploadId, artFile, artImg, frame, surfaceSize.w, surfaceSize.h, shadowOpacity, highlightOpacity, castOpacity, maskFeather, maskContract, reflectionOpacity, reflectionBlur, cylinder, bend, textureAmount, specularOpacity, fxGrain, fxWarmth, fxSaturation, fxBrightness, fxContrast, luzLayers]);

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
        body: JSON.stringify({ name, renderBase64, settings: { shadowOpacity, highlightOpacity, castOpacity, fxGrain, fxWarmth, fxSaturation, fxBrightness, fxContrast, maskFeather, maskContract, shadowFloor, preBlur, reflectionOpacity, reflectionBlur, cylinder, bend, textureAmount, specularOpacity }, tags: analysis?.surfaceType ? [analysis.surfaceType] : [] }),
      });
      if (!r.ok) { const j = await r.json(); throw new Error(j.error ?? `HTTP ${r.status}`); }
      setPublishState("done");
    } catch (e: any) {
      setPublishErr(e.message); setPublishState("error");
    }
  }, [uploadId, renderUrl, aiBlendUrl, showAiResult, analysis, shadowOpacity, highlightOpacity, castOpacity, fxGrain, fxWarmth, fxSaturation, fxBrightness, fxContrast, maskFeather, maskContract, shadowFloor, preBlur, reflectionOpacity, reflectionBlur, cylinder, bend, textureAmount, specularOpacity]);

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
    fxBrightness, fxContrast, maskFeather, maskContract, shadowFloor, preBlur, reflectionOpacity,
    reflectionBlur, lightWrap, matchScene, contactShadow, cylinder, bend, textureAmount,
    specularOpacity, surfaceMaskUrl, occluderMaskUrl, reflectionMaskUrl, surfaceOn, occluderOn, reflectionLayerOn, quad, frame,
  });

  const applySnap = useCallback((s: string) => {
    const o = JSON.parse(s);
    setShadowOpacity(o.shadowOpacity); setHighlightOpacity(o.highlightOpacity); setCastOpacity(o.castOpacity);
    setFxGrain(o.fxGrain); setFxWarmth(o.fxWarmth); setFxSaturation(o.fxSaturation);
    setFxBrightness(o.fxBrightness); setFxContrast(o.fxContrast); setMaskFeather(o.maskFeather);
    if (typeof o.maskContract === "number") setMaskContract(o.maskContract);
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
  }, [shadowOpacity, highlightOpacity, castOpacity, fxGrain, fxWarmth, fxSaturation, fxBrightness, fxContrast, maskFeather, maskContract, shadowFloor, preBlur, reflectionOpacity, reflectionBlur, lightWrap, matchScene, contactShadow, cylinder, bend, textureAmount, specularOpacity, surfaceMaskUrl, occluderMaskUrl, reflectionMaskUrl, surfaceOn, occluderOn, reflectionLayerOn, quad, frame]);

  // Ctrl/Cmd+Z = undo · Ctrl+Shift+Z / Ctrl+Y = redo (whole editor state).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (!(e.ctrlKey || e.metaKey)) return;
      // In Recorte, Ctrl+Z is handled by SegmentCanvas (undo last SAM point) — yield.
      if (toolRef.current === "mask") return;
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
      const tt = PHOTO_TOOL_KEYS[e.key.toLowerCase()];
      if (tt) { e.preventDefault(); setTool(tt); setPanelOpen(true); }
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
    if (tool !== "mask" || (!segApplied.surface && !segApplied.occluder)) return;
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
    setTool("render");
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

                {/* Hidden art file input — always mounted (the rail panel popover unmounts;
                    the empty-state hero + RenderPanel both trigger this by id). */}
                <input id="art-input-fs" type="file" accept="image/*" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleArtFile(f); }} />

                {/* ── ONE canvas, one persistent base <img> ──
                    A single ZoomPanViewer wraps ONE scene <img> that never remounts across
                    tool switches → zoom/pan persists AND there is zero image flash. Each tool
                    (Cantos/Recorte/Caneta/Reflexo) is a TRANSPARENT overlay stacked on top
                    (its own <img> hidden via transparentImg); only its handles/canvas show. */}
                {(() => {
                  const showViewer = !!photoUrl && (!!activeImageUrl || tool !== "render");
                  if (showViewer) {
                    const baseSrc = (activeImageUrl ?? photoUrl)!;
                    return (
                      <ZoomPanViewer requireSpaceToPan={tool !== "render"} dims={imgDims}>
                        <div style={{ maxWidth: "calc(100vw - 360px)", position: "relative", display: "inline-block", lineHeight: 0 }}>
                          {/* Persistent base — the ONLY visible scene pixels. */}
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={baseSrc}
                            alt="mockup"
                            draggable={false}
                            style={{ maxWidth: "calc(100vw - 360px)", maxHeight: "calc(100vh - 80px)", objectFit: "contain", display: "block" }}
                          />
                          {/* Loading shimmer — blur ONLY the surface (clipped to the quad). */}
                          {(renderState === "loading" || autoRenderPending) && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={baseSrc}
                              alt=""
                              aria-hidden
                              draggable={false}
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
                          {/* Tool overlays — transparent, stacked over the persistent base. */}
                          {tool === "corners" && quad && (
                            <div className="absolute inset-0">
                              <QuadEditor transparentImg imageUrl={baseSrc} imageNW={imgDims.w} imageNH={imgDims.h} quad={quad}
                                onQuadChange={(q) => { setQuad(q); setProcessState("idle"); }}
                                bend={bend} onBendChange={setBend} />
                            </div>
                          )}
                          {/* Mask preview — centralizado em dois modos (Photoshop):
                              · overlay: região colorida sobre a imagem (vê o resultado)
                              · mask: grayscale 0/1 isolado em fundo preto (foca no vetor) */}
                          {tool === "mask" && maskView === "mask" && (
                            <>
                              <div aria-hidden style={{ position: "absolute", inset: 0, background: "#000", pointerEvents: "none" }} />
                              {maskUrlFor(maskTarget) && (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={maskUrlFor(maskTarget)!} alt="" aria-hidden draggable={false}
                                  style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "fill", pointerEvents: "none" }} />
                              )}
                            </>
                          )}
                          {tool === "mask" && maskView === "overlay" && maskUrlFor(maskTarget) && (
                            <div aria-hidden
                              style={{
                                position: "absolute", inset: 0, pointerEvents: "none", opacity: 0.5,
                                backgroundColor: maskTarget === "surface" ? "#3df27e" : "#22d3ee",
                                WebkitMaskImage: `url(${maskUrlFor(maskTarget)!})`, maskImage: `url(${maskUrlFor(maskTarget)!})`,
                                WebkitMaskSize: "100% 100%", maskSize: "100% 100%",
                                WebkitMaskRepeat: "no-repeat", maskRepeat: "no-repeat",
                              }} />
                          )}
                          {tool === "mask" && (maskMethod === "wand" || maskMethod === "sam") && (
                            <div className="absolute inset-0">
                              <SegmentCanvas transparentImg imageUrl={baseSrc} sampleUrl={photoUrl ?? undefined} imageW={imgDims.w} imageH={imgDims.h}
                                mode={segMode} tolerance={segTol} contract={segContract} matte={segMatte} feather={segFeather}
                                onMaskChange={setSegHasMask} onStatusChange={setSegStatus} onSwatch={setSegSwatch} apiRef={segApiRef}
                                onApply={(_role, url) => { applyMaskPatch(url); }} />
                            </div>
                          )}
                          {tool === "mask" && maskMethod === "pen" && (
                            <div className="absolute inset-0">
                              <PenMaskCanvas transparentImg imageUrl={baseSrc} imageW={imgDims.w} imageH={imgDims.h}
                                feather={penFeather} onMaskChange={setPenHasMask} onStatus={setPenStatus} apiRef={penApiRef}
                                onApply={(_role, url) => { applyMaskPatch(url); }} />
                            </div>
                          )}
                          {tool === "mask" && maskMethod === "brush" && (
                            <div className="absolute inset-0">
                              <BrushCanvas transparentImg patchMode imageUrl={baseSrc} imageW={imgDims.w} imageH={imgDims.h}
                                brush={brushSize} eraseMode={false} apiRef={brushApiRef}
                                tint={maskMode === "add" ? "61,242,126" : "248,113,113"}
                                onChange={(url) => { if (url) applyMaskPatch(url); }} />
                            </div>
                          )}
                          {tool === "reflect" && (
                            <div className="absolute inset-0">
                              <BrushCanvas transparentImg imageUrl={baseSrc} imageW={imgDims.w} imageH={imgDims.h}
                                brush={brushSize} eraseMode={brushErase} apiRef={brushApiRef}
                                onChange={(url) => { setReflectionMaskUrl(url); setProcessState("idle"); }} />
                            </div>
                          )}
                          {/* Luz/Sombra — composite persistente; arrastável só na aba Luz. */}
                          {luzLayers.some((l) => l.visible && l.src) && (
                            <LuzOverlay
                              layers={luzLayers}
                              activeId={luzActive}
                              interactive={tool === "luz"}
                              onPosition={(id, pos) => updateLuz(id, { position: pos })}
                            />
                          )}
                        </div>
                      </ZoomPanViewer>
                    );
                  }
                  return (
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
                  );
                })()}

                {/* Crop — moldura livre estilo Photoshop (8 alças, estende além da imagem). */}
                {tool === "crop" && photoUrl && imgDims.w > 0 && (
                  <div className="absolute inset-0 z-10 bg-zinc-950">
                    <CropFrame
                      imageUrl={photoUrl}
                      naturalW={imgDims.w}
                      naturalH={imgDims.h}
                      aspect={ASPECT_VALUE[cropAspect]}
                      onChange={setCropArea}
                      resetKey={cropResetKey}
                    />
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

                {/* Floating icon-only tool rail + anchored tool panel popover (Radix). */}
                <ToolRail
                  tools={PHOTO_TOOLS}
                  active={tool}
                  panelOpen={panelOpen}
                  onSelect={setTool}
                  onPanelOpenChange={setPanelOpen}
                >
                    <div className="space-y-3">

                      {/* Surface tools — one canvas; the rail switches what overlays it. */}
                      {photoUrl && (tool === "corners" || tool === "mask" || tool === "reflect") && (
                        <div className="space-y-2 bg-zinc-800/40 rounded-xl border border-zinc-700/40 p-2">
                          {tool === "corners" && <CornersPanel />}
                          {tool === "mask" && (
                            <MaskPanel
                              target={maskTarget} setTarget={setMaskTarget}
                              instrument={maskMethod} setInstrument={setMaskMethod}
                              mode={maskMode} setMode={setMaskMode}
                              segTol={segTol} setSegTol={setSegTol}
                              segContract={segContract} setSegContract={setSegContract}
                              segMatte={segMatte} setSegMatte={setSegMatte}
                              segFeather={segFeather} setSegFeather={setSegFeather}
                              segSwatch={segSwatch} segStatus={segStatus} segHasMask={segHasMask}
                              penFeather={penFeather} setPenFeather={setPenFeather} penStatus={penStatus} penHasMask={penHasMask}
                              brushSize={brushSize} setBrushSize={setBrushSize}
                              imgDims={imgDims}
                              onApply={applyActiveInstrument}
                              onInvert={invertMaskTarget}
                              onClear={clearMaskTarget}
                              onUndo={undoMaskTarget}
                              hasTargetMask={!!maskUrlFor(maskTarget)}
                              view={maskView} setView={setMaskView}
                            />
                          )}
                          {tool === "reflect" && (
                            <ReflexoPanel
                              brushErase={brushErase} setBrushErase={setBrushErase}
                              brushSize={brushSize} setBrushSize={setBrushSize}
                              brushApiRef={brushApiRef} imgDims={imgDims}
                            />
                          )}
                          {/* Apply edits → render. Lives in the editing tabs (intuitive),
                              not in the Render tab. Highlights when there are pending changes. */}
                          {artFile && quad && (
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

                      {/* Scene thumbnail + surface (shared across tools) */}
                      {photoUrl && (
                        <SceneInfo photoUrl={photoUrl} surfaceType={analysis?.surfaceType} material={analysis?.material}
                          imgDims={imgDims} onReanalyze={() => handleAnalyze(true)} analyzing={analyzeState === "loading"} />
                      )}

                      {tool === "crop" && photoUrl && (
                        <CropPanel
                          aspect={cropAspect}
                          setAspect={setCropAspect}
                          onReset={() => { setCropResetKey((k) => k + 1); }}
                          onApply={handleApplyCrop}
                          applying={cropApplying}
                          canApply={!!cropArea}
                          expanding={cropExpanding}
                          prompt={cropPrompt}
                          setPrompt={setCropPrompt}
                        />
                      )}

                      {tool === "aiedit" && photoUrl && (
                        <AIEditPanel
                          prompt={aiEditPrompt}
                          setPrompt={setAiEditPrompt}
                          mode={aiEditMode}
                          setMode={setAiEditMode}
                          resolution={aiEditRes}
                          setResolution={setAiEditRes}
                          hasMask={!!surfaceMaskUrl}
                          onApply={handleAiEdit}
                          applying={aiEditing}
                          err={aiEditErr}
                          via={aiEditVia}
                        />
                      )}

                      {tool === "upscale" && photoUrl && (
                        <UpscalePanel
                          target={upTarget}
                          setTarget={setUpTarget}
                          mode={upMode}
                          setMode={setUpMode}
                          factor={upFactor}
                          setFactor={setUpFactor}
                          size={upSize}
                          setSize={setUpSize}
                          currentDims={upTarget === "art" ? (artDims ? { w: artDims.width, h: artDims.height } : null) : imgDims}
                          hasArt={!!artFile}
                          onApply={handleUpscale}
                          applying={upscaling}
                          err={upscaleErr}
                        />
                      )}

                      {tool === "luz" && photoUrl && (
                        <LuzPanel
                          layers={luzLayers}
                          active={luzActive}
                          setActive={setLuzActive}
                          update={(patch) => updateLuz(luzActive, patch)}
                          toggleVisible={(id) => updateLuz(id, { visible: !luzLayers.find((l) => l.id === id)!.visible })}
                          onImport={() => setLuzModalOpen(true)}
                          onUploadFile={(f) => setLuzAssetFromFile(luzActive, f)}
                          onClear={() => updateLuz(luzActive, { src: null, srcPath: null, srcBase64: null })}
                          onReset={() => resetLuzLayer(luzActive)}
                        />
                      )}

                      {tool === "render" && (
                        <RenderPanel
                          artPreview={artPreview} artDims={artDims} frame={frame} setFrame={setFrame} surfaceSize={surfaceSize}
                          artFile={artFile} clearArt={clearArt} handleArtFile={handleArtFile}
                          shadowOpacity={shadowOpacity} setShadowOpacity={setShadowOpacity}
                          realism={realism} setRealism={setRealism}
                          showAdvanced={showAdvanced} setShowAdvanced={setShowAdvanced}
                          highlightOpacity={highlightOpacity} setHighlightOpacity={setHighlightOpacity}
                          castOpacity={castOpacity} setCastOpacity={setCastOpacity}
                          maskContract={maskContract} setMaskContract={setMaskContract}
                          maskFeather={maskFeather} setMaskFeather={setMaskFeather}
                          reflectionOpacity={reflectionOpacity} setReflectionOpacity={setReflectionOpacity}
                          reflectionBlur={reflectionBlur} setReflectionBlur={setReflectionBlur}
                          lightWrap={lightWrap} setLightWrap={setLightWrap}
                          matchScene={matchScene} setMatchScene={setMatchScene}
                          contactShadow={contactShadow} setContactShadow={setContactShadow}
                          textureAmount={textureAmount} setTextureAmount={setTextureAmount}
                          specularOpacity={specularOpacity} setSpecularOpacity={setSpecularOpacity}
                          cylinder={cylinder} setCylinder={setCylinder} setRenderUrl={setRenderUrl}
                          showCustomFX={showCustomFX} setShowCustomFX={setShowCustomFX}
                          activeLook={activeLook} setActiveLook={setActiveLook}
                          fxGrain={fxGrain} setFxGrain={setFxGrain}
                          fxWarmth={fxWarmth} setFxWarmth={setFxWarmth}
                          fxSaturation={fxSaturation} setFxSaturation={setFxSaturation}
                          fxBrightness={fxBrightness} setFxBrightness={setFxBrightness}
                          fxContrast={fxContrast} setFxContrast={setFxContrast}
                          activeImageUrl={activeImageUrl} renderUrl={renderUrl}
                          handlePublish={handlePublish} publishState={publishState}
                          handleRender={handleRender} renderState={renderState}
                          publishErr={publishErr} renderErr={renderErr} processErr={processErr}
                          analysis={analysis} aiBlendState={aiBlendState}
                          aiQuality={aiQuality} setAiQuality={setAiQuality}
                          shadowPreview={shadowPreview} showShadowMap={showShadowMap} setShowShadowMap={setShowShadowMap}
                          showAiBlend={showAiBlend} setShowAiBlend={setShowAiBlend}
                          aiStrength={aiStrength} setAiStrength={setAiStrength}
                          aiTexture={aiTexture} setAiTexture={setAiTexture}
                          aiTextureOpacity={aiTextureOpacity} setAiTextureOpacity={setAiTextureOpacity}
                          handleAIBlend={handleAIBlend} aiBlendErr={aiBlendErr}
                        />
                      )}

                    </div>
                </ToolRail>

                <LuzAssetModal
                  open={luzModalOpen}
                  layerLabel={luzLayers.find((l) => l.id === luzActive)!.label}
                  onClose={() => setLuzModalOpen(false)}
                  onPick={(path) => { setLuzAssetFromPath(luzActive, path); setLuzModalOpen(false); }}
                  onUploadFile={(f) => { setLuzAssetFromFile(luzActive, f); setLuzModalOpen(false); }}
                />

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
