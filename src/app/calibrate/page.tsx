"use client";

/**
 * /calibrate — rota de calibração de superfície (key color magenta).
 *
 * Loop human-in-the-loop: lista as cenas de Render/New Mockups, roda o detector
 * unificado, mostra o quad + overlay dos pixels detectados, você encaixa com as
 * alças (lupa 5× do QuadEditor) e salva no golden quads.json. O store guarda
 * auto+manual+IoU → aposenta o OVERRIDE_QUADS hardcoded.
 *
 * Atalhos: S salva · ←/→ navega · O liga/desliga overlay · R re-detecta.
 */
import { useCallback, useEffect, useState } from "react";
import { Loader2, Save, ChevronLeft, ChevronRight, RefreshCw, Eye, EyeOff, CheckCircle2 } from "lucide-react";
import ZoomPanViewer from "@/components/ZoomPanViewer";
import { QuadEditor } from "@/components/photo-tools/QuadEditor";
import type { Quad } from "@/stores/editorDoc";

interface Scene {
  name: string; width: number; height: number; url: string;
  status: "manual" | "auto" | "unsaved"; confidence?: number; iou?: number; surfaceType?: string;
}
interface SceneData {
  quad: Quad; auto: Quad | null; hue: number; confidence: number;
  detectorVersion?: number; width: number; height: number; surfaceType: string;
}

const SURFACE_TYPES = ["billboard", "poster", "card", "wall", "sign", "other"] as const;

const centeredQuad = (w: number, h: number): Quad => ({
  tl: { x: Math.round(w * 0.2), y: Math.round(h * 0.2) },
  tr: { x: Math.round(w * 0.8), y: Math.round(h * 0.2) },
  br: { x: Math.round(w * 0.8), y: Math.round(h * 0.8) },
  bl: { x: Math.round(w * 0.2), y: Math.round(h * 0.8) },
});

