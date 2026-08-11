"use client";

/**
 * Smart Objects — o seletor de face, em forma de camadas do Photoshop.
 *
 * Com UM smart object não há escolha a fazer: a lista mostraria a face que já
 * está ativa, e acordeão de um item só é controle morto. Por isso o componente
 * inteiro não renderiza abaixo de dois.
 *
 * O aberto/fechado continua na página porque ela sincroniza a seção de arte com
 * ele. O que MUDOU é que a sincronia deixou de ser um `useEffect` observando o
 * próprio estado e virou parte do handler: quem fecha é quem sabe que fechou.
 *
 * ⚠️ A identidade da face é `smartObject`/`path`, NUNCA `name`: `name` é rótulo
 * curto de UI e casa o alvo errado no render (a arte cobre a cena inteira e a
 * face fica com o placeholder). O `findIndex` abaixo aceita os dois porque
 * PSD antigo do acervo não tem `path`, mas a ordem importa.
 */
import { Layers, ChevronDown, Image as ImageIcon } from "lucide-react";
import { ColorPicker } from "@/components/ui/ColorPicker";
import type { PsdInfo, Face, ArtSlot } from "./types";

export interface SmartObjectListProps {
  psdInfo: PsdInfo | null;
  faces: Face[];
  artSlots: Record<number, ArtSlot>;
  activeSlot: number;
  aberto: boolean;
  onAbertoChange: (aberto: boolean) => void;
  /** Selecionar uma face: ativa o slot, aponta o alvo e reabre a seção de arte. */
  onSelectFace: (faceIdx: number, smartObject: string) => void;
  /** Clique na miniatura. `temArte` decide entre focar o slot e pedir o arquivo. */
  onPickArt: (faceIdx: number, temArte: boolean) => void;
  /** Cor escolhida por camada — `{ [path]: "#rrggbb" }`. Ausente = a do arquivo. */
  colors: Record<string, string>;
  onColorChange: (path: string, hex: string | null) => void;
}

