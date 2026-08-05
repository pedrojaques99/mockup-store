/**
 * Linguagem visual única das alças/contornos dos tools de canvas (Luz, Crop, Quad).
 * Tamanhos em px de TELA — os tools dividem por zoom (useViewerZoom) pra manter
 * constante em qualquer zoom do viewer.
 */
import { ACC2, ACC2_RGB } from "@/lib/brand";

export const HANDLE_ACCENT = ACC2;           // verde BOXY (espelho de --color-acc2)
export const HANDLE_ACCENT_RGB = ACC2_RGB;
export const HANDLE_FILL = "#09090b";        // miolo escuro da alça
export const HANDLE_PX = 11;                 // lado da alça (px de tela)
export const HANDLE_BORDER = 2;              // borda da alça (px de tela)
export const OUTLINE_PX = 1.5;               // contorno de seleção (px de tela)
