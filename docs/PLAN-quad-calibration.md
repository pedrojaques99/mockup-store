# Plano — Calibração de Superfície & Detector Unificado

> **Status — console de calibração implementado (tsc verde, smoke runtime ok):**
> - Núcleo `key-color-core.ts`; `detectKeyColorQuad` em `photo-detect.ts` (findNeonQuad = wrapper).
> - Store `quad-store.ts` (golden `quads.json` + ignore list + `resolveDir`).
> - API `/api/calibrate/{scenes,detect,overlay,save,ignore,upload,displacement,material}`.
> - Rota `/calibrate`: fila+triagem, QuadEditor (lupa 5×), overlay magenta, **pasta dinâmica
>   + upload/drag**, **ignorar/restaurar**, **método de detecção** (magenta/branca/manual →
>   resolve "sem magenta"), **modo Displacement** (mapa de relevo + dispScale/blur),
>   **modo Material/FX procedural** (tecido/metal/vidro/gasto/sombra projetada, preview ao vivo).
> - `scripts/eval-quads.ts` (IoU vs golden). Smoke real: storefront (antes 330×6px) e hotel
>   (1293×65px) degenerados agora detectam limpos a conf 100%.
>
> **Fase 4 — religação ao render: FEITA.** `test-pipeline-cv.ts` e `photo-render.ts` leem
> `getQuad` (golden vence OVERRIDE_QUADS) e aplicam displacement+material; `photo-scene.ts`
> aceita `dispScale`+camada `material`. Render final ao vivo no console: `/api/calibrate/render`
> compõe arte-teste (grid/poster/checker) com quad+luz+displacement+material → preview real
> debounced (modo F). Undo/redo (Ctrl+Z/Shift+Z/Y) com histórico local coalescido.
>
> **Loop retro-alimentativo (engine que aprende): FEITO.** `src/lib/engine-feedback.ts` —
> captura o par (auto, final) de todo aceite (publish do photo-mockup + save do /calibrate)
> em `data/engine-feedback/events.jsonl`; `relearn()` agrega em `engine-profile.json` (bias por
> canto/superfície + defaults + IoU médio); o `detect` aplica o bias → o detector melhora a
> cada correção. `scripts/engine-learn.ts` = gatilho manual/cron. Smoke provou: 6 correções
> com viés +10px → bias aprendido exato. IA p/ textura real = hook no ai-edit FLUX/Visant.

> **Reframe:** não é "fine-tune" de modelo. O magenta é uma _key color_ chapada
> (hue ~300–325°) → detecção é problema **determinístico de CV**. O valor não está em
> consertar um quad; está em **capturar o teu julgamento como dado estruturado**, de modo
> que cada correção deixe o detector permanentemente melhor _e mensurável_.
>
> Três produtos num só desenho:
> 1. **Detector unificado** — funde os dois detectores de magenta de hoje num núcleo só.
> 2. **Rota de calibração** — loop visual onde você encaixa o quad (lupa 5×) e salva.
> 3. **Camada de inteligência** — cada correção vira ground-truth: eval por IoU, bias
>    aprendido, triagem. O detector evolui sem regredir no escuro.

---

## 1. Estado atual

| Peça | Onde | Papel |
|---|---|---|
| `findNeonQuad` / `detectDominantVividHue` | `src/lib/photo-detect.ts` | Detecção CV das cenas em lote (Render/New Mockups) — HSL + blob |
| `isMagenta` / `findMagentaQuad` | `src/lib/magenta-mask.ts` | Detecção do upload no web app — RGB channel-diff |
| `OVERRIDE_QUADS` (hardcoded) | `scripts/test-pipeline-cv.ts` | **O "feedback" de hoje** — coordenadas digitadas à mão em TS |
| `QuadEditor` | `src/components/photo-tools/QuadEditor.tsx` | 4 alças + bend + **lupa 5× pixel-perfect**. Reusável como está |
| `ZoomPanViewer` | `src/components/ZoomPanViewer.tsx` | Zoom/pan |
| `/api/local-image?path=` | `src/app/api/local-image/route.ts` | Serve arquivo local |
| `largestConnectedBlob` | `src/lib/photo-detect.ts` | BFS do maior blob (já remove glow/reflexo) |

