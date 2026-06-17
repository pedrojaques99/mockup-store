"use client";

/** ReflexoPanel — paint where the art should reflect (wet floor / glass). */
import { Slider } from "@/components/ui/Slider";
import { Segmented } from "@/components/ui/Segmented";
import type { BrushApi } from "@/components/BrushCanvas";

export interface ReflexoPanelProps {
  brushErase: boolean;
  setBrushErase: React.Dispatch<React.SetStateAction<boolean>>;
  brushSize: number;
  setBrushSize: React.Dispatch<React.SetStateAction<number>>;
  brushApiRef: React.RefObject<BrushApi | null>;
  imgDims: { w: number; h: number };
}

export function ReflexoPanel(p: ReflexoPanelProps) {
  const maxDim = Math.max(p.imgDims.w, p.imgDims.h);
  return (
    <div className="space-y-1.5">
      <p className="text-[10px] text-zinc-600">Pinte onde a arte deve <span className="text-acc">refletir</span> (chão molhado, vidro). Botão direito apaga.</p>
      <Segmented
        value={p.brushErase ? "erase" : "paint"}
        onChange={(v) => p.setBrushErase(v === "erase")}
        options={[{ value: "paint", label: "Pintar" }, { value: "erase", label: "Apagar" }]}
      />
      <Slider
        label="Tamanho do pincel"
        value={p.brushSize}
        onChange={p.setBrushSize}
        min={Math.max(2, Math.round(maxDim * 0.005))}
        max={Math.max(20, Math.round(maxDim * 0.12))}
        suffix="px"
      />
      <button onClick={() => p.brushApiRef.current?.clear()} className="w-full text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors">Limpar reflexo</button>
    </div>
  );
}
