# PLAN — Displacement pixel-perfect (mesh + warp + relief), nível produção

> Objetivo: eliminar o glitch/smear localizado no warp e tornar o pipeline de
> displacement **robusto e fiel ao engine bit-a-bit**, cobrindo todos os cenários de
> malha (reta, Coons/Bézier, auto-curva, depth-mesh 3D, smart-mesh/drape, cylinder/bend,
> texture relief) em mockups hiper-realistas.

## 0. Contrato do engine (fonte da verdade — não mudar o engine)

`@visant/psd-engine/dist/scene/render.js` (faces):
1. `faceCanvas = perspectiveWarp(art, face.quad)` no **bbox do quad**: `outW=ceil(maxX−minX)`, `outH=ceil(maxY−minY)` dos 4 cantos do quad. `dx=floor(minX), dy=floor(minY)`.
2. `applyDisplacementFilter(faceCanvas, disp, scale, scale, 'stretch to fit', 'repeat edge pixels')`.

`compose.js applyDisplacementFilter`:
- `'stretch to fit'` → desenha o PNG do field em **W×H = tamanho do faceCanvas** (bbox do quad). **offsetX/offsetY do field são IGNORADOS.**
- decode: `dx = ((R−128)/128)*scale`, `dy = ((G−128)/128)*scale`; amostra `src(p+d)` bilinear; edge = clamp.

**Conclusão:** todo field entregue ao engine **precisa** ser autorado no espaço do
**faceCanvas (bbox do `face.quad`, na escala S)**, dimensão `outW×outH`, decodificável
com a constante **128**. Qualquer outra origem/tamanho é esticado errado.

## 1. Causa-raiz (confirmada no código)

| # | Bug | Arquivo | Efeito |
|---|-----|---------|--------|
| A | `composeDispFields` compõe em **canvas inteiro** (`Wc×Hc`) e mistura field de malha (em doc-space com offset) com warpDisp (em inner-space) tratado como full-canvas. O engine espreme o canvas todo no face → sinal da malha cai no lugar errado e **dispara num ponto** (renormaliza + estica). | `render route :249-258`, `mesh-warp.ts:136` | **smear localizado (o bug do print)** |
| B | `generateMeshDisplacement` autora no **bbox da malha** (não do quad) com offset que o engine ignora → desalinha quando nós internos abaúlam pra fora do quad. | `mesh-warp.ts:29-118` | warp levemente torto no caso malha-só |
| C | Encode `/127` vs decode do engine `/128` (e `photo-warp` usa `/128`, inconsistente). | `mesh-warp.ts:111,163` | sub-aplica ~0.8%; máscara desregistra |
| D | Buracos de cobertura viram **neutro 128** (sem hole-fill). | `mesh-warp.ts:113` | degrau/risco em rachaduras de triângulo e dobras |
| E | `meshFromDepth`/`applyDispToMesh` movem nó **sem clamp** e sem normalização robusta; sampler lê **1 pixel** → outlier puxa 1 nó → célula dobra. | `mesh-core.ts:136-188`, `page.tsx:406-467` | dobra/fold local em depth/auto-curva |

## 2. Solução

### 2.1 Espaço único = faceCanvas (corrige A + B) — **núcleo**
- `generateMeshDisplacement(m, { quad })`: passar o **quad do engine** (= `face.quad` escalado). Autorar o field no **bbox do quad** (`qMinX/qMinY`, `outW×outH`), rasterizando posições de saída como `mesh_pos − qMin` (hoje usa `meshMin`). Usar `quad` também no `bilinearQuad` (hoje usa `meshCorners`). Mantém a fórmula `d = quad_pos(u,v) − mesh_pos(u,v)` (matematicamente correta — provada contra o contrato do engine).
- `composeDispFields`: compor no **espaço do faceCanvas** (`outW×outH`), não no canvas. Tanto a malha (já em quad-bbox após o item acima) quanto o `warpDisp` (MAP×MAP, que já é "stretch-to-fit na face" → resize p/ `outW×outH`). Somar offsets em px e renormalizar. Sem offsets de canvas.
- `render route`: trocar `Wc×Hc` por `outW×outH` (bbox do quad escalado) e passar o quad ao gerador. `dispScale` final = `composed.scale` (px no espaço do face, escala S).

