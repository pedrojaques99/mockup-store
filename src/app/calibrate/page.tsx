"use client";

/**
 * /calibrate — console de calibração de superfície.
 *
 * - Detecta o quad (magenta/neon, superfície branca, ou manual) e você encaixa com
 *   as alças (lupa 5× do QuadEditor); salva no golden quads.json da pasta.
 * - Pasta dinâmica: cole um caminho ou arraste imagens (upload).
 * - Displacement: visualiza o mapa de relevo e calibra amplitude (dispScale) + blur.
 *
 * Atalhos: S salva · ←/→ navega · O overlay magenta · D displacement · R re-detecta.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Loader2, Save, ChevronLeft, ChevronRight, RefreshCw, Eye, EyeOff, CheckCircle2,
  Ban, RotateCcw, FolderOpen, Upload, Mountain, Shirt, Play, Grid3x3, Lasso, Sparkles,
} from "lucide-react";
import dynamic from "next/dynamic";
import { defaultMesh, ensureTangents, autoSmoothTangents, applyDispToMesh, meshFromDepth, type WarpMesh } from "@/lib/mesh-core";
import { AuthChip } from "@/components/AuthChip";
import { smartMesh } from "@/lib/smart-mesh";
import { SUBSTRATES, SUBSTRATE_KEYS, type SubstrateKind } from "@/lib/substrate-presets";
import type { SceneAnalysis, SceneKind } from "@/lib/scene-classify";
// react-konva precisa de DOM → carrega só no cliente (sem SSR). Viewer 100% vetor (Konva).
const CalibrateStage = dynamic(() => import("@/components/photo-tools/CalibrateStage").then((m) => m.CalibrateStage), { ssr: false });
const MaskCalibrate = dynamic(() => import("@/components/photo-tools/MaskCalibrate").then((m) => m.MaskCalibrate), { ssr: false });
import type { Quad } from "@/stores/editorDoc";

type Method = "key-color" | "white" | "manual";
type MaterialKind = "none" | "fabric" | "metal" | "glass" | "worn" | "shadow";
const MATERIALS: { id: MaterialKind; label: string }[] = [
  { id: "none", label: "—" }, { id: "fabric", label: "Tecido" }, { id: "metal", label: "Metal" },
  { id: "glass", label: "Vidro" }, { id: "worn", label: "Gasto" }, { id: "shadow", label: "Sombra" },
];

interface Scene {
  name: string; width: number; height: number; url: string;
  status: "manual" | "auto" | "unsaved"; confidence?: number; iou?: number; surfaceType?: string;
  sceneKind?: SceneKind;
  substrate?: SubstrateKind;
}
interface SceneData {
  quad: Quad; auto: Quad | null; hue: number; confidence: number;
  detectorVersion?: number; width: number; height: number;
  surfaceType: string; method: Method; dispScale: number; dispBlur: number;
  material: MaterialKind; materialIntensity: number; materialAngle: number; materialScale: number;
  mesh?: WarpMesh;
  analysis?: SceneAnalysis;
  /** Substrato escolhido (top-1 detectado, ou override manual do usuário). */
  substrate?: SubstrateKind;
}

/** Visual kit por placeholder. */
const KIND_STYLE: Record<SceneKind, { color: string; bg: string; label: string; tag: string }> = {
  magenta: { color: "text-fuchsia-300", bg: "bg-fuchsia-950/60 border-fuchsia-800", label: "Magenta", tag: "M" },
  white:   { color: "text-zinc-100",    bg: "bg-zinc-800 border-zinc-600",          label: "White-label", tag: "W" },
  custom:  { color: "text-amber-300",   bg: "bg-amber-950/60 border-amber-800",     label: "Custom",     tag: "C" },
};

const SURFACE_TYPES = ["billboard", "poster", "card", "wall", "fabric", "other"] as const;
const METHODS: { id: Method; label: string }[] = [
  { id: "key-color", label: "Magenta" }, { id: "white", label: "Branca" }, { id: "manual", label: "Manual" },
];
const DISP_DEFAULT: Record<string, number> = { fabric: 12, tshirt: 12, bag: 10, wall: 8, paper: 6, card: 0, billboard: 0, poster: 0 };
const dispFor = (t: string) => DISP_DEFAULT[t] ?? 6;

const centeredQuad = (w: number, h: number): Quad => ({
  tl: { x: Math.round(w * 0.2), y: Math.round(h * 0.2) }, tr: { x: Math.round(w * 0.8), y: Math.round(h * 0.2) },
  br: { x: Math.round(w * 0.8), y: Math.round(h * 0.8) }, bl: { x: Math.round(w * 0.2), y: Math.round(h * 0.8) },
});
const qstr = (dir: string) => (dir ? `&dir=${encodeURIComponent(dir)}` : "");

