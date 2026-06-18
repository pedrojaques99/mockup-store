# Refactor `photo-mockup/page.tsx` → hooks

> **⚠️ Nota (atualização) — bugfix B3 entrou junto.** O fix do B3 (dupla-aplicação da
> máscara) foi aplicado em `page.tsx` E em `hooks/useMaskEditor.ts`. Isso **diverge de
> propósito** da postura "zero mudança de comportamento": `applyActiveInstrument` agora
> **limpa** o instrumento após `apply()`; o estado `segApplied` e o effect de **seg-reapply
> ao mudar refine (linhas ~1290–1298)** foram **REMOVIDOS** (estavam mortos + somavam ADD).
> Ao retomar o refactor: **não** mova o effect de seg-reapply pro hook nem reintroduza
> `segApplied` — eles não existem mais. O resto do plano abaixo segue válido.


> **Objetivo:** quebrar `src/app/photo-mockup/page.tsx` (2066 linhas, 1 componente
> com ~110 `useState`/`useDocField`, ~20 handlers e ~12 effects) em hooks de domínio,
> começando por **`useRenderPipeline`** e **`useMaskEditor`**.
>
> **Postura:** refactor puramente mecânico — **zero mudança de comportamento**. É um
> "extrair função" em escala. Risco está nas interdependências (refs + effects com
> `exhaustive-deps` desligado), não na lógica. Por isso: **PR isolado**, em fases
> verificáveis, cada fase compila e renderiza igual antes de seguir.

---

## 1. Diagnóstico — por que dói

O componente `PhotoMockupPageInner` (388–2057) acumula **11 domínios** num escopo só.
O acoplamento real que torna isso arriscado:

| Mecanismo | Onde | Por que trava o refactor |
|---|---|---|
| **Refs-ponte** | `handleRenderRef`, `renderStateRef`, `processingRef`, `toolRef`, `maskMethodRef`, `undoMaskRef` | Effects chamam handlers via ref pra fugir do `exhaustive-deps`. Mover o handler sem mover a ref quebra o auto-render. |
| **Handlers que cruzam domínios** | `handlePhotoFile` reseta analysis+process+render; `handleProcess` dispara render; `handleApplyCrop`/`handleUpscale`/`handleAiEdit` chamam `handlePhotoFile`/`handleArtFile` | Não dá pra extrair um domínio sem expor um contrato pro outro. |
| **Effects com deps manuais** | auto-render (857–870), auto-extract (918–924), seg re-apply (1290–1298) | `// eslint-disable-next-line react-hooks/exhaustive-deps` — a lista de deps é **load-bearing**. Copiar errado = loop ou stale. |
| **SSoT já parcialmente extraído** | `useDocField` (`src/stores/editorDoc.ts`) | Bom: máscaras, frame, quad, fx, opacidades já vivem no store Zustand+zundo. Os hooks novos **consomem** `useDocField`, não duplicam estado. |

**Conclusão:** o estado undoable já está fora do componente (no `editorDoc`). O que
sobra no `page.tsx` é **estado transitório de UI + orquestração**. O refactor é mover
essa orquestração pra hooks, mantendo o store como SSoT.

---

## 2. Mapa de domínios (o que vai pra onde)

Inventário pra não esquecer nenhum campo. `(doc)` = já vive no `editorDoc` via `useDocField`.

### A. `useRenderPipeline` — alvo desta fase
- **Estado:** `artFile`, `artPreview`, `artImg`, `artDims`, `artHasAlpha`, `renderState`, `renderErr`, `renderUrl`, `renderMs`, `autoRenderPending`, `bgDragOver` *(arrastar arte)*; consome `frame`(doc), `shadowOpacity`(doc)…`specularOpacity`(doc), `fx*`(doc), `luzLayers`(doc).
- **Refs:** `autoRenderTimer`, `handleRenderRef`, `renderStateRef`.
- **Handlers:** `handleArtFile` (944), `clearArt` (970), `handleRender` (1087).
- **Effects:** `handleRenderRef.current = handleRender` (848), auto-render debounce (857–870), AI_BLEND_DEFAULTS por surfaceType (872–880 — *fronteira com analysis*).
- **Derivados:** `frameSig` (854), `warpSig` (855), `surfaceSize` (936 — *vem de quad, ler como input*).

