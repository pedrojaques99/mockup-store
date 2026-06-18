"use client";

/**
 * RenderPanel — the Render tool's surface: art upload/frame, lighting + realism,
 * advanced passes, look presets, custom FX, export actions, cost tally, dev shadow
 * map, and AI enhance. All sliders use the shared <Slider>; presets come from the
 * shared looks module. State lives in the page and is passed in (SSoT).
 */
import { Sliders, Wand2, ChevronRight, RefreshCw, CheckCircle2, Loader2, AlertTriangle, Eye } from "lucide-react";
import ArtFramePanel from "@/components/ArtFramePanel";
import { ArtDropZone } from "@/components/photo-tools/ArtDropZone";
import { ExportBar } from "@/components/photo-tools/ExportBar";
import { Slider } from "@/components/ui/Slider";
import { IconButton } from "@/components/ui/IconButton";
import { LOOK_PRESETS, AI_BLEND_DEFAULTS, lookCssFilter } from "@/components/photo-tools/looks";
import type { FrameConfig } from "@/lib/art-frame";

type Dispatch<T> = React.Dispatch<React.SetStateAction<T>>;

export interface RenderPanelProps {
  // Art
  artPreview: string | null;
  artDims: { width: number; height: number } | null;
  frame: FrameConfig;
  setFrame: Dispatch<FrameConfig>;
  surfaceSize: { w: number; h: number };
  artFile: File | null;
  artHasAlpha?: boolean;
  clearArt: () => void;
  handleArtFile: (f: File) => void;
  // Lighting + realism
  shadowOpacity: number; setShadowOpacity: Dispatch<number>;
  realism: number; setRealism: Dispatch<number>;
  showAdvanced: boolean; setShowAdvanced: Dispatch<boolean>;
  highlightOpacity: number; setHighlightOpacity: Dispatch<number>;
  castOpacity: number; setCastOpacity: Dispatch<number>;
  maskContract: number; setMaskContract: Dispatch<number>;
  maskFeather: number; setMaskFeather: Dispatch<number>;
  lightWrap: number; setLightWrap: Dispatch<number>;
  matchScene: number; setMatchScene: Dispatch<number>;
  contactShadow: number; setContactShadow: Dispatch<number>;
  textureAmount: number; setTextureAmount: Dispatch<number>;
  specularOpacity: number; setSpecularOpacity: Dispatch<number>;
  cylinder: number; setCylinder: Dispatch<number>;
  setRenderUrl: Dispatch<string | null>;
  // Look presets + custom FX
  showCustomFX: boolean; setShowCustomFX: Dispatch<boolean>;
  activeLook: string; setActiveLook: Dispatch<string>;
  fxGrain: number; setFxGrain: Dispatch<number>;
  fxWarmth: number; setFxWarmth: Dispatch<number>;
  fxSaturation: number; setFxSaturation: Dispatch<number>;
  fxBrightness: number; setFxBrightness: Dispatch<number>;
  fxContrast: number; setFxContrast: Dispatch<number>;
  /** Preview de look no hover (filtro CSS aplicado na imagem do canvas). */
  onPreviewLook?: (filter: string | null) => void;
  // Actions
  activeImageUrl: string | null;
  renderUrl: string | null;
  handlePublish: () => void;
  publishState: string;
  handleRender: () => void;
  renderState: string;
  publishErr: string;
  renderErr: string;
  processErr: string;
  // Cost + AI
  analysis: { surfaceType: string; material?: string; confidence?: number; cached?: boolean } | null;
  aiBlendState: string;
  aiQuality: "fast" | "balanced" | "quality"; setAiQuality: Dispatch<"fast" | "balanced" | "quality">;
  shadowPreview: string | null;
  showShadowMap: boolean; setShowShadowMap: Dispatch<boolean>;
  showAiBlend: boolean; setShowAiBlend: Dispatch<boolean>;
  aiStrength: number; setAiStrength: Dispatch<number>;
  aiTexture: boolean; setAiTexture: Dispatch<boolean>;
  aiTextureOpacity: number; setAiTextureOpacity: Dispatch<number>;
  handleAIBlend: () => void;
  aiBlendErr: string;
}

