"use client";

/**
 * Detalhes do PSD — inspeção, não produção.
 *
 * Eram DOIS blocos permanentes acima do que decide: um acordeão "Camadas de
 * ajuste" e uma linha de arquivo/MB/px, ~92px que ninguém consulta para enquadrar
 * uma arte. Existiam porque o dado estava à mão, que é o vício clássico de
 * painel. Viraram um bloco só, fechado por padrão: alcançável para os 3% que
 * precisam, sumido para os 97%. Também matou o box-dentro-de-box (moldura tingida
 * dentro de moldura tingida) que o acordeão interno criava.
 *
 * Sai do `page.tsx` com QUATRO props porque o aberto/fechado é estado dele, não
 * da página — a página guardava um `useState` que só esta caixa lia.
 */
import { useState } from "react";
import { Settings2, ChevronDown } from "lucide-react";
import { dec } from "@/lib/utils";
import type { PsdInfo } from "./types";

export interface PsdDetailsProps {
  psdInfo: PsdInfo | null;
  /** Caminho do arquivo no disco; o nome exibido é o último segmento. */
  psdPath?: string;
  psdSizeBytes?: number;
  /** Camadas de ajuste desligadas para o render. */
  hiddenLayers: Set<string>;
  onToggleLayer: (path: string) => void;
}

export function PsdDetails({ psdInfo, psdPath, psdSizeBytes, hiddenLayers, onToggleLayer }: PsdDetailsProps) {
  const [aberto, setAberto] = useState(false);
  const ajustes = psdInfo?.adjustments.filter((a) => !a.hidden) ?? [];

  return (
    <div className="border-t border-neutral-900 pt-3 pb-6">
      <button
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        className="w-full flex items-center justify-between gap-2 px-1 py-1.5 text-[10px] font-medium text-neutral-500 hover:text-neutral-300 transition-ui rounded-lg"
      >
        <span className="flex items-center gap-2">
          <Settings2 className="w-3.5 h-3.5" />
          Detalhes do PSD
        </span>
        <ChevronDown className={`w-4 h-4 transition-transform [transition-duration:var(--dur-base)] ${aberto ? "" : "-rotate-90"}`} />
      </button>

      {aberto && (
        <div className="pt-2 space-y-2">
          <p className="text-[10px] text-neutral-500 leading-relaxed px-1">
            {psdPath?.split(/[/\\]/).pop()}
            {psdSizeBytes ? ` · ${dec(psdSizeBytes / 1e6)} MB` : ""}
            {psdInfo ? ` · ${psdInfo.width}×${psdInfo.height} px` : ""}
          </p>
          {ajustes.length > 0 && (
            <div className="space-y-0.5">
              {ajustes.map((a, i) => {
                const alvo = a.path || a.name;
                const desligada = hiddenLayers.has(alvo);
                return (
                  <label
                    key={i}
                    className={`flex items-center gap-3 py-2 px-1 rounded-xl cursor-pointer transition-ui ${desligada ? "opacity-40" : "hover:bg-white/5"}`}
                  >
                    <input
                      type="checkbox"
                      checked={!desligada}
                      onChange={() => onToggleLayer(alvo)}
                      className="accent-white w-3.5 h-3.5"
                    />
                    <span className={`text-[11px] font-bold truncate flex-1 ${desligada ? "line-through" : "text-neutral-300"}`}>{a.name}</span>
                    <span className="text-[9px] font-bold text-neutral-500">{a.type}</span>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
