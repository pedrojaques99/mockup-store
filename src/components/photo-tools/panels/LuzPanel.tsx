"use client";

/**
 * LuzPanel — adicionar uma Sombra ou Luz projetada sobre a cena pra dar realismo.
 * Presetado e enxuto: o padrão mostra só Intensidade + Contraste; escala/rotação são
 * feitas nas alças da cena (LuzOverlay); Mistura/Recortar/Perspectiva ficam num
 * disclosure "Ajustes finos". Visibilidade por camada vive no olho da própria aba.
 *
 * Reusa Slider do design system. Estado vive no page.tsx (SSoT); aqui só lê e dispara.
 */
import { Select } from "@/components/ui/Select";
import { useRef, useState } from "react";
import { ImagePlus, Eye, RotateCcw, X, Crop, Frame, ChevronRight, Sliders } from "lucide-react";
import { cn } from "@/lib/utils";
import { Slider } from "@/components/ui/Slider";
import { IconButton } from "@/components/ui/IconButton";
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
  onResetCrop: () => void;
  hasWarp: boolean;
  warpActive: boolean;
  onResetWarp: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [advanced, setAdvanced] = useState(false);
  const layer = layers.find((l) => l.id === active)!;
  const oDef = LUZ_DEFAULTS.find((d) => d.id === active)?.opacity ?? 0.5;

  const pickFile = () => fileRef.current?.click();

  return (
    <div className="space-y-2 bg-zinc-800/40 rounded-xl border border-zinc-700/40 p-2">
      <p className="text-[9px] uppercase tracking-wider text-zinc-600">Luz &amp; Sombra</p>

      {/* Abas Sombra/Luz — o olho de cada aba liga/desliga a camada (substitui "Camadas") */}
      <div className="grid grid-cols-2 gap-1">
        {layers.map((l) => {
          const isActive = l.id === active;
          return (
            <button
              key={l.id}
              type="button"
              onClick={() => setActive(l.id)}
              className={cn(
                "relative py-1.5 rounded-lg text-[10px] font-medium border transition-ui flex items-center justify-center gap-1.5",
                isActive
                  ? "bg-acc2 text-zinc-950 border-acc2"
                  : "bg-zinc-800/60 text-zinc-400 border-zinc-700/50 hover:bg-zinc-700/60",
              )}
            >
              {l.label}
              {l.src && (
                <span
                  role="button"
                  tabIndex={-1}
                  title={l.visible ? "Ocultar" : "Mostrar"}
                  onClick={(e) => { e.stopPropagation(); toggleVisible(l.id); }}
                  className={cn("transition-opacity", isActive ? "hover:opacity-70" : "hover:text-white")}
                >
                  <Eye size={11} className={l.visible ? "" : "opacity-30"} />
                </span>
              )}
            </button>
          );
        })}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onUploadFile(f); e.target.value = ""; }}
      />

      {!layer.src ? (
        /* ── Sem asset — call-to-action limpo, nada desabilitado ── */
        <button
          type="button"
          onClick={onImport}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f?.type.startsWith("image/")) onUploadFile(f); }}
          className="w-full rounded-xl border border-dashed border-zinc-700 hover:border-acc2/60 hover:bg-zinc-800/40 transition-ui py-5 flex flex-col items-center gap-1.5 text-center"
        >
          <ImagePlus size={18} className="text-zinc-500" />
          <span className="text-[11px] font-medium text-zinc-300">Escolher {layer.label.toLowerCase()}</span>
          <span className="text-[9px] text-zinc-600">
            da galeria, ou{" "}
            <span onClick={(e) => { e.stopPropagation(); pickFile(); }} className="text-acc2 hover:underline">enviar arquivo</span>
          </span>
        </button>
      ) : (
        <>
          {/* ── Com asset — thumb + trocar/remover ── */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onImport}
              title="Trocar textura"
              className="w-11 h-11 flex-none rounded-lg border border-zinc-700/60 bg-zinc-900/60 overflow-hidden grid place-items-center hover:border-zinc-500 transition-ui"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={layer.src} alt="" className="w-full h-full object-cover" />
            </button>
            <button
              type="button"
              onClick={onImport}
              className="flex-1 py-1.5 rounded-lg text-[10px] font-medium bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-ui"
            >
              Trocar
            </button>
            <IconButton icon={X} label="Remover textura" onClick={onClear} />
          </div>

          {/* ── Controles essenciais ── */}
          <div className="space-y-1.5">
            <Slider
              label="Intensidade"
              value={layer.opacity}
              onChange={(v) => update({ opacity: v })}
              min={0} max={1} step={0.05}
              display={`${Math.round(layer.opacity * 100)}%`}
              defaultValue={oDef}
            />
            <Slider
              label="Contraste"
              value={layer.contrast}
              onChange={(v) => update({ contrast: v })}
              min={50} max={150} step={1}
              display={`${layer.contrast}%`}
              defaultValue={100}
            />
            <p className="text-[9px] text-zinc-600 leading-tight pt-0.5">
              Na cena: arraste pra mover · cantos = escala · topo = girar
            </p>
          </div>

          {/* ── Ajustes finos (disclosure) — Mistura, Recortar, Perspectiva ── */}
          <div className="pt-1 border-t border-zinc-800/60">
            <button
              type="button"
              onClick={() => setAdvanced((v) => !v)}
              className="w-full flex items-center gap-1.5 py-1 text-[10px] text-zinc-400 hover:text-zinc-200 transition-ui"
            >
              <ChevronRight size={11} className={cn("transition-transform", advanced && "rotate-90")} />
              <Sliders size={11} /> Ajustes finos
            </button>

            {advanced && (
              <div className="space-y-2 pt-1">
                {/* Mistura — select compacto */}
                <div className="space-y-0.5">
                  <label className="text-[10px] text-zinc-400">Mistura</label>
                  <Select skin="zinc" boxed ariaLabel="Mistura" className="w-full"
                    value={layer.blendMode}
                    onChange={(v) => update({ blendMode: v as LuzLayer["blendMode"] })}
                    options={LUZ_BLEND_OPTIONS.map((o) => ({ value: o.value, label: o.label }))} />
                </div>

                {/* Status: recorte / perspectiva — só visual (recorte: duplo-clique na
                    mídia · perspectiva: segurar Ctrl). Ação sutil de limpar quando ativo. */}
                <div className="space-y-1 text-[9px] leading-tight">
                  {!isFullCrop(layer.crop) ? (
                    <div className="flex items-center gap-1.5 text-zinc-400">
                      <Crop size={10} className="text-amber-400" /> Textura recortada
                      <button type="button" onClick={onResetCrop} className="text-zinc-500 hover:text-acc2 underline">limpar</button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 text-zinc-600">
                      <Crop size={10} /> Duplo-clique na mídia = recortar
                    </div>
                  )}
                  {(hasWarp || warpActive) ? (
                    <div className={cn("flex items-center gap-1.5", warpActive ? "text-acc" : "text-zinc-400")}>
                      <Frame size={10} /> {warpActive ? "Deformando… (Ctrl)" : "Perspectiva ativa"}
                      {hasWarp && !warpActive && (
                        <button type="button" onClick={onResetWarp} className="text-zinc-500 hover:text-acc2 underline">remover</button>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 text-zinc-600">
                      <Frame size={10} /> Segure Ctrl = perspectiva
                    </div>
                  )}
                </div>

                {/* Máscara — clipa a luz/sombra a uma região da cena */}
                <div className="space-y-0.5">
                  <label className="text-[10px] text-zinc-400">Aparecer só em</label>
                  <div className="grid grid-cols-3 gap-1">
                    {([
                      { value: "none", label: "Tudo" },
                      { value: "art", label: "Arte" },
                      { value: "surface", label: "Superfície" },
                    ] as const).map((o) => (
                      <button
                        key={o.value}
                        type="button"
                        onClick={() => update({ maskMode: o.value })}
                        className={cn(
                          "py-1.5 rounded-lg text-[10px] font-medium border transition-ui",
                          (layer.maskMode ?? "none") === o.value
                            ? "bg-acc2 text-zinc-950 border-acc2"
                            : "bg-zinc-800/60 text-zinc-400 border-zinc-700/50 hover:bg-zinc-700/60",
                        )}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Resetar ajustes da camada */}
                <button
                  type="button"
                  onClick={onReset}
                  className="w-full py-1.5 rounded-lg text-[10px] bg-zinc-800 text-zinc-400 hover:bg-zinc-700 transition-ui flex items-center justify-center gap-1"
                >
                  <RotateCcw size={10} /> Resetar ajustes
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
