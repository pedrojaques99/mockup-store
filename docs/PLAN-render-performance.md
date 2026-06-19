# PLANO — Render no nível "Photoshop" (todos os Tiers)

> Objetivo: o loop interativo do photo-mockup (mexer slider → ver resultado) ficar
> instantâneo, mantendo o render final pixel-perfect. Sem reinventar engine —
> cache + buffers crus + libs validadas de GPU no browser.

## Por que o Photoshop é instantâneo (e nós não)

| Segredo do PS | O que fazíamos |
|---|---|
| GPU (shaders, milhares de núcleos) | `for` em JS pixel-a-pixel no CPU |
| Bitmap cru na RAM, zero encode entre ops | `sharp(...).png().toBuffer()` ~10-15× por render (zlib) |
| Cache em camadas + região suja (recompõe, não re-transforma) | recalcula tudo do zero a cada slider |
| Proxy de resolução (edita em tela, full só no export) | full-res (3072×2048) sempre, inclusive preview |

## Anatomia do render atual (`src/app/api/photo-mockup/[id]/render/route.ts`)

```
read disco → warp displacement → contract/feather mask → SSAA 2× (png encode/decode)
  → renderScene (engine canvas)  ← GEOMETRIA (caro)
  → downscale
  → reflection → specular → lightWrap → grainColorMatch → contactShadow  ← LOOK (barato)
  → occluder → fx(clip) → luzOverlays
  → png final
```

**Split-chave:** a parte cara (warp+SSAA+engine) só depende de
`art, quad, warp, textura, maskFeather, maskContract, shadow/highlight/cast`.
Os sliders que o usuário mais mexe — **Realismo** (lightWrap+contactShadow+matchScene),
grão, calor, saturação, specular — são **look**, rodam sobre a base e **não precisam
re-warpar**.

## Tiers (ordem de execução = ROI/risco)

### Tier 0 — Medir (Server-Timing)
`route.ts` emite header `Server-Timing` por etapa (decode, warp, engine, cada FX,
encode). Observabilidade permanente; prova o ganho. Front loga em dev.

### Tier 4 — Cache de assets + engine warm  ·  baixo risco
`src/lib/render-cache.ts`: LRU de imagens decodificadas (photo/mask/shadow) por
`path+mtime`. Hoist do `import("@visant/psd-engine")` pro escopo do módulo (warm,
1× por processo). Mata re-decode de disco e cold-import a cada request.

### Tier 1 — Cache da base (geometria)  ·  maior ganho interativo, sem tocar pixel math
LRU em memória de `{ basePng, fullMask }` keyed por
`geomKey = hash(art, quad, warp, textura, maskFeather, maskContract, shadow/highlight/cast, S)`.
Cache-hit → pula warp+SSAA+engine+downscale e roda só o look sobre a base cacheada.
Mexer "Realismo"/grão/specular = sem re-warp. É o modelo "cacheia o Smart Object,
recompõe os ajustes".

### Tier 2 — Raw RGBA rail nos FX  ·  ganho garantido, refactor contido
As 5 FX de loop puro (reflection, specular, lightWrap, grainColorMatch, contactShadow)
passam a receber/retornar pixels crus `{data,width,height,channels}`. `route.ts`
decodifica a saída do engine → raw **1×**, roda a cadeia toda em raw, encoda → png
**1×**. Elimina ~8-10 ciclos encode/decode de 6 MP. `applyRenderFX` (ops libvips)
continua no sharp, mas troca pixels crus na fronteira.

### Tier 3 — Preview de look instantâneo no cliente  ·  salto de percepção
O `<img>` base já tem `filter: previewFilter` (hover de preset). Estendido: enquanto
o render do servidor está em debounce, aplica o **fx atual** (grão/calor/sat/bri/contraste)
como filtro CSS live → feedback em 0 ms. Servidor confirma o pixel-perfect ao chegar.
Os overlays de Luz já espelham `mix-blend-mode` no preview. Servidor = "commit", não "todo frame".

## Verificação
- `npx tsc --noEmit` + `npm run lint` + testes (`render-passes.test.ts` atualizado).
- Render real: comparar `Server-Timing` antes/depois e o ms exibido na UI.
- Pixel-perfect: cache-hit deve bater byte-a-byte com cache-miss (mesma cadeia de look).

## Status — IMPLEMENTADO (todos os tiers)
- **Tier 0** ✅ `Server-Timing` por etapa em `render/route.ts`; front loga em dev (`console.debug [render]`).
- **Tier 4** ✅ `src/lib/render-cache.ts`: `getEngine()` (warm 1×/processo), `readFileCached()` (path+mtime).
- **Tier 1** ✅ `getBaseComposite/setBaseComposite` — LRU(24) de `{basePng, fullMask}` por
  `geomKey`. Look-only (Realismo/grão/specular/contato) pula warp+SSAA+engine. Sem tocar pixel math.
- **Tier 2** ✅ `Pixels` rail em `photo-fx.ts` (reflection/specular/lightWrap/grain/contact agora
  raw→raw); `route.ts` decodifica 1× (`toPixels`) e encoda 1× (`fromPixels`). Só entra no rail se
  algum FX ativo. Canais lidos preservados → resultado idêntico.
- **Tier 3** ✅ `liveLookDelta()` (looks.ts) — preview CSS instantâneo do delta sat/bri vs fx assado
  (`bakedFxRef`), sem overshoot; debounce 600→250 ms (look agora bate no cache da base).

Verificado: tsc limpo, 108/108 testes, lint 0-erros (sem novos warnings nos arquivos tocados).

### Próximos passos opcionais (não implementados — fora do escopo atual)
- Mover a cadeia de look **inteira** pro cliente (WebGL) com a base SEM fx → adjustment layer real
  (servidor só no export). É o passo final do modelo PS; maior mudança de front.
- GPU no servidor (skia-canvas/gpu.js) pro engine warp, se o `engine` virar o gargalo dominante.
