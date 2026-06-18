"use client";

/**
 * AIEditPanel — edição generativa por máscara. A máscara da IA é INDEPENDENTE da
 * máscara do mockup (surface/occluder): tem alvo próprio (`aiedit`) e é criada
 * pelas mesmas ferramentas (caneta/pincel/varinha/SAM) via botão abaixo.
 * Substituir/Remover/Retocar via Visant (inpaint, fallback change-object).
 */
import { Wand2, Loader2, Lasso, X, Eraser } from "lucide-react";
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
  onEditMask,
  onClearMask,
  onApply,
  applying,
  err,
  via,
  hasMagenta,
  cleaning,
  onCleanPlaceholder,
}: {
  prompt: string;
  setPrompt: (s: string) => void;
  mode: AiEditMode;
  setMode: (m: AiEditMode) => void;
  resolution: "1K" | "2K" | "4K";
  setResolution: (r: "1K" | "2K" | "4K") => void;
  hasMask: boolean;
  onEditMask: () => void;
  onClearMask: () => void;
  onApply: () => void;
  applying: boolean;
  err?: string;
  via?: string;
  hasMagenta?: boolean;
  cleaning?: boolean;
  onCleanPlaceholder?: () => void;
}) {
  const needPrompt = mode === "replace" || mode === "remove";
  const disabled = applying || (mode === "replace" && !prompt.trim());

  return (
    <div className="space-y-2 bg-zinc-800/40 rounded-xl border border-zinc-700/40 p-2">
      <p className="text-[9px] uppercase tracking-wider text-zinc-600">Editar com IA</p>

      {/* Limpar a faixa rosa (placeholder) — recria a superfície via inpaint. */}
      {hasMagenta && onCleanPlaceholder && (
        <div className="space-y-1 rounded-lg border border-pink-400/30 bg-pink-400/5 p-2">
          <p className="text-[10px] text-pink-300/90 leading-snug">Faixa rosa (placeholder) detectada na base.</p>
          <button
            type="button"
            onClick={onCleanPlaceholder}
            disabled={cleaning}
            className="w-full py-1.5 rounded-lg text-[10px] font-medium bg-pink-500/90 text-white hover:bg-pink-500 disabled:opacity-50 transition-colors flex items-center justify-center gap-1.5"
          >
            {cleaning ? <><Loader2 size={11} className="animate-spin" /> Recriando…</> : <><Eraser size={11} /> Limpar faixa rosa (IA)</>}
          </button>
          <p className="text-[9px] text-zinc-500">Adivinha o material sozinho (visão) e recria a superfície real — logo transparente revela o material. Ou digite o prompt acima pra guiar.</p>
        </div>
      )}

      {/* Máscara da IA — própria, criada com as ferramentas de máscara (alvo `aiedit`). */}
      <div className="space-y-1">
        <div
          className={[
            "flex items-center gap-1.5 text-[10px] rounded-lg px-2 py-1.5 border",
            hasMask ? "text-violet-300 border-violet-400/30 bg-violet-400/5" : "text-zinc-500 border-zinc-700/50 bg-zinc-900/40",
          ].join(" ")}
        >
          <Lasso size={11} />
          {hasMask ? "Máscara da IA ativa — edita só a seleção" : "Sem máscara — a IA edita por prompt na imagem toda"}
          {hasMask && (
            <button type="button" onClick={onClearMask} title="Limpar máscara da IA"
              className="ml-auto text-zinc-500 hover:text-rose-400 transition-colors"><X size={11} /></button>
          )}
        </div>
        <button
          type="button"
          onClick={onEditMask}
          className="w-full py-1.5 rounded-lg text-[10px] font-medium border border-violet-400/40 bg-violet-400/10 text-violet-200 hover:bg-violet-400/20 transition-colors flex items-center justify-center gap-1.5"
        >
          <Lasso size={11} /> {hasMask ? "Editar máscara da IA" : "Criar máscara da IA"}
        </button>
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

      <p className="text-[10px] text-acc/80">Edição precisa pela máscara — só a área marcada muda.</p>
      {via === "flux-fill" && <p className="text-[10px] text-acc2/80">Editado pela máscara.</p>}
      {via === "change-object" && (
        <p className="text-[10px] text-amber-400/80">Edição por prompt (sem máscara fina) — resultado mais amplo.</p>
      )}
      {err && <p className="text-[10px] text-red-400">{err}</p>}
    </div>
  );
}