**Falha-raiz:** ambos os detectores extraem cantos por pixels extremos `min/max(x±y)`.
Quebra em trapézio/perspectiva e com 1 pixel de glow → quads degenerados (comentários no
código: storefront `330×6px`, hotel `1293×65px`) → conserto manual no `OVERRIDE_QUADS`.

---

## 2. Princípios de design (o que torna isto "inteligente")

1. **Capturar o delta, não só o resultado.** Toda correção guarda `auto` + `manual`.
   Sem isso, o aprendizado morre. Com isso, eval/bias/triagem saem de graça.
2. **Genérico desde o nome.** É _calibração de superfície_, não _de magenta_. O detect
   retorna `{quad, método, confiança}` independente da origem (neon/white/SAM/LLM). A mesma
   rota vira o console de QA da pipeline inteira — sem reescrita futura.
3. **SSoT real.** Um núcleo de detecção; os dois mundos (web + batch) viram wrappers finos.
4. **Seguro de evoluir.** Nenhuma mudança no detector entra sem passar pelo eval (IoU vs golden).
5. **Anti-overkill.** Construir só o que destrava futuro barato; o resto é _costura
   documentada_ (shape do JSON já permite), não código especulativo.

---

## 3. Fase 0 — Store golden (SSoT)

`Render/New Mockups/quads.json` — mapa `nomeArquivo → entrada`. Guarda o **chute do
detector** e a **correção humana** lado a lado:

```json
{
  "03_storefront_vitrine.png": {
    "quad":   { "tl": {"x":172,"y":48}, "tr": {"x":814,"y":56}, "br": {"x":812,"y":832}, "bl": {"x":86,"y":684} },
    "auto":   { "tl": {"x":180,"y":52}, "tr": {"x":810,"y":60}, "br": {"x":808,"y":825}, "bl": {"x":92,"y":678} },
    "method": "key-color", "surfaceType": "billboard", "hue": 312,
    "source": "manual", "confidence": 0.94,
    "iou": 0.97, "detectorVersion": 3,
    "imageWidth": 896, "imageHeight": 896, "savedAt": 1750000000000
  }
}
```

- `quad` = verdade (o que você encaixou). `auto` = o que o detector previu na hora de salvar.
- `iou` = sobreposição auto×manual no momento do save (mede o quão bom o detector está).
- `detectorVersion` = versão do núcleo que gerou `auto` → permite re-detectar só o que ficou stale.
- Lib **`src/lib/quad-store.ts`** (usada por API **e** scripts): `loadQuads(dir)`,
  `getQuad(dir, name)`, `upsertQuad(dir, name, entry)` — atomic write (padrão `atomicWrite`
  já usado em `/process`).

---

## 4. Fase 1 — Detector unificado + eval (o melhor dos dois mundos)

### 4.1 Núcleo único `src/lib/key-color-detect.ts`

Funde os dois predicados complementares:

- **RGB channel-diff** (de `magenta-mask`): `r-g>40 && b-g>18 && r>80 && b>50`.
  Robusto a sombra/iluminação (diferença de canal, não hue absoluto).
- **HSL adaptativo** (de `findNeonQuad`): `within(h, hueAuto, range) && s>=minSat`.
  Adapta a qualquer tom que o gerador cuspir (fúcsia/violeta), via `detectDominantVividHue`.

```ts
function isKeyColor(r,g,b, hueCenter, hueRange, minSat): boolean {
  const rgbDiff = (r-g > 40) && (b-g > 18) && r > 80 && b > 50;   // sombra-tolerante
  const [h,s]   = rgbToHsl(r,g,b);
  const hslHit  = within(h, hueCenter, hueRange) && s >= minSat;  // tom-adaptativo
  return rgbDiff || hslHit;                                        // união = pega os dois casos
}

export async function detectKeyColorQuad(img, w, h, opts): Promise<KeyColorResult> {
  const hue   = opts.hueCenter ?? await detectDominantVividHue(img, w, h);  // auto-tom
  const pts   = scanFullRes(img, w, h, p => isKeyColor(...p, hue, ...));     // full-res
  const blob  = largestConnectedBlob(pts, w, h);                            // mata glow
  const quad  = fitQuadFromBlob(blob);                                      // cantos novos ↓
  return { quad, hue, method: "key-color",
           confidence: blobFillRatio(blob, quad), detectorVersion: DETECTOR_VERSION };
}
```

