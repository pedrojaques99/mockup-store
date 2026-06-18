"use client";

import { useState, useRef, useCallback, useEffect, useMemo, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Upload, Loader2, AlertTriangle, CheckCircle2, RefreshCw,
  Eye, Wand2, Camera, X, Sparkles, Keyboard,
} from "lucide-react";
import ZoomPanViewer from "@/components/ZoomPanViewer";
import SegmentCanvas from "@/components/SegmentCanvas";
import PenMaskCanvas from "@/components/PenMaskCanvas";
import BrushCanvas from "@/components/BrushCanvas";
import { ToolRail } from "@/components/photo-tools/ToolRail";
import { PHOTO_TOOLS, PHOTO_TOOL_KEYS, type PhotoTool } from "@/components/photo-tools/registry";
import { CornersPanel } from "@/components/photo-tools/panels/CornersPanel";
import { MaskPanel } from "@/components/photo-tools/panels/MaskPanel";
import { EditSelectionPanel } from "@/components/photo-tools/panels/EditSelectionPanel";
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
import { DEFAULT_FRAME, renderFramedArt } from "@/lib/art-frame";
import { QuadEditor } from "@/components/photo-tools/QuadEditor";
import { CanvasContextChip } from "@/components/photo-tools/CanvasContextChip";
import { ShortcutsHelp } from "@/components/photo-tools/ShortcutsHelp";
import { useMaskEditor } from "./hooks/useMaskEditor";
import { toBase64File, urlToDataUrl, dataUrlToFile, fetchJSON } from "@/lib/photo-mockup-io";
import { useDocField, editorHistory, useTemporal, useEditorDoc } from "@/stores/editorDoc";
import { saveSession, loadSession, clearSession } from "@/stores/photoSession";
import { runAiOp, AiOpError } from "@/lib/ai-op";
import { Toaster, toast } from "sonner";
import { Undo2, Redo2 } from "lucide-react";

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

