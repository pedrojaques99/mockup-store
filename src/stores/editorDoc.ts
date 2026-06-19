"use client";

/**
 * editorDoc — SSoT do **state de documento** do photo-mockup (o que o undo deve
 * rastrear). Zustand + zundo (`temporal`): undo/redo do objeto inteiro, sem lista
 * manual de campos. UI transitória (tool, panelOpen, loading, refs) fica em
 * `useState` no componente — não é undoable.
 *
 * Adaptador `useDocField("campo")` tem a MESMA assinatura do `useState`, então os
 * call sites e as props dos panels não mudam. Toda feature nova que cair no DocState
 * entra no undo automaticamente.
 */
import { create, useStore } from "zustand";
import { temporal, type TemporalState } from "zundo";
import { useCallback } from "react";
import { DEFAULT_FRAME, type FrameConfig } from "@/lib/art-frame";
import { LUZ_DEFAULTS, type LuzLayer } from "@/types/luz";
import type { WarpMesh } from "@/lib/mesh-core";

export interface QuadPt { x: number; y: number }
export interface Quad { tl: QuadPt; tr: QuadPt; br: QuadPt; bl: QuadPt }
export interface Bend { top: number; bottom: number; left: number; right: number }

/** Campos versionados pelo undo. Adicione aqui → já entra no Ctrl+Z. */
export interface DocState {
  // luz/sombra (extract + render)
  shadowOpacity: number;
  highlightOpacity: number;
  castOpacity: number;
  reflectionOpacity: number;
  reflectionBlur: number;
  lightWrap: number;
  matchScene: number;
  contactShadow: number;
  // fx
  fxGrain: number;
  fxWarmth: number;
  fxSaturation: number;
  fxBrightness: number;
  fxContrast: number;
  // extract tuning
  maskFeather: number;
  maskContract: number;
  shadowFloor: number;
  preBlur: number;
  // geometria/superfície
  cylinder: number;
  bend: Bend;
  textureAmount: number;
  specularOpacity: number;
  quad: Quad | null;
  /** Malha de warp (grade Coons + hastes Bézier) — SSoT compartilhado com /calibrate. */
  mesh: WarpMesh | null;
  /** Displacement do RELEVO (foto/material) — amplitude (px) + blur. SSoT com /calibrate.
   *  Trabalha JUNTO com a malha: malha = warp macro, disp = relevo micro (composto no render). */
  dispScale: number;
  dispBlur: number;
  /** Material/substrato procedural (espelhado do /calibrate). */
  surfaceMaterial: string;        // "none" | "fabric" | "metal" | "glass" | "worn" | "shadow"
  surfaceMaterialIntensity: number;
  surfaceMaterialAngle: number;
  surfaceMaterialScale: number;
  /** Substrato detectado/escolhido (auto-classify ou override). Alimenta o
   *  self-learning loop: vai no payload do publish → engine-feedback agrega. */
  substrate: string | null;
  /** Cena calibrada vinculada (`${dir}::${sceneName}`) — base do botão "importar / salvar". */
  calibrationKey: string | null;
  frame: FrameConfig;
  // máscaras (data URLs)
  surfaceMaskUrl: string | null;
  occluderMaskUrl: string | null;
  reflectionMaskUrl: string | null;
  aiEditMaskUrl: string | null;
  surfaceOn: boolean;
  occluderOn: boolean;
  reflectionLayerOn: boolean;
  // luz overlays (asset + transform + crop)
  luzLayers: LuzLayer[];
}

export const DEFAULT_DOC: DocState = {
  shadowOpacity: 0.9,
  highlightOpacity: 0.1,
  castOpacity: 0.1,
  reflectionOpacity: 0,
  reflectionBlur: 24,
  // derivados de realism=0.3 (o "look aterrado" que o effect de mount aplicava antes)
  lightWrap: 0.17,
  matchScene: 0.2,
  contactShadow: 0.24,
  fxGrain: 0,
  fxWarmth: 0,
  fxSaturation: 100,
  fxBrightness: 100,
  fxContrast: 100,
  maskFeather: 3,
  maskContract: 1,
  shadowFloor: 0,
  preBlur: 0,
  cylinder: 0,
  bend: { top: 0, bottom: 0, left: 0, right: 0 },
  textureAmount: 0,
  specularOpacity: 0,
  quad: null,
  mesh: null,
  dispScale: 0,
  dispBlur: 8,
  surfaceMaterial: "none",
  surfaceMaterialIntensity: 0.5,
  surfaceMaterialAngle: 35,
  surfaceMaterialScale: 6,
  substrate: null,
  calibrationKey: null,
  frame: DEFAULT_FRAME,
  surfaceMaskUrl: null,
  occluderMaskUrl: null,
  reflectionMaskUrl: null,
  aiEditMaskUrl: null,
  surfaceOn: true,
  occluderOn: true,
  reflectionLayerOn: true,
  luzLayers: LUZ_DEFAULTS,
};

interface EditorStore {
  doc: DocState;
  setField: <K extends keyof DocState>(key: K, v: DocState[K] | ((p: DocState[K]) => DocState[K])) => void;
  /** Aplica um patch sem disparar entrada de histórico granular (load de cena/foto). */
  resetDoc: (patch?: Partial<DocState>) => void;
}

/** Throttle leading — a 1ª mudança de um burst (ex: arrastar slider) grava o estado
 *  anterior; as seguintes na janela são ignoradas pro histórico → 1 passo por gesto. */
function leadingThrottle<F extends (...a: never[]) => void>(fn: F, ms: number): F {
  let last = -Infinity;
  return ((...args: never[]) => {
    const now = performance.now();
    if (now - last >= ms) { last = now; fn(...args); }
  }) as F;
}

export const useEditorDoc = create<EditorStore>()(
  temporal(
    (set) => ({
      doc: DEFAULT_DOC,
      setField: (key, v) =>
        set((s) => ({
          doc: { ...s.doc, [key]: typeof v === "function" ? (v as (p: DocState[typeof key]) => DocState[typeof key])(s.doc[key]) : v },
        })),
      resetDoc: (patch) => set((s) => ({ doc: { ...s.doc, ...(patch ?? DEFAULT_DOC) } })),
    }),
    {
      // Só o documento é versionado.
      partialize: (state) => ({ doc: state.doc }),
      limit: 80,
      handleSet: (handleSet) => leadingThrottle(handleSet as (...a: never[]) => void, 350) as typeof handleSet,
    },
  ),
);

/** Drop-in do `useState` lastreado no DocState — undo cobre o campo de graça. */
export function useDocField<K extends keyof DocState>(
  key: K,
): [DocState[K], (v: DocState[K] | ((p: DocState[K]) => DocState[K])) => void] {
  const value = useEditorDoc((s) => s.doc[key]);
  const setField = useEditorDoc((s) => s.setField);
  const set = useCallback(
    (v: DocState[K] | ((p: DocState[K]) => DocState[K])) => setField(key, v),
    [setField, key],
  );
  return [value, set];
}

/** Acesso reativo ao histórico (pra habilitar/contar undo-redo na UI, se preciso). */
export function useTemporal<T>(selector: (s: TemporalState<{ doc: DocState }>) => T): T {
  return useStore(useEditorDoc.temporal, selector);
}

/** Atalhos imperativos pro histórico (handlers de teclado / reset). */
export const editorHistory = {
  undo: () => useEditorDoc.temporal.getState().undo(),
  redo: () => useEditorDoc.temporal.getState().redo(),
  clear: () => useEditorDoc.temporal.getState().clear(),
};