### 4.2 Cantos novos `fitQuadFromBlob` — substitui o frágil `min/max(x±y)`

```ts
function fitQuadFromBlob(points: [number,number][]): QuadPoints {
  const hull = convexHull(points);     // monotone chain (~20 linhas, sem dep)
  const quad = simplifyToQuad(hull);   // Douglas–Peucker: epsilon↑ até sobrar 4 vértices
  return orderCorners(quad);           // por ângulo do centroide → tl/tr/br/bl
}
```

- Hull + DP são algoritmo de livro (~40 linhas) — **sem OpenCV** (pesado no Windows).
- **Fallback:** se DP não convergir a 4, cai no extremal atual → nunca pior que hoje.
- Preserva perspectiva: hull de retângulo em perspectiva já é o trapézio certo; DP mantém.
- `confidence` = fração do blob dentro do quad (quão retangular) → badge na UI.

### 4.3 Os dois mundos viram wrappers (comportamento preservado)

```ts
// batch (Render/New Mockups) — px, full-res
findNeonQuad    = (img,w,h) => detectKeyColorQuad(img,w,h, {minSat:0.45}).quad;
// web app (upload) — normalizado 0..1; dilatação p/ inpaint continua em magenta-mask
findMagentaQuad = (img)     => normalize(detectKeyColorQuad(img,w,h, {/*core*/}).quad);
```

> Ganho colateral: o **upload do web app** herda sombra-tolerância + auto-tom + blob filter.

### 4.4 Eval harness `scripts/eval-quads.ts` — o que torna evoluir seguro

```
npx tsx scripts/eval-quads.ts          # roda o detector vs todos os goldens
# → IoU por cena, média, piores 5, regressões vs run anterior
```

- IoU poligonal via **`polygon-clipping`** (lib validada, npm) — interseção/união de
  polígonos sem implementar na unha.
- Compara `detectKeyColorQuad` × `quad` golden de cada cena → tabela de IoU.
- **Gate:** qualquer mudança no núcleo precisa manter/melhorar o IoU médio. Vira step no CI
  (`.github/workflows/ci.yml` já existe) — detector nunca regride no escuro.

---

## 5. Fase 2 — API (`src/app/api/calibrate/`)

| Rota | Método | Faz |
|---|---|---|
| `/api/calibrate/scenes` | GET | Lista `Render/New Mockups/*.png` → `[{name,width,height,url,saved?,confidence,iou}]`, **ordenado por triagem** (§7) |
| `/api/calibrate/detect` | POST `{name}` | `detectKeyColorQuad` → `{quad, hue, confidence, method, detectorVersion}` |
| `/api/calibrate/overlay` | GET `?name=` | PNG transparente tingindo os pixels que casam `isKeyColor` → feedback "pixel-perfect" |
| `/api/calibrate/save` | POST `{name, quad, surfaceType}` | Calcula IoU vs `auto`, `upsertQuad` com `auto`+`manual`+`detectorVersion` |

- `url` → `/api/local-image?path=...` (já existe). `overlay` usa o **mesmo** `isKeyColor`,
  então o tinte **é** o que o detector enxerga.

---

## 6. Fase 3 — UI `/calibrate` (`src/app/calibrate/page.tsx`)

> Reaproveita o **design system existente** (QuadEditor, ZoomPanViewer, Segmented,
> IconButton). **Não crio nem edito componente de design** sem pedir.

- **Esquerda:** fila de cenas ordenada por triagem; badge `auto`/`manual`/`não salvo` + IoU.
- **Centro:** `ZoomPanViewer` + `QuadEditor` (alças + lupa 5× = pixel-perfect). Toggle
  **"overlay magenta"** liga/desliga o tinte dos pixels detectados.
- **Controles:** `Re-detectar` · `Salvar` (**S**) · `Próx/Ant` (**←/→**) · `surfaceType`
  (Segmented) · readout hue/confiança/IoU.
