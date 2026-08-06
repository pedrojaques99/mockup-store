"use client";

/**
 * Zoom atual do ZoomPanViewer exposto aos filhos. Tools usam pra contra-escalar
 * alças/contornos por 1/zoom → tamanho de TELA constante em qualquer zoom (Figma).
 */
import { createContext, useContext } from "react";

export const ViewerZoomContext = createContext(1);
export const useViewerZoom = () => useContext(ViewerZoomContext);

/**
 * Sensibilidade do zoom por roda do mouse. Um número só, porque é FEEL: se o zoom
 * for rápido demais numa tela e certo na outra, o operador aprende dois gestos
 * para a mesma intenção.
 *
 * Estava escrito à mão em dois lugares — `ZoomPanViewer` (DOM/CSS transform) e
 * `photo-tools/CalibrateStage` (Konva) — com a mesma constante `0.0015` e a mesma
 * exponencial, copiadas na unha em vez de importadas. Ajuste por reclamação de UX
 * consertaria metade das telas.
 *
 * O que NÃO mora aqui: o alcance do zoom. Os dois já divergiram de propósito
 * (viewer 0,4–32; stage 0,1–40) porque um é leitura de mockup e o outro é encaixe
 * de canto, que pede aproximação maior. Juntar os dois seria mudar comportamento
 * sem ninguém ter pedido.
 */
export const WHEEL_STEP = 0.0015;

/** Fator multiplicativo do zoom para um `deltaY` de roda. Exponencial para o passo
 *  ser proporcional (zoom perto e zoom longe custam o mesmo gesto). */
export const wheelZoomFactor = (deltaY: number) => Math.exp(-deltaY * WHEEL_STEP);
