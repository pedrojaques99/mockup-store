# Plano — Undo/Redo universal via Zustand + zundo

## Problema
O undo do `photo-mockup/page.tsx` é uma **lista manual** de campos (`snapRef` + `applySnap` + deps do effect). Cada feature nova (Luz, máscara IA, crop) precisa ser lembrada em 3 lugares — e foi o que falhou. State espalhado em ~40 `useState`.

## Solução
Mover só o **state de documento** (o que o undo deve rastrear) pra um store Zustand único, com o middleware **`temporal` do zundo** (undo/redo do objeto inteiro — sem enumerar campo). UI transitória (tool, panelOpen, loading, erros, refs, status) **fica em `useState`** (não é undoable).

Libs: `zustand` + `zundo` (validadas, padrão de mercado). Não reinventar pilha de histórico.

## Baixo churn — adaptador `useDocField`
Assinatura idêntica ao `useState`:
```ts
const [shadowOpacity, setShadowOpacity] = useDocField("shadowOpacity");
```
- `value = useEditorDoc(s => s.doc[key])`
- `set(v)` = aplica updater no store (`v` ou `prev => next`)
- Panels continuam recebendo `setX` igual → quase zero mudança nos call sites e nas props.

## Campos do documento (DocState)
shadowOpacity, highlightOpacity, castOpacity, reflectionOpacity, reflectionBlur, lightWrap, matchScene, contactShadow, realism, fxGrain, fxWarmth, fxSaturation, fxBrightness, fxContrast, maskFeather, maskContract, shadowFloor, preBlur, cylinder, bend, textureAmount, specularOpacity, surfaceMaskUrl, occluderMaskUrl, reflectionMaskUrl, aiEditMaskUrl, surfaceOn, occluderOn, reflectionLayerOn, quad, frame, luzLayers.

Fora (UI/transitório): tool, panelOpen, uploadId, photoUrl, imgDims, *State (loading), *Err, seg*/pen*/brush* status, maskTarget/maskMethod/maskView/maskMode, luzActive/luzCropMode/luzModalOpen, crop UI (cropAspect…), upscale/aiedit UI, artFile/artImg/artPreview/artDims (não serializável).

## Passos
1. `npm i zustand zundo`.
2. `src/stores/editorDoc.ts`: `DocState` + store `useEditorDoc` com `temporal` (partialize → só `doc`, `limit: 80`, `handleSet` debounce 350ms p/ coalescer drags). Action `setField(key, v)` + `resetDoc(partial)` (p/ load de cena/troca de foto). Hook `useDocField`.
3. `page.tsx`:
   - Trocar os `useState` dos campos do doc por `useDocField`.
   - Apagar `snapRef`/`applySnap`/`histRef` + effect de captura.
   - Keydown: `undo()` → `useEditorDoc.temporal.getState().undo()`; redo idem. Manter o yield do tool Máscara (varinha/SAM) e o fallback caneta/pincel → `undoMaskTarget`.
   - `handlePhotoFile`/load de cena/`resetPhoto`: usar `resetDoc(...)` + `temporal.clear()` (não dá pra "desfazer" pra outra foto).
4. `tsc` + build após cada bloco. Teste manual: slider, Luz (mover/escala/rota/crop), máscara IA, quad — tudo deve responder a Ctrl+Z; Ctrl+Shift+Z redo.

## Riscos
- Massa de call sites → mitigado pelo `useDocField` (mesma assinatura).
- Drags gerando histórico demais → `handleSet` debounce + `limit`.
- Masks (data URLs) no histórico → já era assim no snapshot atual; `limit` segura memória.
- Reset ao trocar foto → `temporal.clear()` pra não desfazer entre fotos.
