# Plano — Eliminar serrilhado + borda cinza no render (photo-mockup)

## Diagnóstico

| Defeito | Causa raiz | Arquivo |
|---|---|---|
| **Serrilhado** (escada nas bordas) | Todo o composite roda na resolução da FOTO (`doc.width×height` = `imageWidth×Height`, ex. 1536×1024). A máscara já tem AA 16×/px, mas é o teto de resolução que limita. Zoom 300% magnifica. | `scene/render.ts:36`, `photo-shadow.ts:237` |
| **Borda cinza** (halo) | Na faixa AA da borda da máscara o alpha é parcial → arte semitransparente composta **sobre a foto base** (moldura escura/cinza por baixo). Fringe/matte clássico. | `scene/render.ts:96-100`, `warp.ts` |

Nota: `displaceMask` usa `Math.round` (nearest) e re-serrilha — mas só em superfície curva (bend/cylinder). Poster plano não passa por lá.

## Decisões (confirmadas)
- **SSAA adaptativo**: 2× por padrão; cai pra 1× se `max(imageWidth,imageHeight) > 3000` (sem ganho visível e custo alto).
- **Defringe junto**: contrair máscara ~1px + feather default menor.

## Mudanças (todas server-side — client não muda)

### 1. SSAA no render route — `src/app/api/photo-mockup/[id]/render/route.ts`
- Calcular `S = max(W,H) > 3000 ? 1 : 2`.
- Quando `S>1`: construir `analysisSS` (imageWidth/Height e quad × S), upscalar assets raster (photo, multiply, screen, mask) p/ S× com `lanczos3`, `dispScale × S`.
- `renderScene(docSS, assetsSS, …)` → PNG em S×.
- **Downscale do PNG pra resolução nativa** (`lanczos3`) ANTES do bloco de pós-FX (reflexo/specular/lightwrap/grain/occluder rodam em res nativa, sem tocar).
- Lossless pra foto: upscale 2× → downscale 2× ≈ original; só as bordas/arte ganham amostras.

### 2. Defringe — `src/lib/photo-shadow.ts` + route
- Novo helper `contractMask(buf, px)` (erosão morfológica 3×3 min-filter, padrão).
- No route: contrair `maskRaw` por 1px (×S) antes de usar.
- Reduzir feather default em `extractMask` (3 → 1) — borda mais nítida encosta na moldura sem vazar cinza.

## Verificação
- Render de teste no quadro do print, zoom 300%: borda reta lisa, sem escada nem halo cinza.
- Conferir tempo (~1.7s → ~4-6s em 2×) e que poster plano e superfície curva continuam ok.
- `npm run typecheck` / testes de `render-passes`.