### B. `useMaskEditor` — alvo desta fase
- **Estado:** `maskTarget`, `maskView`, `maskMode`; `surfaceMaskUrl`(doc), `occluderMaskUrl`(doc), `aiEditMaskUrl`(doc), `reflectionMaskUrl`(doc), `surfaceOn`/`occluderOn`/`reflectionLayerOn`(doc); instrumentos: `maskMethod`, `segTol`/`segContract`/`segMatte`/`segFeather`/`segHasMask`/`segApplied`/`segSwatch`/`segStatus`, `penFeather`/`penHasMask`/`penStatus`, `brushSize`/`brushErase`.
- **Refs:** `segApiRef`, `penApiRef`, `brushApiRef`.
- **Helpers/handlers:** `maskUrlFor`/`maskSetterFor` (590–591), `applyMaskPatch` (593), `invertMaskTarget` (602), `clearMaskTarget` (612), `undoMaskTarget` (622), `applyActiveInstrument` (630).
- **Effects:** seg re-apply ao mudar refine params (1290–1298).
- **Derivado:** `segMode` (460).

### C. Domínios que **ficam fora desta fase** (mapa pra fase 2+)
`useUpload` (handlePhotoFile, handleDrop, resetPhoto, ?scene= effect) · `useSurface`
(quad/bend/cylinder, handleAnalyze, surfaceSize) · `useExtract` (processState,
handleProcess, auto-extract effect) · `useCrop` · `useUpscale` · `useAiEdit` (+ magenta) ·
`useLuz` · `usePublish` · `useEditorShortcuts` (os 2 effects de keydown + timer).

---

## 3. Contratos dos hooks (assinaturas propostas)

Sem inventar abstração: cada hook recebe o que **lê de outro domínio** como args e
devolve `{ state, handlers }`. Tudo o que é undoable continua puxado de `useDocField`
**dentro** do hook (não vira arg).

```ts
// src/app/photo-mockup/hooks/useRenderPipeline.ts
function useRenderPipeline(args: {
  uploadId: string | null;
  surfaceSize: { w: number; h: number };   // de useSurface (quad)
  warp: { cylinder: number; bend: Bend };   // doc, lido em page p/ passar — ou puxar interno
  processingRef: React.RefObject<boolean>;  // guard compartilhado com useExtract
  onRendered?: () => void;                   // limpa aiBlend (hoje inline no handleRender)
}): {
  artFile; artPreview; artImg; artDims; artHasAlpha; bgDragOver; setBgDragOver;
  renderState; renderErr; renderUrl; setRenderUrl; renderMs; autoRenderPending;
  handleArtFile; clearArt; handleRender; handleRenderRef; renderStateRef;
};
```

```ts
// src/app/photo-mockup/hooks/useMaskEditor.ts
function useMaskEditor(args: {
  imgDims: { w: number; h: number };
  onMaskChanged: () => void;   // hoje = setProcessState("idle") → re-extrai/render (debounce)
}): {
  maskTarget; setMaskTarget; maskView; setMaskView; maskMode; setMaskMode;
  maskMethod; setMaskMethod; segMode;
  /* seg/pen/brush params + refs + handlers */
  maskUrlFor; applyMaskPatch; invertMaskTarget; clearMaskTarget; undoMaskTarget; applyActiveInstrument;
};
```

**Regra do `onMaskChanged` / `onRendered`:** os callbacks que cruzam domínio (ex.:
máscara mudou → `setProcessState("idle")`; render terminou → limpa AI blend) viram
**callbacks injetados**, não imports diretos. Mantém os hooks desacoplados e o
`exhaustive-deps` honesto.

---

## 4. Plano de execução (fases verificáveis)

> Cada fase: **compila** (`npm run build` ou `tsc`), **lint sem novos erros**
> (ver [[mockup-store-ci-lint-policy]] — 0 erros é por design), e **smoke manual**
> do fluxo afetado. Commit atômico por fase. Não avança com o build vermelho.

### Fase 0 — Mudanças zero-risco (warm-up, separa ruído do PR)
Mover pra arquivos próprios **sem tocar no componente** — são puros/independentes:
- `QuadEditor` (76–329) → `src/components/photo-tools/QuadEditor.tsx` (já usado em 3 lugares: Cantos, Luz-warp; bom candidato a componente próprio).
- `StepPip` (333–349) → junto do `pipelineBar` ou em `photo-tools/`.
- Helpers `toBase64File`/`urlToDataUrl`/`dataUrlToFile`/`fetchJSON` (353–386) → `src/lib/photo-mockup-io.ts` (alguns provavelmente já têm similar — **checar antes de duplicar**, regra "não reinventa a roda").
- Tipos `Quad`/`QuadPt`/`Bend` → reusar os de `editorDoc.ts` (já exportados) em vez dos locais (38–39, 67–74).

**Ganho:** ~280 linhas saem do arquivo sem risco. **Verificação:** build verde + página abre.

