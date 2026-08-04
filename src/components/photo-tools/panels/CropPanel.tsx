"use client";

/** CropPanel — moldura livre (8 alças) estilo Photoshop. Proporção opcional,
 *  reset, e expansão por IA quando a moldura passa da imagem. Reusa Segmented. */
import { Crop as CropIcon, Loader2, Expand, Maximize, RotateCcw } from "lucide-react";
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
  onReset,
  onApply,
  applying,
  canApply,
  expanding,
  prompt,
  setPrompt,
}: {
  aspect: CropAspect;
  setAspect: (a: CropAspect) => void;
  onReset: () => void;
  onApply: () => void;
  applying: boolean;
  canApply: boolean;
  /** true quando a moldura ultrapassa a imagem → expandir com IA (outpaint). */
  expanding: boolean;
  prompt: string;
  setPrompt: (s: string) => void;
}) {
  return (
    <div className="space-y-2 bg-zinc-800/40 rounded-xl border border-zinc-700/40 p-2">
      <p className="text-[9px] uppercase tracking-wider text-zinc-600">Cortar / Expandir</p>

      <p className="text-[10px] text-zinc-500 leading-snug">
        Arraste as <span className="text-zinc-300">8 alças</span> pra ajustar a moldura. Puxe pra <span className="text-acc">fora da imagem</span> → estende a cena.
        <br /><span className="text-zinc-600">Duplo-clique dentro (ou Enter) aplica · Esc cancela.</span>
      </p>

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

      <button
        type="button"
        onClick={onReset}
        className="w-full py-1.5 rounded-lg text-[10px] bg-zinc-800 text-zinc-400 hover:bg-zinc-700 transition-colors flex items-center justify-center gap-1"
      >
        <RotateCcw size={10} /> Resetar moldura
      </button>

      {expanding && (
        <div className="flex items-center gap-1.5 text-[10px] rounded-lg px-2 py-1.5 border text-acc border-acc/30 bg-acc/5">
          <Maximize size={11} /> Moldura além da imagem → estende a cena (gera a borda nova)
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
          <><Expand size={12} /> Expandir cena</>
        ) : (
          <><CropIcon size={12} /> Aplicar corte</>
        )}
      </button>
      <p className="text-[10px] text-zinc-600">
        {expanding ? "Gera a borda nova (créditos) e recarrega a cena." : "Recorta e recarrega a cena (re-analisa a superfície)."}
      </p>
    </div>
  );
}
