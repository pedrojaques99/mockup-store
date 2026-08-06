"use client";

/**
 * MaskPanel — editor de máscara modelo Photoshop. Arquitetura óbvia e CONSISTENTE
 * (icon-first via IconButton/IconSegmented):  MÁSCARA (qual camada) → FERRAMENTA
 * (como selecionar) → MODO (somar/subtrair) → APLICAR → AÇÕES. Pen/Brush/Varinha/
 * SAM são instrumentos: TODOS pintam na MESMA máscara do alvo ativo. A seleção da
 * edição (aiedit) tem painel próprio (EditSelectionPanel) — aqui só surface/occluder.
 */
import { Loader2, Plus, Minus, Undo2, FlipHorizontal2, Trash2, PenTool, Paintbrush, Wand2, MousePointerClick, Layers, Radio, Eye, Contrast } from "lucide-react";
import { Slider } from "@/components/ui/Slider";
import { IconButton } from "@/components/ui/IconButton";
import { IconSegmented } from "@/components/ui/IconSegmented";
import type { MaskInstrument, MaskTarget, MaskMode } from "@/components/photo-tools/registry";

/** Como a máscara é exibida no canvas: overlay colorido (vê o resultado) ou
 *  grayscale isolado 0/1 (foca no vetor da máscara, igual Photoshop). */
export type MaskView = "overlay" | "mask";

export interface MaskPanelProps {
  target: MaskTarget; setTarget: (t: MaskTarget) => void;
  instrument: MaskInstrument; setInstrument: (i: MaskInstrument) => void;
  mode: MaskMode; setMode: (m: MaskMode) => void;
  // instrument controls
  segTol: number; setSegTol: React.Dispatch<React.SetStateAction<number>>;
  segContract: number; setSegContract: React.Dispatch<React.SetStateAction<number>>;
  segMatte: boolean; setSegMatte: React.Dispatch<React.SetStateAction<boolean>>;
  segFeather: number; setSegFeather: React.Dispatch<React.SetStateAction<number>>;
  segSwatch: [number, number, number] | null;
  segStatus: { status: string; msg: string; device: string | null };
  segHasMask: boolean;
  penFeather: number; setPenFeather: React.Dispatch<React.SetStateAction<number>>;
  penStatus: string;
  penHasMask: boolean;
  brushSize: number; setBrushSize: React.Dispatch<React.SetStateAction<number>>;
  imgDims: { w: number; h: number };
  // actions
  onApply: () => void;     // pen / wand / sam → push the current selection into the mask
  onInvert: () => void;
  onClear: () => void;
  onUndo: () => void;
  hasTargetMask: boolean;
  // visualização da máscara no canvas
  view: MaskView; setView: (v: MaskView) => void;
}

const INSTRUMENTS: { value: MaskInstrument; label: string; icon: typeof PenTool; tip: string }[] = [
  { value: "pen", label: "Caneta", icon: PenTool, tip: "Vetor: cantos e curvas bézier" },
  { value: "brush", label: "Pincel", icon: Paintbrush, tip: "Pinta à mão livre, ao vivo" },
  { value: "wand", label: "Varinha", icon: Wand2, tip: "Seleção por cor (clique)" },
  { value: "sam", label: "Objeto", icon: MousePointerClick, tip: "Seleção de objeto (clique)" },
];

/** Rótulo de seção (módulo-scope → não recria componente em render). */
function Section({ icon: Icon, children }: { icon: typeof PenTool; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 text-[9px] uppercase tracking-wider text-zinc-600">
      <Icon size={10} /> {children}
    </div>
  );
}