// ── Surface pulse (SSoT) ──────────────────────────────────────────────────────
// Pulso de blur sobre a região que está sendo processada — feedback "trabalhando AQUI".
// Fonte única: usado pelo loading do render (clip = quad), pela edição da imagem
// (mask = seleção, ou imagem toda quando sem seleção) e pelo limpar faixa rosa (quad).
// A animação `art-blur-pulse` vive no globals.css.
function SurfacePulse({ src, clipPath, maskUrl }: { src: string; clipPath?: string; maskUrl?: string | null }) {
  const region: React.CSSProperties = maskUrl
    ? { WebkitMaskImage: `url(${maskUrl})`, maskImage: `url(${maskUrl})`, WebkitMaskSize: "100% 100%", maskSize: "100% 100%", WebkitMaskRepeat: "no-repeat", maskRepeat: "no-repeat" }
    : { clipPath, WebkitClipPath: clipPath };
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      aria-hidden
      draggable={false}
      className="animate-[art-blur-pulse_1.4s_ease-in-out_infinite]"
      style={{
        position: "absolute", inset: 0, width: "100%", height: "100%",
        objectFit: "contain", pointerEvents: "none",
        filter: "blur(7px) brightness(0.97)", willChange: "opacity",
        ...region,
      }}
    />
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

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
  const [quad, setQuad] = useDocField("quad");
  const [analyzeState, setAnalyzeState] = useState<StepState>("idle");
  const [analyzeErr, setAnalyzeErr] = useState("");
  // Curved-surface warp (cylinder + per-edge bend) — fed to engine displacement
  const [cylinder, setCylinder] = useDocField("cylinder");
  const [bend, setBend] = useDocField("bend");

  // Processing — extract tuning (mask + shadow-map params, lib defaults)
  const [processState, setProcessState] = useState<StepState>("idle");
  const [processErr, setProcessErr] = useState("");
  const [shadowPreview, setShadowPreview] = useState<string | null>(null);
  const [maskFeather, setMaskFeather] = useDocField("maskFeather");   // extractMask featherPx
  const [maskContract, setMaskContract] = useDocField("maskContract"); // render-side mask erosion (px) — kills edge fringe
  const [shadowFloor, setShadowFloor] = useDocField("shadowFloor");   // extractGrayscaleLayers multiplyFloor
  const [preBlur,     setPreBlur]     = useDocField("preBlur");   // extractGrayscaleLayers preBlur
  const [showSegment,    setShowSegment]    = useState(false);
  const [showReflBrush,  setShowReflBrush]  = useState(false);

  // ── Máscara — subsistema dedicado (useMaskEditor) ────────────────────────────
  // Máscaras + toggles de camada vivem no DocState (undo global); instrumentos são
  // estado de UI. Os MESMOS nomes saem do hook → JSX/panels inalterados. onMaskChanged
  // invalida o extract (re-extrai/renderiza no debounce).
  const {
    surfaceMaskUrl, setSurfaceMaskUrl,
    occluderMaskUrl, setOccluderMaskUrl,
    aiEditMaskUrl, setAiEditMaskUrl,
    reflectionMaskUrl, setReflectionMaskUrl,
    surfaceOn, setSurfaceOn,
    occluderOn, setOccluderOn,
    reflectionLayerOn, setReflectionLayerOn,
    maskTarget, setMaskTarget,
    maskView, setMaskView,
    maskMode, setMaskMode,
    maskMethod, setMaskMethod, segMode,
    segApiRef, penApiRef, brushApiRef,
    segTol, setSegTol,
    segContract, setSegContract,
    segMatte, setSegMatte,
    segFeather, setSegFeather,
    segHasMask, setSegHasMask,
    segSwatch, setSegSwatch,
    segStatus, setSegStatus,
    penFeather, setPenFeather,
    penHasMask, setPenHasMask,
    penStatus, setPenStatus,
    brushSize, setBrushSize,
    brushErase, setBrushErase,
    maskUrlFor,
    applyMaskPatch,
    invertMaskTarget,
    clearMaskTarget,
    undoMaskTarget,
    applyActiveInstrument,
  } = useMaskEditor({ imgDims, onMaskChanged: () => setProcessState("idle") });

  // Render
  const [artFile, setArtFile] = useState<File | null>(null);
  const [artPreview, setArtPreview] = useState<string | null>(null);
  const [artImg, setArtImg] = useState<HTMLImageElement | null>(null);
  const [artDims, setArtDims] = useState<{ width: number; height: number } | null>(null);
  const [artHasAlpha, setArtHasAlpha] = useState(false); // arte tem transparência (PNG/logo)
  const [frame, setFrame] = useDocField("frame");
  const [shadowOpacity,    setShadowOpacity]    = useDocField("shadowOpacity");
  const [highlightOpacity, setHighlightOpacity] = useDocField("highlightOpacity"); // ambient light (screen)
  const [castOpacity,      setCastOpacity]      = useDocField("castOpacity"); // scene color cast
  const [reflectionOpacity, setReflectionOpacity] = useDocField("reflectionOpacity");  // reflexo (art tint on reflections)
  const [lightWrap, setLightWrap] = useDocField("lightWrap");  // ambient light wrap on the art edge
  const [matchScene, setMatchScene] = useDocField("matchScene");  // grain + colour match to the scene
  const [contactShadow, setContactShadow] = useDocField("contactShadow");  // cast shadow grounding the surface
  const [realism, setRealism] = useState(0.3);   // macro transitório (UI) → escreve lightWrap+contactShadow+matchScene
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [procMs, setProcMs] = useState(0);        // live elapsed while processing/rendering
  const processingRef = useRef(false);            // re-entrancy guard for handleProcess
  const procStartRef = useRef(0);
  const extractTimer = useRef<ReturnType<typeof setTimeout> | null>(null);  // debounce re-extract
  const [reflectionBlur,    setReflectionBlur]    = useDocField("reflectionBlur");
  const [textureAmount,   setTextureAmount]   = useDocField("textureAmount");  // surface-relief displacement (art drapes)
  const [specularOpacity, setSpecularOpacity] = useDocField("specularOpacity");  // glossy highlight preservation
  const [fxGrain,      setFxGrain]      = useDocField("fxGrain");
  const [fxWarmth,     setFxWarmth]     = useDocField("fxWarmth");
  const [fxSaturation, setFxSaturation] = useDocField("fxSaturation");
  const [fxBrightness, setFxBrightness] = useDocField("fxBrightness");
  const [fxContrast,   setFxContrast]   = useDocField("fxContrast");
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
  const [shortcutsOpen, setShortcutsOpen] = useState(false); // cheatsheet de atalhos (?)

  // ── Luz — duas camadas de overlay (Sombra / Luz) ────────────────────────────
  const [luzLayers, setLuzLayers] = useDocField("luzLayers");
  const [luzActive, setLuzActive] = useState<LuzLayerId>("shadow");
  const [luzModalOpen, setLuzModalOpen] = useState(false);
  const [luzCropMode, setLuzCropMode] = useState(false); // alças de recorte da camada Luz ativa
  const [luzCtrl, setLuzCtrl] = useState(false); // Ctrl segurado na aba Luz → modo warp (perspectiva, reusa QuadEditor)
  const updateLuz = useCallback((id: LuzLayerId, patch: Partial<LuzLayer>) => {
    setLuzLayers((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }, []);
  // Preset ao escolher um asset de Luz: cai centralizado, full-screen (scale 1 =
  // 100% da largura da cena), sem rotação/recorte/warp — e já em modo transform
  // (sai do crop) pra arrastar/redimensionar pro lugar certo na hora.
  const LUZ_ASSET_PRESET = { position: { x: 0.5, y: 0.5 }, scale: 1, rotation: 0, crop: { x: 0, y: 0, w: 1, h: 1 }, warpQuad: null } as const;
  const setLuzAssetFromPath = useCallback((id: LuzLayerId, path: string) => {
    updateLuz(id, { src: `/api/local-image?path=${encodeURIComponent(path)}`, srcPath: path, srcBase64: null, ...LUZ_ASSET_PRESET });
    setLuzCropMode(false);
  }, [updateLuz]);
  const setLuzAssetFromFile = useCallback((id: LuzLayerId, file: File) => {
    const fr = new FileReader();
    fr.onload = () => updateLuz(id, { src: URL.createObjectURL(file), srcPath: null, srcBase64: fr.result as string, ...LUZ_ASSET_PRESET });
    setLuzCropMode(false);
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
  const [photoHasMagenta, setPhotoHasMagenta] = useState(false); // base tem a faixa rosa (placeholder)
  const [cleaningSurface, setCleaningSurface] = useState(false);
  const [aiEditVia, setAiEditVia] = useState("");
  const [aiQuality, setAiQuality] = useState<"fast" | "balanced" | "quality">("balanced");
  const [publishState, setPublishState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [publishErr,   setPublishErr]   = useState("");
  const [publishModalOpen, setPublishModalOpen] = useState(false);
  const [publishName, setPublishName] = useState("");

  // UI panels
  const [showCustomFX,  setShowCustomFX]  = useState(false);
  const [previewFilter, setPreviewFilter] = useState<string | null>(null); // preview de look no hover (CSS)
  const [compare, setCompare] = useState(false);     // antes/depois (divisor arrastável)
  const [compareX, setCompareX] = useState(0.5);
  const compareRef = useRef<HTMLDivElement>(null);
  const compareDragRef = useRef(false);
  // Dicas de 1º uso (chips efêmeros) — vistas uma vez, persistido em localStorage.
  const [hintsSeen, setHintsSeen] = useState<Record<string, boolean>>({});
  useEffect(() => { try { setHintsSeen(JSON.parse(localStorage.getItem("boxy-hints") || "{}")); } catch { /* ignore */ } }, []);
  const dismissHint = useCallback((k: string) => {
    setHintsSeen((s) => { const n = { ...s, [k]: true }; try { localStorage.setItem("boxy-hints", JSON.stringify(n)); } catch { /* ignore */ } return n; });
  }, []);
  // Auto-detecta a faixa rosa (placeholder #FF1493) na base atual → mostra o botão de limpar.
  useEffect(() => {
    if (!photoUrl) { setPhotoHasMagenta(false); return; }
    let cancelled = false;
    import("@/lib/magenta-mask").then(({ detectMagentaRatio }) =>
      detectMagentaRatio(photoUrl).then((r) => { if (!cancelled) setPhotoHasMagenta(r > 0.012); }));
    return () => { cancelled = true; };
  }, [photoUrl]);
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

  // ── Handlers ────────────────────────────────────────────────────────────────

  // `preserve` → re-upload de uma edição da MESMA cena (crop/upscale/ai-edit): mantém
  // params/máscaras/aba/histórico e usa o quad já mapeado pras novas dimensões, em vez
  // de tratar como foto nova (que zera o quad pro default, volta pra Cantos e limpa undo).
  const handlePhotoFile = useCallback(async (file: File, preserve?: { quad: Quad | null }) => {
    setUploadErr(""); setUploadState("loading");
    setAnalysis(null); setAnalyzeState("idle"); setAnalyzeErr("");
    setProcessState("idle"); setProcessErr(""); setShadowPreview(null);
    setRenderUrl(null); setRenderState("idle");
    if (!preserve) { setQuad(null); setTool("corners"); } // foto nova → Cantos pra definir a superfície

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

      // Quad default INTELIGENTE: detecta a região magenta (a superfície da cena) e
      // cai com os cantos já certos — em vez do retângulo genérico 15-85% (pedágio).
      let detected: { tl: QuadPt; tr: QuadPt; br: QuadPt; bl: QuadPt } | null = null;
      if (!preserve) {
        try {
          const { findMagentaQuad } = await import("@/lib/magenta-mask");
          const nq = await findMagentaQuad(URL.createObjectURL(file));
          if (nq) detected = {
            tl: { x: Math.round(nq.tl.x * w), y: Math.round(nq.tl.y * h) },
            tr: { x: Math.round(nq.tr.x * w), y: Math.round(nq.tr.y * h) },
            br: { x: Math.round(nq.br.x * w), y: Math.round(nq.br.y * h) },
            bl: { x: Math.round(nq.bl.x * w), y: Math.round(nq.bl.y * h) },
          };
        } catch { /* sem magenta → default */ }
      }
      const q: Quad = preserve?.quad ?? detected ?? {
        tl: { x: Math.round(w * 0.15), y: Math.round(h * 0.15) },
        tr: { x: Math.round(w * 0.85), y: Math.round(h * 0.15) },
        br: { x: Math.round(w * 0.85), y: Math.round(h * 0.85) },
        bl: { x: Math.round(w * 0.15), y: Math.round(h * 0.85) },
      };
      setQuad(q);
      setAnalysis({ id, quad: q, surfaceType: "manual", material: "unknown", hasOcclusion: false, occlusionDesc: "", lightingDir: "ambient", confidence: 0, imageWidth: w, imageHeight: h });
      setAnalyzeState("done");
      if (!preserve) editorHistory.clear(); // foto nova → baseline; preserve mantém o undo
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

      // Mapeia o quad pro novo enquadramento: translada por -cropArea.(x,y) (vale p/
      // corte e expand — o original fica em -cropArea no novo canvas) e clampa.
      const cl = (v: number, hi: number) => Math.max(0, Math.min(hi, v));
      const mappedQuad: Quad | null = quad ? {
        tl: { x: cl(Math.round(quad.tl.x - cropArea.x), W), y: cl(Math.round(quad.tl.y - cropArea.y), H) },
        tr: { x: cl(Math.round(quad.tr.x - cropArea.x), W), y: cl(Math.round(quad.tr.y - cropArea.y), H) },
        br: { x: cl(Math.round(quad.br.x - cropArea.x), W), y: cl(Math.round(quad.br.y - cropArea.y), H) },
        bl: { x: cl(Math.round(quad.bl.x - cropArea.x), W), y: cl(Math.round(quad.bl.y - cropArea.y), H) },
      } : null;

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

        const res = await runAiOp("Expandir cena",
          (signal) => fetchJSON<{ base64: string; via?: string }>(
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
              signal,
            },
          ),
          { loading: "Expandindo cena…", timeoutMs: 150_000 },
        );
        const file = dataUrlToFile(res.base64, "expanded.png");
        setCropResetKey((k) => k + 1); setCropArea(null); setCropPrompt("");
        await handlePhotoFile(file, { quad: mappedQuad });
        toast.success("Cena expandida");
        return;
      }

      // Corte normal
      const tId = toast.loading("Cortando…");
      const c = document.createElement("canvas");
      c.width = W; c.height = H;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(img, cropArea.x, cropArea.y, cropArea.width, cropArea.height, 0, 0, W, H);
      const blob = await new Promise<Blob | null>((res) => c.toBlob(res, "image/png"));
      if (blob) {
        const file = new File([blob], "cropped.png", { type: "image/png" });
        setCropResetKey((k) => k + 1); setCropArea(null);
        await handlePhotoFile(file, { quad: mappedQuad }); // re-sobe → render lê a foto cortada do disco
        toast.success(`Cortado · ${W}×${H}px`, { id: tId });
      } else toast.dismiss(tId);
    } catch (e: any) {
      if (e instanceof AiOpError) return; // expand cancel/timeout/erro já avisado no toast
      const msg = e?.message ?? "falha ao cortar/expandir";
      setUploadErr(msg); toast.error(msg);
    } finally {
      setCropApplying(false);
    }
  }, [photoUrl, cropArea, cropExpanding, cropPrompt, uploadId, quad, handlePhotoFile]);

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
      if (force) toast.success("Superfície re-detectada");
    } catch (e: any) {
      setAnalyzeErr(e.message); setAnalyzeState("error");
      toast.error(`Falha ao detectar superfície: ${e.message}`);
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
        editorHistory.clear(); // cena carregada → baseline novo
      } catch { /* scene not found */ }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Restaura a última sessão (IndexedDB) — só ao abrir limpo: sem ?scene= (cena por URL
  // tem prioridade) e sem upload em andamento. Valida que a foto ainda existe no servidor
  // antes de rehidratar; senão limpa a sessão órfã. Mutuamente exclusivo com o effect acima.
  useEffect(() => {
    if (searchParams.get("scene") || uploadId) return;
    let cancelled = false;
    (async () => {
      const s = await loadSession();
      if (!s || cancelled) return;
      if (!/^[a-f0-9]{16}$/.test(s.uploadId)) { clearSession(); return; }
      const ok = await fetch(s.photoUrl, { cache: "no-store" }).then((r) => r.ok).catch(() => false);
      if (cancelled) return;
      if (!ok) { clearSession(); return; } // foto sumiu do disco → sessão órfã

      useEditorDoc.getState().resetDoc(s.doc);
      setUploadId(s.uploadId);
      setImgDims(s.imgDims);
      setPhotoUrl(s.photoUrl);
      if ((PHOTO_TOOLS as readonly { id: PhotoTool }[]).some((t) => t.id === s.tool)) setTool(s.tool as PhotoTool);
      setUploadState("done");
      setAnalyzeState("done");
      setProcessState("idle"); // re-extrai quando a arte voltar
      const q = s.doc.quad ?? {
        tl: { x: Math.round(s.imgDims.w * 0.15), y: Math.round(s.imgDims.h * 0.15) },
        tr: { x: Math.round(s.imgDims.w * 0.85), y: Math.round(s.imgDims.h * 0.15) },
        br: { x: Math.round(s.imgDims.w * 0.85), y: Math.round(s.imgDims.h * 0.85) },
        bl: { x: Math.round(s.imgDims.w * 0.15), y: Math.round(s.imgDims.h * 0.85) },
      };
      setAnalysis({ id: s.uploadId, quad: q, surfaceType: "manual", material: "unknown", hasOcclusion: false, occlusionDesc: "", lightingDir: "ambient", confidence: 0, imageWidth: s.imgDims.w, imageHeight: s.imgDims.h });
      editorHistory.clear(); // sessão restaurada = baseline; não dá pra desfazer pra "antes do reload"
      toast.success("Sessão restaurada", { description: "Sua última cena e ajustes voltaram." });
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Salva o ponteiro de sessão (debounced no módulo) sempre que a cena ou o doc mudam.
  // Lazy: a gravação real só acontece 1.2s após a última mudança.
  const sessionDoc = useEditorDoc((s) => s.doc);
  useEffect(() => {
    if (!uploadId || !photoUrl) return;
    saveSession({ uploadId, photoUrl, imgDims, tool, doc: sessionDoc });
  }, [uploadId, photoUrl, imgDims, tool, sessionDoc]);

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
      // Não renderiza durante um process/extract (escrevendo mask/shadow no disco) nem
      // com outro render em voo — o process dispara o render ao terminar. Evita race.
      if (renderStateRef.current === "loading" || processingRef.current) { setAutoRenderPending(false); return; }
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
      const prep = await fetch(`/api/photo-mockup/${uploadId}/prepare-magenta`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quad, imageWidth: imgDims.w, imageHeight: imgDims.h }),
      });
      if (!prep.ok) throw new Error((await prep.json().catch(() => ({}))).error ?? "falha ao preparar a superfície");
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
      // Detecta transparência (amostra 64×64) → sugere escolher um fundo.
      try {
        const c = document.createElement("canvas"); c.width = 64; c.height = 64;
        const cx = c.getContext("2d")!; cx.drawImage(img, 0, 0, 64, 64);
        const d = cx.getImageData(0, 0, 64, 64).data;
        let alpha = false;
        for (let i = 3; i < d.length; i += 4) { if (d[i] < 245) { alpha = true; break; } }
        setArtHasAlpha(alpha);
        // PNG transparente fica TRANSPARENTE (revela a superfície). Pra não mostrar a
        // magenta atrás, use "Limpar faixa rosa" → recria a superfície real.
      } catch { setArtHasAlpha(false); }
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
      const label = `Upscale · ${upMode === "bicubic" ? "Rápido" : upMode === "ai" ? "Visant" : upMode === "pruna" ? "Turbo" : "Nítido"}`;
      const res = await runAiOp(label,
        (signal) => fetchJSON<{ base64: string; width: number; height: number }>(
          `/api/photo-mockup/${uploadId ?? "x"}/upscale`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ base64: srcB64, mode: upMode, factor: upFactor, size: upSize }),
            signal,
          },
        ),
        { loading: "Aumentando resolução…", timeoutMs: upMode === "bicubic" ? 30_000 : 150_000 },
      );
      const file = dataUrlToFile(res.base64, upTarget === "photo" ? "upscaled.png" : "art-upscaled.png");
      if (upTarget === "photo") {
        // upscale uniforme → escala o quad proporcionalmente; preserva params/máscaras/undo.
        const sx = res.width / (imgDims.w || res.width), sy = res.height / (imgDims.h || res.height);
        const mapped: Quad | null = quad ? {
          tl: { x: Math.round(quad.tl.x * sx), y: Math.round(quad.tl.y * sy) },
          tr: { x: Math.round(quad.tr.x * sx), y: Math.round(quad.tr.y * sy) },
          br: { x: Math.round(quad.br.x * sx), y: Math.round(quad.br.y * sy) },
          bl: { x: Math.round(quad.bl.x * sx), y: Math.round(quad.bl.y * sy) },
        } : null;
        await handlePhotoFile(file, { quad: mapped });
      } else await handleArtFile(file);
      toast.success(`Resolução aumentada · ${res.width}×${res.height}px`);
    } catch (e: any) {
      if (e instanceof AiOpError) return; // cancel/timeout/erro já avisados no toast
      setUpscaleErr(e?.message ?? "falha no upscale");
    } finally {
      setUpscaling(false);
    }
  }, [upTarget, upMode, upFactor, upSize, photoUrl, artFile, uploadId, quad, imgDims.w, imgDims.h, handlePhotoFile, handleArtFile]);

  const handleAiEdit = useCallback(async () => {
    if (!photoUrl) return;
    setAiEditErr(""); setAiEditVia("");
    setAiEditing(true);
    try {
      const imageBase64 = await urlToDataUrl(photoUrl);
      const maskBase64 = aiEditMaskUrl ? await urlToDataUrl(aiEditMaskUrl) : "";
      const res = await runAiOp("Edição",
        (signal) => fetchJSON<{ base64: string; via?: string; fallback?: boolean }>(
          `/api/photo-mockup/${uploadId ?? "x"}/ai-edit`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ imageBase64, maskBase64, prompt: aiEditPrompt, mode: aiEditMode, resolution: aiEditRes }),
            signal,
          },
        ),
        { loading: "Editando…", timeoutMs: 150_000 },
      );
      if (res.via) setAiEditVia(res.via);
      const file = dataUrlToFile(res.base64, "ai-edited.png");
      await handlePhotoFile(file, { quad }); // mesmas dimensões → preserva quad/params/undo
      toast.success("Edição aplicada");
    } catch (e: any) {
      if (e instanceof AiOpError) return;
      setAiEditErr(e?.message ?? "falha na edição");
    } finally {
      setAiEditing(false);
    }
  }, [photoUrl, aiEditMaskUrl, uploadId, aiEditPrompt, aiEditMode, aiEditRes, quad, handlePhotoFile]);

  // Recria o photo-clean da superfície via IA (inpaint do quad) → tira a faixa rosa
  // de vez. Cacheado por quad no servidor; o render passa a usar a base limpa.
  const handleCleanPlaceholder = useCallback(async () => {
    if (!uploadId || !quad || processingRef.current) return; // mesmo guard do extract → sem race no /process
    processingRef.current = true;
    setCleaningSurface(true);
    try {
      const j = await runAiOp("Limpar superfície", async (signal) => {
        const prep = await fetch(`/api/photo-mockup/${uploadId}/prepare-magenta`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ quad, imageWidth: imgDims.w, imageHeight: imgDims.h }), signal,
        });
        if (!prep.ok) throw new Error((await prep.json().catch(() => ({}))).error ?? "falha ao preparar a superfície");
        const r = await fetch("/api/photo-mockup/process", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: uploadId, quad, featherPx: 0, multiplyFloor: shadowFloor, preBlur,
            aiClean: true, cleanPrompt: aiEditPrompt.trim() || undefined,
            surfaceMaskBase64: (surfaceOn && surfaceMaskUrl) ? surfaceMaskUrl : undefined,
            occluderMaskBase64: (occluderOn && occluderMaskUrl) ? occluderMaskUrl : undefined,
            reflectionMaskBase64: (reflectionLayerOn && reflectionMaskUrl) ? reflectionMaskUrl : undefined,
          }), signal,
        });
        const body = await r.json().catch(() => ({} as { error?: string; cleanMaterial?: string; aiCleaned?: boolean }));
        if (!r.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${r.status}`);
        return body as { cleanMaterial?: string; aiCleaned?: boolean };
      }, { loading: "Recriando a superfície sem a faixa rosa…", timeoutMs: 150_000 });

      setPhotoUrl(`/api/photo-mockup/${uploadId}/asset/photo-clean?t=${Date.now()}`);
      setShadowPreview(`/api/photo-mockup/${uploadId}/asset/shadow?t=${Date.now()}`);
      setProcessState("done");
      if (artFile) setTimeout(() => handleRenderRef.current(), 100);
      if (j.aiCleaned === false) {
        toast.warning("Edição indisponível — usei limpeza simples (pode sobrar um pouco de rosa).");
      } else {
        toast.success(j.cleanMaterial ? `Superfície recriada · ${j.cleanMaterial}` : "Superfície recriada sem o rosa");
      }
    } catch (e: any) {
      if (!(e instanceof AiOpError)) toast.error(e?.message ?? "falha ao limpar superfície");
    } finally { processingRef.current = false; setCleaningSurface(false); }
  }, [uploadId, quad, imgDims.w, imgDims.h, shadowFloor, preBlur, aiEditPrompt, surfaceOn, surfaceMaskUrl, occluderOn, occluderMaskUrl, reflectionLayerOn, reflectionMaskUrl, artFile]);

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
      toast.error(`Render falhou: ${e.message}`);
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
      const aiBlob = await runAiOp("Melhorar", async (signal) => {
        const r = await fetch(`/api/photo-mockup/${uploadId}/ai-blend`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ compositeBase64, strength: aiStrength, textureOpacity: aiTexture ? aiTextureOpacity : 0, quality: aiQuality }),
          signal,
        });
        if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error ?? `HTTP ${r.status}`); }
        return r.blob();
      }, { loading: "Melhorando…", timeoutMs: 150_000 });
      setAiBlendUrl(URL.createObjectURL(aiBlob));
      setAiBlendMs(Date.now() - t0);
      setAiBlendState("done");
      setShowAiResult(true);
    } catch (e: any) {
      if (e instanceof AiOpError) { setAiBlendState("idle"); return; }
      setAiBlendErr(e.message); setAiBlendState("error");
    }
  }, [uploadId, renderUrl, aiStrength, aiTexture, aiTextureOpacity, aiQuality]);

  // Abre o modal de nome (substitui o window.prompt nativo, off-brand).
  const handlePublish = useCallback(() => {
    const activeUrl = (aiBlendUrl && showAiResult) ? aiBlendUrl : renderUrl;
    if (!uploadId || !activeUrl) return;
    setPublishName(analysis?.surfaceType && analysis.surfaceType !== "manual" ? `${analysis.surfaceType} scene` : "Photo Mockup");
    setPublishModalOpen(true);
  }, [uploadId, renderUrl, aiBlendUrl, showAiResult, analysis]);

  const doPublish = useCallback(async (name: string) => {
    const activeUrl = (aiBlendUrl && showAiResult) ? aiBlendUrl : renderUrl;
    if (!uploadId || !activeUrl || !name.trim()) return;
    setPublishModalOpen(false);
    setPublishState("loading"); setPublishErr("");
    const tId = toast.loading("Publicando na Biblioteca…");
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
      toast.success(`"${name}" publicado na Biblioteca`, { id: tId });
    } catch (e: any) {
      setPublishErr(e.message); setPublishState("error");
      toast.error(e.message ?? "falha ao publicar", { id: tId });
    }
  }, [uploadId, renderUrl, aiBlendUrl, showAiResult, analysis, shadowOpacity, highlightOpacity, castOpacity, fxGrain, fxWarmth, fxSaturation, fxBrightness, fxContrast, maskFeather, maskContract, shadowFloor, preBlur, reflectionOpacity, reflectionBlur, cylinder, bend, textureAmount, specularOpacity]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f?.type.startsWith("image/")) handlePhotoFile(f);
  }, [handlePhotoFile]);

  // ── Global undo/redo — Zustand + zundo (`temporal`). Todo o DocState é versionado
  //    automaticamente; não há lista manual de campos. Ver src/stores/editorDoc.ts.
  // Refs pro handler de teclado rotear Ctrl+Z no tool Máscara sem re-subscrever.
  const maskMethodRef = useRef(maskMethod); maskMethodRef.current = maskMethod;
  const undoMaskRef = useRef(undoMaskTarget); undoMaskRef.current = undoMaskTarget;

  // Ctrl/Cmd+Z = undo · Ctrl+Shift+Z / Ctrl+Y = redo (DocState inteiro via zundo).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (!(e.ctrlKey || e.metaKey)) return;
      // No tool Máscara: varinha/SAM têm Ctrl+Z próprio (desfaz ponto) → cede.
      // Caneta/pincel não têm atalho → Ctrl+Z desfaz a máscara do alvo ativo.
      if (toolRef.current === "mask") {
        const m = maskMethodRef.current;
        if (m === "wand" || m === "sam") return;
        if (e.key.toLowerCase() === "z" && !e.shiftKey) { e.preventDefault(); undoMaskRef.current(); }
        return;
      }
      const k = e.key.toLowerCase();
      const redo = (k === "z" && e.shiftKey) || k === "y";
      const undo = k === "z" && !e.shiftKey;
      if (redo) { e.preventDefault(); editorHistory.redo(); }
      else if (undo) { e.preventDefault(); editorHistory.undo(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Tool shortcuts (Adobe-style): V result · C cantos · S segmentar · P caneta · R reflexo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "?") { e.preventDefault(); setShortcutsOpen((v) => !v); return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const tt = PHOTO_TOOL_KEYS[e.key.toLowerCase()];
      if (tt) { e.preventDefault(); setTool(tt); setPanelOpen(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Enter = aplicar · Esc = cancelar — nos modos com confirmação (crop, cantos).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (tool === "crop") {
        if (e.key === "Enter" && cropArea) { e.preventDefault(); handleApplyCrop(); }
        else if (e.key === "Escape") { e.preventDefault(); setCropResetKey((k) => k + 1); setCropArea(null); }
      } else if (tool === "corners" && e.key === "Enter") {
        e.preventDefault(); setTool("render");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tool, cropArea, handleApplyCrop]);

  // Realism — knob-macro: escreve lightWrap + contactShadow + matchScene de uma vez.
  // Derivado no onChange (não em effect) pra o undo restaurar os 3 campos sem que um
  // effect baseado em `realism` os sobrescreva. `realism` é só posição de slider (UI).
  const applyRealism = useCallback((v: React.SetStateAction<number>) => {
    const nv = typeof v === "function" ? v(realism) : v;
    setRealism(nv);
    setLightWrap(+(nv * 0.55).toFixed(2));
    setContactShadow(+(nv * 0.8).toFixed(2));
    setMatchScene(+(nv * 0.65).toFixed(2));
  }, [realism, setLightWrap, setContactShadow, setMatchScene]);

  // Luz wrap — Ctrl segurado na aba Luz ativa o modo perspectiva (alças = QuadEditor).
  useEffect(() => {
    if (tool !== "luz") { setLuzCtrl(false); return; }
    const isMod = (e: KeyboardEvent) => e.key === "Control" || e.key === "Meta";
    const down = (e: KeyboardEvent) => { if (isMod(e)) setLuzCtrl(true); };
    const up = (e: KeyboardEvent) => { if (isMod(e)) setLuzCtrl(false); };
    const blur = () => setLuzCtrl(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
      setLuzCtrl(false);
    };
  }, [tool]);

  // Ao segurar Ctrl com a camada ativa sem warp → semeia um quad centrado (a partir
  // do box afim atual) pra o preview já deformar e dar as alças onde a textura está.
  useEffect(() => {
    if (!luzCtrl || tool !== "luz") return;
    const lay = luzLayers.find((l) => l.id === luzActive);
    if (!lay?.src || lay.warpQuad) return;
    const hw = Math.min(0.45, Math.max(0.1, lay.scale / 2)), hh = hw;
    const cx = lay.position.x, cy = lay.position.y;
    const c = (v: number) => Math.max(0, Math.min(1, v));
    updateLuz(luzActive, { warpQuad: {
      tl: { x: c(cx - hw), y: c(cy - hh) }, tr: { x: c(cx + hw), y: c(cy - hh) },
      br: { x: c(cx + hw), y: c(cy + hh) }, bl: { x: c(cx - hw), y: c(cy + hh) },
    } });
  }, [luzCtrl, tool, luzActive, luzLayers, updateLuz]);

  // B3: removido o effect que re-aplicava o segmento ao mudar refine (feather/limpar/
  // matte/tolerância). Ele (a) estava morto — `segApplied` nunca era setado — e (b) se
  // disparasse, somava (ADD) em cima da máscara já commitada → dupla-aplicação. Modelo
  // correto: o refine molda a SELEÇÃO ao vivo (props tolerance/contract/matte/feather do
  // SegmentCanvas) ANTES do commit; Aplicar commita+limpa. Pra re-tunar pós-commit: Ctrl+Z.

  const resetPhoto = useCallback(() => {
    // Guarda destrutiva: trocar a foto descarta máscaras/arte/render/undo. Confirma
    // só quando há trabalho a perder (Anthropic-level: não atrapalha quando vazio).
    const hasWork = !!(surfaceMaskUrl || occluderMaskUrl || aiEditMaskUrl || reflectionMaskUrl || renderUrl || artFile);
    if (hasWork && !window.confirm("Trocar a foto descarta a arte, máscaras e o histórico desta cena. Continuar?")) return;
    setPhotoUrl(null); setUploadId(null); setUploadState("idle");
    setAnalyzeState("idle"); setAnalysis(null); setQuad(null);
    setProcessState("idle"); setShadowPreview(null); setRenderUrl(null);
    setTool("render");
    editorHistory.clear();
    clearSession(); // trocar foto descarta a sessão persistida
  }, [surfaceMaskUrl, occluderMaskUrl, aiEditMaskUrl, reflectionMaskUrl, renderUrl, artFile]);

  // ── Render ───────────────────────────────────────────────────────────────────

  // Histórico (zundo) reativo → habilita/desabilita os botões de undo/redo.
  const canUndo = useTemporal((s) => s.pastStates.length > 0);
  const canRedo = useTemporal((s) => s.futureStates.length > 0);

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

  // Bounding box do quad em % da imagem — pra ancorar a drop zone e o loading
  // DENTRO da área do smart object (não no centro da tela toda).
  const quadBBox = quad && imgDims.w && imgDims.h
    ? (() => {
        const xs = [quad.tl.x, quad.tr.x, quad.br.x, quad.bl.x];
        const ys = [quad.tl.y, quad.tr.y, quad.br.y, quad.bl.y];
        const minX = Math.min(...xs), maxX = Math.max(...xs);
        const minY = Math.min(...ys), maxY = Math.max(...ys);
        return {
          left: (minX / imgDims.w) * 100, top: (minY / imgDims.h) * 100,
          width: ((maxX - minX) / imgDims.w) * 100, height: ((maxY - minY) / imgDims.h) * 100,
        };
      })()
    : null;

  // Máscara de cena pra Luz (clip art/superfície no preview): quad preenchido em
  // branco sobre transparente, em px da imagem (cap 1024). Casa 1:1 com a mask.png do
  // render. Memoizada no quad+dims (toDataURL é caro). Aspect-stretch no overlay.
  const luzSceneMaskUrl = useMemo(() => {
    if (!quad || !imgDims.w || !imgDims.h || typeof document === "undefined") return null;
    const cap = 1024, s = Math.min(1, cap / Math.max(imgDims.w, imgDims.h));
    const cw = Math.max(1, Math.round(imgDims.w * s)), ch = Math.max(1, Math.round(imgDims.h * s));
    const cv = document.createElement("canvas");
    cv.width = cw; cv.height = ch;
    const ctx = cv.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.moveTo(quad.tl.x * s, quad.tl.y * s);
    ctx.lineTo(quad.tr.x * s, quad.tr.y * s);
    ctx.lineTo(quad.br.x * s, quad.br.y * s);
    ctx.lineTo(quad.bl.x * s, quad.bl.y * s);
    ctx.closePath();
    ctx.fill();
    return cv.toDataURL("image/png");
  }, [quad, imgDims.w, imgDims.h]);


  return (
    <div className="scene-maker min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">

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

        {/* Right: novo projeto + undo/redo + pipeline */}
        <div className="flex items-center gap-3">
          {photoUrl && (
            <button
              onClick={resetPhoto}
              title="Recomeçar — descarta esta cena e sobe uma nova foto"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-neutral-400 hover:text-white hover:bg-white/5 border border-neutral-800 hover:border-neutral-700 transition-all"
            >
              <RefreshCw size={11} />
              Novo projeto
            </button>
          )}
          <div className="flex items-center gap-0.5 pr-3 border-r border-neutral-800">
            <button
              onClick={() => editorHistory.undo()} disabled={!canUndo}
              title="Desfazer (Ctrl+Z)"
              className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-white/5 disabled:opacity-25 disabled:hover:bg-transparent transition-colors"
            >
              <Undo2 size={14} />
            </button>
            <button
              onClick={() => editorHistory.redo()} disabled={!canRedo}
              title="Refazer (Ctrl+Shift+Z)"
              className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-white/5 disabled:opacity-25 disabled:hover:bg-transparent transition-colors"
            >
              <Redo2 size={14} />
            </button>
            <button
              onClick={() => setShortcutsOpen(true)}
              title="Atalhos (?)"
              aria-label="Atalhos"
              className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-white/5 transition-colors"
            >
              <Keyboard size={14} />
            </button>
          </div>
        </div>
      </header>

      <ShortcutsHelp open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />

      <Toaster
        theme="dark"
        position="bottom-right"
        toastOptions={{ style: { background: "rgba(24,24,27,0.92)", border: "1px solid rgba(63,63,70,0.6)", color: "#e4e4e7", backdropFilter: "blur(8px)" } }}
      />

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
                          <p className="text-sm text-zinc-500 mt-1">Cartão, pôster, outdoor, parede…</p>
                        </div>
                      </>
                    )}
                    {uploadErr && <p className="text-red-400 text-sm">{uploadErr}</p>}
                  </div>
                )}

                {photoUrl && quad && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-zinc-400">Arraste os cantos pra ajustar · {imgDims.w}×{imgDims.h}px</span>
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
                  // Mostra a cena sempre que houver foto — mesmo sem arte na aba Render
                  // (a drop zone passa a viver DENTRO do quad, não como hero full-screen).
                  const showViewer = !!photoUrl;
                  if (showViewer) {
                    const baseSrc = (activeImageUrl ?? photoUrl)!;
                    return (
                      <ZoomPanViewer requireSpaceToPan={tool !== "render"} dims={imgDims} minimapSrc={baseSrc}>
                        <div style={{ maxWidth: "calc(100vw - 360px)", position: "relative", display: "inline-block", lineHeight: 0 }}>
                          {/* Persistent base — the ONLY visible scene pixels. */}
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={baseSrc}
                            alt="mockup"
                            draggable={false}
                            style={{ maxWidth: "calc(100vw - 360px)", maxHeight: "calc(100vh - 80px)", objectFit: "contain", display: "block", filter: previewFilter ?? undefined, transition: "filter var(--motion) var(--ease)" }}
                          />
                          {/* Pulso "trabalhando aqui" (SSoT: SurfacePulse). Render → clip no quad;
                              edição da imagem → mask na seleção (ou imagem toda); limpar rosa → quad. */}
                          {(renderState === "loading" || autoRenderPending) && <SurfacePulse src={baseSrc} clipPath={surfaceClip} />}
                          {aiEditing && <SurfacePulse src={baseSrc} maskUrl={aiEditMaskUrl} />}
                          {cleaningSurface && <SurfacePulse src={baseSrc} clipPath={surfaceClip} />}

                          {/* Antes/depois — divisor arrastável: esquerda = foto original, direita = render. */}
                          {compare && tool === "render" && renderUrl && photoUrl && (
                            <div ref={compareRef} className="absolute inset-0 select-none" style={{ touchAction: "none" }}>
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={photoUrl} alt="original" draggable={false}
                                style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain", clipPath: `inset(0 ${((1 - compareX) * 100).toFixed(2)}% 0 0)`, pointerEvents: "none" }} />
                              <div style={{ position: "absolute", top: 0, bottom: 0, left: `${compareX * 100}%`, width: 2, background: "rgba(255,255,255,0.9)", boxShadow: "0 0 0 1px rgba(0,0,0,0.4)", pointerEvents: "none" }} />
                              <div
                                onPointerDown={(e) => { compareDragRef.current = true; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); }}
                                onPointerMove={(e) => { if (!compareDragRef.current || !compareRef.current) return; const r = compareRef.current.getBoundingClientRect(); setCompareX(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))); }}
                                onPointerUp={(e) => { compareDragRef.current = false; try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* */ } }}
                                style={{ position: "absolute", top: "50%", left: `${compareX * 100}%`, transform: "translate(-50%,-50%)", width: 26, height: 26, borderRadius: "9999px", background: "rgba(24,24,27,0.9)", border: "2px solid #fff", display: "grid", placeItems: "center", cursor: "ew-resize", color: "#fff", fontSize: 12 }}
                              >⇄</div>
                              <span className="absolute top-2 left-3 text-[10px] font-medium text-white/90 bg-black/40 px-1.5 py-0.5 rounded backdrop-blur-sm pointer-events-none">antes</span>
                              <span className="absolute top-2 right-3 text-[10px] font-medium text-white/90 bg-black/40 px-1.5 py-0.5 rounded backdrop-blur-sm pointer-events-none">depois</span>
                            </div>
                          )}

                          {/* Drop zone DENTRO do smart object — centralizada no quad; clica/dropa ali.
                              Só na aba Render sem arte; substitui o hero full-screen. */}
                          {tool === "render" && !artFile && quadBBox && (
                            <div
                              style={{ position: "absolute", left: `${quadBBox.left}%`, top: `${quadBBox.top}%`, width: `${quadBBox.width}%`, height: `${quadBBox.height}%`, padding: "4%", boxSizing: "border-box" }}
                            >
                              <ArtDropZone onFile={handleArtFile} dragOver={bgDragOver} size="quad" />
                            </div>
                          )}

                          {/* Tool overlays — transparent, stacked over the persistent base. */}
                          {tool === "corners" && quad && (
                            <div className="absolute inset-0">
                              <QuadEditor transparentImg imageUrl={baseSrc} imageNW={imgDims.w} imageNH={imgDims.h} quad={quad}
                                onQuadChange={(q) => { setQuad(q); setProcessState("idle"); }}
                                bend={bend} onBendChange={setBend} />
                            </div>
                          )}
                          {/* Crop — moldura livre (8 alças, estende além da imagem). Overlay
                              transparente dentro do viewer → herda zoom/pan como os outros tools. */}
                          {tool === "crop" && imgDims.w > 0 && (
                            <div className="absolute inset-0">
                              <CropFrame
                                transparentImg
                                imageUrl={baseSrc}
                                naturalW={imgDims.w}
                                naturalH={imgDims.h}
                                aspect={ASPECT_VALUE[cropAspect]}
                                onChange={setCropArea}
                                resetKey={cropResetKey}
                                onApply={handleApplyCrop}
                              />
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
                                backgroundColor: maskTarget === "surface" ? "#3df27e" : maskTarget === "occluder" ? "#22d3ee" : "#a78bfa",
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
                              cropMode={tool === "luz" && luzCropMode}
                              maskUrls={{ art: luzSceneMaskUrl, surface: luzSceneMaskUrl }}
                              onPosition={(id, pos) => updateLuz(id, { position: pos })}
                              onScale={(id, scale) => updateLuz(id, { scale })}
                              onRotate={(id, rotation) => updateLuz(id, { rotation })}
                              onCrop={(id, crop) => updateLuz(id, { crop })}
                              onToggleCrop={() => setLuzCropMode((v) => !v)}
                              onActivate={(id) => setLuzActive(id)}
                            />
                          )}
                          {/* Warp da Luz — Ctrl segurado: reusa o MESMO QuadEditor do Cantos
                              (SSoT das alças). Sem bend. Quad em px da cena; salvo normalizado. */}
                          {tool === "luz" && luzCtrl && (() => {
                            const lay = luzLayers.find((l) => l.id === luzActive);
                            if (!lay?.src || !lay.warpQuad) return null;
                            const wq = lay.warpQuad;
                            const toPx = (p: { x: number; y: number }) => ({ x: p.x * imgDims.w, y: p.y * imgDims.h });
                            const quadPx = { tl: toPx(wq.tl), tr: toPx(wq.tr), br: toPx(wq.br), bl: toPx(wq.bl) };
                            const toNorm = (p: { x: number; y: number }) => ({ x: p.x / imgDims.w, y: p.y / imgDims.h });
                            return (
                              <div className="absolute inset-0">
                                <QuadEditor transparentImg imageUrl={baseSrc} imageNW={imgDims.w} imageNH={imgDims.h} quad={quadPx}
                                  onQuadChange={(q) => updateLuz(luzActive, { warpQuad: { tl: toNorm(q.tl), tr: toNorm(q.tr), br: toNorm(q.br), bl: toNorm(q.bl) } })} />
                              </div>
                            );
                          })()}
                        </div>
                      </ZoomPanViewer>
                    );
                  }
                  return (
                  <div className="w-full h-full flex items-center justify-center relative overflow-hidden">
                    {/* Scene preview — SHARP, só escurecida; o blur acontece apenas atrás
                        do glass panel (backdrop-blur do ArtDropZone hero). */}
                    {photoUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={photoUrl}
                        alt=""
                        aria-hidden
                        draggable={false}
                        className="absolute inset-0 w-full h-full object-cover select-none pointer-events-none"
                        style={{ filter: "brightness(0.5)", transform: "scale(1.05)" }}
                      />
                    )}
                    <div className="absolute inset-0 bg-zinc-950/25 pointer-events-none" />
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

                {/* Chip de contexto — diz QUAL modo está ativo (só nos modos de edição;
                    no Render some). Fonte única: tool (+ maskTarget pro contexto da máscara). */}
                {photoUrl && tool !== "render" && (() => {
                  const t = PHOTO_TOOLS.find((x) => x.id === tool);
                  if (!t) return null;
                  if (tool === "mask" && maskTarget === "aiedit")
                    return <CanvasContextChip icon={Wand2} label="Seleção da edição" sublabel="não afeta o render" tone="violet" />;
                  if (tool === "mask")
                    return <CanvasContextChip icon={t.icon} label="Máscara"
                      sublabel={maskTarget === "surface" ? "Superfície" : "Oclusão"}
                      tone={maskTarget === "surface" ? "acc2" : "acc"} />;
                  if (tool === "luz")
                    return <CanvasContextChip icon={t.icon} label="Luz"
                      sublabel={luzLayers.find((l) => l.id === luzActive)?.label} />;
                  if (tool === "crop")
                    return <CanvasContextChip icon={t.icon} label="Cortar"
                      sublabel={cropExpanding ? "Expandir" : undefined} tone="amber" />;
                  return <CanvasContextChip icon={t.icon} label={t.label} />;
                })()}

                {/* Subtle top progress bar — non-intrusive, image stays visible (blurred) */}
                {(renderState === "loading" || autoRenderPending) && (
                  <div className="absolute top-0 left-0 right-0 h-0.5 z-20 overflow-hidden pointer-events-none">
                    <div className="h-full w-1/3 bg-acc/80 rounded-full animate-[scene-loadbar_1.1s_ease-in-out_infinite]" />
                  </div>
                )}

                {/* Antes/depois toggle — só quando há render + foto. */}
                {tool === "render" && renderUrl && photoUrl && (
                  <button
                    onClick={() => setCompare((v) => !v)}
                    className={["absolute top-3 z-20 text-[11px] px-2 py-0.5 rounded-full backdrop-blur-sm flex items-center gap-1 transition-colors",
                      aiBlendUrl ? "left-20" : "left-4",
                      compare ? "bg-acc2/80 text-zinc-950" : "bg-black/50 text-zinc-400 hover:text-white"].join(" ")}
                    title="Comparar antes/depois"
                  >
                    ⇄ {compare ? "Comparando" : "Antes/Depois"}
                  </button>
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
                          {tool === "corners" && <CornersPanel onConfirm={() => setTool("render")} size={surfaceSize} />}
                          {/* Seleção da edição (aiedit) — painel dedicado, separado da máscara de arte/design. */}
                          {tool === "mask" && maskTarget === "aiedit" && (
                            <EditSelectionPanel
                              instrument={maskMethod} setInstrument={setMaskMethod}
                              mode={maskMode} setMode={setMaskMode}
                              brushSize={brushSize} setBrushSize={setBrushSize}
                              segFeather={segFeather} setSegFeather={setSegFeather}
                              segStatus={segStatus} segHasMask={segHasMask}
                              imgDims={imgDims}
                              hasMask={!!aiEditMaskUrl}
                              onApply={applyActiveInstrument}
                              onUndo={undoMaskTarget}
                              onClear={clearMaskTarget}
                              onDone={() => setTool("aiedit")}
                            />
                          )}
                          {tool === "mask" && maskTarget !== "aiedit" && (
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
                              reflectionOpacity={reflectionOpacity} setReflectionOpacity={setReflectionOpacity}
                              reflectionBlur={reflectionBlur} setReflectionBlur={setReflectionBlur}
                            />
                          )}
                          {/* Apply edits → render. Lives in the editing tabs (intuitive),
                              not in the Render tab. Highlights when there are pending changes. */}
                          {!(tool === "mask" && maskTarget === "aiedit") && (<>
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
                          </>)}
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
                          hasMask={!!aiEditMaskUrl}
                          onEditMask={() => { setMaskTarget("aiedit"); setMaskMethod("brush"); setMaskMode("add"); setTool("mask"); }}
                          onClearMask={() => setAiEditMaskUrl(null)}
                          hasMagenta={photoHasMagenta}
                          cleaning={cleaningSurface}
                          onCleanPlaceholder={handleCleanPlaceholder}
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
                          onResetCrop={() => updateLuz(luzActive, { crop: { x: 0, y: 0, w: 1, h: 1 } })}
                          hasWarp={!!luzLayers.find((l) => l.id === luzActive)?.warpQuad}
                          warpActive={luzCtrl}
                          onResetWarp={() => updateLuz(luzActive, { warpQuad: null })}
                        />
                      )}

                      {tool === "render" && (
                        <RenderPanel
                          artPreview={artPreview} artDims={artDims} frame={frame} setFrame={setFrame} surfaceSize={surfaceSize}
                          artFile={artFile} artHasAlpha={artHasAlpha} clearArt={clearArt} handleArtFile={handleArtFile}
                          shadowOpacity={shadowOpacity} setShadowOpacity={setShadowOpacity}
                          realism={realism} setRealism={applyRealism}
                          showAdvanced={showAdvanced} setShowAdvanced={setShowAdvanced}
                          highlightOpacity={highlightOpacity} setHighlightOpacity={setHighlightOpacity}
                          castOpacity={castOpacity} setCastOpacity={setCastOpacity}
                          maskContract={maskContract} setMaskContract={setMaskContract}
                          maskFeather={maskFeather} setMaskFeather={setMaskFeather}
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
                          onPreviewLook={setPreviewFilter}
                        />
                      )}

                    </div>
                </ToolRail>

                {/* Status line única — narra a op async atual, discreta no canto. */}
                {(() => {
                  const busy =
                    (renderState === "loading" || autoRenderPending) ? "Renderizando"
                    : processState === "loading" ? "Extraindo luz & sombra"
                    : upscaling ? "Aumentando resolução"
                    : aiEditing ? "Editando"
                    : cropApplying ? (cropExpanding ? "Expandindo cena" : "Cortando")
                    : publishState === "loading" ? "Publicando" : null;
                  if (!busy) return null;
                  const showMs = renderState === "loading" || processState === "loading" || autoRenderPending;
                  return (
                    <div className="absolute bottom-4 left-4 z-30 flex items-center gap-2 px-3 py-1.5 rounded-full bg-zinc-900/85 border border-zinc-700/50 backdrop-blur-md text-[11px] text-zinc-300 shadow-lg pointer-events-none">
                      <Loader2 size={11} className="animate-spin text-acc" />
                      <span>{busy}{showMs ? ` · ${(procMs / 1000).toFixed(1)}s` : "…"}</span>
                    </div>
                  );
                })()}

                {/* Dica de 1º uso — chip efêmero, dispensável, lembra via localStorage. */}
                {(() => {
                  const hint = (tool === "render" && !artFile && !hintsSeen["drop-art"])
                      ? { key: "drop-art", text: "Solte a arte na superfície destacada — renderiza sozinho" }
                    : (tool === "corners" && !hintsSeen["corners"])
                      ? { key: "corners", text: "Arraste os cantos pra ajustar a superfície · OK quando estiver certo" }
                    : null;
                  if (!hint) return null;
                  return (
                    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 px-3 py-1.5 rounded-full bg-acc2/15 border border-acc2/30 backdrop-blur-md text-[11px] text-acc2 shadow-lg animate-in fade-in slide-in-from-bottom-2">
                      <Sparkles size={12} />
                      <span>{hint.text}</span>
                      <button onClick={() => dismissHint(hint.key)} className="ml-1 text-acc2/70 hover:text-acc2 transition-colors" aria-label="Dispensar dica"><X size={12} /></button>
                    </div>
                  );
                })()}

                <LuzAssetModal
                  open={luzModalOpen}
                  layerLabel={luzLayers.find((l) => l.id === luzActive)!.label}
                  onClose={() => setLuzModalOpen(false)}
                  onPick={(path) => { setLuzAssetFromPath(luzActive, path); setLuzModalOpen(false); }}
                  onUploadFile={(f) => { setLuzAssetFromFile(luzActive, f); setLuzModalOpen(false); }}
                />

                {/* Modal de nome do publish (design system — substitui o window.prompt). */}
                {publishModalOpen && (
                  <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm"
                    onClick={() => setPublishModalOpen(false)}>
                    <div className="w-[min(360px,90vw)] rounded-2xl border border-zinc-700/70 bg-zinc-900 shadow-2xl p-4 space-y-3"
                      onClick={(e) => e.stopPropagation()}>
                      <p className="text-[11px] uppercase tracking-widest text-zinc-500">Publicar na Biblioteca</p>
                      <input
                        autoFocus
                        value={publishName}
                        onChange={(e) => setPublishName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") doPublish(publishName); if (e.key === "Escape") setPublishModalOpen(false); }}
                        placeholder="Nome do mockup"
                        className="w-full rounded-lg bg-zinc-950 border border-zinc-700 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-acc2/60"
                      />
                      <div className="flex items-center gap-2 justify-end">
                        <button onClick={() => setPublishModalOpen(false)}
                          className="px-3 py-1.5 rounded-lg text-xs text-zinc-400 hover:text-white hover:bg-white/5 transition-colors">Cancelar</button>
                        <button onClick={() => doPublish(publishName)} disabled={!publishName.trim()}
                          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-acc2 text-zinc-950 hover:bg-acc2/90 disabled:opacity-40 transition-colors">Salvar</button>
                      </div>
                    </div>
                  </div>
                )}

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
