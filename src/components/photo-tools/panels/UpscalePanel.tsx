"use client";

/** UpscalePanel — aumenta foto ou arte. Bicubic (local, grátis) ou IA (Visant, crédito). */
import { ZoomIn, Loader2, Sparkles } from "lucide-react";
import { Segmented } from "@/components/ui/Segmented";

export type UpscaleTarget = "photo" | "art";
export type UpscaleMode = "bicubic" | "ai";

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
          options={[
            { value: "bicubic", label: "Bicubic" },
            { value: "ai", label: "IA · crédito" },
          ]}
        />
      </div>

      <div className="space-y-0.5">
        <label className="text-[10px] text-zinc-400">{mode === "bicubic" ? "Escala" : "Tamanho"}</label>
        {mode === "bicubic" ? (
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
          {mode === "bicubic" && ` → ${currentDims.w * factor}×${currentDims.h * factor}px`}
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
        ) : mode === "ai" ? (
          <><Sparkles size={12} /> Aumentar (IA)</>
        ) : (
          <><ZoomIn size={12} /> Aumentar</>
        )}
      </button>

      {mode === "ai" && <p className="text-[10px] text-acc/80">Usa créditos da Visant (Gemini).</p>}
      {err && <p className="text-[10px] text-red-400">{err}</p>}
    </div>
  );
}
