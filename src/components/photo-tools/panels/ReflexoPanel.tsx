"use client";

/** ReflexoPanel — paint where the art should reflect (wet floor / glass). */
import { Paintbrush, Eraser, Trash2 } from "lucide-react";
import { Slider } from "@/components/ui/Slider";
import { IconButton } from "@/components/ui/IconButton";
import { IconSegmented } from "@/components/ui/IconSegmented";
import type { BrushApi } from "@/components/BrushCanvas";

export interface ReflexoPanelProps {
  brushErase: boolean;
  setBrushErase: React.Dispatch<React.SetStateAction<boolean>>;
  brushSize: number;
  setBrushSize: React.Dispatch<React.SetStateAction<number>>;
  brushApiRef: React.RefObject<BrushApi | null>;
  imgDims: { w: number; h: number };
  // Render-side reflection look — vive AQUI (não no Render) pra a feature ser auto-contida.
  reflectionOpacity: number; setReflectionOpacity: React.Dispatch<React.SetStateAction<number>>;
  reflectionBlur: number; setReflectionBlur: React.Dispatch<React.SetStateAction<number>>;
}

export function ReflexoPanel(p: ReflexoPanelProps) {
  const maxDim = Math.max(p.imgDims.w, p.imgDims.h);
  return (
    <div className="space-y-1.5">
      <p className="text-[10px] text-zinc-600">Pinte onde a arte deve <span className="text-acc">refletir</span> (chão molhado, vidro). Botão direito apaga.</p>
      <IconSegmented<"paint" | "erase">
        value={p.brushErase ? "erase" : "paint"}
        onChange={(v) => p.setBrushErase(v === "erase")}
        options={[
          { value: "paint", label: "Pintar reflexo", icon: Paintbrush, variant: "accent" },
          { value: "erase", label: "Apagar", icon: Eraser, variant: "danger" },
        ]}
      />
      <Slider
        label="Tamanho do pincel"
        value={p.brushSize}
        onChange={p.setBrushSize}
        min={Math.max(2, Math.round(maxDim * 0.005))}
        max={Math.max(20, Math.round(maxDim * 0.12))}
        suffix="px"
      />

      {/* Aparência do reflexo no render (intensidade + espalhamento) */}
      <div className="pt-1.5 mt-0.5 border-t border-zinc-800/60 space-y-1.5">
        <Slider label="Intensidade" hint="tinge reflexos com a arte" accent="acc"
          value={p.reflectionOpacity} onChange={p.setReflectionOpacity}
          min={0} max={1} step={0.05} display={`${Math.round(p.reflectionOpacity * 100)}%`} defaultValue={0} />
        {p.reflectionOpacity > 0 && (
          <Slider label="Espalhar" hint="desfoca o reflexo" accent="acc"
            value={p.reflectionBlur} onChange={p.setReflectionBlur}
            min={4} max={60} step={2} suffix="px" />
        )}
      </div>

      <div className="flex">
        <IconButton icon={Trash2} label="Limpar reflexo" text="Limpar" onClick={() => p.brushApiRef.current?.clear()} className="w-full justify-center" />
      </div>
    </div>
  );
}