### Fase 1 — `useMaskEditor` (o domínio mais isolado)
Por que primeiro: máscaras já estão 100% no `editorDoc`; o único acoplamento de saída
é `setProcessState("idle")` → vira `onMaskChanged`. Refs dos canvases (`segApiRef` etc.)
movem junto. O effect de seg re-apply (1290–1298) vai pro hook.

**Atenção:** `undoMaskTarget` (622) chama `editorHistory.undo()` global — mantém como
está (não é undo "da máscara", é o undo global; o comentário no código explica o porquê,
evita o bug B1). **Verificação:** Cantos→Máscara, aplicar varinha/caneta/pincel,
inverter, limpar, Ctrl+Z na aba Máscara, alternar overlay/grayscale.

### Fase 2 — `useRenderPipeline`
O mais entrelaçado: as 3 refs (`handleRenderRef`/`renderStateRef`/`autoRenderTimer`) e
o effect de auto-render (857–870) movem **juntos**. Cuidado com a ordem:
1. O effect `handleRenderRef.current = handleRender` (848) garante que o ref aponta pro
   handler atual a cada render — manter dentro do hook.
2. A lista de deps do auto-render (`fxGrain`…`warpSig`) é o gatilho: qualquer slider
   muda → debounce 600ms → render. **Copiar a lista exata.** Um dep a menos = slider
   que não re-renderiza; um a mais = loop.
3. `processingRef` é compartilhado com o `useExtract` (handleProcess) — passar como arg
   (não criar dois refs). Enquanto `useExtract` não existe, o ref nasce no `page.tsx` e
   é injetado nos dois.
4. `surfaceSize` (936) é input (vem do quad) — passar como arg, não recalcular.

**Verificação:** soltar arte → auto-render; arrastar sliders de FX/luz → re-render
debounced; trocar look; comparar antes/depois; tempo de render no badge.

### Fase 3 — Limpeza
- `PhotoMockupPageInner` passa a ser **composição**: chama os hooks, espalha o retorno
  nos panels (props idênticas — `RenderPanel`/`MaskPanel` **não mudam**).
- Reavaliar os refs-ponte: o que sobrou de `toolRef`/`maskMethodRef`/`undoMaskRef` vive
  no `useEditorShortcuts` (fase futura) ou fica no page por enquanto.

### Fases futuras (fora deste PR, mesma receita)
`useUpload` · `useSurface` · `useExtract` · `useCrop`/`useUpscale`/`useAiEdit` ·
`useLuz` · `usePublish` · `useEditorShortcuts`. Cada uma é um PR pequeno depois.

---

## 5. Riscos e mitigação

| Risco | Sinal | Mitigação |
|---|---|---|
| **Loop de render** | CPU 100%, render dispara sozinho sem parar | Copiar a lista de deps do auto-render effect **verbatim**; testar arrastando 1 slider. |
| **Stale closure via ref** | Render usa params antigos | Manter `handleRenderRef.current = handleRender` dentro do hook, rodando todo render. |
| **Undo da máscara quebra (bug B1)** | Ctrl+Z restaura máscara errada | **Não** criar pilha paralela; `undoMaskTarget` segue chamando `editorHistory.undo()`. |
| **`processingRef` duplicado** | Render roda durante extract (race) | Um único ref, injetado nos dois hooks. |
| **Re-render extra** | Jank ao digitar/arrastar | Hooks retornam handlers memoizados (`useCallback` com as deps originais). |
| **Lint regression** | CI vermelho | Preservar os `eslint-disable` nas mesmas linhas; não "consertar" deps de propósito. |

---

## 6. Estratégia de verificação (sem suíte E2E)

Não há teste de UI pra esse fluxo. **Antes** de começar, capturar baseline manual:
1. Subir uma cena (ou `?scene=`), Cantos, Máscara (varinha+caneta+pincel), soltar arte,
   ajustar FX, comparar antes/depois, publicar.
2. Após **cada fase**, repetir o subconjunto afetado.
3. Diff de comportamento = zero. Se algo mudar visualmente, a fase está errada — reverter.

Opcional (alto valor, baixo custo): um teste de render de hook com
`@testing-library/react` cobrindo `useMaskEditor` (apply→invert→clear→undo) e o
gatilho de debounce do `useRenderPipeline` (fake timers). Fica como follow-up, não
bloqueia o PR.

---

## 7. Resultado esperado

- `page.tsx`: de ~2066 → ~700–900 linhas (componente de composição + JSX).
- `src/app/photo-mockup/hooks/useRenderPipeline.ts`, `useMaskEditor.ts`.
- `src/components/photo-tools/QuadEditor.tsx` + helpers em `src/lib/`.
- **Zero** mudança de comportamento, **zero** mudança nas props dos panels.
- PR isolado, revisável fase a fase pelos commits atômicos.
