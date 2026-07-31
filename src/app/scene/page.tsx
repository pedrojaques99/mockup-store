"use client";

import { Select } from "@/components/ui/Select";
import { useState, useCallback, useRef } from "react";
import type { SceneDoc } from "@visant/psd-engine";
import { Upload, ImageIcon, Loader2, AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────

interface PsdEntry {
  name: string;
  folder: string;
  path: string;
  sizeMB: number;
}

type StepState = "idle" | "loading" | "done" | "error";

// ── helpers ──────────────────────────────────────────────────────────────────

async function fetchJson<T>(url: string, opts?: RequestInit): Promise<T> {
  const r = await fetch(url, opts);
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error((j as any).error ?? `HTTP ${r.status}`);
  }
  return r.json();
}

function toBase64(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result as string);
    fr.onerror = rej;
    fr.readAsDataURL(file);
  });
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StepBadge({ step, state }: { step: number; state: StepState }) {
  return (
    <span
      className={[
        "flex-none w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold",
        state === "done" ? "bg-green-500 text-white" :
        state === "loading" ? "bg-blue-500 text-white animate-pulse" :
        state === "error" ? "bg-red-500 text-white" :
        "bg-zinc-700 text-zinc-400",
      ].join(" ")}
    >
      {state === "done" ? <CheckCircle2 size={14} /> :
       state === "loading" ? <Loader2 size={14} className="animate-spin" /> :
       state === "error" ? <AlertTriangle size={14} /> :
       step}
    </span>
  );
}

