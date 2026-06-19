/**
 * photo-render-params — SSoT dos parâmetros do render de mockup-foto.
 *
 * Existe UM core de render (`photo-render-core.ts`) usado pela prévia (/calibrate) e pela
 * produção (/photo-mockup/[id]/render) → WYSIWYG. Estas constantes são os **defaults de
 * produção** (a fonte da verdade): a prévia se alinha a elas. Mexer aqui muda os dois lados
 * juntos — é de propósito. Ver docs/PLAN-render-wysiwyg-unify.md.
 */

/** Extração de luz (multiply/screen) a partir da foto crua. */
export const LIGHT_FLOOR = 0;     // piso do multiply (0 = sombras cheias, como o bake de produção)
export const LIGHT_PREBLUR = 0;   // pré-blur antes do grayscale (0 = nítido)

/** Máscara da superfície. */
export const MASK_FEATHER = 3;    // feather base (px) no bake da máscara
export const MASK_CONTRACT = 1;   // defringe: contrai a borda (px) pra matar halo do fundo

/** Neutralização do marcador neon/magenta da cena. */
export const NEON_HUE = 300;
export const NEON_RANGE = 50;
export const NEON_MINSAT = 0.18;  // < 0.15 grayscaleia a cena toda — não baixar

/** Mapa de reflexo (onde a superfície magenta vazou pro chão/vidro). */
export const REFLECTION_OPTS = { hueCenter: 300, hueRange: 55, satLo: 0.04, satHi: 0.6 } as const;

/** Opacidades default dos overlays de luz/sombra/cast (iguais aos defaults do doc da cena). */
export const DEFAULT_OPACITY = { multiply: 0.20, screen: 0.30, cast: 0.10 } as const;

/** Qualidade do render: 'preview' = rápido (resolução reduzida, sem SSAA); 'hd' = produção. */
export type RenderQuality = "preview" | "hd";

/** Maior dimensão (px) da prévia rápida antes de aplicar SSAA. */
export const PREVIEW_MAX = 900;