export default function CalibratePage() {
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [cur, setCur] = useState(-1);
  const [data, setData] = useState<SceneData | null>(null);
  const [overlayOn, setOverlayOn] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const scene = cur >= 0 ? scenes[cur] : null;

  // ── carga inicial ───────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/calibrate/scenes");
        const j = await r.json();
        if (j.error) { setErr(j.error); return; }
        setScenes(j.scenes);
        if (j.scenes.length) setCur(0);
      } catch (e: any) { setErr(e.message); }
    })();
  }, []);

  const loadScene = useCallback(async (i: number) => {
    const s = scenes[i];
    if (!s) return;
    setBusy(true); setErr(null); setData(null);
    try {
      const r = await fetch("/api/calibrate/detect", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: s.name }),
      });
      const j = await r.json();
      const width = j.width || s.width, height = j.height || s.height;
      const auto: Quad | null = j.quad ?? null;
      const saved: Quad | null = j.saved?.quad ?? null;
      setData({
        quad: saved ?? auto ?? centeredQuad(width, height),
        auto,
        hue: j.hue ?? -1,
        confidence: j.confidence ?? 0,
        detectorVersion: j.detectorVersion,
        width, height,
        surfaceType: j.saved?.surfaceType ?? s.surfaceType ?? "billboard",
      });
      setDirty(false);
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }, [scenes]);

  useEffect(() => { if (cur >= 0 && scenes[cur]) loadScene(cur); }, [cur, scenes, loadScene]);

  const reDetect = useCallback(async () => {
    if (!scene || !data) return;
    setBusy(true);
    try {
      const r = await fetch("/api/calibrate/detect", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: scene.name }),
      });
      const j = await r.json();
      if (j.quad) {
        setData((d) => d && ({ ...d, quad: j.quad, auto: j.quad, hue: j.hue, confidence: j.confidence, detectorVersion: j.detectorVersion }));
        setDirty(true);
      }
    } finally { setBusy(false); }
  }, [scene, data]);

  const save = useCallback(async () => {
    if (!scene || !data) return;
    setSaving(true); setErr(null);
    try {
      const r = await fetch("/api/calibrate/save", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: scene.name, quad: data.quad, auto: data.auto,
          surfaceType: data.surfaceType, hue: data.hue,
          confidence: data.confidence, detectorVersion: data.detectorVersion,
        }),
      });
      const j = await r.json();
      if (j.error) { setErr(j.error); return; }
      setScenes((ss) => ss.map((s, i) => i === cur ? { ...s, status: "manual", iou: j.saved?.iou, surfaceType: data.surfaceType } : s));
      setDirty(false);
    } catch (e: any) { setErr(e.message); }
    finally { setSaving(false); }
  }, [scene, data, cur]);

  const go = useCallback((d: number) => {
    setCur((c) => Math.max(0, Math.min(scenes.length - 1, c + d)));
  }, [scenes.length]);

  // ── atalhos ─────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "s" || e.key === "S") { e.preventDefault(); save(); }
      else if (e.key === "ArrowRight") { e.preventDefault(); go(1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); }
      else if (e.key === "o" || e.key === "O") { setOverlayOn((v) => !v); }
      else if (e.key === "r" || e.key === "R") { reDetect(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save, go, reDetect]);

  const badge = (s: Scene) =>
    s.status === "manual" ? <span className="text-emerald-400">✓ {s.iou != null ? `IoU ${(s.iou * 100).toFixed(0)}%` : "salvo"}</span>
    : s.status === "auto" ? <span className="text-amber-400">auto</span>
    : <span className="text-zinc-500">novo</span>;

  return (
    <div className="flex h-screen bg-zinc-950 text-zinc-200">
      {/* ── fila de cenas ── */}
      <aside className="w-64 shrink-0 border-r border-zinc-800 overflow-y-auto">
        <div className="p-3 border-b border-zinc-800">
          <h1 className="text-sm font-semibold text-zinc-100">Calibração de superfície</h1>
          <p className="text-[11px] text-zinc-500 mt-0.5">{scenes.length} cenas · ordenadas por triagem</p>
        </div>
        {scenes.map((s, i) => (
          <button key={s.name} onClick={() => setCur(i)}
            className={["w-full text-left px-3 py-2 border-b border-zinc-900 hover:bg-zinc-900 transition-colors",
              i === cur ? "bg-zinc-900" : ""].join(" ")}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs truncate text-zinc-300">{s.name}</span>
            </div>
            <div className="text-[10px] mt-0.5 flex items-center gap-2">
              {badge(s)}
              {s.confidence != null && <span className="text-zinc-600">conf {(s.confidence * 100).toFixed(0)}%</span>}
            </div>
          </button>
        ))}
      </aside>

      {/* ── viewer + controles ── */}
      <main className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center gap-2 px-4 py-2 border-b border-zinc-800 text-xs">
          <button onClick={() => go(-1)} disabled={cur <= 0} className="p-1.5 rounded hover:bg-zinc-800 disabled:opacity-30"><ChevronLeft size={16} /></button>
          <span className="font-mono text-zinc-400 min-w-[3ch] text-center">{scenes.length ? cur + 1 : 0}/{scenes.length}</span>
          <button onClick={() => go(1)} disabled={cur >= scenes.length - 1} className="p-1.5 rounded hover:bg-zinc-800 disabled:opacity-30"><ChevronRight size={16} /></button>

          <span className="w-px h-4 bg-zinc-800 mx-1" />
          <span className="text-zinc-300 truncate">{scene?.name ?? "—"}</span>
          {data && <span className="text-zinc-600 font-mono">{data.width}×{data.height} · hue {data.hue < 0 ? "—" : `${Math.round(data.hue)}°`} · conf {(data.confidence * 100).toFixed(0)}%</span>}

          <div className="flex-1" />

          {/* surfaceType */}
          <div className="flex items-center gap-0.5 bg-zinc-900 rounded-md p-0.5">
            {SURFACE_TYPES.map((t) => (
              <button key={t} onClick={() => { if (data) { setData({ ...data, surfaceType: t }); setDirty(true); } }}
                className={["px-2 py-1 rounded text-[11px] capitalize transition-colors",
                  data?.surfaceType === t ? "bg-emerald-600 text-white" : "text-zinc-400 hover:text-zinc-200"].join(" ")}>
                {t}
              </button>
            ))}
          </div>

          <button onClick={() => setOverlayOn((v) => !v)} title="Overlay magenta (O)"
            className={["p-1.5 rounded hover:bg-zinc-800", overlayOn ? "text-emerald-400" : "text-zinc-500"].join(" ")}>
            {overlayOn ? <Eye size={16} /> : <EyeOff size={16} />}
          </button>
          <button onClick={reDetect} disabled={busy} title="Re-detectar (R)" className="p-1.5 rounded hover:bg-zinc-800 disabled:opacity-30">
            <RefreshCw size={15} className={busy ? "animate-spin" : ""} />
          </button>
          <button onClick={save} disabled={saving || !data} title="Salvar (S)"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-40">
            {saving ? <Loader2 size={14} className="animate-spin" /> : dirty ? <Save size={14} /> : <CheckCircle2 size={14} />}
            {dirty ? "Salvar" : "Salvo"}
          </button>
        </div>

        {err && <div className="px-4 py-2 text-xs text-red-400 bg-red-950/40 border-b border-red-900">{err}</div>}

        <div className="flex-1 min-h-0 relative">
          {busy && <div className="absolute inset-0 z-30 flex items-center justify-center bg-zinc-950/50"><Loader2 className="animate-spin text-zinc-400" /></div>}
          {scene && data && (
            <ZoomPanViewer requireSpaceToPan dims={{ w: data.width, h: data.height }} minimapSrc={scene.url}>
              <div style={{ maxWidth: "calc(100vw - 280px)", position: "relative", display: "inline-block", lineHeight: 0 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={scene.url} alt={scene.name} className="w-full block" draggable={false} />
                {overlayOn && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/api/calibrate/overlay?name=${encodeURIComponent(scene.name)}`} alt="" aria-hidden
                    className="absolute inset-0 w-full h-full pointer-events-none" draggable={false} />
                )}
                <div className="absolute inset-0">
                  <QuadEditor transparentImg imageUrl={scene.url} imageNW={data.width} imageNH={data.height}
                    quad={data.quad} onQuadChange={(q) => { setData((d) => d && ({ ...d, quad: q })); setDirty(true); }} />
                </div>
              </div>
            </ZoomPanViewer>
          )}
          {!scene && !err && <div className="flex items-center justify-center h-full text-zinc-600 text-sm">Nenhuma cena.</div>}
        </div>
      </main>
    </div>
  );
}