export function SmartObjectList({
  psdInfo,
  faces,
  artSlots,
  activeSlot,
  aberto,
  onAbertoChange,
  onSelectFace,
  onPickArt,
  colors,
  onColorChange,
}: SmartObjectListProps) {
  const cores = psdInfo?.colorSlots ?? [];
  // Some junto com a lista de faces, mas volta sozinho quando o PSD tem UMA
  // face e cores editáveis — aí não há escolha de face a fazer e ainda há o que
  // ajustar. Sumir com a cor por causa da contagem de smart objects seria
  // esconder função por um motivo que não é dela.
  if (!psdInfo || (psdInfo.smartObjects.length <= 1 && cores.length === 0)) return null;
  const soMostraCor = psdInfo.smartObjects.length <= 1;

  return (
    <div className="bg-neutral-900/30 border border-neutral-800 rounded-2xl overflow-hidden">
      <button
        onClick={() => onAbertoChange(!aberto)}
        aria-expanded={aberto}
        className="w-full flex items-center justify-between px-4 py-3 text-[10px] font-medium text-neutral-500 hover:bg-white/5 transition-ui"
      >
        <div className="flex items-center gap-2 text-neutral-300">
          <Layers className="w-3.5 h-3.5 text-neutral-500" />
          {soMostraCor ? `Cores (${cores.length})` : `Smart Objects (${psdInfo.smartObjects.length})`}
        </div>
        <ChevronDown className={`w-4 h-4 transition-transform [transition-duration:var(--dur-slow)] ${aberto ? "" : "-rotate-90"}`} />
      </button>

      {aberto && (
        <div className="border-t border-neutral-800 overflow-y-auto max-h-72 no-scrollbar">
          {!soMostraCor && psdInfo.smartObjects.map((so, i) => {
            const alvo = so.path || so.name;
            const faceIdx = faces.findIndex((f) => f.smartObject === alvo || f.name === so.name);
            const isFace = faceIdx >= 0;
            const slot = isFace ? (artSlots[faceIdx] ?? null) : null;
            const isActive = isFace && activeSlot === faceIdx;

            return (
              <div
                key={i}
                onClick={() => { if (isFace) onSelectFace(faceIdx, alvo); }}
                className={`flex items-center gap-3 px-3 py-2.5 border-b border-neutral-900/70 last:border-b-0 transition-ui select-none ${
                  isFace ? (isActive ? "bg-white/8 cursor-pointer" : "hover:bg-white/4 cursor-pointer") : "opacity-35 cursor-default"
                }`}
              >
                <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${isActive ? "bg-white" : isFace ? "bg-neutral-600" : "bg-neutral-800"}`} />

                <div className="flex-1 min-w-0">
                  <p className={`text-[11px] font-bold truncate ${isActive ? "text-white" : isFace ? "text-neutral-300" : "text-neutral-500"}`}>{so.name}</p>
                  {so.path && so.path.includes(" > ") && (
                    <p className="text-[9px] text-neutral-500 truncate">{so.path.split(" > ").slice(0, -1).join(" › ")}</p>
                  )}
                </div>

                <span className={`text-[9px] font-mono shrink-0 ${isActive ? "text-neutral-400" : "text-neutral-500"}`}>
                  {so.innerWidth}×{so.innerHeight}
                </span>

                {isFace ? (
                  <div
                    className={`shrink-0 w-8 h-8 rounded-lg overflow-hidden border transition-ui ${isActive ? "border-white/40 shadow-lg shadow-white/5" : "border-neutral-800"}`}
                    onClick={(e) => { e.stopPropagation(); onPickArt(faceIdx, !!slot?.preview); }}
                  >
                    {slot?.preview ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={slot.preview} alt={so.name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-neutral-900">
                        <ImageIcon className="w-3 h-3 text-neutral-500" />
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="w-8 shrink-0" />
                )}
              </div>
            );
          })}

        </div>
      )}

      {/* Cores FORA da caixa de rolagem dos smart objects — de propósito.
          Dentro dela, num PSD com 7 SOs, o seletor nascia abaixo da dobra de um
          scroll de 288px: existia no DOM e não existia para o usuário. Aqui ele
          fica sempre visível enquanto a seção está aberta, encostado na seção de
          arte, que é onde a decisão de cor acontece. */}
      {aberto && cores.length > 0 && (
        <div className={soMostraCor ? "" : "border-t border-neutral-800"}>
          {!soMostraCor && (
            <div className="px-3 pt-2.5 pb-1 text-[9px] font-medium text-neutral-500 uppercase tracking-wide">
              Cores ({cores.length})
            </div>
          )}
          {cores.map((c) => {
                const atual = colors[c.path] ?? c.hex;
                const mudou = atual.toLowerCase() !== c.hex.toLowerCase();
                return (
                  <div
                    key={c.path}
                    className="flex items-center gap-3 px-3 py-2.5 border-b border-neutral-900/70 last:border-b-0 select-none"
                  >
                    <div
                      className={`w-1.5 h-1.5 rounded-full shrink-0 ${mudou ? "bg-white" : "bg-neutral-600"}`}
                    />
                    <div className="flex-1 min-w-0">
                      <p className={`text-[11px] font-bold truncate ${mudou ? "text-white" : "text-neutral-300"}`}>
                        {c.name}
                      </p>
                      <p className="text-[9px] text-neutral-500 truncate">
                        {c.hidden ? "oculta no arquivo · " : ""}
                        {c.blendMode}
                        {c.opacity < 1 ? ` · ${Math.round(c.opacity * 100)}%` : ""}
                      </p>
                    </div>
                    <ColorPicker
                      value={atual}
                      onChange={(cor) => onColorChange(c.path, cor)}
                      swatches={[{ valor: c.hex, titulo: `Original do arquivo (${c.hex})` }]}
                    />
                  </div>
                );
              })}
        </div>
      )}
    </div>
  );
}
