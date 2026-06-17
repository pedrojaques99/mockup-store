"use client";

/** CropPanel — proporção + zoom + aplicar. Reusa Slider/Segmented do design system. */
import { Crop as CropIcon, Loader2, Sparkles, Maximize } from "lucide-react";
import { Slider } from "@/components/ui/Slider";
import { Segmented } from "@/components/ui/Segmented";

export type CropAspect = "free" | "1:1" | "16:9" | "4:5";

export const ASPECT_VALUE: Record<CropAspect, number | undefined> = {
  free: undefined,
  "1:1": 1,
  "16:9": 16 / 9,
  "4:5": 4 / 5,
};

export function CropPanel({
  aspect,
  setAspect,
  zoom,
  setZoom,
  onApply,
  applying,
  canApply,
  expanding,
  prompt,
  setPrompt,
}: {
  aspect: CropAspect;
  setAspect: (a: CropAspect) => void;
  zoom: number;
  setZoom: (z: number) => void;
  onApply: () => void;
  applying: boolean;
  canApply: boolean;
  /** true quando a área de corte ultrapassa a imagem → expandir com IA (outpaint). */
  expanding: boolean;
  prompt: string;
  setPrompt: (s: string) => void;
}) {
  return (
    <div className="space-y-2 bg-zinc-800/40 rounded-xl border border-zinc-700/40 p-2">
      <p className="text-[9px] uppercase tracking-wider text-zinc-600">Cortar / Expandir</p>

      <div className="space-y-0.5">
        <label className="text-[10px] text-zinc-400">Proporção</label>
        <Segmented<CropAspect>
          value={aspect}
          onChange={setAspect}
          options={[
            { value: "free", label: "Livre" },
            { value: "1:1", label: "1:1" },
            { value: "16:9", label: "16:9" },
            { value: "4:5", label: "4:5" },
          ]}
        />
      </div>

      <Slider label="Zoom" value={zoom} onChange={setZoom} min={0.3} max={3} step={0.01} display={`${zoom.toFixed(2)}×`} />

      {expanding && (
        <div className="flex items-center gap-1.5 text-[10px] rounded-lg px-2 py-1.5 border text-acc border-acc/30 bg-acc/5">
          <Maximize size={11} /> Área maior que a imagem → expandir com IA (outpaint)
        </div>
      )}

      {expanding && (
        <div className="space-y-0.5">
          <label className="text-[10px] text-zinc-400">Prompt (opcional)</label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={2}
            placeholder="ex: continuar a parede e o piso da cena"
            className="w-full resize-none rounded-lg bg-zinc-900/60 border border-zinc-700/50 px-2 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 outline-none focus:border-acc/50"
          />
        </div>
      )}

      <button
        type="button"
        onClick={onApply}
        disabled={!canApply || applying}
        className="w-full py-2 rounded-xl text-xs font-medium transition-colors flex items-center justify-center gap-1.5 bg-acc2 text-zinc-950 hover:bg-acc2/90 disabled:opacity-40"
      >
        {applying ? (
          <><Loader2 size={12} className="animate-spin" /> {expanding ? "Expandindo…" : "Cortando…"}</>
        ) : expanding ? (
          <><Sparkles size={12} /> Expandir com IA</>
        ) : (
          <><CropIcon size={12} /> Aplicar corte</>
        )}
      </button>
      <p className="text-[10px] text-zinc-600">
        {expanding ? "Gera a borda nova via IA (créditos) e recarrega a cena." : "Recorta e recarrega a cena (re-analisa a superfície). Diminua o zoom p/ expandir."}
      </p>
    </div>
  );
}
