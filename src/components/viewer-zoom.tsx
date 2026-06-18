"use client";

/**
 * Zoom atual do ZoomPanViewer exposto aos filhos. Tools usam pra contra-escalar
 * alças/contornos por 1/zoom → tamanho de TELA constante em qualquer zoom (Figma).
 */
import { createContext, useContext } from "react";

export const ViewerZoomContext = createContext(1);
export const useViewerZoom = () => useContext(ViewerZoomContext);
