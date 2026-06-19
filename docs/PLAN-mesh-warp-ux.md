# PLAN — Malha warp curva (PS Warp completo): hastes + âncoras

> Objetivo: dar **controle total na malha**, curvada estilo Photoshop *Warp*, com
> **hastes (handles) e âncoras** fáceis de manusear. UX completa no editor de malha
> do `/calibrate` (componente `CalibrateStage`).

## TL;DR

O **core de warp curvo já existe e está validado** — não há nada para reinventar.
O que falta é **UX**: hoje as hastes Bézier estão *inacessíveis*, então o usuário só
vê a grade com interpolação reta (bilinear), exatamente como no print. Este plano
expõe as hastes, adiciona suavização automática (o "facilitar") e fecha as
afordâncias de um editor pen-tool.

---

## Diagnóstico (o que já existe)

| Camada | Arquivo | Estado |
|---|---|---|
| Modelo | `src/lib/mesh-core.ts` | `WarpMesh { points[], tangents?[]{h,v} }`. `evalCell` = **patch de Coons com arestas Bézier cúbicas** quando há `tangents`; bilinear quando não. |
| Displacement | `src/lib/mesh-warp.ts` | `generateMeshDisplacement` — amostra o patch (`SUB=6` com tangentes) → PNG R=X/G=Y que o `@visant/psd-engine` aplica (Displace nativo). |
| Editor | `src/components/photo-tools/CalibrateStage.tsx` | Konva (vetor). Desenha curvas (`evalCell` ×11), drag de pontos, marquee/Shift multi-seleção, e **hastes em cyan + handles draggáveis** (`setTangent`). |
| UI/host | `src/app/calibrate/page.tsx` | Toggle malha (W), densidade 2–5, resetar grade, undo/redo, render final ao vivo. |
| Persistência | `src/lib/quad-store.ts` (`QuadEntry.mesh`) | `mesh` (com `tangents`) viaja em `quads.json`. |
| Render | `src/app/api/calibrate/render/route.ts` | Já usa `meshIsWarped` + `generateMeshDisplacement`. |
| Undo | `src/stores/editorDoc.ts` (`DocState.mesh`) | Coberto. |

### O gap real — chicken-and-egg que esconde as curvas

1. `defaultMesh()` cria a malha **sem** `tangents` (`mesh-core.ts:69`).
2. No editor, as hastes só são desenhadas para pontos **selecionados que já tenham**
   `tangents[k]` — senão `return []` (`CalibrateStage.tsx:148`).
3. `setTangent` (que chama `ensureTangents`) **só dispara ao arrastar uma haste que
   nunca foi desenhada**.

➡️ Resultado: não há caminho na UI para "ligar" as curvas. Tudo fica bilinear (reto).

---

## Princípios

- **Não reinventar**: manter Coons + `tangents` (já integrado ao engine). Nada de lib
  externa de warp — Konva já é a lib de canvas; o math já está validado/testado.
- **Não tocar** no engine de displacement nem na persistência/render (já corretos).
- Trabalho concentrado em 3 arquivos: `mesh-core.ts` (1 função pura nova),
  `CalibrateStage.tsx` (interação), `calibrate/page.tsx` (toolbar do painel malha).

---

## Mudanças

### 1. Tornar as hastes alcançáveis  *(mesh-core + CalibrateStage + page)*
- Ao **entrar no modo malha**, aplicar `ensureTangents` (já existe) — todo nó passa a
  ter `{h:0,v:0}`, e ao mudar densidade/resetar também.
- No editor, desenhar as hastes da âncora **selecionada mesmo com offset 0**: render de
  *stubs* curtos na direção da grade (h ao longo da linha, v ao longo da coluna), que
  podem ser puxados para fora. Hoje `if (!t) return []` mata isso.
- Suprimir a haste que aponta "pra fora" da malha em nós de borda (ex.: num canto
  superior-esquerdo, não mostrar handle para cima/esquerda) — reduz ruído, igual ao PS.

### 2. Suavizar automático (Catmull-Rom → Bézier) — *o "facilitar"*  *(mesh-core + page)*
- Nova função **pura** `autoSmoothTangents(mesh): WarpMesh` em `mesh-core.ts`:
  para cada nó, deriva `h`/`v` dos vizinhos na linha/coluna
  (`tangent ≈ (P_next − P_prev) / 6`, Catmull-Rom), bordas com tangente de meia-haste.
- Botão **"Suavizar"** no painel malha → a superfície vira spline suave **só de mexer
  nas âncoras**, sem tocar em handle. É o atalho que entrega "curvar com facilidade".