export function MaskPanel(p: MaskPanelProps) {
  const isAdd = p.mode === "add";
  const live = p.instrument === "brush";
  const canApply = p.instrument === "pen" ? p.penHasMask : (p.instrument === "wand" || p.instrument === "sam") ? p.segHasMask : false;
  const maxDim = Math.max(p.imgDims.w, p.imgDims.h);
  const activeTool = INSTRUMENTS.find((i) => i.value === p.instrument)!;

  return (
    <div className="space-y-2.5">
      {/* ── MÁSCARA (alvo / camada) ───────────────────────────────────── */}
      <div className="space-y-1.5">
        <Section icon={Layers}>Máscara</Section>
        <div className="grid grid-cols-2 gap-1">
          {([
            { value: "surface", label: "Superfície", on: "bg-acc2 text-zinc-950 border-acc2" },
            { value: "occluder", label: "Oclusão", on: "bg-acc text-zinc-950 border-acc" },
          ] as const).map((t) => {
            const on = p.target === t.value;
            return (
              <button
                key={t.value}
                type="button"
                onClick={() => p.setTarget(t.value)}
                className={[
                  "py-1.5 rounded-lg text-[10px] font-medium border transition-ui flex items-center justify-center gap-1",
                  on ? t.on : "bg-zinc-800/60 text-zinc-400 border-zinc-700/50 hover:bg-zinc-700/60",
                ].join(" ")}
              >
                {t.label}
                {on && <span className="text-[8px] font-normal opacity-80">{p.hasTargetMask ? "●" : "○"}</span>}
              </button>
            );
          })}
        </div>
        <p className="text-[10px] text-zinc-600 leading-snug">
          As ferramentas abaixo pintam <span className="text-zinc-400">nesta mesma máscara</span> (modelo Photoshop).
        </p>

        {/* Visualização da máscara no canvas (overlay vs grayscale) */}
        <IconSegmented<MaskView>
          value={p.view}
          onChange={(v) => p.setView(v)}
          variant="primary"
          options={[
            { value: "overlay", label: "Overlay: região sobre a imagem", icon: Eye },
            { value: "mask", label: "Máscara: preto/branco isolado", icon: Contrast },
          ]}
        />
      </div>

      {/* ── FERRAMENTA (instrumento) ──────────────────────────────────── */}
      <div className="space-y-1.5">
        <Section icon={activeTool.icon}>Ferramenta: <span className="text-zinc-500 normal-case tracking-normal">{activeTool.tip}</span></Section>
        <IconSegmented<MaskInstrument>
          value={p.instrument}
          onChange={(v) => p.setInstrument(v)}
          variant="primary"
          options={INSTRUMENTS.map((it) => ({ value: it.value, label: `${it.label}: ${it.tip}`, icon: it.icon }))}
        />

        {/* opções do instrumento ativo — agrupadas */}
        <div className="rounded-lg bg-zinc-900/40 border border-zinc-800/60 p-2 space-y-1.5">
          {p.instrument === "pen" && (<>
            <p className="text-[10px] text-zinc-500">{p.penStatus || "clique = canto, arraste = curva, 1º ponto = fechar"}</p>
            <Slider label="Suavizar borda" value={p.penFeather} onChange={p.setPenFeather} min={0} max={20} suffix="px" />
          </>)}
          {p.instrument === "brush" && (<>
            <p className="text-[10px] text-zinc-500">Pinte na imagem. Aplica {isAdd ? "somando" : "subtraindo"} a cada traço.</p>
            <Slider label="Tamanho do pincel" value={p.brushSize} onChange={p.setBrushSize}
              min={Math.max(2, Math.round(maxDim * 0.005))} max={Math.max(20, Math.round(maxDim * 0.12))} suffix="px" />
          </>)}
          {p.instrument === "wand" && (<>
            <p className="text-[10px] text-zinc-500 flex items-center gap-1">
              Clique na superfície pra pegar a cor
              {p.segSwatch && <span className="inline-block w-3 h-3 rounded-sm border border-zinc-600 align-middle" style={{ background: `rgb(${p.segSwatch[0]},${p.segSwatch[1]},${p.segSwatch[2]})` }} />}
            </p>
            <Slider label="Tolerância" value={p.segTol} onChange={p.setSegTol} min={1} max={80} />
            <Slider label="Limpar borda" hint="tira franja" value={p.segContract} onChange={p.setSegContract} min={0} max={8} suffix="px" />
            <button onClick={() => p.setSegMatte((v) => !v)}
              className={["w-full py-1.5 rounded-lg text-[10px] font-medium border transition-ui",
                p.segMatte ? "bg-acc2 text-zinc-950 border-acc2" : "bg-zinc-800/60 text-zinc-400 border-zinc-700/50 hover:bg-zinc-700/60"].join(" ")}>
              Refinar borda (matte): {p.segMatte ? "on" : "off"}
            </button>
            <Slider label="Suavizar borda" value={p.segFeather} onChange={p.setSegFeather} min={0} max={20} suffix="px" />
          </>)}
          {p.instrument === "sam" && (<>
            <p className="text-[10px] text-zinc-500">Clique no objeto, botão direito exclui.</p>
            <Slider label="Suavizar borda" value={p.segFeather} onChange={p.setSegFeather} min={0} max={20} suffix="px" />
            {p.segStatus.status !== "ready" && <p className="text-[10px] text-zinc-500 flex items-center gap-1"><Loader2 size={9} className="animate-spin" /> {p.segStatus.msg}</p>}
          </>)}
        </div>
      </div>

      {/* ── MODO (somar / subtrair) — vale pra todas as ferramentas ────── */}
      <div className="space-y-1.5">
        <Section icon={Radio}>Modo</Section>
        <IconSegmented<MaskMode>
          value={p.mode}
          onChange={(v) => p.setMode(v)}
          options={[
            { value: "add", label: "Adicionar à máscara", icon: Plus, variant: "accent" },
            { value: "sub", label: "Subtrair da máscara", icon: Minus, variant: "danger" },
          ]}
        />
      </div>

      {/* Aplicar (pen/wand/sam) — brush é ao vivo */}
      {live ? (
        <p className="text-[10px] text-acc2 flex items-center justify-center gap-1 py-1">
          <Radio size={10} className="animate-pulse" /> Pincel aplica ao vivo
        </p>
      ) : (
        <button
          onClick={p.onApply}
          disabled={!canApply}
          className={["w-full py-2 rounded-xl text-xs font-medium transition-ui flex items-center justify-center gap-1.5",
            !canApply ? "bg-zinc-800 text-zinc-500"
              : isAdd ? "bg-acc2 text-zinc-950 hover:bg-acc2/90" : "bg-rose-500 text-white hover:bg-rose-500/90"].join(" ")}
        >
          {isAdd ? <Plus size={12} /> : <Minus size={12} />}
          {isAdd ? "Adicionar à máscara" : "Subtrair da máscara"}
        </button>
      )}

      <div className="h-px bg-zinc-800/70" />

      {/* ── AÇÕES da máscara (secundárias, icon-only) ─────────────────── */}
      <div className="flex items-center gap-1.5">
        <IconButton icon={Undo2} label="Desfazer" onClick={p.onUndo} className="flex-1" />
        <IconButton icon={FlipHorizontal2} label="Inverter máscara" onClick={p.onInvert} disabled={!p.hasTargetMask} className="flex-1" />
        <IconButton icon={Trash2} label="Limpar máscara" onClick={p.onClear} disabled={!p.hasTargetMask} className="flex-1" />
      </div>
    </div>
  );
}
