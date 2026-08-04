"use client";

/**
 * AIEditPanel — edição generativa por seleção. A seleção da edição é INDEPENDENTE
 * da máscara do mockup (surface/occluder): tem alvo próprio (`aiedit`) e é criada
 * pelas mesmas ferramentas (caneta/pincel/varinha/objeto) via botão abaixo.
 * Substituir/Remover/Retocar via Visant (inpaint, fallback change-object).
 *
 * Visual: alinhado ao design system dos painéis (superfícies zinc, acento único acc2,
 * títulos discretos). Sem caixas saturadas — hierarquia por espaço e tipografia.
 */
import { Wand2, Loader2, Lasso, X, Eraser, Replace, Paintbrush } from "lucide-react";
import { Segmented } from "@/components/ui/Segmented";

export type AiEditMode = "replace" | "remove" | "retouch";

/** Rótulo de campo (módulo-scope → não recria componente em render). */
function Label({ children }: { children: React.ReactNode }) {
  return <label className="text-[10px] text-zinc-400">{children}</label>;
}

/** Opção de Segmented com ícone comunicativo + texto. */
function Opt({ icon: Icon, children }: { icon: typeof Wand2; children: React.ReactNode }) {
  return <span className="inline-flex items-center justify-center gap-1"><Icon size={10} /> {children}</span>;
}

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
    <div className="space-y-3 bg-zinc-800/40 rounded-xl border border-zinc-700/40 p-2.5">
      <p className="text-[9px] uppercase tracking-wider text-zinc-600">Editar imagem</p>

      {/* Faixa rosa (placeholder) — afordância discreta; ponto rosa só referencia a faixa. */}
      {hasMagenta && onCleanPlaceholder && (
        <div className="space-y-1.5 rounded-lg border border-zinc-700/50 bg-zinc-900/40 p-2">
          <div className="flex items-center gap-1.5 text-[10px] text-zinc-400">
            <span className="w-1.5 h-1.5 rounded-full bg-pink-500 flex-none" />
            Faixa rosa detectada na superfície
          </div>
          <button
            type="button"
            onClick={onCleanPlaceholder}
            disabled={cleaning}
            className="w-full py-1.5 rounded-lg text-[10px] font-medium border border-zinc-700/60 bg-zinc-800/60 text-zinc-200 hover:bg-zinc-700/60 disabled:opacity-50 transition-colors flex items-center justify-center gap-1.5"
          >
            {cleaning ? <><Loader2 size={11} className="animate-spin" /> Recriando…</> : <><Eraser size={11} /> Limpar faixa rosa</>}
          </button>
          <p className="text-[10px] text-zinc-600 leading-snug">Substitui pela superfície real (detecta o material). Descreva no prompt pra guiar.</p>
        </div>
      )}

      {/* Seleção — onde a edição age. Botão de ação + status discreto. */}
      <div className="space-y-1.5">
        <Label>Seleção</Label>
        <button
          type="button"
          onClick={onEditMask}
          className="w-full py-1.5 rounded-lg text-[10px] font-medium border border-zinc-700/60 bg-zinc-800/60 text-zinc-300 hover:bg-zinc-700/60 transition-colors flex items-center justify-center gap-1.5"
        >
          <Lasso size={11} /> {hasMask ? "Editar seleção" : "Definir seleção"}
        </button>
        <div className="flex items-center gap-1.5 text-[10px] text-zinc-500">
          <span className={["w-1.5 h-1.5 rounded-full flex-none", hasMask ? "bg-acc2" : "bg-zinc-600"].join(" ")} />
          {hasMask ? "Edita só a área marcada" : "Edita a imagem toda"}
          {hasMask && (
            <button type="button" onClick={onClearMask} title="Limpar seleção"
              className="ml-auto text-zinc-600 hover:text-zinc-300 transition-colors"><X size={11} /></button>
          )}
        </div>
      </div>

      {/* Modo */}
      <div className="space-y-1">
        <Label>Modo</Label>
        <Segmented<AiEditMode>
          value={mode}
          onChange={setMode}
          options={[
            { value: "replace", label: <Opt icon={Replace}>Substituir</Opt> },
            { value: "remove", label: <Opt icon={Eraser}>Remover</Opt> },
            { value: "retouch", label: <Opt icon={Paintbrush}>Retocar</Opt> },
          ]}
        />
      </div>

      {/* Prompt */}
      {needPrompt && (
        <div className="space-y-1">
          <Label>{mode === "remove" ? "Contexto (opcional)" : "Prompt"}</Label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={2}
            placeholder={mode === "remove" ? "ex: continuar a parede de tijolos" : "ex: uma garrafa de vinho tinto"}
            className="w-full resize-none rounded-lg bg-zinc-900/60 border border-zinc-700/50 px-2 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 outline-none focus:border-zinc-500 transition-colors"
          />
        </div>
      )}

      {/* Resolução */}
      <div className="space-y-1">
        <Label>Resolução</Label>
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

      {/* Aplicar — único primário */}
      <button
        type="button"
        onClick={onApply}
        disabled={disabled}
        className="w-full py-2 rounded-xl text-xs font-medium bg-acc2 text-zinc-950 hover:bg-acc2/90 disabled:opacity-40 transition-colors flex items-center justify-center gap-1.5"
      >
        {applying ? <><Loader2 size={12} className="animate-spin" /> Editando…</> : <><Wand2 size={12} /> Aplicar edição</>}
      </button>

      {via === "change-object" && <p className="text-[10px] text-amber-500/80 leading-snug">Edição ampla (sem seleção fina) — resultado mais abrangente.</p>}
      {err && <p className="text-[10px] text-red-400">{err}</p>}
    </div>
  );
}
