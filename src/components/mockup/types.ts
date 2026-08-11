/**
 * Os tipos que descrevem um PSD aberto no painel.
 *
 * Moram aqui, e não dentro do `page.tsx`, pelo motivo mais simples: assim que a
 * primeira seção do painel virou componente próprio, os dois arquivos passaram a
 * precisar da mesma forma. Tipo declarado dentro da página é o que faz o próximo
 * recorte parecer caro e a página continuar crescendo.
 *
 * `FrameConfig` NÃO entra aqui: ele já tem dono em `@/lib/art-frame`.
 */
import type { FrameConfig } from "@/lib/art-frame";

export interface SmartObjectInfo {
  name: string;
  path: string;
  innerWidth: number;
  innerHeight: number;
}

export interface AdjustmentInfo {
  name: string;
  path: string;
  type: string;
  hidden: boolean;
}

/** Face editável — o smart object que a arte de fato substitui. */
export interface Face {
  key: string;
  name: string;
  smartObject: string;
  innerWidth: number;
  innerHeight: number;
  linkedCount: number;
}

/**
 * Camada de cor sólida do PSD ("Cor do Fundo", "Left Cup Color") — o que a UI
 * oferece pra recolorir. Espelha o `ColorSlot` do engine.
 */
export interface ColorSlotInfo {
  path: string;
  name: string;
  /** Cor declarada no arquivo. É o swatch de "voltar ao original". */
  hex: string;
  blendMode: string;
  opacity: number;
  hidden: boolean;
}

export interface PsdInfo {
  smartObjects: SmartObjectInfo[];
  adjustments: AdjustmentInfo[];
  width: number;
  height: number;
  faces?: Face[];
  /** Ausente = PSD indexado antes do campo existir; `[]` = não tem cor editável. */
  colorSlots?: ColorSlotInfo[];
}

/** A arte de UMA face, com o enquadramento dela. */
export interface ArtSlot {
  file: File | null;
  preview: string;
  dims: { width: number; height: number } | null;
  frame: FrameConfig;
  img: HTMLImageElement | null;
}