function DropZone({
  onFile,
  label,
  accept,
  preview,
}: {
  onFile: (f: File) => void;
  label: string;
  accept: string;
  preview?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const f = e.dataTransfer.files[0];
      if (f) onFile(f);
    },
    [onFile]
  );

  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      className={[
        "relative flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed cursor-pointer transition-colors min-h-[120px]",
        dragging ? "border-blue-400 bg-blue-500/10" : "border-zinc-700 hover:border-zinc-500",
      ].join(" ")}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}
      />
      {preview ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={preview} alt="art preview" className="max-h-24 max-w-full rounded object-contain" />
      ) : (
        <>
          <Upload size={24} className="text-zinc-500" />
          <span className="text-sm text-zinc-400">{label}</span>
        </>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ScenePage() {
  // Step 1: pick PSD
  const [psds, setPsds] = useState<PsdEntry[]>([]);
  const [psdsLoaded, setPsdsLoaded] = useState(false);
  const [psdPath, setPsdPath] = useState("");
  const [psdSearch, setPsdSearch] = useState("");

  // Step 2: extract scene
  const [extractState, setExtractState] = useState<StepState>("idle");
  const [sceneId, setSceneId] = useState<string | null>(null);
  const [sceneDoc, setSceneDoc] = useState<SceneDoc | null>(null);
  const [extractError, setExtractError] = useState("");
  const [cached, setCached] = useState(false);

  // Step 3: pick art + face
  const [artBase64, setArtBase64] = useState<string | null>(null);
  const [artPreview, setArtPreview] = useState<string | null>(null);
  const [faceKey, setFaceKey] = useState<string>("");

  // Step 4: render
  const [renderState, setRenderState] = useState<StepState>("idle");
  const [renderUrl, setRenderUrl] = useState<string | null>(null);
  const [renderError, setRenderError] = useState("");
  const [renderMs, setRenderMs] = useState<number | null>(null);

  // ── Step 1: load PSD list ──────────────────────────────────────────────────

  const loadPsds = useCallback(async () => {
    if (psdsLoaded) return;
    const data = await fetchJson<{ psds: PsdEntry[] }>("/api/psds");
    setPsds(data.psds);
    setPsdsLoaded(true);
  }, [psdsLoaded]);

  const filteredPsds = psds.filter(
    (p) =>
      !psdSearch ||
      p.name.toLowerCase().includes(psdSearch.toLowerCase()) ||
      p.folder.toLowerCase().includes(psdSearch.toLowerCase())
  );

  // ── Step 2: extract ───────────────────────────────────────────────────────

  const handleExtract = useCallback(async () => {
    if (!psdPath) return;
    setExtractState("loading");
    setExtractError("");
    setSceneId(null);
    setSceneDoc(null);
    setRenderUrl(null);

    try {
      const data = await fetchJson<{ sceneId: string; doc: SceneDoc; cached: boolean }>(
        "/api/scene/extract",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ psdPath }),
        }
      );
      setSceneId(data.sceneId);
      setSceneDoc(data.doc);
      setCached(data.cached);
      setFaceKey(data.doc.faces[0]?.key ?? "");
      setExtractState("done");
    } catch (err: any) {
      setExtractError(err.message);
      setExtractState("error");
    }
  }, [psdPath]);

  // ── Step 3: pick art ──────────────────────────────────────────────────────

  const handleArtFile = useCallback(async (file: File) => {
    const b64 = await toBase64(file);
    setArtBase64(b64);
    setArtPreview(b64);
    setRenderUrl(null);
  }, []);

  // ── Step 4: render ────────────────────────────────────────────────────────

  const handleRender = useCallback(async () => {
    if (!sceneId || !artBase64) return;
    setRenderState("loading");
    setRenderError("");
    setRenderUrl(null);

    const t0 = Date.now();
    try {
      const res = await fetch(`/api/scene/${sceneId}/render`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ artBase64, faceKey: faceKey || undefined }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error((j as any).error ?? `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      setRenderUrl(URL.createObjectURL(blob));
      setRenderMs(Date.now() - t0);
      setRenderState("done");
    } catch (err: any) {
      setRenderError(err.message);
      setRenderState("error");
    }
  }, [sceneId, artBase64, faceKey]);

  // ── UI ────────────────────────────────────────────────────────────────────

  const step1State: StepState = psdPath ? "done" : "idle";
  const step2State: StepState = extractState;
  const step3State: StepState = artBase64 ? "done" : "idle";
  const step4State: StepState = renderState;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-6">
      <div className="max-w-3xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold">Scene Pipeline</h1>
          <p className="text-zinc-400 text-sm mt-1">
            Upload art → render into any mockup without a full PSD parse
          </p>
        </div>

        {/* Step 1 — Pick PSD */}
        <section className="bg-zinc-900 rounded-2xl p-5 space-y-4">
          <div className="flex items-center gap-3">
            <StepBadge step={1} state={step1State} />
            <h2 className="font-semibold text-base">Select PSD</h2>
          </div>

          <button
            onClick={loadPsds}
            disabled={psdsLoaded}
            className="text-sm text-blue-400 hover:text-blue-300 disabled:text-zinc-600"
          >
            {psdsLoaded ? `${psds.length} PSDs loaded` : "Load available PSDs →"}
          </button>

          {psdsLoaded && (
            <>
              <input
                type="text"
                placeholder="Search by name or folder…"
                value={psdSearch}
                onChange={(e) => setPsdSearch(e.target.value)}
                className="w-full bg-zinc-800 rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-blue-500"
              />
              <div className="max-h-48 overflow-y-auto space-y-1">
                {filteredPsds.slice(0, 100).map((p) => (
                  <button
                    key={p.path}
                    onClick={() => { setPsdPath(p.path); setExtractState("idle"); setSceneId(null); setSceneDoc(null); setRenderUrl(null); }}
                    className={[
                      "w-full text-left px-3 py-2 rounded-lg text-sm flex items-center justify-between gap-2 transition-colors",
                      psdPath === p.path
                        ? "bg-blue-600 text-white"
                        : "hover:bg-zinc-800 text-zinc-300",
                    ].join(" ")}
                  >
                    <span className="truncate">{p.folder ? `${p.folder} / ` : ""}<strong>{p.name}</strong></span>
                    <span className="flex-none text-xs text-zinc-400">{p.sizeMB} MB</span>
                  </button>
                ))}
                {filteredPsds.length === 0 && (
                  <p className="text-zinc-500 text-sm px-2">No PSDs match</p>
                )}
              </div>
            </>
          )}

          {psdPath && (
            <p className="text-xs text-zinc-500 truncate">{psdPath}</p>
          )}
        </section>

        {/* Step 2 — Extract Scene */}
        <section className="bg-zinc-900 rounded-2xl p-5 space-y-4">
          <div className="flex items-center gap-3">
            <StepBadge step={2} state={step2State} />
            <h2 className="font-semibold text-base">Extract Scene</h2>
            {cached && sceneId && (
              <span className="text-xs text-green-400 bg-green-400/10 px-2 py-0.5 rounded-full">cached</span>
            )}
          </div>

          <button
            onClick={handleExtract}
            disabled={!psdPath || extractState === "loading"}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-sm font-medium transition-colors flex items-center gap-2"
          >
            {extractState === "loading" && <Loader2 size={14} className="animate-spin" />}
            {extractState === "loading" ? "Extracting…" : "Extract Scene Package"}
          </button>

          {extractError && (
            <p className="text-red-400 text-sm flex items-center gap-2">
              <AlertTriangle size={14} /> {extractError}
            </p>
          )}

          {sceneDoc && sceneId && (
            <div className="bg-zinc-800 rounded-xl p-4 space-y-2">
              <p className="text-xs text-zinc-400">Scene ID: <code className="text-blue-300">{sceneId}</code></p>
              <p className="text-xs text-zinc-400">{sceneDoc.width}×{sceneDoc.height}px · {sceneDoc.layers.length} layer(s)</p>
              <div className="space-y-1">
                {sceneDoc.faces.map((f) => (
                  <div key={f.key} className="flex items-center gap-2 text-xs">
                    <ImageIcon size={12} className="text-zinc-500" />
                    <span className="text-zinc-300">{f.name}</span>
                    <span className="text-zinc-500">[{f.key}]</span>
                    <span className="text-zinc-500">{f.innerW}×{f.innerH}</span>
                    {f.quad && <span className="text-green-400">✓ quad</span>}
                    {f.maskRef && <span className="text-yellow-400">mask</span>}
                  </div>
                ))}
              </div>
              {sceneDoc.warnings.length > 0 && (
                <div className="mt-2 space-y-1">
                  {sceneDoc.warnings.map((w, i) => (
                    <p key={i} className="text-yellow-400 text-xs flex items-center gap-1">
                      <AlertTriangle size={11} /> {w}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>

        {/* Step 3 — Upload Art + pick face */}
        <section className={["bg-zinc-900 rounded-2xl p-5 space-y-4 transition-opacity", !sceneDoc ? "opacity-40 pointer-events-none" : ""].join(" ")}>
          <div className="flex items-center gap-3">
            <StepBadge step={3} state={step3State} />
            <h2 className="font-semibold text-base">Upload Art</h2>
          </div>

          <DropZone
            onFile={handleArtFile}
            label="Drop image here or click to browse"
            accept="image/*"
            preview={artPreview ?? undefined}
          />

          {sceneDoc && sceneDoc.faces.length > 1 && (
            <div className="space-y-1">
              <label className="text-xs text-zinc-400">Target face</label>
              <Select skin="zinc" boxed ariaLabel="Target face" className="w-full"
                value={faceKey || "__all"}
                onChange={(v) => setFaceKey(v === "__all" ? "" : v)}
                options={[
                  { value: "__all", label: "All faces" },
                  ...sceneDoc.faces.map((f) => ({ value: f.key, label: `${f.name} (${f.innerW}×${f.innerH})` })),
                ]} />
            </div>
          )}
        </section>

        {/* Step 4 — Render */}
        <section className={["bg-zinc-900 rounded-2xl p-5 space-y-4 transition-opacity", (!sceneDoc || !artBase64) ? "opacity-40 pointer-events-none" : ""].join(" ")}>
          <div className="flex items-center gap-3">
            <StepBadge step={4} state={step4State} />
            <h2 className="font-semibold text-base">Render Mockup</h2>
            {renderMs && renderState === "done" && (
              <span className="text-xs text-zinc-400">{(renderMs / 1000).toFixed(1)}s</span>
            )}
          </div>

          <button
            onClick={handleRender}
            disabled={!sceneDoc || !artBase64 || renderState === "loading"}
            className="px-4 py-2 rounded-lg bg-green-600 hover:bg-green-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-sm font-medium transition-colors flex items-center gap-2"
          >
            {renderState === "loading" && <Loader2 size={14} className="animate-spin" />}
            {renderState === "loading" ? "Rendering…" : "Render Scene"}
          </button>

          {renderError && (
            <p className="text-red-400 text-sm flex items-center gap-2">
              <AlertTriangle size={14} /> {renderError}
            </p>
          )}

          {renderUrl && (
            <div className="space-y-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={renderUrl}
                alt="rendered mockup"
                className="w-full rounded-xl border border-zinc-800 object-contain max-h-[600px]"
              />
              <div className="flex gap-3">
                <a
                  href={renderUrl}
                  download="scene-render.png"
                  className="px-3 py-1.5 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-sm transition-colors"
                >
                  Download PNG
                </a>
                <button
                  onClick={handleRender}
                  className="px-3 py-1.5 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-sm transition-colors flex items-center gap-1"
                >
                  <RefreshCw size={12} /> Re-render
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
