"use client";

/**
 * AIEditPanel — edição generativa por máscara. Reusa a máscara do tool Máscara
 * (SAM2/caneta/pincel/varinha). Substituir/Remover/Retocar via Visant (inpaint,
 * com fallback change-object). Reusa Segmented do design system.
 */
import { Wand2, Loader2, Lasso } from "lucide-react";
import { Segmented } from "@/components/ui/Segmented";

export type AiEditMode = "replace" | "remove" | "retouch";

export function AIEditPanel({
  prompt,
  setPrompt,
  mode,
  setMode,
  resolution,
  setResolution,
  hasMask,
  onApply,
  applying,
  err,
  via,
}: {
  prompt: string;
  setPrompt: (s: string) => void;
  mode: AiEditMode;
  setMode: (m: AiEditMode) => void;
  resolution: "1K" | "2K" | "4K";
  setResolution: (r: "1K" | "2K" | "4K") => void;
  hasMask: boolean;
  onApply: () => void;
  applying: boolean;
  err?: string;
  via?: string;
}) {
  const needPrompt = mode === "replace" || mode === "remove";
  const disabled = applying || (mode === "replace" && !prompt.trim());

  return (
    <div className="space-y-2 bg-zinc-800/40 rounded-xl border border-zinc-700/40 p-2">
      <p className="text-[9px] uppercase tracking-wider text-zinc-600">Editar com IA</p>

      <div
        className={[
          "flex items-center gap-1.5 text-[10px] rounded-lg px-2 py-1.5 border",
          hasMask ? "text-acc2 border-acc2/30 bg-acc2/5" : "text-zinc-500 border-zinc-700/50 bg-zinc-900/40",
        ].join(" ")}
      >
        <Lasso size={11} />
        {hasMask ? "Máscara ativa — edita só a seleção" : "Sem máscara — use o tool Máscara (edita por prompt)"}
      </div>

      <div className="space-y-0.5">
        <label className="text-[10px] text-zinc-400">Modo</label>
        <Segmented<AiEditMode>
          value={mode}
          onChange={setMode}
          options={[
            { value: "replace", label: "Substituir" },
            { value: "remove", label: "Remover" },
            { value: "retouch", label: "Retocar" },
          ]}
        />
      </div>

      {needPrompt && (
        <div className="space-y-0.5">
          <label className="text-[10px] text-zinc-400">{mode === "remove" ? "Contexto (opcional)" : "Prompt"}</label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={2}
            placeholder={mode === "remove" ? "ex: continuar a parede de tijolos" : "ex: uma garrafa de vinho tinto"}
            className="w-full resize-none rounded-lg bg-zinc-900/60 border border-zinc-700/50 px-2 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 outline-none focus:border-acc/50"
          />
        </div>
      )}

      <div className="space-y-0.5">
        <label className="text-[10px] text-zinc-400">Resolução</label>
        <Segmented<"1K" | "2K" | "4K">
          value={resolution}
          onChange={setResolution}
          options={[
            { value: "1K", label: "1K" },
            { value: "2K", label: "2K" },
            { value: "4K", label: "4K" },
          ]}
        />
      </div>

      <button
        type="button"
        onClick={onApply}
        disabled={disabled}
        className="w-full py-2 rounded-xl text-xs font-medium transition-colors flex items-center justify-center gap-1.5 bg-acc2 text-zinc-950 hover:bg-acc2/90 disabled:opacity-40"
      >
        {applying ? <><Loader2 size={12} className="animate-spin" /> Editando…</> : <><Wand2 size={12} /> Aplicar IA</>}
      </button>

      <p className="text-[10px] text-acc/80">FLUX Fill (Replicate, barato) com máscara · fallback Visant.</p>
      {via === "flux-fill" && <p className="text-[10px] text-acc2/80">Editado via FLUX Fill (Replicate).</p>}
      {via === "change-object" && (
        <p className="text-[10px] text-amber-400/80">Inpaint indisponível — usei edição por prompt (sem máscara fina).</p>
      )}
      {err && <p className="text-[10px] text-red-400">{err}</p>}
    </div>
  );
}
