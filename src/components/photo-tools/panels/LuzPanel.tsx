"use client";

/**
 * LuzPanel — controles das duas camadas de overlay (Sombra / Luz).
 * Reusa os primitivos do design system (Slider, Segmented) e os tokens acc/acc2/zinc.
 * Estado vive no page.tsx (SSoT); este painel só lê e dispara updates.
 */
import { useRef } from "react";
import { Image as ImageIcon, Eye, RotateCcw, X, Crop, Frame } from "lucide-react";
import { Slider } from "@/components/ui/Slider";
import { Segmented } from "@/components/ui/Segmented";
import { LUZ_BLEND_OPTIONS, LUZ_DEFAULTS, isFullCrop, type LuzLayer, type LuzLayerId } from "@/types/luz";

export function LuzPanel({
  layers,
  active,
  setActive,
  update,
  toggleVisible,
  onImport,
  onUploadFile,
  onClear,
  onReset,
  cropMode,
  setCropMode,
  onResetCrop,
  hasWarp,
  warpActive,
  onResetWarp,
}: {
  layers: LuzLayer[];
  active: LuzLayerId;
  setActive: (id: LuzLayerId) => void;
  update: (patch: Partial<LuzLayer>) => void;
  toggleVisible: (id: LuzLayerId) => void;
  onImport: () => void;
  onUploadFile: (f: File) => void;
  onClear: () => void;
  onReset: () => void;
  cropMode: boolean;
  setCropMode: (v: boolean) => void;
  onResetCrop: () => void;
  hasWarp: boolean;
  warpActive: boolean;
  onResetWarp: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const layer = layers.find((l) => l.id === active)!;
  const oDef = LUZ_DEFAULTS.find((d) => d.id === active)?.opacity ?? 0.5;

  return (
    <div className="space-y-2 bg-zinc-800/40 rounded-xl border border-zinc-700/40 p-2">
      <p className="text-[9px] uppercase tracking-wider text-zinc-600">Luz &amp; Sombra</p>

      {/* Camada ativa */}
      <Segmented<LuzLayerId>
        value={active}
        onChange={setActive}
        options={layers.map((l) => ({ value: l.id, label: l.label }))}
      />

      {/* Asset da camada ativa */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onImport}
          className="relative w-12 h-12 flex-none rounded-lg border border-zinc-700/60 bg-zinc-900/60 overflow-hidden grid place-items-center hover:border-zinc-500 transition-colors"
          title="Importar asset"
        >
          {layer.src ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={layer.src} alt="" className="w-full h-full object-cover" />
          ) : (
            <ImageIcon size={16} className="text-zinc-600" />
          )}
        </button>
        <div className="flex-1 grid grid-cols-2 gap-1">
          <button
            type="button"
            onClick={onImport}
            className="py-1.5 rounded-lg text-[10px] font-medium bg-acc2 text-zinc-950 hover:bg-acc2/90 transition-colors"
          >
            Importar
          </button>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="py-1.5 rounded-lg text-[10px] font-medium bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors"
          >
            Upload
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onUploadFile(f);
            e.target.value = "";
          }}
        />
      </div>

      {/* Controles — desabilitados sem asset */}
      <div className={layer.src ? "space-y-1.5" : "space-y-1.5 opacity-40 pointer-events-none"}>
        <Slider
          label="Opacidade"
          value={layer.opacity}
          onChange={(v) => update({ opacity: v })}
          min={0}
          max={1}
          step={0.05}
          display={`${Math.round(layer.opacity * 100)}%`}
          defaultValue={oDef}
        />
        <Slider
          label="Contraste"
          value={layer.contrast}
          onChange={(v) => update({ contrast: v })}
          min={50}
          max={150}
          step={1}
          display={`${layer.contrast}%`}
          defaultValue={100}
        />
        <Slider
          label="Escala"
          value={layer.scale}
          onChange={(v) => update({ scale: v })}
          min={0.2}
          max={3}
          step={0.05}
          display={`${layer.scale.toFixed(2)}×`}
          defaultValue={1}
        />
        <Slider
          label="Rotação"
          value={layer.rotation}
          onChange={(v) => update({ rotation: v })}
          min={-180}
          max={180}
          step={1}
          display={`${layer.rotation}°`}
          defaultValue={0}
        />

        {/* Recorte da textura — alças âmbar no canvas (modo crop) */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setCropMode(!cropMode)}
            className={[
              "flex-1 py-1.5 rounded-lg text-[10px] font-medium border transition-colors flex items-center justify-center gap-1",
              cropMode ? "bg-amber-400 text-zinc-950 border-amber-400" : "bg-zinc-800/60 text-zinc-400 border-zinc-700/50 hover:bg-zinc-700/60",
            ].join(" ")}
          >
            <Crop size={11} /> {cropMode ? "Recortando…" : "Recortar"}
          </button>
          {!isFullCrop(layer.crop) && (
            <button
              type="button"
              onClick={onResetCrop}
              title="Limpar recorte"
              className="py-1.5 px-2 rounded-lg text-[10px] bg-zinc-800 text-zinc-400 hover:bg-zinc-700 transition-colors"
            >
              <RotateCcw size={10} />
            </button>
          )}
        </div>

        {/* Warp de perspectiva — segure Ctrl no canvas (alças = QuadEditor do Cantos) */}
        <div className="flex items-center gap-1">
          <div className={[
            "flex-1 py-1.5 rounded-lg text-[10px] font-medium border flex items-center justify-center gap-1",
            warpActive ? "bg-acc/20 text-acc border-acc/40" : hasWarp ? "bg-zinc-800/60 text-zinc-300 border-zinc-700/50" : "bg-zinc-800/40 text-zinc-500 border-zinc-700/40",
          ].join(" ")}>
            <Frame size={11} /> {warpActive ? "Deformando… (Ctrl)" : hasWarp ? "Perspectiva ativa" : "Segure Ctrl → perspectiva"}
          </div>
          {hasWarp && (
            <button
              type="button"
              onClick={onResetWarp}
              title="Remover perspectiva (volta ao normal)"
              className="py-1.5 px-2 rounded-lg text-[10px] bg-zinc-800 text-zinc-400 hover:bg-zinc-700 transition-colors"
            >
              <RotateCcw size={10} />
            </button>
          )}
        </div>

        <div className="space-y-0.5">
          <label className="text-[10px] text-zinc-400">Mistura</label>
          <div className="grid grid-cols-4 gap-1">
            {LUZ_BLEND_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => update({ blendMode: o.value })}
                className={[
                  "py-1 rounded-lg text-[10px] font-medium border transition-colors",
                  layer.blendMode === o.value
                    ? "bg-acc2 text-zinc-950 border-acc2"
                    : "bg-zinc-800/60 text-zinc-400 border-zinc-700/50 hover:bg-zinc-700/60",
                ].join(" ")}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-1 pt-0.5">
          <button
            type="button"
            onClick={onReset}
            className="flex-1 py-1 rounded-lg text-[10px] bg-zinc-800 text-zinc-400 hover:bg-zinc-700 transition-colors flex items-center justify-center gap-1"
          >
            <RotateCcw size={10} /> Resetar
          </button>
          <button
            type="button"
            onClick={onClear}
            className="flex-1 py-1 rounded-lg text-[10px] bg-zinc-800 text-zinc-400 hover:bg-red-500/20 hover:text-red-400 transition-colors flex items-center justify-center gap-1"
          >
            <X size={10} /> Remover asset
          </button>
        </div>
      </div>

      {/* Camadas — toggle de visibilidade (mesmo padrão do RenderPanel) */}
      <div className="space-y-1 pt-1.5 mt-0.5 border-t border-zinc-800/60">
        <p className="text-[9px] uppercase tracking-wider text-zinc-600">Camadas</p>
        {layers.map((l) => (
          <div key={l.id} className="flex items-center gap-1.5 text-[10px]">
            <button
              type="button"
              onClick={() => toggleVisible(l.id)}
              title="Mostrar/ocultar"
              className="text-zinc-400 hover:text-white transition-colors"
            >
              <Eye size={11} className={l.visible ? "" : "opacity-25"} />
            </button>
            <span
              className={[
                "flex-1",
                l.visible ? (l.id === "shadow" ? "text-acc" : "text-acc2") : "text-zinc-600 line-through",
              ].join(" ")}
            >
              {l.label}
            </span>
            {!l.src && <span className="text-zinc-700">vazio</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