- Botão **"Retas"** → zera `tangents` (volta a bilinear).

### 3. Interação pen-tool nas hastes + comandos Ctrl/Alt+clique  *(mesh-core + CalibrateStage)*

**Mapa de comandos (UX completa, estilo Photoshop pen/warp):**

| Gesto | Alvo | Ação |
|---|---|---|
| Clique | âncora | seleciona (limpa as outras) |
| Shift+clique | âncora | adiciona/remove da seleção *(já existe)* |
| Arrastar | âncora | move (grupo, se houver seleção) *(já existe)* |
| Arrastar | haste | curva a aresta — **mirror C1** (o lado oposto espelha) |
| **Alt**+arrastar | haste | **quebra a simetria** — move só aquele lado (corner) |
| **Ctrl**+arrastar | haste | força simetria de volta (re-mirror, mesmo se quebrado) |
| **Alt**+clique | âncora | alterna nó **smooth ⇄ corner** (some/volta o par de hastes) |
| **Ctrl**+clique | âncora | reseta o nó à grade regular + zera hastes |
| **Alt**+clique | haste | remove aquela haste (aresta volta reta) |
| Duplo-clique | âncora | reseta hastes do nó (atalho do Ctrl+clique) |

- **Modelo de tangentes — extensão retrocompatível.** Hoje `tangents[k] = {h, v}` é um
  offset único usado como `+h`/`−h` (mirror simétrico). Para o **Alt (break)** adiciono
  campos opcionais `hOut`/`hIn`/`vOut`/`vIn`; quando ausentes, caem em `h`/`v` (mirror) —
  zero quebra para malhas já salvas. `evalCell` passa a ler o handle de **saída** do nó
  inicial e o de **entrada** do nó final de cada aresta (default = `h`). Mudança pequena
  e localizada no Bézier de aresta; `mesh-warp.ts` herda de graça (usa `evalCell`).
- **Handle-espelho draggável**: desenhar o lado `−h`/`−v` também, para puxar de qualquer
  ponta (no modo mirror os dois andam juntos; quebrado, independentes).
- Hover/realce de haste e âncora (cores: âncora branca→verde selecionada; haste
  azul→azul-claro hover), consistente com os padrões de canvas já existentes.

### 4. Afordâncias / teclado  *(CalibrateStage + page)*
- `Esc` limpa seleção; **setas** dão *nudge* nas âncoras selecionadas (1px / Shift = 10px);
  `Delete`/`Backspace` zera as hastes do nó selecionado.
- Modificador ao vivo: cursor muda no hover de haste conforme `Alt`/`Ctrl` pressionado
  (dica visual de break vs mirror).
- Painel malha (`calibrate/page.tsx`): densidade (já) · **[Suavizar]** · **[Retas]** ·
  **[Resetar grade]** (já) · legenda dos comandos Ctrl/Alt.
- Cursor/HiDPI já corretos (Konva vetor) — nada a fazer.

### 5. Persistência / render
- **Nada a mudar.** `tangents` já serializa em `mesh` no `/save` e no `/render`
  (objeto `WarpMesh` inteiro). Confirmado pelo mapeamento.

---

## Fora de escopo (não fazer)
- Trocar Coons por lib externa de warp.
- Mexer no engine de displacement ou no formato do `quads.json` (o `mesh` estendido é
  retrocompatível — campos novos opcionais).
- Continuidade C1 *entre células distintas* além do que o Coons já dá.
- Pré-popular curvatura por IA/normal-map — ideia futura.

---

## Arquivos tocados
- `src/lib/mesh-core.ts` — `autoSmoothTangents()` (pura); campos opcionais
  `hIn/hOut/vIn/vOut` no `tangents` + leitura no `evalCell` (mirror por default);
  helper de handle visível em zero.
- `src/components/photo-tools/CalibrateStage.tsx` — hastes sempre p/ selecionados
  (stubs em zero), handle-espelho, comandos Ctrl/Alt+clique (break/mirror/smooth-corner/
  reset), hover, atalhos de teclado do mesh.
- `src/app/calibrate/page.tsx` — `ensureTangents` ao entrar; botões Suavizar/Retas +
  legenda de comandos no painel.

## Validação
- `npm run build` + lint (política do repo: 0 erros).
- Manual em `/calibrate`: entrar malha → puxar haste → aresta curva; **Suavizar** →
  superfície spline; render final (F) mostra a arte curvada via displacement
  (`SUB=6`); salvar/recarregar preserva `tangents`.

## Riscos
- Baixo: math intocado; mudanças isoladas no editor. Maior atenção em não quebrar o
  drag em grupo/marquee existente ao adicionar handles de borda.