- Fluxo: abre → carrega golden ou auto-detecta → arrasta → **S** salva → **→** próxima.

---

## 7. Camada de inteligência — destravada pelo store de delta

Tudo abaixo sai do par `(auto, manual)` que a Fase 0 já guarda. **Folded na Fase 1: eval.**
O resto é **costura documentada** — o shape do JSON já permite; constrói quando a dor aparecer.

| Capacidade | Como (sem ML) | Quando |
|---|---|---|
| **Eval por IoU** ✅ | §4.4 — vs goldens, gate de CI | **Agora (Fase 1)** |
| **Bias aprendido por aresta** | Média dos `(manual − auto)` por borda vira offset corretivo aplicado nos próximos chutes. Resolve viés sistemático (ex.: "sempre 25px curto à direita") direto dos dados. | Quando ~15+ correções |
| **Triagem / active learning** | Ordena a fila por "provável conserto": confiança baixa, aspect degenerado, cantos quase-colineares, IoU histórico baixo. Você conserta as piores primeiro. | Quando 50+ cenas |
| **Re-detecção seletiva** | `detectorVersion` por cena → re-roda só o que está stale após melhorar o núcleo. | Junto com cada bump de versão |
| **Modelo próprio** | Com correções suficientes, treinar detector leve. | Só costura — não construir |

---

## 8. Fase 4 — Pipeline consome o golden

- `scripts/test-pipeline-cv.ts`: antes da detecção, `getQuad(NEW_MOCKUPS_DIR, name)`. Entrada
  `manual` → usa como override. Migra os `nm_*` do `OVERRIDE_QUADS` pro `quads.json` e remove do TS.
- `scripts/photo-render.ts`: idem, via `quad-store`.
- Resultado: corrigir um quad = abrir a rota e arrastar. **Nunca mais editar TS.**

---

## 9. Saltos de arquitetura (decisões baratas, futuro grande)

1. **Calibração de superfície, não de magenta.** `method` no store + detect agnóstico de
   origem → a mesma rota estende pra white-surface/SAM/LLM, e depois pra máscara/oclusor/
   lighting/surfaceType. O console de QA da pipeline inteira nasce daqui.
2. **Cena calibrada = production-ready.** O golden é a semente do catálogo do app/boxy.app/
   desktop. Loop fecha: `Visant gera → auto-detecta → fila "needs-review" → você calibra →
   publica`. A rota vira o portão de qualidade do conteúdo.

---

## 10. Não-objetivos (anti-overkill)

- ❌ Fine-tune / treino de modelo — desnecessário pra key color chapada.
- ❌ OpenCV/`opencv4nodejs` — hull+DP inline resolvem; `polygon-clipping` só pro IoU.
- ❌ Banco/Mongo — sidecar JSON viaja com as cenas e é versionável.
- ⚠️ `findMagentaQuad` (upload) vira **wrapper** do núcleo — comportamento preservado
  (normaliza + dilatação de inpaint continuam), só herda robustez. **UI não muda.**
- 🔒 Bias/triagem/modelo/console-geral/promote-to-app = **costura**, não construir agora.

---

## 11. Ordem de execução

1. **Fase 0 + 1** — `quad-store.ts`, `key-color-detect.ts` (núcleo + cantos novos),
   `eval-quads.ts`. **Testável por script, sem nenhuma tela.** Baseline de IoU dos `nm_*`.
2. **Fase 2** — API.
3. **Fase 3** — rota UI.
4. **Fase 4** — migrar pipeline, esvaziar `OVERRIDE_QUADS` dos `nm_*`.
5. **Costura (§7)** — bias/triagem entram quando o volume de correções justificar.

## 12. Validação

- `eval-quads.ts`: IoU médio dos `nm_*` antes (extremal) × depois (hull+DP) — provar o ganho.
- Antes/depois visual: `test-pipeline-cv.ts` nas 10 cenas `nm_*`, comparar `-result.png`
  (debug green) — quad casa a borda magenta sem vazar.
- Confiança ≥ 0.9 nas planas; trapézios validados a olho na rota.
</content>