### 2.2 Constante 128 em todo lugar (corrige C)
- `mesh-warp.ts` (encode malha e compose) e samplers: `127 → 128`. `photo-warp`/`displaceMask` já usam 128. Headroom `*1.05` garante que não clipa (max ratio ≈0.952 → 250 < 255). Mantém o `*1.05`.

### 2.3 Hole-fill de cobertura (corrige D)
- Em `generateMeshDisplacement`, após rasterizar: **dilatar `Ox/Oy`** pelos vizinhos cobertos (push N passes no mapa low-res — barato) onde `cov==0`, em vez de escrever 128. Sem buraco neutro = sem degrau. Borda externa do quad-bbox (fora do quad) pode ficar neutra (arte transparente lá).

### 2.4 Robustez de malha (corrige E) — **anti-fold**
- `mesh-core.ts`:
  - **Clamp por-nó**: limitar `|Δ|` de cada nó interno a uma fração do tamanho da célula local (ex. `0.45 * min(cellW,cellH)`) em `applyDispToMesh` e `meshFromDepth`. Impede dobra na origem.
  - **Normalização robusta** em `meshFromDepth`: range por **P2–P98** dos depths amostrados (igual `photo-shadow.extractDisplacementMap`), não min/max cru.
  - **Guard de fold-over** (novo `clampMeshFolds(m)`): após mover nós, detectar células cujo sinal da área (cross-product das 2 diagonais de triângulo) inverte vs. a grade-base; recuar o nó ofensor até a célula voltar a ser não-degenerada (busca por bisseção curta). Aplicado no fim de `applyDispToMesh`/`meshFromDepth`/edição manual (server-side em `generateMeshDisplacement` como rede de segurança).
- Samplers (`page.tsx`): **median 3×3** (ou small-radius) em vez de 1 pixel; `127 → 128`. Mata outlier de depth/disp antes de virar nó.

### 2.5 Resolução adaptativa (qualidade hi-res)
- `generateMeshDisplacement`: `SUB` adaptativo à curvatura (magnitude das hastes/áreas das células) e `maxRes` adaptativo ao tamanho do face (`min(1024, longest)`), em vez de fixos `6`/`256`. Field é suave → custo controlado; mockup 2.7k ganha nitidez no vinco sem explodir memória.

## 3. Testes (garantia bit-a-bit)
Novo `src/lib/__tests__/mesh-warp.test.ts` (+ estender `render-passes.test.ts`):
1. **Round-trip encode→decode** com a MESMA fórmula do engine (`/128`): erro ≤ 0.5px no field.
2. **Identidade**: malha = grade regular ⇒ field todo neutro (≤1 LSB) e `meshIsWarped=false`.
3. **Espaço**: field tem dimensão do **bbox do quad**, não da malha; nó interno abaulando pra fora não muda dim.
4. **Hole-fill**: célula degenerada artificial ⇒ nenhum texel interno fica em 128 cercado de não-128.
5. **Anti-fold**: nó empurrado além do vizinho ⇒ `clampMeshFolds` recua, todas as células com área de sinal consistente.
6. **Compose**: malha + warpDisp ⇒ soma de offsets bate (≤1px) com a soma manual, no espaço do face.
7. **Depth robusto**: depth com 1 pixel outlier ⇒ deslocamento do nó vizinho ≤ clamp; sem P2–P98 falharia.

## 4. Ordem de execução / risco
1. (2.2) constante 128 + (2.1) espaço único — **resolve o bug do print**. Risco baixo, alto impacto.
2. (2.3) hole-fill + (2.4) anti-fold/clamp/robusto — blinda depth/3D/drape.
3. (2.5) resolução adaptativa — qualidade hi-res.
4. (3) testes em cada etapa; `npm test`, `tsc`, `lint`, `build` verdes.

Sem libs novas, sem mudar o engine, sem mexer no shape do doc/photoSession.
Arquivos: `mesh-warp.ts`, `mesh-core.ts`, `photo-warp.ts` (só constante já ok), `render route`,
`calibrate/page.tsx` (samplers), `__tests__/mesh-warp.test.ts`.
