"use client";

/**
 * MaskPanel — Photoshop-style mask editor. You pick a TARGET (Superfície/Oclusão),
 * an INSTRUMENT (Pen/Brush/Varinha/SAM), and a MODE (Add/Sub). Every instrument
 * adds to or subtracts from the SAME persistent mask — none replaces it. Pen is an
 * instrument here, not a category.
 */
import { Loader2, Plus, Minus, Undo2, FlipHorizontal2, Trash2 } from "lucide-react";
import { Slider } from "@/components/ui/Slider";
import { Segmented } from "@/components/ui/Segmented";
import type { MaskInstrument, MaskTarget, MaskMode } from "@/components/photo-tools/registry";

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
}

export function MaskPanel(p: MaskPanelProps) {
  const addLabel = p.mode === "add" ? "Adicionar à máscara" : "Subtrair da máscara";
  const canApply = p.instrument === "pen" ? p.penHasMask : (p.instrument === "wand" || p.instrument === "sam") ? p.segHasMask : false;
  const maxDim = Math.max(p.imgDims.w, p.imgDims.h);

  return (
    <div className="space-y-2">
      {/* Target + mode */}
      <Segmented value={p.target} onChange={p.setTarget}
        options={[{ value: "surface", label: "Superfície" }, { value: "occluder", label: "Oclusão" }]} />
      <Segmented value={p.mode} onChange={p.setMode}
        options={[
          { value: "add", label: <span className="flex items-center justify-center gap-1"><Plus size={10} /> Add</span> },
          { value: "sub", label: <span className="flex items-center justify-center gap-1"><Minus size={10} /> Sub</span> },
        ]} />

      <div className="h-px bg-zinc-800/70" />

      {/* Instrument */}
      <Segmented value={p.instrument} onChange={p.setInstrument}
        options={[{ value: "pen", label: "Pen" }, { value: "brush", label: "Brush" }, { value: "wand", label: "Varinha" }, { value: "sam", label: "SAM" }]} />

      {/* Instrument-specific controls + hint */}
      {p.instrument === "pen" && (<>
        <p className="text-[10px] text-zinc-600">{p.penStatus || "clique = canto · clique-arraste = curva · clique no 1º ponto = fechar"}</p>
        <Slider label="Suavizar borda" value={p.penFeather} onChange={p.setPenFeather} min={0} max={20} suffix="px" />
      </>)}
      {p.instrument === "brush" && (
        <p className="text-[10px] text-zinc-600">Pinte na imagem — {p.mode === "add" ? "adiciona" : "remove"} da máscara a cada traço.</p>
      )}
      {p.instrument === "brush" && (
        <Slider label="Tamanho do pincel" value={p.brushSize} onChange={p.setBrushSize}
          min={Math.max(2, Math.round(maxDim * 0.005))} max={Math.max(20, Math.round(maxDim * 0.12))} suffix="px" />
      )}
      {p.instrument === "wand" && (<>
        <p className="text-[10px] text-zinc-600 flex items-center gap-1">Clique na superfície pra selecionar a cor{p.segSwatch && <span className="inline-block w-3 h-3 rounded-sm border border-zinc-600 align-middle" style={{ background: `rgb(${p.segSwatch[0]},${p.segSwatch[1]},${p.segSwatch[2]})` }} />}</p>
        <Slider label="Tolerância" value={p.segTol} onChange={p.setSegTol} min={1} max={80} />
        <Slider label="Limpar borda" hint="tira franja" value={p.segContract} onChange={p.setSegContract} min={0} max={8} suffix="px" />
        <button onClick={() => p.setSegMatte((v) => !v)}
          className={["w-full py-1 rounded-lg text-[10px] font-medium border transition-colors",
            p.segMatte ? "bg-acc2 text-zinc-950 border-acc2" : "bg-zinc-800/60 text-zinc-400 border-zinc-700/50 hover:bg-zinc-700/60"].join(" ")}>Refinar borda (matte) {p.segMatte ? "on" : "off"}</button>
        <Slider label="Suavizar borda" value={p.segFeather} onChange={p.setSegFeather} min={0} max={20} suffix="px" />
      </>)}
      {p.instrument === "sam" && (<>
        <p className="text-[10px] text-zinc-600">Clique na região (IA); direito exclui.</p>
        <Slider label="Suavizar borda" value={p.segFeather} onChange={p.setSegFeather} min={0} max={20} suffix="px" />
        {p.segStatus.status !== "ready" && <p className="text-[10px] text-zinc-500 flex items-center gap-1"><Loader2 size={9} className="animate-spin" /> {p.segStatus.msg}</p>}
      </>)}

      {/* Apply (pen / wand / sam — brush applies live) */}
      {p.instrument !== "brush" && (
        <button onClick={p.onApply} disabled={!canApply}
          className={["w-full py-1.5 rounded-lg text-[10px] font-medium transition-colors flex items-center justify-center gap-1",
            canApply ? "bg-acc2 text-zinc-950 hover:bg-acc2/90" : "bg-zinc-800 text-zinc-500"].join(" ")}>
          {p.mode === "add" ? <Plus size={11} /> : <Minus size={11} />} {addLabel}
        </button>
      )}

      <div className="h-px bg-zinc-800/70" />

      {/* Mask actions */}
      <div className="grid grid-cols-3 gap-1.5">
        <button onClick={p.onUndo} className="py-1.5 rounded-lg text-[10px] bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors flex items-center justify-center gap-1"><Undo2 size={11} /> Desfazer</button>
        <button onClick={p.onInvert} disabled={!p.hasTargetMask} className="py-1.5 rounded-lg text-[10px] bg-zinc-800 hover:bg-zinc-700 text-zinc-300 disabled:opacity-40 transition-colors flex items-center justify-center gap-1"><FlipHorizontal2 size={11} /> Inverter</button>
        <button onClick={p.onClear} disabled={!p.hasTargetMask} className="py-1.5 rounded-lg text-[10px] bg-zinc-800 hover:bg-zinc-700 text-zinc-300 disabled:opacity-40 transition-colors flex items-center justify-center gap-1"><Trash2 size={11} /> Limpar</button>
      </div>
    </div>
  );
}
