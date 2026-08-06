/**
 * Linguagem visual única das alças/contornos dos tools de canvas (Luz, Crop, Quad).
 * Tamanhos em px de TELA — os tools dividem por zoom (useViewerZoom) pra manter
 * constante em qualquer zoom do viewer.
 */
import { ACC, ACC2, ACC2_RGB, INK } from "@/lib/brand";

export const HANDLE_ACCENT = ACC2;           // verde BOXY (espelho de --color-acc2)
export const HANDLE_ACCENT_RGB = ACC2_RGB;
export const HANDLE_FILL = "#09090b";        // miolo escuro da alça

/**
 * Alça sendo arrastada ou selecionada. Verde-folha da casa, que o `brand.ts`
 * descreve como o transitório ("em progresso") — que é exatamente o que uma alça
 * sob o dedo é.
 *
 * Estava `#16a34a` na unha no `QuadEditor` e no `CalibrateStage`: green-600 do
 * Tailwind, não da BOXY. É a recaída que o cabeçalho do `brand.ts` já contava ter
 * acontecido uma vez com o ciano — o token seguiu a marca e o literal ficou para
 * trás, cada um sozinho no seu arquivo, meio da tela pintada de outra marca.
 */
export const HANDLE_ACTIVE = ACC;

/**
 * Alça secundária: as hastes de tangente do warp. Precisa ler como "outra coisa"
 * em relação ao canto, sem competir com ele. Sage, o texto de destaque da casa.
 * Era `#38bdf8` (sky-400) — o ciano que saiu da paleta quando a marca virou BOXY.
 */
export const HANDLE_TANGENT = INK;

/**
 * Tangente QUEBRADA (Alt): os dois lados deixam de ser simétricos.
 *
 * Fica fora da paleta de propósito, e é a única exceção deste arquivo. A paleta
 * da BOXY é mono-verde, então ela não tem como codificar "atenção" — pintar o
 * quebrado de verde faria o estado anormal parecer o normal, que é o oposto do
 * trabalho do aviso. Âmbar é o vocabulário universal de atenção e não colide com
 * nada da marca.
 */
export const HANDLE_BROKEN = "#f59e0b";
export const HANDLE_PX = 11;                 // lado da alça (px de tela)
export const HANDLE_BORDER = 2;              // borda da alça (px de tela)
export const OUTLINE_PX = 1.5;               // contorno de seleção (px de tela)
