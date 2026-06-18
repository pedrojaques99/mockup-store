"use client";

/**
 * EditSelectionPanel — painel DEDICADO da "Seleção da edição" (alvo `aiedit`).
 * Separado do MaskPanel de propósito: aqui você só pinta ONDE a edição (IA) vai
 * agir; não é máscara de render (superfície/oclusão). Mínimo necessário, icon-first
 * (IconButton/IconSegmented): Pincel (pintar/apagar) ou Objeto, desfazer/limpar,
 * concluir. Dirige o MESMO estado/handlers do useMaskEditor roteados pro aiedit.
 */
import { Loader2, Paintbrush, Sparkles, Plus, Minus, Undo2, Trash2, Check } from "lucide-react";
import { Slider } from "@/components/ui/Slider";
import { IconButton } from "@/components/ui/IconButton";
import { IconSegmented } from "@/components/ui/IconSegmented";
import type { MaskInstrument, MaskMode } from "@/components/photo-tools/registry";

export interface EditSelectionPanelProps {
  instrument: MaskInstrument; setInstrument: (i: MaskInstrument) => void;
  mode: MaskMode; setMode: (m: MaskMode) => void;
  brushSize: number; setBrushSize: React.Dispatch<React.SetStateAction<number>>;
  segFeather: number; setSegFeather: React.Dispatch<React.SetStateAction<number>>;
  segStatus: { status: string; msg: string; device: string | null };
  segHasMask: boolean;
  imgDims: { w: number; h: number };
  hasMask: boolean;
  onApply: () => void;   // commita a seleção do Objeto (SAM)
  onUndo: () => void;
  onClear: () => void;
  onDone: () => void;
}

export function EditSelectionPanel(p: EditSelectionPanelProps) {
  const isBrush = p.instrument === "brush";
  const maxDim = Math.max(p.imgDims.w, p.imgDims.h);

  return (
    <div className="space-y-2.5">
      {/* Intenção */}
      <div>
        <p className="text-[9px] uppercase tracking-wider text-violet-300/80 flex items-center gap-1">
          <Sparkles size={10} /> Seleção da edição
        </p>
        <p className="text-[10px] text-zinc-500 leading-snug mt-0.5">
          Pinte <span className="text-zinc-300">onde a edição vai agir</span>. Não afeta o render.
        </p>
      </div>

      {/* Ferramenta — Pincel ou Objeto */}
      <IconSegmented<MaskInstrument>
        value={p.instrument}
        onChange={(v) => p.setInstrument(v)}
        variant="violet"
        options={[
          { value: "brush", label: "Pincel — pinta à mão livre, ao vivo", icon: Paintbrush },
          { value: "sam", label: "Objeto — clica e seleciona", icon: Sparkles },
        ]}
      />

      {/* Opções da ferramenta */}
      <div className="rounded-lg bg-zinc-900/40 border border-zinc-800/60 p-2 space-y-1.5">
        {isBrush ? (
          <>
            <IconSegmented<MaskMode>
              value={p.mode}
              onChange={(v) => p.setMode(v)}
              options={[
                { value: "add", label: "Pintar — adiciona à seleção", icon: Plus, variant: "violet" },
                { value: "sub", label: "Apagar — remove da seleção", icon: Minus, variant: "danger" },
              ]}
            />
            <Slider label="Tamanho do pincel" value={p.brushSize} onChange={p.setBrushSize}
              min={Math.max(2, Math.round(maxDim * 0.005))} max={Math.max(20, Math.round(maxDim * 0.12))} suffix="px" />
            <p className="text-[9px] text-violet-300/70 pt-0.5">Aplica ao vivo a cada traço.</p>
          </>
        ) : (
          <>
            <p className="text-[10px] text-zinc-500">Clique no objeto · botão direito exclui.</p>
            <Slider label="Suavizar borda" value={p.segFeather} onChange={p.setSegFeather} min={0} max={20} suffix="px" />
            {p.segStatus.status !== "ready" && (
              <p className="text-[10px] text-zinc-500 flex items-center gap-1"><Loader2 size={9} className="animate-spin" /> {p.segStatus.msg}</p>
            )}
            <button
              type="button"
              onClick={p.onApply}
              disabled={!p.segHasMask}
              className={["w-full py-1.5 rounded-lg text-[10px] font-medium transition-colors flex items-center justify-center gap-1",
                p.segHasMask ? "bg-violet-500 text-white hover:bg-violet-500/90" : "bg-zinc-800 text-zinc-500"].join(" ")}
            >
              <Plus size={12} /> Adicionar à seleção
            </button>
          </>
        )}
      </div>

      {/* Ações (secundárias) + Concluir (primária) — ícones casam a altura da CTA */}
      <div className="flex items-center gap-1.5">
        <IconButton icon={Undo2} label="Desfazer" onClick={p.onUndo} className="w-9 h-9 rounded-xl" />
        <IconButton icon={Trash2} label="Limpar seleção" onClick={p.onClear} disabled={!p.hasMask} className="w-9 h-9 rounded-xl" />
        <button
          onClick={p.onDone}
          className="flex-1 py-2 rounded-xl text-xs font-medium bg-violet-500 text-white hover:bg-violet-500/90 transition-colors flex items-center justify-center gap-1.5"
        >
          <Check size={12} /> Concluir
        </button>
      </div>
    </div>
  );
}
