"use client";

/**
 * useMaskEditor — subsistema de máscara do photo-mockup (modelo Photoshop): uma
 * máscara persistente por alvo (surface/occluder/aiedit) + a do reflexo; os
 * instrumentos (caneta/pincel/varinha/SAM) somam/subtraem na máscara do alvo ativo.
 *
 * As máscaras e os toggles de camada vivem no DocState (useDocField) → entram no
 * undo global (zundo) de graça. O estado dos instrumentos é transitório de UI.
 *
 * Contrato de saída = mesmos nomes que o page.tsx já usava → desestruturar e pronto,
 * os panels (MaskPanel/ReflexoPanel) e o JSX dos overlays NÃO mudam. O único
 * acoplamento de saída é `onMaskChanged` (hoje: setProcessState("idle") → re-extrai).
 *
 * Robustez do compositing (todas as escritas de máscara passam por uma FILA serializada):
 *  - **Sem lost-update:** a base é lida FRESCA via `useEditorDoc.getState()` no momento
 *    da execução (não pelo closure), e os composites rodam um de cada vez → traços
 *    rápidos do pincel não se atropelam (cada um soma sobre o resultado do anterior).
 *  - **Memória/perf:** rasteriza no máximo a `MASK_MAX_EDGE` (capMaskDims) — base capada
 *    = decode barato, encode capado = traço rápido, undo/IndexedDB leves. O server
 *    reescala pra W×H de qualquer forma.
 */
import { useState, useRef, useCallback } from "react";
import { useDocField, editorHistory, useEditorDoc } from "@/stores/editorDoc";
import { compositeMask, invertMask, capMaskDims, resampleMask } from "@/lib/mask-compose";
import type { MaskInstrument, MaskTarget, MaskMode } from "@/components/photo-tools/registry";
import type { MaskView } from "@/components/photo-tools/panels/MaskPanel";
import type { SegApi } from "@/components/SegmentCanvas";
import type { PenApi } from "@/components/PenMaskCanvas";
import type { BrushApi } from "@/components/BrushCanvas";

/** Alvo → campo data-URL no DocState (lido fresco via getState dentro da fila). */
const MASK_FIELD = {
  surface: "surfaceMaskUrl",
  occluder: "occluderMaskUrl",
  aiedit: "aiEditMaskUrl",
} as const;

