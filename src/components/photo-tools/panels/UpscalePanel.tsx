"use client";

/** UpscalePanel — aumenta foto ou arte. Bicubic (local, grátis) ou IA (Visant, crédito). */
import { ZoomIn, Loader2, Sparkles } from "lucide-react";
import { Segmented } from "@/components/ui/Segmented";

export type UpscaleTarget = "photo" | "art";
export type UpscaleMode = "bicubic" | "pruna" | "google" | "ai";

const METHOD_META: Record<UpscaleMode, { label: string; hint: string; factorBased: boolean }> = {
  bicubic: { label: "Rápido",  hint: "Reamostragem local — grátis, sem inventar detalhe.", factorBased: true },
  pruna:   { label: "Turbo",   hint: "Upscale por IA, rápido — até 128 MP.", factorBased: true },
  google:  { label: "Nítido",  hint: "IA com mais detalhe — 2× ou 4×.", factorBased: true },
  ai:      { label: "Visant",  hint: "Máxima qualidade — usa créditos da conta.", factorBased: false },
};

export function UpscalePanel({
  target,
  setTarget,
  mode,
  setMode,
  factor,
  setFactor,
  size,
  setSize,
  currentDims,
  hasArt,
  onApply,
  applying,
  err,
}: {
  target: UpscaleTarget;
  setTarget: (t: UpscaleTarget) => void;
  mode: UpscaleMode;
  setMode: (m: UpscaleMode) => void;
  factor: number;
  setFactor: (f: number) => void;
  size: "1K" | "2K" | "4K";
  setSize: (s: "1K" | "2K" | "4K") => void;
  currentDims: { w: number; h: number } | null;
  hasArt: boolean;
  onApply: () => void;
  applying: boolean;
  err?: string;
}) {
  const targetDisabled = target === "art" && !hasArt;
  return (
    <div className="space-y-2 bg-zinc-800/40 rounded-xl border border-zinc-700/40 p-2">
      <p className="text-[9px] uppercase tracking-wider text-zinc-600">Aumentar resolução</p>

      <div className="space-y-0.5">
        <label className="text-[10px] text-zinc-400">Alvo</label>
        <Segmented<UpscaleTarget>
          value={target}
          onChange={setTarget}
          options={[
            { value: "photo", label: "Foto" },
            { value: "art", label: hasArt ? "Arte" : "Arte (vazio)" },
          ]}
        />
      </div>

      <div className="space-y-0.5">
        <label className="text-[10px] text-zinc-400">Método</label>
        <Segmented<UpscaleMode>
          value={mode}
          onChange={setMode}
          options={(["bicubic", "pruna", "google", "ai"] as UpscaleMode[]).map((m) => ({ value: m, label: METHOD_META[m].label }))}
        />
      </div>

      <div className="space-y-0.5">
        <label className="text-[10px] text-zinc-400">{METHOD_META[mode].factorBased ? "Escala" : "Tamanho"}</label>
        {METHOD_META[mode].factorBased ? (
          <Segmented<string>
            value={String(factor)}
            onChange={(v) => setFactor(Number(v))}
            options={[
              { value: "2", label: "2×" },
              { value: "4", label: "4×" },
            ]}
          />
        ) : (
          <Segmented<"1K" | "2K" | "4K">
            value={size}
            onChange={setSize}
            options={[
              { value: "1K", label: "1K" },
              { value: "2K", label: "2K" },
              { value: "4K", label: "4K" },
            ]}
          />
        )}
      </div>

      {currentDims && (
        <p className="text-[10px] text-zinc-600">
          Atual: {currentDims.w}×{currentDims.h}px
          {METHOD_META[mode].factorBased && mode !== "google" && ` → ${currentDims.w * factor}×${currentDims.h * factor}px`}
          {mode === "google" && " → resolução máxima do método"}
        </p>
      )}

      <button
        type="button"
        onClick={onApply}
        disabled={applying || targetDisabled}
        className="w-full py-2 rounded-xl text-xs font-medium transition-colors flex items-center justify-center gap-1.5 bg-acc2 text-zinc-950 hover:bg-acc2/90 disabled:opacity-40"
      >
        {applying ? (
          <><Loader2 size={12} className="animate-spin" /> Aumentando…</>
        ) : mode === "bicubic" ? (
          <><ZoomIn size={12} /> Aumentar</>
        ) : (
          <><Sparkles size={12} /> Aumentar ({METHOD_META[mode].label})</>
        )}
      </button>

      <p className="text-[10px] text-acc/80">{METHOD_META[mode].hint}</p>
      {err && <p className="text-[10px] text-red-400">{err}</p>}
    </div>
  );
}
