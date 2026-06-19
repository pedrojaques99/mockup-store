# PLAN — Render 100% WYSIWYG (core único: prévia /calibrate ≡ produção)

> Objetivo: a prévia da /calibrate e o mockup final de produção saírem **com o mesmo
> look, sempre**, compartilhando **um único core** (sem dois renderizadores que voltam a
> divergir). Decisões do usuário: **(1) toggle HD na prévia** (rápida por padrão, botão HD
> = idêntico a produção); **(2) produção/final é a fonte da verdade** em toda divergência.

## 0. Diagnóstico (mapa de divergências — confirmado no código)

Hoje são **dois renderizadores**. Convergem só em `buildPhotoSceneDoc` + `renderScene`.

| Stage | Prévia (`calibrate/render`) | Produção (`photo-mockup/[id]/render`) | Ação |
|---|---|---|---|
| luz multiply/screen | live `extractGrayscaleLayers` floor 200 / preBlur 25 (por tipo), fonte neon-neutralizada | disco `shadow.png`/`shadow-screen.png` baked com floor **0** / preBlur **0** (process route) | unificar params (produção manda) num extrator único |
| máscara | live `extractMask` feather 4, sem contract/SAM/displace | disco `mask.png` feather 3 + SAM + feather live + contract 1px + displaceMask | extrator único + mesmo pós (contract/displace) |
| displacement base | `extractDisplacementMap` (gray full-image, P2–P98) | `buildTextureRelief`(256²) + `buildWarpDisplacement` | **produção manda**: usar relief+warp dos dois lados |
| mesh warp (Coons) | já unificado (compose em face-space) | idem | ✅ feito (PLAN-displacement-pixel-perfect) |
| material | live `buildMaterialOverlay` → asset | **ausente** | adicionar ao core (funciona nos dois) |
| color-cast | live `extractColorCastLayer` → renderiza | layer emitida mas **asset nunca carregado** → morto | construir asset no core (passa a funcionar) |
| opacidades | hardcoded por tipo | body / defaults lib (screen .30 / mult .20 / cast .10) | unificar nos defaults de produção |
| SSAA | nenhum (downscale ~900px) | S×2 + downscale | core com `quality`: preview/HD |
| pós-FX looks (refl/spec/lightwrap/grain/contact) | **nenhum** | rail completo | mover pro core (rodam nos dois) |
| occluder / applyRenderFX / luzOverlays | nenhum | sim | mover pro core |
| neon-neutralize | live auto-hue | bake `photo-clean.png` hue 300±50/.18 | extrator único |

## 1. Arquitetura — core único

Novos módulos:

### `src/lib/photo-render-params.ts`
SSoT de constantes/defaults (valores de **produção**): `LIGHT_FLOOR`, `LIGHT_PREBLUR`,
`MASK_FEATHER`, `MASK_CONTRACT`, `NEON_HUE/RANGE/MINSAT`, `DEFAULT_OPACITY.{multiply,screen,cast}`,
e `RenderParams` (todos os sliders: opacidades, warp, textureAmount, fx, looks, luzOverlays, mesh, material…).

### `src/lib/photo-render-core.ts`
1. `extractSceneAssets(photoBuf, analysis, opts) → SceneAssets`
   `{ multiply, screen, mask(surface), reflectionMask, cleanPhoto, occluder?, colorCast }`.
   **Único extrator** — usado pelo *bake* (process route) e pela prévia *live*. Mesmos params.
2. `buildBaseComposite({ engine, analysis, assets, artBase64, params, quality }) → { basePng, fullMask }`
   Mask prep (feather/contract/displaceMask) + disp (relief+warp+mesh via composeDispFields em
   face-space) + **material** + **color-cast** + SSAA(`quality`) + engine + downscale. (= a "base"
   cacheável de produção). `quality: 'preview'|'hd'` controla S e resolução.
3. `applyLooks({ engine, png, fullMask, analysis, photoBuf, artBase64, params }) → png`
   refl/spec/lightwrap/grain/contact + occluder + applyRenderFX + luzOverlays (o rail atual de produção).

### Wiring
- `process/route.ts` → `extractSceneAssets` p/ assar os PNGs (params idênticos).
- `photo-mockup/[id]/render` → lê assets do disco → `buildBaseComposite` (com cache Tier-1 atual em volta) → `applyLooks`. `quality:'hd'`.
- `calibrate/render` → `extractSceneAssets` (live) → `buildBaseComposite` → `applyLooks`. `quality:'preview'` (ou `'hd'` se `body.hd`).
- **Produção é a verdade**: a prévia passa a usar relief+warp, material, cast, looks, opacidades de produção.

## 2. Toggle HD na prévia (decisão 1)
- `calibrate/render`: aceita `body.hd` → `quality:'hd'` (full-res + SSAA, idêntico a produção). Default `preview` (reduzido, look igual, AA mais leve).
- UI `src/app/calibrate/page.tsx`: botão **HD** ao lado de "re-renderizar" (usa o design system; só um toggle de estado + flag no fetch). Sem novos componentes sem permissão.

## 3. Fases (verificáveis, baixo risco por etapa)
1. **params + extractSceneAssets**: unifica luz/máscara/cast/clean/reflection num extrator. Wire em process + calibrate. `tsc`/test/build. (Look da luz/máscara passa a bater.)
2. **buildBaseComposite**: move disp(relief+warp+mesh)+material+cast+SSAA+engine pro core; produção e calibrate chamam. Cache Tier-1 preservado na rota.
3. **applyLooks**: move o rail de looks/occluder/fx/luz pro core; os dois chamam. (Prévia ganha os 9 passes.)
4. **HD toggle** na UI + `quality`.
5. **Verificação visual**: render real (render-server :4200) da MESMA cena/params pelos dois caminhos → diff. Ajustar divergências residuais (ex.: floor da luz) escolhendo o de produção.

## 4. Riscos / cuidados
- **Cache de produção** (Tier-1/2, `geomKey`, `render-cache`): preservar — o core recebe o engine e devolve buffers; o cache continua na rota.
- **Não mexer no shape do doc/photoSession** (persistem) — [[photo-mockup-mask-system]].
- **Sem libs novas, sem mudar o engine.** Reusar funções existentes (`photo-shadow`, `photo-warp`, `photo-fx`, `material-fx`).
- **0 erros de lint** (warnings pré-existentes ok), `tsc`/test/build verdes por fase.
- `extractDisplacementMap` deixa de alimentar o render (produção manda) — manter a função se usada noutro lugar; senão marcar como legada.

Arquivos: novos `photo-render-params.ts`, `photo-render-core.ts`; editar `process/route.ts`,
`photo-mockup/[id]/render/route.ts`, `calibrate/render/route.ts`, `calibrate/page.tsx`;
testes em `__tests__/photo-render-core.test.ts`.