export default function CalibratePage() {
  const [dir, setDir] = useState("");           // "" = pasta default (Render/New Mockups)
  const [dirInput, setDirInput] = useState("");
  const [recents, setRecents] = useState<string[]>([]);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [ignored, setIgnored] = useState<string[]>([]);
  const [cur, setCur] = useState(-1);
  const [data, setData] = useState<SceneData | null>(null);
  const [overlayOn, setOverlayOn] = useState(true);
  const [dispMode, setDispMode] = useState(false);
  const [dispUrl, setDispUrl] = useState<string | null>(null);
  const [matMode, setMatMode] = useState(false);
  const [matUrl, setMatUrl] = useState<string | null>(null);
  const [matBlend, setMatBlend] = useState("normal");
  const [meshMode, setMeshMode] = useState(false);
  const [maskMode, setMaskMode] = useState(false);
  const [maskUrl, setMaskUrl] = useState<string | null>(null);
  const [renderMode, setRenderMode] = useState(false);
  // Toggle do MLLM (Claude vision) — pago/lento, sticky no localStorage.
  const [useAI, setUseAI] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("calibrate:ai") === "1";
  });
  useEffect(() => { try { localStorage.setItem("calibrate:ai", useAI ? "1" : "0"); } catch { /* */ } }, [useAI]);
  // Stats da engine-pai (global + tenant se houver) — transparência "produto que aprende".
  const [engineMeta, setEngineMeta] = useState<{ global: { version: number; samples: number; meanIoU?: number }; tenant?: { name: string; version: number; samples: number } } | null>(null);
  useEffect(() => {
    fetch("/api/engine/stats").then((r) => r.ok ? r.json() : null).then(setEngineMeta).catch(() => {});
  }, [cur]);
  const [renderUrl, setRenderUrl] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const [artKind, setArtKind] = useState<"grid" | "poster" | "checker">("grid");
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const [viewSize, setViewSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = viewerRef.current; if (!el) return;
    const update = () => setViewSize({ w: el.clientWidth, h: el.clientHeight });
    update(); const ro = new ResizeObserver(update); ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const scene = cur >= 0 ? scenes[cur] : null;

  // ── undo/redo (parity com photo-mockup): histórico local de `data` ──
  // Coalesce: arrasto/slider vira UM passo (push só a cada ≥500ms).
  const pastRef = useRef<SceneData[]>([]);
  const futureRef = useRef<SceneData[]>([]);
  const lastPushRef = useRef(0);
  const resetHistory = useCallback(() => { pastRef.current = []; futureRef.current = []; lastPushRef.current = 0; }, []);
  const editData = useCallback((updater: (d: SceneData) => SceneData) => {
    setData((prev) => {
      if (!prev) return prev;
      const now = Date.now();
      if (now - lastPushRef.current > 500) {
        pastRef.current.push(prev);
        if (pastRef.current.length > 100) pastRef.current.shift();
        futureRef.current = [];
        lastPushRef.current = now;
      }
      return updater(prev);
    });
    setDirty(true);
  }, []);
  const undo = useCallback(() => { setData((cur) => { const prev = pastRef.current.pop(); if (!prev) return cur; if (cur) futureRef.current.push(cur); return prev; }); setDirty(true); }, []);
  const redo = useCallback(() => { setData((cur) => { const nxt = futureRef.current.pop(); if (!nxt) return cur; if (cur) pastRef.current.push(cur); return nxt; }); setDirty(true); }, []);

  // ── recents (localStorage) ──────────────────────────────────────
  useEffect(() => {
    try {
      setRecents(JSON.parse(localStorage.getItem("calibrate:recents") || "[]"));
      const last = localStorage.getItem("calibrate:dir") || "";
      setDir(last); setDirInput(last);
    } catch { /* ignore */ }
  }, []);
  const pushRecent = useCallback((d: string) => {
    if (!d) return;
    setRecents((rs) => {
      const next = [d, ...rs.filter((r) => r !== d)].slice(0, 8);
      try { localStorage.setItem("calibrate:recents", JSON.stringify(next)); } catch { /* */ }
      return next;
    });
  }, []);

  // ── carregar pasta ──────────────────────────────────────────────
  const fetchScenes = useCallback(async (d: string, selectFirst = true) => {
    setErr(null);
    try {
      const r = await fetch(`/api/calibrate/scenes?_=1${qstr(d)}`);
      const j = await r.json();
      if (j.error) { setErr(j.error); setScenes([]); setIgnored([]); setCur(-1); return; }
      setScenes(j.scenes); setIgnored(j.ignored ?? []);
      setCur(selectFirst ? (j.scenes.length ? 0 : -1) : (c) => c as any);
      try { localStorage.setItem("calibrate:dir", d); } catch { /* */ }
    } catch (e: any) { setErr(e.message); }
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchScenes(dir); }, [dir]);

  const loadDir = useCallback(() => { const d = dirInput.trim(); setDir(d); pushRecent(d); }, [dirInput, pushRecent]);

  // ── carregar cena ───────────────────────────────────────────────
  const detectFor = useCallback(async (s: Scene, method: Method) => {
    const r = await fetch("/api/calibrate/detect", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: s.name, dir, method }),
    });
    return r.json();
  }, [dir]);

  const loadScene = useCallback(async (i: number) => {
    const s = scenes[i];
    if (!s) return;
    setBusy(true); setErr(null); setData(null); setDispUrl(null); setMaskUrl(null); resetHistory();
    try {
      // 1) Análise completa (placeholder + substrato + preset combinado [+ AI opcional]).
      const analyzePromise = fetch("/api/calibrate/classify", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: s.name, dir, ai: useAI }),
      }).then((r) => r.ok ? r.json() as Promise<SceneAnalysis> : null).catch(() => null);

      // 2) Detecta com método salvo OU pelo análise quando novo.
      const savedMethod = (s as any).method as Method | undefined;
      const an = await analyzePromise;
      const method: Method = savedMethod ?? (an?.preset.method as Method | undefined) ?? "key-color";
      const j = await detectFor(s, method);

      // 3) Carrega máscara sidecar via /api/calibrate/load (atomic com a entry).
      try {
        const lr = await fetch(`/api/calibrate/load?name=${encodeURIComponent(s.name)}${qstr(dir)}`);
        const lj = await lr.json();
        if (lj?.surfaceMaskDataUrl) setMaskUrl(lj.surfaceMaskDataUrl);
      } catch { /* */ }

      const width = j.width || s.width, height = j.height || s.height;
      const auto: Quad | null = j.quad ?? null;
      const saved = j.saved;
      const preset = an?.preset;
      const surfaceType = saved?.surfaceType ?? s.surfaceType ?? preset?.surfaceType ?? "billboard";

      setData({
        quad: saved?.quad ?? auto ?? centeredQuad(width, height),
        auto, hue: j.hue ?? -1, confidence: j.confidence ?? 0, detectorVersion: j.detectorVersion,
        width, height, surfaceType,
        method: saved?.method ?? method,
        // Smart presets aplicados quando a cena NÃO tem valor salvo — não sobrescreve trabalho.
        dispScale: saved?.dispScale ?? preset?.dispScale ?? dispFor(surfaceType),
        dispBlur: saved?.dispBlur ?? preset?.dispBlur ?? 8,
        material: (saved?.material as MaterialKind) ?? preset?.material ?? "none",
        materialIntensity: saved?.materialIntensity ?? preset?.materialIntensity ?? 0.5,
        materialAngle: saved?.materialAngle ?? preset?.materialAngle ?? 35,
        materialScale: saved?.materialScale ?? preset?.materialScale ?? 6,
        mesh: saved?.mesh,
        analysis: an ?? undefined,
        substrate: an?.substrate.kind,
      });
      if (an) setScenes((ss) => ss.map((x, idx) => idx === i ? { ...x, sceneKind: an.placeholder.kind, substrate: an.substrate.kind } : x));
      setDirty(false);
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }, [scenes, detectFor, dir]);

  // Carrega só quando a cena selecionada (dir::name) muda de fato — assim um setScenes
  // de save/ignore (que mantém o mesmo nome em `cur`) não re-dispara detecção/spinner.
  const loadedKeyRef = useRef("");
  useEffect(() => {
    const s = cur >= 0 ? scenes[cur] : null;
    if (!s) { loadedKeyRef.current = ""; return; }
    const key = `${dir}::${s.name}::ai=${useAI ? 1 : 0}`;
    if (loadedKeyRef.current === key) return;
    loadedKeyRef.current = key;
    loadScene(cur);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur, scenes, dir, useAI]);

  // ── detecção / método ───────────────────────────────────────────
  const runDetect = useCallback(async (method: Method) => {
    if (!scene) return;
    setBusy(true);
    try {
      const j = await detectFor(scene, method);
      editData((d) => ({
        ...d, method,
        quad: j.quad ?? centeredQuad(d.width, d.height),
        auto: j.quad ?? null, hue: j.hue ?? -1, confidence: j.confidence ?? 0, detectorVersion: j.detectorVersion,
        surfaceType: j.surfaceType ?? d.surfaceType,
      }));
    } finally { setBusy(false); }
  }, [scene, detectFor, editData]);

  // ── displacement preview ────────────────────────────────────────
  const refreshDisp = useCallback(async () => {
    if (!scene || !data) return;
    try {
      const r = await fetch("/api/calibrate/displacement", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: scene.name, dir, quad: data.quad, blur: data.dispBlur }),
      });
      if (!r.ok) return;
      const blob = await r.blob();
      setDispUrl((u) => { if (u) URL.revokeObjectURL(u); return URL.createObjectURL(blob); });
    } catch { /* */ }
  }, [scene, data, dir]);

  // regenera o preview quando entra no modo displacement ou muda o blur (debounce)
  useEffect(() => {
    if (!dispMode || !data) return;
    const t = setTimeout(refreshDisp, 350);
    return () => clearTimeout(t);
  }, [dispMode, data?.dispBlur, refreshDisp, data]);

  // ── material/FX preview ─────────────────────────────────────────
  const refreshMat = useCallback(async () => {
    if (!scene || !data) return;
    if (data.material === "none") { setMatUrl((u) => { if (u) URL.revokeObjectURL(u); return null; }); return; }
    try {
      const r = await fetch("/api/calibrate/material", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: scene.name, dir, quad: data.quad, material: data.material, intensity: data.materialIntensity, angle: data.materialAngle, scale: data.materialScale }),
      });
      if (!r.ok) return;
      setMatBlend(r.headers.get("X-Blend") || "normal");
      const blob = await r.blob();
      setMatUrl((u) => { if (u) URL.revokeObjectURL(u); return URL.createObjectURL(blob); });
    } catch { /* */ }
  }, [scene, data, dir]);

  useEffect(() => {
    if (!matMode || !data) return;
    const t = setTimeout(refreshMat, 350);
    return () => clearTimeout(t);
  }, [matMode, data?.material, data?.materialIntensity, data?.materialAngle, data?.materialScale, refreshMat, data]);

  // ── render final ao vivo ────────────────────────────────────────
  const refreshRender = useCallback(async (hd = false) => {
    if (!scene || !data) return;
    setRendering(true);
    try {
      const r = await fetch("/api/calibrate/render", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: scene.name, dir, quad: data.quad, surfaceType: data.surfaceType, art: artKind,
          dispScale: data.dispScale, dispBlur: data.dispBlur,
          material: data.material, materialIntensity: data.materialIntensity,
          materialAngle: data.materialAngle, materialScale: data.materialScale,
          surfaceMaskBase64: maskUrl ?? undefined,   // SAM → luz/máscara da superfície real (WYSIWYG)
          mesh: data.mesh, preview: !hd, hd,   // hd → mesmo pipeline de produção (SSAA + full-res)
        }),
      });
      if (!r.ok) return;
      const blob = await r.blob();
      // troca só quando o novo frame chega → nunca pisca/branqueia (sem perceber carregamento)
      setRenderUrl((u) => { if (u) URL.revokeObjectURL(u); return URL.createObjectURL(blob); });
    } catch { /* */ }
    finally { setRendering(false); }
  }, [scene, data, dir, artKind, maskUrl]);

  // re-renderiza (debounce curto) quando muda quad/disp/material/malha/arte no modo render
  useEffect(() => {
    if (!renderMode || !data) return;
    const t = setTimeout(refreshRender, 220);
    return () => clearTimeout(t);
  }, [renderMode, artKind, data?.quad, data?.dispScale, data?.dispBlur, data?.material, data?.materialIntensity, data?.materialAngle, data?.materialScale, data?.mesh, refreshRender, data]);

  // ── salvar ──────────────────────────────────────────────────────
  const save = useCallback(async () => {
    if (!scene || !data) return;
    setSaving(true); setErr(null);
    try {
      const r = await fetch("/api/calibrate/save", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: scene.name, dir, quad: data.quad, auto: data.auto, method: data.method,
          surfaceType: data.surfaceType, hue: data.hue, confidence: data.confidence,
          detectorVersion: data.detectorVersion, dispScale: data.dispScale, dispBlur: data.dispBlur,
          material: data.material, materialIntensity: data.materialIntensity,
          materialAngle: data.materialAngle, materialScale: data.materialScale,
          mesh: data.mesh,
          surfaceMaskBase64: maskUrl ?? undefined,
          substrate: data.substrate ?? data.analysis?.substrate.kind,
        }),
      });
      const j = await r.json();
      if (j.error) { setErr(j.error); return; }
      setScenes((ss) => ss.map((s, i) => i === cur ? { ...s, status: "manual", iou: j.saved?.iou, surfaceType: data.surfaceType, method: data.method } as any : s));
      setDirty(false);
    } catch (e: any) { setErr(e.message); }
    finally { setSaving(false); }
  }, [scene, data, cur, dir]);

  const go = useCallback((d: number) => setCur((c) => Math.max(0, Math.min(scenes.length - 1, c + d))), [scenes.length]);

  // ── malha (warp envelope) ───────────────────────────────────────
  const toggleMask = useCallback(() => {
    setDispMode(false); setMatMode(false); setMeshMode(false); setRenderMode(false);
    setMaskMode((v) => !v);
  }, []);
  const toggleMesh = useCallback(() => {
    setDispMode(false); setMatMode(false); setMaskMode(false);
    setMeshMode((v) => {
      const next = !v;
      // ao entrar, garante hastes Bézier zeradas no mesh → handles já ficam acessíveis
      if (next) editData((d) => ({ ...d, mesh: ensureTangents(d.mesh ?? defaultMesh(d.quad as any, 3, 3)) }));
      return next;
    });
  }, [editData]);
  const setMeshDensity = useCallback((n: number) => editData((d) => ({ ...d, mesh: ensureTangents(defaultMesh(d.quad as any, n, n)) })), [editData]);
  const resetMesh = useCallback(() => editData((d) => ({ ...d, mesh: ensureTangents(defaultMesh(d.quad as any, d.mesh?.rows ?? 3, d.mesh?.cols ?? 3)) })), [editData]);
  const smoothMesh = useCallback(() => editData((d) => d.mesh ? ({ ...d, mesh: autoSmoothTangents(d.mesh) }) : d), [editData]);
  const straightenMesh = useCallback(() => editData((d) => d.mesh ? ({ ...d, mesh: { rows: d.mesh.rows, cols: d.mesh.cols, points: d.mesh.points } }) : d), [editData]);
  // ── Auto-curva: lê o displacement preview (dispUrl) e curva a malha de acordo. ──
  // Carrega o PNG num <canvas>, amostra R/G nos nós e aplica como offset escalado.
  // Pré-condição: estar em modo Displacement + ter dispUrl carregado.
  const autoCurveFromDisp = useCallback(async (intensity = 1) => {
    if (!data?.mesh) return;
    let url = dispUrl;
    if (!url) { await refreshDisp(); url = dispUrl; }
    if (!url) return;
    const img = new window.Image();
    img.crossOrigin = "anonymous"; img.src = url;
    await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error("load disp")); });
    const cv = document.createElement("canvas"); cv.width = img.naturalWidth; cv.height = img.naturalHeight;
    const ctx = cv.getContext("2d"); if (!ctx) return;
    ctx.drawImage(img, 0, 0);
    const { data: px } = ctx.getImageData(0, 0, cv.width, cv.height);
    // Escala estimada: a amplitude na UI (dispScale) é o "raio" max em px (já é byte→px).
    const scale = Math.max(2, data.dispScale || 8);
    const sx = cv.width / data.width, sy = cv.height / data.height;
    // median 3×3 → 1 pixel-outlier não puxa um nó (decode /128 = constante do engine)
    const sampler = (x: number, y: number): readonly [number, number] => {
      const cx = Math.round(x * sx), cy = Math.round(y * sy);
      const rs: number[] = [], gs: number[] = [];
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        const ix = Math.max(0, Math.min(cv.width - 1, cx + ox));
        const iy = Math.max(0, Math.min(cv.height - 1, cy + oy));
        const o = (iy * cv.width + ix) * 4;
        rs.push(px[o]); gs.push(px[o + 1]);
      }
      const med = (arr: number[]) => { arr.sort((a, b) => a - b); return arr[4]; };
      return [((med(rs) - 128) / 128) * scale, ((med(gs) - 128) / 128) * scale] as const;
    };
    editData((d) => d.mesh ? ({ ...d, mesh: applyDispToMesh(d.mesh, sampler, intensity) }) : d);
  }, [data, dispUrl, refreshDisp, editData]);

  // ── smart presets — aplica preset combinado (placeholder + substrato) ──
  const applyPreset = useCallback(() => {
    if (!data?.analysis) return;
    const p = data.analysis.preset;
    editData((d) => ({
      ...d,
      method: p.method as Method,
      surfaceType: p.surfaceType,
      dispScale: p.dispScale,
      dispBlur: p.dispBlur,
      material: p.material as MaterialKind,
      materialIntensity: p.materialIntensity,
      materialAngle: p.materialAngle,
      materialScale: p.materialScale,
    }));
    if (scene) runDetect(p.method as Method);
  }, [data, editData, runDetect, scene]);

  /** Troca o substrato manualmente (override do detector). Re-aplica preset desse substrato. */
  const setSubstrate = useCallback((k: SubstrateKind) => {
    const sp = SUBSTRATES[k];
    editData((d) => ({
      ...d, substrate: k,
      surfaceType: sp.surfaceType,
      dispScale: sp.dispScale, dispBlur: sp.dispBlur,
      material: sp.material as MaterialKind,
      materialIntensity: sp.materialIntensity,
      materialAngle: sp.materialAngle, materialScale: sp.materialScale,
    }));
  }, [editData]);

  /** Depth-aware mesh: chama /depth, amostra os nós, aplica `meshFromDepth`. */
  const applyDepthMesh = useCallback(async (amount = 24) => {
    if (!scene || !data?.mesh) return;
    try {
      const r = await fetch("/api/calibrate/depth", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: scene.name, dir }),
      });
      if (!r.ok) { setErr("depth falhou"); return; }
      const blob = await r.blob(); const url = URL.createObjectURL(blob);
      const img = new window.Image();
      img.src = url; await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error("img")); });
      const cv = document.createElement("canvas"); cv.width = img.naturalWidth; cv.height = img.naturalHeight;
      const ctx = cv.getContext("2d"); if (!ctx) return;
      ctx.drawImage(img, 0, 0);
      const { data: px } = ctx.getImageData(0, 0, cv.width, cv.height);
      const sx = cv.width / data.width, sy = cv.height / data.height;
      // median 3×3 do depth → spike de 1 pixel (depth model / specular) não voa um nó
      const sampler = (x: number, y: number) => {
        const cx = Math.round(x * sx), cy = Math.round(y * sy);
        const vs: number[] = [];
        for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
          const ix = Math.max(0, Math.min(cv.width - 1, cx + ox));
          const iy = Math.max(0, Math.min(cv.height - 1, cy + oy));
          vs.push(px[(iy * cv.width + ix) * 4]);
        }
        vs.sort((a, b) => a - b);
        return vs[4] / 255;
      };
      editData((d) => d.mesh ? ({ ...d, mesh: meshFromDepth(d.mesh, sampler, amount) }) : d);
      URL.revokeObjectURL(url);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "depth falhou");
    }
  }, [scene, data, dir, editData]);

  /** Gera a malha pré-esquematizada (flat / slight / drape / cylinder) do substrato atual. */
  const applySmartMesh = useCallback(() => {
    if (!data) return;
    const kind = data.substrate ?? data.analysis?.substrate.kind;
    if (!kind) return;
    const sp = SUBSTRATES[kind];
    const mesh = smartMesh(data.quad as any, sp.form, sp.meshDensity, 1);
    editData((d) => ({ ...d, mesh }));
  }, [data, editData]);

  // ── ignore ──────────────────────────────────────────────────────
  const toggleIgnore = useCallback(async (name: string, ignore: boolean) => {
    try {
      const r = await fetch("/api/calibrate/ignore", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, ignore, dir }),
      });
      const j = await r.json();
      setIgnored(j.ignored ?? []);
      if (ignore) {
        setScenes((ss) => { const next = ss.filter((s) => s.name !== name); setCur((c) => Math.min(c, next.length - 1)); return next; });
      } else { await fetchScenes(dir, false); }
    } catch (e: any) { setErr(e.message); }
  }, [dir, fetchScenes]);

  // ── upload ──────────────────────────────────────────────────────
  const uploadFiles = useCallback(async (files: FileList | File[]) => {
    const arr = [...files].filter((f) => /image\/(png|jpe?g|webp)/.test(f.type));
    if (!arr.length) return;
    setUploading(true); setErr(null);
    try {
      const fd = new FormData();
      if (dir) fd.append("dir", dir);
      for (const f of arr) fd.append("files", f);
      const r = await fetch("/api/calibrate/upload", { method: "POST", body: fd });
      const j = await r.json();
      if (j.error) { setErr(j.error); return; }
      const newDir = j.dir || dir;
      pushRecent(newDir);
      if (newDir !== dir) { setDir(newDir); setDirInput(newDir); } // useEffect recarrega
      else await fetchScenes(dir);
    } catch (e: any) { setErr(e.message); }
    finally { setUploading(false); }
  }, [dir, fetchScenes, pushRecent]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files?.length) uploadFiles(e.dataTransfer.files);
  }, [uploadFiles]);

  // ── atalhos ─────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if ((e.ctrlKey || e.metaKey) && (e.key === "z" || e.key === "Z")) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if ((e.ctrlKey || e.metaKey) && (e.key === "y" || e.key === "Y")) { e.preventDefault(); redo(); return; }
      if (e.ctrlKey || e.metaKey) return; // não dispara atalhos de tecla única com modificador
      if (e.key === "s" || e.key === "S") { e.preventDefault(); save(); }
      else if (e.key === "ArrowRight") { e.preventDefault(); go(1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); }
      else if (e.key === "o" || e.key === "O") setOverlayOn((v) => !v);
      else if (e.key === "d" || e.key === "D") { setDispMode((v) => !v); setMatMode(false); }
      else if (e.key === "m" || e.key === "M") { setMatMode((v) => !v); setDispMode(false); }
      else if (e.key === "w" || e.key === "W") toggleMesh();
      else if (e.key === "k" || e.key === "K") toggleMask();
      else if (e.key === "f" || e.key === "F") setRenderMode((v) => !v);
      else if (e.key === "r" || e.key === "R") { if (data) runDetect(data.method); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save, go, runDetect, data, undo, redo, toggleMesh, toggleMask]);

  const badge = (s: Scene) =>
    s.status === "manual" ? <span className="text-emerald-400">✓ {s.iou != null ? `IoU ${(s.iou * 100).toFixed(0)}%` : "salvo"}</span>
    : s.status === "auto" ? <span className="text-amber-400">auto</span>
    : <span className="text-zinc-500">novo</span>;

  return (
    <div className="flex h-screen bg-zinc-950 text-zinc-200" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      {/* ── fila de cenas ── */}
      <aside className="w-64 shrink-0 border-r border-zinc-800 overflow-y-auto flex flex-col">
        <div className="p-3 border-b border-zinc-800">
          <h1 className="text-sm font-semibold text-zinc-100">Calibração de superfície</h1>
          {/* pasta */}
          <div className="mt-2 flex items-center gap-1">
            <FolderOpen size={13} className="text-zinc-500 shrink-0" />
            <input value={dirInput} onChange={(e) => setDirInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") loadDir(); }}
              list="calibrate-recents" placeholder="Render/New Mockups (default)"
              className="flex-1 min-w-0 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-zinc-300 focus:outline-none focus:border-zinc-600" />
            <datalist id="calibrate-recents">{recents.map((r) => <option key={r} value={r} />)}</datalist>
            <button onClick={loadDir} title="Carregar pasta" className="p-1 rounded hover:bg-zinc-800 text-zinc-400 shrink-0">↵</button>
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <button onClick={() => fileRef.current?.click()} disabled={uploading}
              className="flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-200">
              {uploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />} enviar / arrastar
            </button>
            <span className="text-[10px] text-zinc-600">{scenes.length} cenas</span>
            <input ref={fileRef} type="file" accept="image/*" multiple className="hidden"
              onChange={(e) => { if (e.target.files) uploadFiles(e.target.files); e.target.value = ""; }} />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {scenes.map((s, i) => (
            <div key={s.name}
              className={["group w-full px-3 py-2 border-b border-zinc-900 hover:bg-zinc-900 transition-colors cursor-pointer", i === cur ? "bg-zinc-900" : ""].join(" ")}
              onClick={() => setCur(i)}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  {s.sceneKind && (
                    <span title={`tipo: ${KIND_STYLE[s.sceneKind].label}`}
                      className={["w-4 h-4 shrink-0 inline-flex items-center justify-center rounded text-[9px] font-bold border", KIND_STYLE[s.sceneKind].bg, KIND_STYLE[s.sceneKind].color].join(" ")}>{KIND_STYLE[s.sceneKind].tag}</span>
                  )}
                  <span className="text-xs truncate text-zinc-300">{s.name}</span>
                </div>
                <button onClick={(e) => { e.stopPropagation(); toggleIgnore(s.name, true); }}
                  title="Ignorar (não é cena)" className="opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-red-400 shrink-0"><Ban size={13} /></button>
              </div>
              <div className="text-[10px] mt-0.5 flex items-center gap-2">
                {badge(s)}
                {s.substrate && <span className="text-violet-400">{SUBSTRATES[s.substrate].label}</span>}
                {s.confidence != null && <span className="text-zinc-600">conf {(s.confidence * 100).toFixed(0)}%</span>}
              </div>
            </div>
          ))}

          {ignored.length > 0 && (
            <div className="p-3 border-t border-zinc-800 mt-1">
              <p className="text-[10px] uppercase tracking-wide text-zinc-600 mb-1">{ignored.length} ignoradas</p>
              {ignored.map((name) => (
                <div key={name} className="flex items-center justify-between gap-2 py-0.5">
                  <span className="text-[11px] text-zinc-600 truncate">{name}</span>
                  <button onClick={() => toggleIgnore(name, false)} title="Restaurar" className="text-zinc-600 hover:text-emerald-400 shrink-0"><RotateCcw size={12} /></button>
                </div>
              ))}
            </div>
          )}
        </div>
      </aside>

      {/* ── viewer + controles ── */}
      <main className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center gap-2 px-4 py-2 border-b border-zinc-800 text-xs">
          <button onClick={() => go(-1)} disabled={cur <= 0} className="p-1.5 rounded hover:bg-zinc-800 disabled:opacity-30"><ChevronLeft size={16} /></button>
          <span className="font-mono text-zinc-400 min-w-[3ch] text-center">{scenes.length ? cur + 1 : 0}/{scenes.length}</span>
          <button onClick={() => go(1)} disabled={cur >= scenes.length - 1} className="p-1.5 rounded hover:bg-zinc-800 disabled:opacity-30"><ChevronRight size={16} /></button>

          <span className="w-px h-4 bg-zinc-800 mx-1" />
          <button onClick={undo} title="Desfazer (Ctrl+Z)" className="p-1.5 rounded hover:bg-zinc-800 text-zinc-400"><RotateCcw size={14} /></button>
          <button onClick={redo} title="Refazer (Ctrl+Shift+Z)" className="p-1.5 rounded hover:bg-zinc-800 text-zinc-400 scale-x-[-1]"><RotateCcw size={14} /></button>
          <span className="w-px h-4 bg-zinc-800 mx-1" />
          <span className="text-zinc-300 truncate max-w-[180px]">{scene?.name ?? "—"}</span>
          {data && <span className="text-zinc-600 font-mono">{data.width}×{data.height} · conf {(data.confidence * 100).toFixed(0)}%</span>}

          {/* Chip da análise (placeholder + substrato) — base do smart preset. */}
          {data?.analysis && (() => {
            const k = KIND_STYLE[data.analysis.placeholder.kind];
            const subKind = data.substrate ?? data.analysis.substrate.kind;
            const subP = SUBSTRATES[subKind];
            const p = data.analysis.preset;
            const matches = data.method === p.method && data.surfaceType === subP.surfaceType && data.material === subP.material;
            return (
              <div className={["flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-[11px]", k.bg, k.color].join(" ")}
                title={`${data.analysis.placeholder.hint} · ${subP.hint}`}>
                <span className="font-mono font-semibold">{k.tag}</span>
                <span>{k.label}</span>
                <span className="text-zinc-700">•</span>
                <span className="text-zinc-200 font-medium">{subP.label}</span>
                <span className="text-zinc-500 uppercase text-[9px]">{subP.form}</span>
                <span className="text-zinc-600">{(data.analysis.substrate.confidence * 100).toFixed(0)}%</span>
                {!matches && (
                  <button onClick={applyPreset} className="ml-1 px-1.5 py-0.5 rounded bg-zinc-900/80 hover:bg-zinc-700 text-zinc-200">Aplicar preset</button>
                )}
              </div>
            );
          })()}

          {/* método de detecção */}
          {data && (
            <div className="flex items-center gap-0.5 bg-zinc-900 rounded-md p-0.5 ml-1">
              {METHODS.map((m) => (
                <button key={m.id} onClick={() => runDetect(m.id)}
                  className={["px-2 py-1 rounded text-[11px] transition-colors", data.method === m.id ? "bg-sky-600 text-white" : "text-zinc-400 hover:text-zinc-200"].join(" ")}>{m.label}</button>
              ))}
            </div>
          )}

          <div className="flex-1" />

          {/* surfaceType */}
          {data && (
            <div className="flex items-center gap-0.5 bg-zinc-900 rounded-md p-0.5">
              {SURFACE_TYPES.map((t) => (
                <button key={t} onClick={() => editData((d) => ({ ...d, surfaceType: t }))}
                  className={["px-2 py-1 rounded text-[11px] capitalize transition-colors", data.surfaceType === t ? "bg-emerald-600 text-white" : "text-zinc-400 hover:text-zinc-200"].join(" ")}>{t}</button>
              ))}
            </div>
          )}

          <button onClick={() => setOverlayOn((v) => !v)} title="Overlay magenta (O)" className={["p-1.5 rounded hover:bg-zinc-800", overlayOn ? "text-emerald-400" : "text-zinc-500"].join(" ")}>{overlayOn ? <Eye size={16} /> : <EyeOff size={16} />}</button>
          {engineMeta && (
            <span className="text-[10px] text-zinc-500 font-mono px-2 py-1 rounded bg-zinc-900 border border-zinc-800"
              title={`Engine pai (SSoT) — global v${engineMeta.global.version} • ${engineMeta.global.samples} amostras${engineMeta.global.meanIoU ? ` • IoU ${engineMeta.global.meanIoU.toFixed(3)}` : ""}`}>
              engine v{engineMeta.global.version}·{engineMeta.global.samples}
            </span>
          )}
          <button onClick={() => setUseAI((v) => !v)} title="Visant vision — análise mais precisa, ~1s + custo" className={["p-1.5 rounded hover:bg-zinc-800", useAI ? "text-purple-400" : "text-zinc-500"].join(" ")}><Sparkles size={16} /></button>
          <button onClick={toggleMesh} title="Malha / Warp envelope (W)" className={["p-1.5 rounded hover:bg-zinc-800", meshMode ? "text-lime-400" : "text-zinc-500"].join(" ")}><Grid3x3 size={16} /></button>
          <button onClick={toggleMask} title="Máscara (K) — pen / brush / wand / SAM" className={["p-1.5 rounded hover:bg-zinc-800", maskMode ? "text-cyan-400" : "text-zinc-500"].join(" ")}><Lasso size={16} /></button>
          <button onClick={() => { setDispMode((v) => !v); setMatMode(false); }} title="Displacement (D)" className={["p-1.5 rounded hover:bg-zinc-800", dispMode ? "text-orange-400" : "text-zinc-500"].join(" ")}><Mountain size={16} /></button>
          <button onClick={() => { setMatMode((v) => !v); setDispMode(false); }} title="Material / FX (M)" className={["p-1.5 rounded hover:bg-zinc-800", matMode ? "text-fuchsia-400" : "text-zinc-500"].join(" ")}><Shirt size={16} /></button>
          <button onClick={() => setRenderMode((v) => !v)} title="Render final ao vivo (F)" className={["p-1.5 rounded hover:bg-zinc-800", renderMode ? "text-cyan-400" : "text-zinc-500"].join(" ")}>{rendering ? <Loader2 size={15} className="animate-spin" /> : <Play size={16} />}</button>
          <button onClick={() => data && runDetect(data.method)} disabled={busy} title="Re-detectar (R)" className="p-1.5 rounded hover:bg-zinc-800 disabled:opacity-30"><RefreshCw size={15} className={busy ? "animate-spin" : ""} /></button>
          <button onClick={save} disabled={saving || !data} title="Salvar (S)" className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-40">
            {saving ? <Loader2 size={14} className="animate-spin" /> : dirty ? <Save size={14} /> : <CheckCircle2 size={14} />}{dirty ? "Salvar" : "Salvo"}
          </button>
          <span className="w-px h-4 bg-zinc-800 mx-1" />
          <AuthChip compact />
        </div>

        {/* painel malha */}
        {meshMode && data && (
          <div className="flex items-center gap-4 px-4 py-2 border-b border-zinc-800 bg-zinc-900/50 text-xs">
            <span className="text-lime-400 flex items-center gap-1"><Grid3x3 size={13} /> Malha (warp envelope)</span>
            <span className="text-zinc-400">densidade</span>
            <div className="flex items-center gap-0.5 bg-zinc-900 rounded-md p-0.5">
              {[2, 3, 4, 5].map((n) => (
                <button key={n} onClick={() => setMeshDensity(n)}
                  className={["px-2 py-1 rounded text-[11px] transition-colors", (data.mesh?.rows ?? 3) === n ? "bg-lime-600 text-white" : "text-zinc-400 hover:text-zinc-200"].join(" ")}>{n}×{n}</button>
              ))}
            </div>
            <button onClick={smoothMesh} title="Deriva hastes Bézier suaves dos vizinhos" className="px-2 py-1 rounded bg-lime-700 hover:bg-lime-600 text-white">Suavizar</button>
            <button onClick={straightenMesh} title="Zera as hastes (arestas retas)" className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300">Retas</button>
            <button onClick={() => autoCurveFromDisp(1)} title="Lê o relevo (displacement) e curva a malha de forma inteligente" className="px-2 py-1 rounded bg-orange-600 hover:bg-orange-500 text-white">Auto-curva ← disp</button>
            <button onClick={applySmartMesh} title="Gera malha pré-curvada (flat/slight/drape/cylinder) do substrato detectado" className="px-2 py-1 rounded bg-violet-600 hover:bg-violet-500 text-white">Smart mesh ← substrato</button>
            <button onClick={() => applyDepthMesh(24)} title="DepthAnything-V2 (se REPLICATE_API_TOKEN) → curva a malha pelo depth real" className="px-2 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white">Depth-mesh 3D</button>
            <button onClick={resetMesh} className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300">resetar grade</button>
            <span className="text-zinc-600">sel.: clique/Shift · haste: arraste (Alt=quebra, Ctrl=simetria) · âncora: Alt=canto, Ctrl=reset · setas movem, Del zera</span>
          </div>
        )}

        {/* Painel substrato — top-N candidatos + override manual */}
        {data?.analysis && (
          <div className="flex items-center gap-2 px-4 py-2 border-b border-zinc-800 bg-zinc-900/40 text-xs overflow-x-auto">
            <span className="text-violet-300 shrink-0">Substrato</span>
            {data.analysis.substrate.candidates.slice(0, 5).map((c) => {
              const sp = SUBSTRATES[c.kind];
              const active = (data.substrate ?? data.analysis!.substrate.kind) === c.kind;
              return (
                <button key={c.kind} onClick={() => setSubstrate(c.kind)}
                  title={`${sp.hint}${c.reasons.length ? ` · ${c.reasons.join(", ")}` : ""}`}
                  className={["shrink-0 px-2 py-1 rounded text-[11px] transition-colors flex items-center gap-1", active ? "bg-violet-600 text-white" : "bg-zinc-800 hover:bg-zinc-700 text-zinc-300"].join(" ")}>
                  {sp.label}
                  <span className={active ? "text-violet-200" : "text-zinc-500"}>{(c.score * 100).toFixed(0)}</span>
                </button>
              );
            })}
            <span className="w-px h-4 bg-zinc-800 mx-1 shrink-0" />
            <select value={data.substrate ?? data.analysis.substrate.kind}
              onChange={(e) => setSubstrate(e.target.value as SubstrateKind)}
              className="shrink-0 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-zinc-300">
              {SUBSTRATE_KEYS.map((k) => <option key={k} value={k}>{SUBSTRATES[k].label}</option>)}
            </select>
          </div>
        )}

        {/* AI vision result — descrição + tags + provider. */}
        {data?.analysis?.ai && (
          <div className="flex items-center gap-2 px-4 py-1.5 border-b border-zinc-800 bg-purple-950/20 text-[11px] overflow-x-auto">
            <Sparkles size={12} className="text-purple-400 shrink-0" />
            <span className="text-purple-300 shrink-0">{data.analysis.ai.provider}</span>
            <span className="text-zinc-300 truncate">{data.analysis.ai.description}</span>
            {data.analysis.ai.attributes.slice(0, 6).map((a) => (
              <span key={a} className="shrink-0 px-1.5 py-0.5 rounded bg-zinc-800/80 text-zinc-400">{a}</span>
            ))}
          </div>
        )}

        {/* painel displacement */}
        {dispMode && data && (
          <div className="flex items-center gap-4 px-4 py-2 border-b border-zinc-800 bg-zinc-900/50 text-xs">
            <span className="text-orange-400 flex items-center gap-1"><Mountain size={13} /> Displacement</span>
            <label className="flex items-center gap-2 text-zinc-400">amplitude
              <input type="range" min={0} max={20} step={1} value={data.dispScale}
                onChange={(e) => editData((d) => ({ ...d, dispScale: +e.target.value }))} />
              <span className="font-mono text-zinc-300 w-6">{data.dispScale}</span>
            </label>
            <label className="flex items-center gap-2 text-zinc-400">suavização (blur)
              <input type="range" min={0} max={30} step={1} value={data.dispBlur}
                onChange={(e) => editData((d) => ({ ...d, dispBlur: +e.target.value }))} />
              <span className="font-mono text-zinc-300 w-6">{data.dispBlur}</span>
            </label>
            <button onClick={refreshDisp} className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300">atualizar preview</button>
            <span className="text-zinc-600">mapa de relevo sobreposto (blend screen)</span>
          </div>
        )}

        {/* painel material/FX */}
        {matMode && data && (
          <div className="flex items-center gap-4 px-4 py-2 border-b border-zinc-800 bg-zinc-900/50 text-xs flex-wrap">
            <span className="text-fuchsia-400 flex items-center gap-1"><Shirt size={13} /> Material</span>
            <div className="flex items-center gap-0.5 bg-zinc-900 rounded-md p-0.5">
              {MATERIALS.map((m) => (
                <button key={m.id} onClick={() => editData((d) => ({ ...d, material: m.id }))}
                  className={["px-2 py-1 rounded text-[11px] transition-colors", data.material === m.id ? "bg-fuchsia-600 text-white" : "text-zinc-400 hover:text-zinc-200"].join(" ")}>{m.label}</button>
              ))}
            </div>
            <label className="flex items-center gap-2 text-zinc-400">força
              <input type="range" min={0} max={1} step={0.05} value={data.materialIntensity}
                onChange={(e) => editData((d) => ({ ...d, materialIntensity: +e.target.value }))} disabled={data.material === "none"} />
              <span className="font-mono text-zinc-300 w-8">{data.materialIntensity.toFixed(2)}</span>
            </label>
            <label className="flex items-center gap-2 text-zinc-400">ângulo
              <input type="range" min={0} max={180} step={5} value={data.materialAngle}
                onChange={(e) => editData((d) => ({ ...d, materialAngle: +e.target.value }))} disabled={data.material === "none"} />
              <span className="font-mono text-zinc-300 w-8">{data.materialAngle}°</span>
            </label>
            <label className="flex items-center gap-2 text-zinc-400">escala
              <input type="range" min={2} max={20} step={1} value={data.materialScale}
                onChange={(e) => editData((d) => ({ ...d, materialScale: +e.target.value }))} disabled={data.material === "none"} />
              <span className="font-mono text-zinc-300 w-6">{data.materialScale}</span>
            </label>
            <span className="text-zinc-600">procedural · blend {matBlend}</span>
          </div>
        )}

        {/* painel render final */}
        {renderMode && data && (
          <div className="flex items-center gap-4 px-4 py-2 border-b border-zinc-800 bg-zinc-900/50 text-xs">
            <span className="text-cyan-400 flex items-center gap-1"><Play size={13} /> Render final</span>
            <div className="flex items-center gap-0.5 bg-zinc-900 rounded-md p-0.5">
              {(["grid", "poster", "checker"] as const).map((k) => (
                <button key={k} onClick={() => setArtKind(k)}
                  className={["px-2 py-1 rounded text-[11px] capitalize transition-colors", artKind === k ? "bg-cyan-600 text-white" : "text-zinc-400 hover:text-zinc-200"].join(" ")}>{k}</button>
              ))}
            </div>
            <button onClick={() => refreshRender(false)} disabled={rendering} className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 disabled:opacity-40">{rendering ? "renderizando…" : "re-renderizar"}</button>
            <button onClick={() => refreshRender(true)} disabled={rendering} title="Render idêntico ao final (SSAA, full-res) — mais lento" className="px-2 py-1 rounded bg-cyan-700 hover:bg-cyan-600 text-white disabled:opacity-40">HD</button>
            <span className="text-zinc-600">arte-teste warpada com quad+luz+displacement+material</span>
          </div>
        )}

        {err &&<div className="px-4 py-2 text-xs text-red-400 bg-red-950/40 border-b border-red-900">{err}</div>}

        <div ref={viewerRef} className="flex-1 min-h-0 relative">
          {busy && <div className="absolute inset-0 z-30 flex items-center justify-center bg-zinc-950/50"><Loader2 className="animate-spin text-zinc-400" /></div>}
          {scene && data && viewSize.w > 0 && maskMode && (
            <MaskCalibrate imageUrl={scene.url} imageW={data.width} imageH={data.height}
              mask={maskUrl} onMaskChange={(m) => { setMaskUrl(m); setDirty(true); }} />
          )}
          {scene && data && viewSize.w > 0 && !maskMode && (
            <CalibrateStage
              width={viewSize.w} height={viewSize.h} imageNW={data.width} imageNH={data.height}
              baseUrl={renderMode && renderUrl ? renderUrl : scene.url}
              overlay={
                renderMode || meshMode ? undefined
                : matMode && matUrl ? { url: matUrl, opacity: 0.85, blend: matBlend }
                : dispMode && dispUrl ? { url: dispUrl, opacity: 0.75, blend: "screen" }
                : overlayOn ? { url: `/api/calibrate/overlay?name=${encodeURIComponent(scene.name)}${qstr(dir)}`, opacity: 1 }
                : undefined
              }
              mode={meshMode ? "mesh" : "cantos"}
              quad={data.quad} onQuadChange={(q) => editData((d) => ({ ...d, quad: q }))}
              mesh={data.mesh} onMeshChange={(mm) => editData((d) => ({ ...d, mesh: mm }))}
            />
          )}
          {!scene && !err && <div className="flex items-center justify-center h-full text-zinc-600 text-sm">Pasta vazia ou nenhuma cena. Cole um caminho ou arraste imagens.</div>}
        </div>
      </main>
    </div>
  );
}
