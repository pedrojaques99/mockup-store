# Alpha 100% — Engine Modular, Profissional, Inteligente

**Goal:** mockup-store alpha 100% → produção como beta  
**Status:** COMPLETE (2026-06-15)

---

## Wave 1 — Engine Modular (psd-engine extractions) ✅

### Task 1.1 — `psd-engine/src/resolve.ts` (NOVO) ✅
Extraiu `findTarget` heuristic (duplicado em render-server + render-cli) para o engine como `resolveSoTarget(allLayers, soName)`.

### Task 1.2 — `psd-engine/src/displacement.ts` (NOVO) ✅
Extraiu `attachDisplacementMaps` (duplicado em render-server + render-cli) para o engine como `preloadDisplacementMaps(allLayers, psdPath, createCanvas, fs, readPsd, onWarn?)`.  
FsCallbacks injetável para isomorfismo (Node.js em produção, mock em testes).

### Task 1.3 — `index.ts` — exportar novas APIs ✅
`resolveSoTarget`, `preloadDisplacementMaps`, `DisplacementCanvas`, `FsCallbacks` exportados.

### Task 1.4 — Build psd-engine ✅
`npm run build` → 0 erros TypeScript.

---

## Wave 2 — render-server.ts + render-cli.ts ✅

### Task 2.1 — render-server.ts refactor ✅
- `attachDisplacementMaps` local removido → usa `preloadDisplacementMaps` do engine
- `findTarget` local + `byArea` removidos → usa `resolveSoTarget` do engine
- try/catch em `composePsd()` — crash não mata o server
- Imports limpos

### Task 2.2 — render-cli.ts refactor ✅
- `attachDisplacementMaps` local removido → usa `preloadDisplacementMaps` do engine
- `findTarget` local + `byArea` removidos → usa `resolveSoTarget` do engine
- `SO_TARGET as SO_PATTERNS` removido (não usado diretamente)
- Imports limpos

---

## Wave 3 — Qualidade Profissional

### Task 3.1 — psd-scan.ts error handling ✅
`scanPsd()` já tem try/catch retornando null. Loop em `scan-psds.ts` e `ingest-folder/route.ts` já trata null. Sem crash por PSD corrompido.

### Task 3.2 — BLEND_MAP pixel-level blend modes ✅
Implementados via `pixelBlendMode()` em compose.ts usando `getImageData/putImageData`:
- `divide`: min(1, backdrop/blend) — era source-over (errado)
- `subtract`: max(0, backdrop-blend) — era difference (direção errada)
- `linear burn`: max(0, backdrop+blend-1) — era color-burn (aproximado)
- `linear light`: max(0, min(1, backdrop+2×blend-1)) — era hard-light (errado)
- `vivid light`: color-dodge/burn duplo — era hard-light (errado)
- `pin light`: min/max condicional — era hard-light (errado)
- `hard mix`: vivid light → threshold — era hard-light (errado)

Porter-Duff com blend function aplicado. 11/11 testes de fórmula passam.
Smoke tests: Wire Card + A5 Paper renderizam sem erros.

### Task 3.3 — Smoke test ✅
Wire Card + test-red.png: 1200x675, 14s, 0 erros.  
A5 Paper (displacement filter): 1200x675, 2.6s, 0 erros.

---

## Acceptance Criteria

- [x] `resolveSoTarget` exportado de `@visant/psd-engine`
- [x] `preloadDisplacementMaps` exportado de `@visant/psd-engine`
- [x] render-server.ts sem `findTarget` local, sem `attachDisplacementMaps` local
- [x] render-cli.ts sem `findTarget` local, sem `attachDisplacementMaps` local, sem import sujo
- [x] composePsd crash não derruba o render-server
- [x] psd-scan.ts não aborta scan por um PSD corrompido
- [x] render Wire Card com test-art: output limpo, 0 erros
- [x] `npm run build` em psd-engine: 0 erros TypeScript
- [x] blend modes pixel-level (divide, subtract, linear burn, linear/vivid/pin light, hard mix) implementados e testados