export function useMaskEditor({
  imgDims,
  onMaskChanged,
}: {
  imgDims: { w: number; h: number };
  /** Chamado quando uma máscara muda (apply/invert/clear/undo) — invalida o extract. */
  onMaskChanged: () => void;
}) {
  // SAM2 segmentation (optional) — refines lighting mask + occluder
  const [surfaceMaskUrl, setSurfaceMaskUrl] = useDocField("surfaceMaskUrl");
  const [occluderMaskUrl, setOccluderMaskUrl] = useDocField("occluderMaskUrl");
  // Máscara da IA — independente do render (surface/occluder); só guia o inpaint.
  const [aiEditMaskUrl, setAiEditMaskUrl] = useDocField("aiEditMaskUrl");
  // Mask editor (Photoshop model): one persistent mask per target; instruments
  // add/subtract into it. As máscaras vivem no DocState → undo = histórico global (zundo).
  const [maskTarget, setMaskTarget] = useState<MaskTarget>("surface");
  const [maskView, setMaskView] = useState<MaskView>("overlay"); // overlay colorido vs máscara grayscale isolada
  const [maskMode, setMaskMode] = useState<MaskMode>("add");

  const [reflectionMaskUrl, setReflectionMaskUrlRaw] = useDocField("reflectionMaskUrl"); // brush override
  // Non-destructive layer visibility — toggling hides a mask from the bake WITHOUT discarding it.
  const [surfaceOn, setSurfaceOn] = useDocField("surfaceOn");
  const [occluderOn, setOccluderOn] = useDocField("occluderOn");
  const [reflectionLayerOn, setReflectionLayerOn] = useDocField("reflectionLayerOn");

  // Recorte (Segment) tool options — live in the side panel (Photoshop-style),
  // controlled here; the canvas component just samples/draws and exposes apply via ref.
  const segApiRef = useRef<SegApi | null>(null);
  // Mask method — Varinha / SAM (SegmentCanvas) or Caneta (PenMaskCanvas). SSoT for
  // "how the surface/occluder is defined"; Caneta is a method here, not a separate view.
  const [maskMethod, setMaskMethod] = useState<MaskInstrument>("brush");
  const segMode: "sam" | "smart" = maskMethod === "sam" ? "sam" : "smart";
  const [segTol, setSegTol] = useState(15);
  const [segContract, setSegContract] = useState(1);
  const [segMatte, setSegMatte] = useState(true);
  const [segFeather, setSegFeather] = useState(2);
  const [segHasMask, setSegHasMask] = useState(false);
  const [segSwatch, setSegSwatch] = useState<[number, number, number] | null>(null);
  const [segStatus, setSegStatus] = useState<{ status: string; msg: string; device: string | null }>({ status: "loading", msg: "", device: null });
  // Caneta (Pen) + Reflexo (Brush) tool options — also in the side panel.
  const penApiRef = useRef<PenApi | null>(null);
  const [penFeather, setPenFeather] = useState(2);
  const [penHasMask, setPenHasMask] = useState(false);
  const [penStatus, setPenStatus] = useState("");
  const brushApiRef = useRef<BrushApi | null>(null);
  const [brushSize, setBrushSize] = useState(60);
  const [brushErase, setBrushErase] = useState(false);

  // ── Mask editor (add/subtract into the persistent per-target mask) ────────────
  const maskUrlFor = (t: MaskTarget) => (t === "surface" ? surfaceMaskUrl : t === "occluder" ? occluderMaskUrl : aiEditMaskUrl);
  const maskSetterFor = (t: MaskTarget) => (t === "surface" ? setSurfaceMaskUrl : t === "occluder" ? setOccluderMaskUrl : setAiEditMaskUrl);

  // Fila serializada — toda escrita de máscara entra aqui em ordem. Garante que um
  // composite só começa após o anterior ter COMMITADO no doc (getState reflete na hora),
  // matando a corrida onde dois traços liam a mesma base e um sobrescrevia o outro.
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const enqueue = useCallback((fn: () => Promise<void> | void) => {
    const next = queueRef.current.then(fn, fn);
    queueRef.current = next.then(() => {}, () => {}); // nunca rejeita → fila não trava
  }, []);

  const applyMaskPatch = useCallback((patchUrl: string) => {
    const target = maskTarget;
    const mode = maskMode;
    enqueue(async () => {
      const cur = useEditorDoc.getState().doc[MASK_FIELD[target]]; // base FRESCA, não-stale
      const [cw, ch] = capMaskDims(imgDims.w, imgDims.h);
      maskSetterFor(target)(await compositeMask(cur, patchUrl, mode, cw, ch));
      onMaskChanged();
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maskTarget, maskMode, imgDims.w, imgDims.h, onMaskChanged, enqueue]);

  const invertMaskTarget = useCallback(() => {
    const target = maskTarget;
    enqueue(async () => {
      const cur = useEditorDoc.getState().doc[MASK_FIELD[target]];
      if (!cur) return;
      const [cw, ch] = capMaskDims(imgDims.w, imgDims.h);
      maskSetterFor(target)(await invertMask(cur, cw, ch));
      onMaskChanged();
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maskTarget, imgDims.w, imgDims.h, onMaskChanged, enqueue]);

  const clearMaskTarget = useCallback(() => {
    const target = maskTarget;
    enqueue(() => { maskSetterFor(target)(null); onMaskChanged(); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maskTarget, onMaskChanged, enqueue]);

  // Reflexo: o BrushCanvas (não-patchMode) emite a máscara cheia full-res → capa antes
  // de gravar (mesma razão das outras: memória/undo/upload). null passa direto.
  const setReflectionMaskUrl = useCallback((url: string | null) => {
    if (!url) { setReflectionMaskUrlRaw(null); return; }
    enqueue(async () => {
      const [cw, ch] = capMaskDims(imgDims.w, imgDims.h);
      try { setReflectionMaskUrlRaw(await resampleMask(url, cw, ch)); }
      catch { setReflectionMaskUrlRaw(url); }
    });
  }, [imgDims.w, imgDims.h, enqueue, setReflectionMaskUrlRaw]);

  // Undo da máscara = histórico global (zundo). As 4 máscaras vivem no DocState, então
  // cada apply/invert/clear já é um passo versionado — sem pilha paralela (evita B1: o
  // undo-duplo onde a ref e o zundo divergiam e restauravam máscara stale). Entra na fila
  // pra não correr com um composite em voo.
  const undoMaskTarget = useCallback(() => {
    enqueue(() => { editorHistory.undo(); onMaskChanged(); });
  }, [onMaskChanged, enqueue]);

  // Push the active instrument's current selection into the mask (pen/wand/sam).
  // The canvas `Role` is surface|occluder only — but it's cosmetic here (onApply
  // ignores it; applyMaskPatch routes by maskTarget), so map `aiedit` to a valid role.
  //
  // B3: commita E LIMPA o instrumento. `apply()` emite o patch síncrono (data-URL já
  // capturado pelo applyMaskPatch), então `clear()` logo após zera a seleção — sem isso,
  // clicar Aplicar de novo re-somava a MESMA seleção (dupla-aplicação) e o overlay ficava
  // grudado sobre a máscara commitada. O brush não passa aqui: em patchMode ele já se
  // auto-limpa por stroke. (Diverge de propósito da extração "behavior-preserving" — B3
  // é bug real; o effect morto de seg-reapply + `segApplied` foram removidos junto.)
  const applyActiveInstrument = useCallback(() => {
    const role = maskTarget === "occluder" ? "occluder" : "surface";
    if (maskMethod === "pen") { penApiRef.current?.apply(role); penApiRef.current?.clear(); }
    else if (maskMethod === "wand" || maskMethod === "sam") { segApiRef.current?.apply(role); segApiRef.current?.clear(); }
  }, [maskMethod, maskTarget]);

  return {
    // máscaras (doc)
    surfaceMaskUrl, setSurfaceMaskUrl,
    occluderMaskUrl, setOccluderMaskUrl,
    aiEditMaskUrl, setAiEditMaskUrl,
    reflectionMaskUrl, setReflectionMaskUrl,
    surfaceOn, setSurfaceOn,
    occluderOn, setOccluderOn,
    reflectionLayerOn, setReflectionLayerOn,
    // alvo / view / modo
    maskTarget, setMaskTarget,
    maskView, setMaskView,
    maskMode, setMaskMode,
    // instrumentos
    maskMethod, setMaskMethod, segMode,
    segApiRef, penApiRef, brushApiRef,
    segTol, setSegTol,
    segContract, setSegContract,
    segMatte, setSegMatte,
    segFeather, setSegFeather,
    segHasMask, setSegHasMask,
    segSwatch, setSegSwatch,
    segStatus, setSegStatus,
    penFeather, setPenFeather,
    penHasMask, setPenHasMask,
    penStatus, setPenStatus,
    brushSize, setBrushSize,
    brushErase, setBrushErase,
    // ações
    maskUrlFor,
    applyMaskPatch,
    invertMaskTarget,
    clearMaskTarget,
    undoMaskTarget,
    applyActiveInstrument,
  };
}