export function RenderPanel(p: RenderPanelProps) {
  return (
    <>
      {/* Art upload + fit-mode controls (hidden #art-input-fs lives in the page, always mounted) */}
      {p.artPreview ? (
        <div className="bg-zinc-800/40 rounded-xl border border-zinc-700/40 p-2">
          <ArtFramePanel
            artPreview={p.artPreview}
            artDims={p.artDims}
            frame={p.frame}
            onFrameChange={p.setFrame}
            soWidth={p.surfaceSize.w}
            soHeight={p.surfaceSize.h}
            fileName={p.artFile?.name}
            onClear={p.clearArt}
            previewHeightClass="h-32"
            compact
          />
          <button onClick={() => document.getElementById("art-input-fs")?.click()}
            className="mt-1.5 w-full text-[9px] text-zinc-600 hover:text-zinc-400 transition-colors">
            Trocar arte
          </button>
        </div>
      ) : (
        <ArtDropZone onFile={p.handleArtFile} dragOver={false} size="panel" />
      )}

      {/* Lighting — shadow (multiply) · ambient (screen) · color cast */}
      <div className="space-y-2">
        <Slider label={<><Sliders size={9} /> Sombra</>} value={p.shadowOpacity} onChange={p.setShadowOpacity}
          min={0} max={1} step={0.05} display={`${Math.round(p.shadowOpacity * 100)}%`} defaultValue={0.9} />
        <Slider label={<><Wand2 size={9} /> Realismo</>} hint="luz + sombra + grão" accent="acc2"
          value={p.realism} onChange={p.setRealism} min={0} max={1} step={0.05} display={`${Math.round(p.realism * 100)}%`} defaultValue={0.3} />
        <button onClick={() => p.setShowAdvanced((v) => !v)}
          className="w-full flex items-center justify-between text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors pt-0.5">
          <span>Ajustes avançados</span>
          <ChevronRight size={11} className={["transition-transform", p.showAdvanced ? "rotate-90" : ""].join(" ")} />
        </button>
        {p.showAdvanced && (<>
          <Slider label="Luz ambiente" value={p.highlightOpacity} onChange={p.setHighlightOpacity}
            min={0} max={1} step={0.05} display={`${Math.round(p.highlightOpacity * 100)}%`} defaultValue={0.1} />
          <Slider label="Matiz" hint="tom da cena" value={p.castOpacity} onChange={p.setCastOpacity}
            min={0} max={0.5} step={0.02} display={`${Math.round(p.castOpacity * 100)}%`} defaultValue={0.1} />
          <Slider label="Limpar borda" hint="tira franja cinza" value={p.maskContract} onChange={p.setMaskContract}
            min={0} max={8} step={1} suffix="px" defaultValue={1} />
          <Slider label="Suavizar borda" value={p.maskFeather} onChange={p.setMaskFeather}
            min={0} max={30} step={1} suffix="px" defaultValue={3} />
          {/* Reflexo (intensidade + espalhar) vive na tab Reflexo — feature auto-contida. */}
          <Slider label="Luz nas bordas" hint="luz do ambiente na borda" value={p.lightWrap} onChange={p.setLightWrap}
            min={0} max={1} step={0.05} display={`${Math.round(p.lightWrap * 100)}%`} defaultValue={0.17} />
          <Slider label="Casar cena" hint="grão + temperatura" value={p.matchScene} onChange={p.setMatchScene}
            min={0} max={1} step={0.05} display={`${Math.round(p.matchScene * 100)}%`} defaultValue={0.2} />
          <Slider label="Sombra de contato" hint="aterra a superfície" value={p.contactShadow} onChange={p.setContactShadow}
            min={0} max={1} step={0.05} display={`${Math.round(p.contactShadow * 100)}%`} defaultValue={0.24} />
          <Slider label="Textura" hint="arte segue o relevo" value={p.textureAmount} onChange={p.setTextureAmount}
            min={0} max={1} step={0.05} display={`${Math.round(p.textureAmount * 100)}%`} defaultValue={0} />
          <Slider label="Brilho" hint="specular (vidro/tela)" value={p.specularOpacity} onChange={p.setSpecularOpacity}
            min={0} max={1} step={0.05} display={`${Math.round(p.specularOpacity * 100)}%`} defaultValue={0} />
          <Slider label="Cilindro" hint="curvar" value={p.cylinder} onChange={(v) => { p.setCylinder(v); p.setRenderUrl(null); }}
            min={0} max={1} step={0.02} display={`${Math.round(p.cylinder * 100)}%`} defaultValue={0} />
        </>)}
      </div>

      {/* Look presets */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-zinc-400">Visual</span>
          <button onClick={() => p.setShowCustomFX((v) => !v)}
            className="text-[9px] text-zinc-500 hover:text-zinc-300 transition-colors flex items-center gap-1">
            <Sliders size={8} /> {p.showCustomFX ? "Ocultar" : "Personalizar"}
          </button>
        </div>
        <div className="flex gap-1 flex-wrap">
          {LOOK_PRESETS.map((preset) => (
            <button key={preset.name}
              onMouseEnter={() => p.onPreviewLook?.(lookCssFilter(preset))}
              onMouseLeave={() => p.onPreviewLook?.(null)}
              onClick={() => { p.onPreviewLook?.(null); p.setActiveLook(preset.name); p.setFxGrain(preset.grain); p.setFxWarmth(preset.warmth); p.setFxSaturation(preset.saturation); p.setFxBrightness(preset.brightness); p.setFxContrast(100); }}
              className={["px-2 py-0.5 rounded-full text-[10px] transition-colors",
                p.activeLook === preset.name ? "bg-zinc-200 text-zinc-900 font-medium" : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"].join(" ")}>
              {preset.name}
            </button>
          ))}
        </div>
      </div>

      {/* Custom FX */}
      {p.showCustomFX && (
        <div className="border-t border-zinc-800 pt-2 space-y-2">
          {([
            { label: "Grão",      value: p.fxGrain,      set: p.setFxGrain,      min: 0,    max: 100, step: 1, def: 0,   accent: "accent-zinc-400", fmt: (v: number) => `${v}%` },
            { label: "Calor",     value: p.fxWarmth,     set: p.setFxWarmth,     min: -100, max: 100, step: 5, def: 0,   accent: "accent-acc",      fmt: (v: number) => (v > 0 ? `+${v}` : `${v}`) },
            { label: "Saturação", value: p.fxSaturation, set: p.setFxSaturation, min: 0,    max: 200, step: 5, def: 100, accent: "accent-acc",      fmt: (v: number) => `${v}%` },
            { label: "Claridade", value: p.fxBrightness, set: p.setFxBrightness, min: 50,   max: 150, step: 5, def: 100, accent: "accent-acc",      fmt: (v: number) => `${v}%` },
            { label: "Contraste", value: p.fxContrast,   set: p.setFxContrast,   min: 50,   max: 150, step: 5, def: 100, accent: "accent-acc",      fmt: (v: number) => `${v}%` },
          ] as const).map(({ label, value, set, min, max, step, def, accent, fmt }) => (
            <div key={label} className="space-y-0.5">
              <label className="text-[10px] text-zinc-400 flex items-center justify-between">
                <span className="flex items-center gap-1">
                  {label}
                  {value !== def && <span className="w-1 h-1 rounded-full inline-block bg-acc" title="alterado — duplo-clique reseta" />}
                </span>
                <span className="font-mono text-zinc-500">{fmt(value)}</span>
              </label>
              <input type="range" min={min} max={max} step={step} value={value}
                onChange={(e) => { p.setActiveLook("Custom"); (set as (v: number) => void)(Number(e.target.value)); }}
                onDoubleClick={() => { p.setActiveLook("Custom"); (set as (v: number) => void)(def); }}
                title="Duplo-clique reseta ao padrão"
                className={["w-full h-1", accent].join(" ")} />
            </div>
          ))}
        </div>
      )}

      {/* Export — formato + qualidade + salvar */}
      <ExportBar src={p.activeImageUrl} />

      {/* Actions */}
      <div className="flex items-center gap-1.5">
        <button onClick={p.handlePublish} disabled={!p.renderUrl || p.publishState === "loading"}
          className={["flex-1 justify-center px-3 py-2 rounded-xl text-xs transition-colors flex items-center gap-1.5",
            p.publishState === "done" ? "bg-acc2 text-zinc-950" : "bg-zinc-800 hover:bg-zinc-700 text-zinc-400 disabled:text-zinc-600"].join(" ")}>
          {p.publishState === "done" ? <><CheckCircle2 size={11} /> Salvo!</> :
           p.publishState === "loading" ? <><Loader2 size={11} className="animate-spin" /> Salvando…</> :
           "Biblioteca"}
        </button>
        <IconButton icon={RefreshCw} label="Renderizar de novo" onClick={p.handleRender}
          disabled={!p.artFile || p.renderState === "loading"} className="w-9 h-9 rounded-xl" />
      </div>
      {p.publishErr && <p className="text-red-400 text-[9px]">{p.publishErr}</p>}
      {p.renderErr && <p className="text-red-400 text-[9px] flex items-center gap-1"><AlertTriangle size={8} /> {p.renderErr}</p>}
      {p.processErr && <p className="text-red-400 text-[9px] flex items-center gap-1"><AlertTriangle size={8} /> {p.processErr}</p>}

      {/* Cost tally */}
      {p.renderState === "done" && ((): React.ReactNode => {
        const aiDetectCost = (p.analysis?.surfaceType === "manual" || !p.analysis?.confidence) ? 0 : p.analysis?.cached ? 0 : 0.01;
        const aiBlendCost = p.aiBlendState === "done"
          ? (p.aiQuality === "fast" ? 0.005 : p.aiQuality === "balanced" ? 0.015 : 0.045) : 0;
        const total = aiDetectCost + aiBlendCost;
        return (
          <div className="flex items-center gap-1.5 text-[9px] font-mono text-zinc-600">
            {aiDetectCost > 0 ? <span>detecção ~${aiDetectCost.toFixed(3)}</span> : <span>manual·$0</span>}
            {aiBlendCost > 0 && <><span>+</span><span>melhorar ~${aiBlendCost.toFixed(3)}</span></>}
            <span className="text-zinc-500 ml-auto">~${total.toFixed(3)}</span>
          </div>
        );
      })()}

      {/* Shadow map preview — só em desenvolvimento (artefato interno, não pro usuário). */}
      {process.env.NODE_ENV === "development" && p.shadowPreview && (
        <div className="rounded-lg border border-zinc-800 overflow-hidden">
          <button onClick={() => p.setShowShadowMap((v) => !v)}
            className="w-full flex items-center justify-between px-2.5 py-1.5 text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors">
            <span className="flex items-center gap-1">
              <Eye size={9} /> Mapa de sombra
              <span className="bg-zinc-800 text-zinc-500 px-1 rounded text-[9px]">dev</span>
            </span>
            <ChevronRight size={9} className={["transition-transform", p.showShadowMap ? "rotate-90" : ""].join(" ")} />
          </button>
          {p.showShadowMap && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.shadowPreview} alt="shadow map" className="w-full border-t border-dashed border-zinc-800 opacity-60" />
          )}
        </div>
      )}

      {/* AI Enhance */}
      {p.renderUrl && (
        <div className={["rounded-xl border transition-all overflow-hidden", p.showAiBlend ? "border-acc/40 bg-acc/5" : "border-zinc-800"].join(" ")}>
          <button onClick={() => p.setShowAiBlend((v) => !v)} className="w-full flex items-center justify-between px-3 py-2">
            <span className={["flex items-center gap-1.5 text-[11px] font-medium", p.showAiBlend ? "text-acc" : "text-zinc-400"].join(" ")}>
              <Wand2 size={10} className={p.showAiBlend ? "text-acc" : "text-zinc-500"} />
              Melhorar
              {p.analysis && AI_BLEND_DEFAULTS[p.analysis.surfaceType]?.enabled && !p.showAiBlend && (
                <span className="text-[9px] px-1 py-0 rounded-full bg-acc/20 text-acc">rec</span>
              )}
            </span>
            <ChevronRight size={9} className={["text-zinc-600 transition-transform", p.showAiBlend ? "rotate-90" : ""].join(" ")} />
          </button>
          {p.showAiBlend && (
            <div className="px-3 pb-3 space-y-2.5 border-t border-zinc-800 pt-2.5">
              <div className="grid grid-cols-3 gap-1">
                {(["fast", "balanced", "quality"] as const).map((q) => (
                  <button key={q} onClick={() => p.setAiQuality(q)}
                    className={["py-1.5 rounded-lg text-[10px] font-medium transition-colors",
                      p.aiQuality === q ? "bg-acc text-zinc-950" : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"].join(" ")}>
                    <span>{q === "fast" ? "Rápido" : q === "balanced" ? "Equilíbrio" : "Alta"}</span>
                    <span className={["block text-[9px] font-normal", p.aiQuality === q ? "text-acc" : "text-zinc-600"].join(" ")}>
                      {q === "fast" ? "$0.005" : q === "balanced" ? "$0.015" : "$0.045"}
                    </span>
                  </button>
                ))}
              </div>
              <div className="space-y-0.5">
                <label className="text-[10px] text-zinc-400 flex items-center justify-between">
                  <span>Intensidade</span>
                  <span className="text-zinc-300 font-mono">{Math.round(p.aiStrength * 100)}%</span>
                </label>
                <input type="range" min={0.05} max={0.70} step={0.05} value={p.aiStrength}
                  onChange={(e) => p.setAiStrength(Number(e.target.value))}
                  className="w-full accent-acc h-1" />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-zinc-400">Textura</span>
                <div className="flex items-center gap-2">
                  {p.aiTexture && <span className="text-[9px] text-zinc-500 font-mono">{Math.round(p.aiTextureOpacity * 100)}%</span>}
                  <button onClick={() => p.setAiTexture((v) => !v)}
                    className={["relative w-7 h-3.5 rounded-full transition-colors flex-none", p.aiTexture ? "bg-acc" : "bg-zinc-700"].join(" ")}>
                    <span className={["absolute top-0.5 w-2.5 h-2.5 rounded-full bg-white shadow transition-transform",
                      p.aiTexture ? "translate-x-3.5" : "translate-x-0.5"].join(" ")} />
                  </button>
                </div>
              </div>
              {p.aiTexture && (
                <input type="range" min={0} max={0.6} step={0.05} value={p.aiTextureOpacity}
                  onChange={(e) => p.setAiTextureOpacity(Number(e.target.value))}
                  className="w-full accent-acc h-1" />
              )}
              <button onClick={p.handleAIBlend} disabled={p.aiBlendState === "loading"}
                className="w-full py-2 rounded-xl bg-acc hover:bg-acc disabled:bg-zinc-700 disabled:text-zinc-500 text-[11px] font-medium transition-colors flex items-center justify-center gap-1.5">
                {p.aiBlendState === "loading"
                  ? <><Loader2 size={10} className="animate-spin" /> Aplicando…</>
                  : <><Wand2 size={10} /> {p.aiBlendState === "done" ? "Reaplicar" : "Aplicar"}</>}
              </button>
              {p.aiBlendErr && <p className="text-red-400 text-[9px] flex items-center gap-1"><AlertTriangle size={8} /> {p.aiBlendErr}</p>}
            </div>
          )}
        </div>
      )}
    </>
  );
}
