# Killer: interface de operação de cenas

**Tier** T3 núcleo · **Nota** 94/100 · **Veredito** vai pra PR com uma pendência
_(abertura: 49 → portão consertado: 58 → fases 1 a 4: 94)_
**Superfície** B trabalho (throughput e qualidade de decisão do operador)
**Alvo** `/photo-mockup` (2033 linhas), `/calibrate` (864), `/scene` (432), `src/components/photo-tools/**`, canvases compartilhados

> A nota é baixa porque nada foi consertado ainda, e é assim que ela deve sair de
> uma primeira rodada em código legado. O portão quase não discrimina (dois dos
> três detectores deram zero antes de qualquer trabalho); quem derruba a nota é o
> julgamento, e o julgamento achou 17 itens confirmados com `arquivo:linha`.

---

## Decisão pendente (do usuário, não minha)

**1. ~~Desktop-only por decisão ou por descuido?~~ RESPONDIDA em 06/08/2026: é tudo
desktop-only, por decisão.**
Medido a 390px: `/calibrate` estoura **+1446px** (a barra de ferramentas é uma
fileira que não quebra e corre até x=1836), `/photo-mockup` **+13px**.
**Consequência: isso deixa de ser defeito e vira contrato.** Não se conserta, não
entra em plano, e auditoria futura não deve reabrir. Nenhum aviso de mobile foi
construído — seria elemento novo para zero operador, e o cut test o reprova.
Se um dia a régua mudar, o custo está medido aqui.

**2. ~~Quatro pipelines de render. Qual é o SSoT?~~ RESPONDIDA POR MEDIÇÃO em
06/08/2026. E a pergunta estava mal feita — minha, não sua.**
Não são quatro pipelines divergentes: são **três domínios de entrada** e só um par
faz o mesmo trabalho. Ver a seção "Inquérito do render" abaixo. O SSoT é o
`photo-render-core.ts`, que o par já compartilhava; a divergência real estava na
FONTE DOS ASSETS, e foi consertada e remedida até 0/255.

**3. ~~Vale `@testing-library/react`?~~ RESPONDIDA: não, e o caminho barato foi
executado.**
A matemática de coordenada saiu do `QuadEditor.tsx` para `src/lib/quad-math.ts`
(pura) com **23 testes**: ida e volta tela↔imagem, quad degenerado, escala por
eixo independente, normal apontando para fora em toda aresta, largura=média em
perspectiva, e divisão por zero em cada ponto onde ela cabia. Total do repo:
377 → **400**.

O que teste de lib **não** cobre é a ligação: um `toCanvas` trocado por engano
passa em `tsc` e nos 400. Por isso a rodada também criou `npm run visual:scene`,
que abre as duas rotas, dirige até a ferramenta pelo atalho `C` e exige canvas com
backing > 0 e imagem carregada — canvas de largura zero é o sintoma exato de fit
quebrado e não lança exceção nenhuma.

**A divergência do Inverter não era decisão de produto — o Photoshop já decidiu.**

Levantei como pendência que inverter **sem máscara** preenchia tudo de branco no
`/calibrate` e era no-op no `/photo-mockup`, e disse que escolher entre os dois era
decisão sua. Errado. A pergunta "como o Photoshop faz?" fecha a questão:

- Ctrl+I **transforma uma máscara que existe**. Sem máscara, o comando não se
  aplica.
- **Criar** máscara é outro ato, com dois nomes próprios: *Reveal All* (branca) e
  *Hide All* (preta).
- O Photoshop **nunca** sobrecarrega o Inverter para significar "cria uma cheia".

E o `mask-compose.ts` já declara no cabeçalho que segue o modelo do Photoshop, e o
`MaskPanel` já o implementava certo: `MaskPanel.tsx:192` tem
`disabled={!p.hasTargetMask}` — controle desligado, exatamente como lá. O
`if (!cur) return` do hook é só a trava atrás de um botão já desligado.

Quem estava fora do padrão era o `/calibrate`: botão sempre ligado que, sem
máscara, fazia **outra coisa** — a mesma tecla com dois significados conforme um
estado que o usuário não vê. Consertado: o controle desliga igual ao irmão.

**Pendência que sobra:** só a duplicação estrutural. `MaskPanel` (painel burro +
hook) e `MaskCalibrate` (monolito com estado próprio) ainda são dois códigos para
a mesma toolbar. Agora que o comportamento convergiu, fundir virou refactor
mecânico em vez de decisão.

**De quebra**, olhar esse arquivo revelou a recaída que o `brand.ts` documenta no
próprio cabeçalho: `bg-cyan-600` no instrumento ativo e nas ações primárias — o
ciano que saiu da paleta quando a marca virou BOXY. Trocado por `bg-acc2`, a
convenção da casa. O vermelho do "subtrair" fica: é o par negativo, mesma exceção
justificada do `SegmentCanvas` (paleta mono-verde não codifica negativo).

**O portão da casa me pegou no meio disso**, e vale registrar: copiei
`text-neutral-950` do `IconButton` e o `ui:audit` acusou "arquivo que mistura zinc
e neutral", com a explicação pronta — *zinc é a pele do editor, neutral a da loja*.
Corrigido para `text-zinc-950`. É o argumento a favor de ter teto por métrica em
vez de régua inventada por auditoria.

---

## Portão

| Detector | Antes | Depois |
|---|---|---|
| impeccable (tell de IA) | 0 | 0 |
| audit:design (token) | 0 | 0 |
| copy (vício) | 46 | **0** (333 strings de interface) |
| tsc | pass | pass |
| 390px `/photo-mockup` | +13px | +13px (decisão 1) |
| 390px `/calibrate` | +1446px | +1446px (decisão 1) |
| erro de console | 0 | 0 |

Pulado: nenhum. `impeccable` e `audit:design` rodaram e deram zero — o que confirma
a lição da skill: **o portão tem poder de veto e quase nenhum poder de
discriminação.** Todos os 17 achados abaixo passaram pelos três detectores.

**Composição da nota:** portão 20/20 · julgamento 36/40 (17 itens confirmados; 12
consertados, 4 eram enquadramento errado meu ou do levantamento, 1 segue de pé) ·
interrogatório 38/40. O 390px não entra no portão: virou contrato (decisão 1).

### Placar dos 17

| # | Item | Situação |
|---|---|---|
| 1 | `Quad` declarado 4× | **consertado** — `key-color-core` é o SSoT, `editorDoc` vira apelido |
| 2 | `invertMask` reimplementada | **consertado** — `MaskCalibrate` importa do lib |
| 3 | Composição de máscara sem fila | **consertado** — a fila anti-race chegou no `/calibrate`, com espelho e guarda de eco (o hook lê o store, o componente recebe por prop) |
| 4 | Toolbar de máscara em duas versões | **divergência de comportamento consertada** (modelo do Photoshop, abaixo); a duplicação estrutural dos dois painéis segue de pé |
| 5 | Fórmula de zoom copiada | **consertado** — `wheelZoomFactor` em `viewer-zoom.tsx`. O ALCANCE fica local: os dois já divergiam de propósito (0,4–32 × 0,1–40) |
| 6 | `fetchJson`/`toBase64` triplicados | **consertado** — `/scene` usa `photo-mockup-io` |
| 7 | "Quatro pipelines divergentes" | **enquadramento errado meu** — são 3 domínios, 1 par. Medido e convergido a 0/255 |
| 8 | `http-error.ts` não adotado | **consertado** — `/calibrate` e `/scene` adotaram, incluindo o caminho de blob do "Render Scene" |
| 9 | "373 cores cruas" | **não é violação** — não existe token de cinza no `@theme`; `zinc` é a convenção e o `audit:design` passa com ela. Trocar seria churn contra o sistema |
| 10 | Cor de marca errada no canvas | **consertado** — `#22c55e`/`#16a34a`/`#38bdf8` saíram. Novos tokens `HANDLE_ACTIVE`/`HANDLE_TANGENT` em `handle-style.ts` |
| 11 | "112 botões à mão" | **inflado** — contou todo `<button>`, quase todos com texto. A métrica da casa é "botão só-ícone à mão": **12, teto 12**. No orçamento, e no limite |
| 12 | Segunda paleta de cinza | **consertado** — `ArtFramePanel` passou de `neutral` para `zinc` (14 tokens) |
| 13 | "143 `text-[Npx]`" | **não é violação** — não há escala tipográfica no `@theme` |
| 14 | `transition-colors` na unha | **consertado** — 77 trocas para `transition-ui`, que já existia para isto |
| 15 | Erro silencioso no deep link | **consertado** — `toast.error` + `readError` |
| 16 | Waterfall no deep link | **consertado** — `Promise.all` |
| 17 | Sem cache no listador de cenas | **consertado** — cache por `caminho:mtime:tamanho` (sem TTL, porque os mesmos bytes têm sempre a mesma dimensão). Medido: 99ms → 39ms |

**Nota sobre 9, 11 e 13:** os três vieram de um levantamento que aplicou uma régua
mais dura que a da casa. O sinal correto é o `npm run ui:audit`, que tem teto por
métrica — e ele está todo dentro do orçamento. Auditoria que inventa régua nova
gera trabalho que o repo não pediu.

## Copy consertada — 50 strings

Travessão e bolinha separadora saíram do texto de interface. **Só string que chega
no olho do usuário** foi tocada: JSX, `title`, `aria-label`, `toast.*`, `setErr`.
Nenhum comentário, nome de variável, `console.*`, `className` ou lógica mudou, e
toda interpolação `${...}`/`{expr}` segue idêntica.

| arquivo:linha | Antes | Depois |
|---|---|---|
| `photo-mockup/page.tsx:513` | `Cortado · ${W}×${H}px` | `Cortado em ${W}×${H}px` |
| `photo-mockup/page.tsx:783` | `Upscale · ${modo}` | `Upscale ${modo}` |
| `photo-mockup/page.tsx:808` | `Resolução aumentada · ${w}×${h}px` | `Resolução aumentada para ${w}×${h}px` |
| `photo-mockup/page.tsx:881` | `Edição indisponível — usei limpeza simples (pode sobrar um pouco de rosa).` | `Edição indisponível. Usei limpeza simples, pode sobrar um pouco de rosa.` |
| `photo-mockup/page.tsx:883` | `Superfície recriada · ${material}` | `Superfície recriada com ${material}` |
| `photo-mockup/page.tsx:1302` | `Salvar projeto em arquivo (.vsn) — foto + luz + máscaras + ajustes` | `Salvar projeto em arquivo (.vsn) com foto, luz, máscaras e ajustes` |
| `photo-mockup/page.tsx:1310` | `Novo projeto — descarta esta cena e sobe uma nova foto` | `Novo projeto. Descarta esta cena e sobe uma nova foto` |
| `photo-mockup/page.tsx:1402` | `Arraste os cantos pra ajustar · {w}×{h}px` | `Arraste os cantos pra ajustar a imagem de {w}×{h}px` |
| `photo-mockup/page.tsx:1708` | `Visant · ${s}s` | `Visant em ${s}s` |
| `photo-mockup/page.tsx:1793` | `Solte a arte no painel — o render acontece sozinho.` | `Solte a arte no painel. O render acontece sozinho.` |
| `photo-mockup/page.tsx:1796` | `Processando · {s}s` | `Processando há {s}s` |
| `photo-mockup/page.tsx:1798` ¹ | `Pronto · ${s}s` | `Pronto em ${s}s` |
| `photo-mockup/page.tsx:1967` ¹ | `{busy} · ${s}s` | `{busy} há ${s}s` |
| `photo-mockup/page.tsx:1975` | `Solte a arte na superfície destacada — renderiza sozinho` | `Solte a arte na superfície destacada. Renderiza sozinho` |
| `photo-mockup/page.tsx:1977` | `Arraste os cantos pra ajustar a superfície · OK quando estiver certo` | `Arraste os cantos pra ajustar a superfície, OK quando estiver certo` |
| `calibrate/page.tsx:696` | `Engine pai (SSoT) — global v${v} • ${n} amostras` | `Engine pai (SSoT). Global v${v}, ${n} amostras` |
| `calibrate/page.tsx:697` | `engine v{v}·{n}` | `engine v{v} ({n})` |
| `calibrate/page.tsx:700` | `Visant vision — análise mais precisa, ~1s + custo` | `Visant vision, análise mais precisa (~1s e custo)` |
| `calibrate/page.tsx:702` | `Máscara (K) — pen / brush / wand / SAM` | `Máscara (K): pen, brush, wand, SAM` |
| `calibrate/page.tsx:731` | `sel.: clique/Shift · haste: arraste … · âncora: … · setas movem` | `sel.: clique/Shift, haste: arraste …, âncora: …, setas movem` |
| `calibrate/page.tsx:815` | `procedural · blend {n}` | `procedural, blend {n}` |
| `calibrate/page.tsx:830` | `Render idêntico ao final (SSAA, full-res) — mais lento` | `Render idêntico ao final (SSAA, full-res), mais lento` |
| `photo-tools/ArtDropZone.tsx:66,101` | `PNG, JPG, SVG · renderiza ao soltar` | `PNG, JPG, SVG. Renderiza ao soltar` |
| `panels/CalibrationPanel.tsx:84` | `cena não calibrada — abra o /calibrate primeiro` | `cena não calibrada, abra o /calibrate primeiro` |
| `panels/CalibrationPanel.tsx:105,134` | `sem quad — defina cantos primeiro` | `sem quad, defina os cantos primeiro` |
| `panels/CornersPanel.tsx:20` | `… encaixa na borda da imagem · Enter vai pro render.` | `… encaixa na borda da imagem, Enter vai pro render.` |
| `panels/CornersPanel.tsx:33` | `OK · ir pro render` | `OK, ir pro render` |
| `panels/CropPanel.tsx:45` | `Duplo-clique dentro (ou Enter) aplica · Esc cancela.` | `Duplo-clique dentro (ou Enter) aplica, Esc cancela.` |
| `panels/EditSelectionPanel.tsx:76` | `Clique no objeto · botão direito exclui.` | `Clique no objeto, botão direito exclui.` |
| `panels/LuzPanel.tsx:112` | `galeria · ou` | `da galeria, ou` |
| `panels/MaskPanel.tsx:107` | `Overlay — região sobre a imagem` | `Overlay: região sobre a imagem` |
| `panels/MaskPanel.tsx:108` ¹ | `Máscara — preto/branco isolado` | `Máscara: preto/branco isolado` |
| `panels/MaskPanel.tsx:115` | `Ferramenta · {dica}` | `Ferramenta: {dica}` |
| `panels/MaskPanel.tsx:120` ¹ | `${label} — ${dica}` | `${label}: ${dica}` |
| `panels/MaskPanel.tsx:126` | `clique = canto · arraste = curva · 1º ponto = fechar` | `clique = canto, arraste = curva, 1º ponto = fechar` |
| `panels/MaskPanel.tsx:130` | `Pinte na imagem — aplica {modo} a cada traço.` | `Pinte na imagem. Aplica {modo} a cada traço.` |
| `panels/MaskPanel.tsx:144` | `Refinar borda (matte) · {on/off}` | `Refinar borda (matte): {on/off}` |
| `panels/MaskPanel.tsx:149` | `Clique no objeto · botão direito exclui.` | `Clique no objeto, botão direito exclui.` |
| `panels/RenderPanel.tsx:189` | `alterado — duplo-clique reseta` | `alterado, duplo-clique reseta` |
| `panels/SceneInfo.tsx:26` | `Detecta a superfície de novo — refaz o quad` | `Detecta a superfície de novo e refaz o quad` |
| `panels/UpscalePanel.tsx:16` | `Reamostragem local — grátis, sem inventar detalhe.` | `Reamostragem local, grátis, sem inventar detalhe.` |
| `panels/UpscalePanel.tsx:17` ¹ | `Upscale rápido — até 128 MP.` | `Upscale rápido, até 128 MP.` |
| `panels/UpscalePanel.tsx:18` | `Mais detalhe — 2× ou 4×.` | `Mais detalhe, 2× ou 4×.` |
| `panels/UpscalePanel.tsx:19` | `Máxima qualidade — usa créditos da conta.` | `Máxima qualidade, usa créditos da conta.` |
| `PenMaskCanvas.tsx:124` | `clique = canto · clique-arraste = curva` | `clique = canto, clique-arraste = curva` |
| `PenMaskCanvas.tsx:125` | `${n} âncoras · feche no ponto verde` | `${n} âncoras, feche no ponto verde` |
| `PenMaskCanvas.tsx:126` | `fechado · arraste âncoras/handles` | `fechado, arraste âncoras/handles` |

¹ Cinco linhas que o detector **não** acusou e que quebram a mesma regra dentro da
**mesma expressão** das que ele acusou (o segmented control da máscara, o mapa de
instrumentos, os modos do upscale e os dois irmãos do cronômetro). Corrigir só as
flagradas deixaria travessão ao lado de um vizinho já limpo, e o detector diria
zero. 45 flagradas + 5 irmãs = 50.

Três decisões de sentido que valem sua revisão: `engine v3·120` virou
`engine v3 (120)`; o rótulo `Upscale · Rápido` virou `Upscale Rápido`, que lê como
nome do modo em vez de dois campos; e a bolinha antes do cronômetro virou **"há"**
quando é tempo decorrido (`1796`, `1967`) e **"em"** quando é duração final
(`1708`, `1798`).

**Fora do escopo, não tocado:** `CanvasContextChip.tsx:33`, `ToolRail.tsx:75`,
`LuzAssetModal.tsx:70`, `CalibrationPanel.tsx:177` e `:22` (onde `—` é o rótulo da
opção "nenhum material", e provavelmente deve continuar). Viram um segundo lote se
você quiser.

---

## Julgamento — 17 itens confirmados

### A. SSoT quebrado (o que o usuário chamou de "tá tudo duplicado")

| # | Item | Onde | Risco concreto |
|---|---|---|---|
| 1 | **Tipo `Quad` declarado 4×** | `stores/editorDoc.ts:20-21` · `photo-mockup/page.tsx:53-54` · `photo-tools/CalibrateStage.tsx:19-20` · `lib/key-color-core.ts:17` | Estruturalmente idênticos, nominalmente distintos. Adicionar campo em um não acusa erro nos outros. A do `page.tsx` já é sombra morta do que `editorDoc` exporta |
| 2 | **`invertMask` reimplementada** | `lib/mask-compose.ts:67-78` × `photo-tools/MaskCalibrate.tsx:63-78` | O `MaskCalibrate` importa `compositeMask` e `capMaskDims` do lib mas reescreveu a inversão. Feather ou alpha premultiplicado conserta um lado só |
| 3 | **Composição de máscara sem fila** | `photo-mockup/hooks/useMaskEditor.ts:100-128` × `MaskCalibrate.tsx:49-78` | O lado A tem fila serializada anti-race, documentada em `useMaskEditor.ts:15-18` como bug já corrigido. **A correção nunca chegou no lado B** — `/calibrate` ainda perde update em dois cliques rápidos |
| 4 | **Toolbar de máscara em duas versões** | `panels/MaskPanel.tsx` (dumb + hook) × `MaskCalibrate.tsx` (monolito com estado próprio) | ~150 linhas equivalentes. Atalho novo ou instrumento novo aparece em uma rota só. O comentário em `MaskCalibrate.tsx:4-6` diz reusar os instrumentos, mas reusa só os canvases |
| 5 | **Fórmula de zoom copiada** | `ZoomPanViewer.tsx:16,74-102` × `CalibrateStage.tsx:58-64` | `Math.exp(-deltaY * 0.0015)` com a mesma constante hardcoded nos dois. Ajuste de sensibilidade por reclamação de UX conserta metade |
| 6 | **`fetchJson` + `toBase64` triplicados** | `lib/photo-mockup-io.ts:8-17,38-44` × `scene/page.tsx:21-28,30-37` | Mesma mensagem de erro literal nos dois. O `/scene` não usa `readError` — o bugfix de corpo de erro vazio não chega lá |
| 7 | **Quatro pipelines de render** | `/api/render` · `/api/photo-mockup/[id]/render` · `/api/calibrate/render` · `/api/scene/[sceneId]/render` | Bugfix no engine precisa ser validado em 4 rotas na mão. A luz existe em 3 e falta na 4ª |
| 8 | **`http-error.ts` criado e não adotado** | usado em `photo-mockup/page.tsx:41` (2 usos) · **zero** em `calibrate/page.tsx` e `scene/page.tsx` | O utilitário existe justamente para o "corpo vazio → SyntaxError do parser na cara do usuário", e a classe de bug segue reproduzível nas outras duas rotas |

### B. Design system desrespeitado

| # | Item | Número medido | Pior arquivo |
|---|---|---|---|
| 9 | **Cor crua em vez de token** | ~373 ocorrências | `calibrate/page.tsx` (86), `photo-mockup/page.tsx` (39 + 7 hex + 3 rgb) |
| 10 | **Cor de marca ERRADA no canvas** | `#22c55e`, `#16a34a`, `#38bdf8`, `#f59e0b` | `CalibrateStage.tsx:213,216,226,231,236,254,257,270` e `QuadEditor.tsx:132,147,149,177,193` — verde do Tailwind onde deveria ser o `#84B028`/`#BFFF38` da BOXY. `lib/brand.ts` existe exatamente para isso, e `handle-style.ts:8` importa `ACC2` certo enquanto a linha 10 escreve `#09090b` cru |
| 11 | **Botão à mão vs primitivo** | 112 `<button>` cru × 16 `IconButton` | `calibrate/page.tsx` 33 crus e **zero** primitivo; `photo-mockup/page.tsx` 15 crus e zero |
| 12 | **Segunda paleta de cinza** | 12 `neutral-*` | `ArtFramePanel.tsx` fala `neutral` sozinho enquanto todo o resto fala `zinc` |
| 13 | **Escala tipográfica reinventada** | 143 `text-[Npx]` | `RenderPanel.tsx` (21), `photo-tools/**` somam 111 |
| 14 | **Motion fora do utility da casa** | 66 `transition-colors` | Não é violação de SSoT de curva (nenhum `duration-*`/`ease-*` cru, nenhum `transition-all` — esse ponto está limpo), mas reimplementa a decisão que `@utility transition-ui` já toma |

Limpo de verdade: **Dialog/Select/Switch**. Nada de `role="dialog"` na unha, nada de
`<select>` cru. `LuzAssetModal` e `ShortcutsHelp` usam o `Dialog` de `components/ui`.

### C. Next.js e verdade do dado

| # | Item | Onde | Custo |
|---|---|---|---|
| 15 | **Erro silencioso no deep link** | `photo-mockup/page.tsx:557` — `if (!res.ok) return;` | Abrir `?scene=<id>` quebrado deixa a página vazia, sem toast, sem log. É o caminho de entrada principal, e o resto do arquivo usa `toast.error` |
| 16 | **Waterfall evitável** | `photo-mockup/page.tsx:552-571` | `analyze` é aguardado e só então `settings` é buscado. `settings` não depende de `analyze` — dois RTT onde cabe um `Promise.all` |
| 17 | **Sem cache no listador de cenas** | `api/calibrate/scenes/route.ts:27-64` | `readdir` + `sharp().metadata()` por arquivo a cada GET, disparado por `useEffect` toda vez que `dir` muda. O catálogo já resolveu isso com SWR + TTL; esta rota não replicou |

Sem achado: peso de bundle. Nenhuma das três páginas importa `psd-engine`/`sharp`/
`ag-psd` no cliente — os imports pesados estão corretamente atrás de `await import()`
nos route handlers. `/calibrate` inclusive já usa `dynamic(..., { ssr: false })`
(`calibrate/page.tsx:19-27`), que é o padrão que falta no `photo-mockup`.

---

## Inquérito do render — medido, não deduzido

O item 7 da tabela acima dizia "quatro pipelines divergentes". **Estava errado, e a
correção veio de medir.** Instrumento novo: `npm run check:render-ab`
(`scripts/render-ab.ts`) — mesma cena, mesmo quad, **mesma arte byte a byte** pelas
duas rotas de foto, com diff pixel a pixel e heatmap.

### O mapa certo: três domínios, um par comparável

| Rota | Entrada | Comparável? |
|---|---|---|
| `/api/render` | PSD, via render-server TCP (fila, cache de output) | Não — outro domínio |
| `/api/photo-mockup/[id]/render` | cena de foto, assets **pré-assados** em disco | **par** |
| `/api/calibrate/render` | cena de foto, assets **extraídos na hora** | **par** |
| `/api/scene/[sceneId]/render` | `SceneDoc` do `extractScene` (Scene Package) | Não — camadas chegam baked |

**A "luz que falta" no `/api/scene/.../render` não é bug de rota.** Não existe
estágio de luz ali porque as camadas já vêm compostas do `extractScene`. O defeito
é da extração, e foi remedido hoje com `bun scripts/scene-fidelity.ts --amostra 3`:

```
0/3 pixel-perfect
boxes_scene_3_bg.psd   divergência até 218/255 em 39,85% dos pixels
paper-ghetto-2.1.psd   divergência até 251/255 em 92,07% dos pixels
```

Segue lossy. O Scene Package não substitui PSD, e essa rota continua laboratório.

### O par: WYSIWYG é real, e o que mentia era a fonte do asset

Primeira rodada, 5 cenas: **3 byte-idênticas (max 0/255)**, 1 erro de dado (cena
sem `shadow.png`), 1 divergente com max 152/255 em 0,56% dos pixels.

O diff mostrou o que o número escondia: a divergência era um **contorno fino**, não
mancha na superfície. Assinatura de borda de máscara. Causa no código: a produção
lê `mask.png`, `photo-clean.png`, `occluder.png`, `reflection-mask.png` e
`color-cast.png` do disco; a prévia regenerava tudo com `extractSceneAssets`. Cena
refinada à mão = prévia mentindo exatamente onde mais se trabalhou.

**Isolamento, um asset por vez, em vez de dedução:**

| O que a prévia passou a ler do disco | Divergência |
|---|---|
| (nada — estado original) | 0,56% |
| occluder + reflexo + color-cast | 0,56% — **zero efeito** |
| + `mask.png` | 0,34% |
| + `photo-clean.png` | **0,00%** |

Minha primeira suspeita foi o occluder (632 KB naquela cena contra ~10 KB nas
outras) e ela **não mexeu um pixel**. Os culpados eram a máscara e a foto limpa.
Os três sem efeito ficaram assim mesmo, por simetria: a produção lê os cinco, e
deixar três de fora recria a mesma assimetria noutro dia.

**Depois do conserto, 6 cenas: 5 de 5 renderizáveis em 0/255.** A sexta é a cena
nunca processada, e o script a conta como falha de propósito — ele não consegue
provar igualdade sobre o que não renderiza.

Contra-verificação obrigatória (conserto de um caminho costuma quebrar o outro):
`/api/calibrate/render` numa pasta **sem** sidecar (`Render/New Mockups/`) segue
respondendo 200 com PNG de 621 KB, caindo na extração como antes.

## Interrogatório

**Q1 Se eu apagasse isto hoje, quem reclama em 48h?**
Você, no mesmo dia. `/photo-mockup` é o único lugar onde o quad, a máscara e a luz
de uma cena são refinados à mão, e o `settings.json` que ele grava é lido pelo loop
headless (`agent-mockup.ts`). Apagar quebra o WYSIWYG.
OBRIGA: nada. A tela se defende.

**Q2 Existe porque alguém precisa, ou porque o dado estava disponível?**
Precisa. Mas `/scene` (432 linhas) é o contrário: é laboratório do Scene Package,
que hoje entrega render lavado (0 de 6 pixel-perfect) e não está linkado no app.
OBRIGA: `/scene` e as rotas mortas `scene/[id]/doc` e `scene/[id]/asset/[...ref]`
(zero chamada no frontend) entram na lista de remoção, ou ganham um `README` que
diga que são laboratório.

**Q3 Qual é a versão disto que caberia numa frase?**
Não cabe. É manipulação direta de geometria — arrastar canto é a interface.
OBRIGA: nada.

**Q4 Qual o menor número de telas que entrega o resultado?**
**Uma.** Hoje são duas (`/calibrate` e `/photo-mockup`) fazendo a mesma operação
com dois modelos de estado, e é daí que vêm os itens 2, 3, 4 e 5 acima.
OBRIGA: é a decisão estrutural da rodada. Ver plano, fase 2.

**Q5 Qual decisão isto produz?**
"A superfície está certa, pode renderizar." A frase existe e a tela a produz.
OBRIGA: nada.

**Q6 Qual é o número que decide, e ele é o mais saliente?**
Não há número: o que decide é a sobreposição visual do quad na imagem. Correto para
o domínio.
OBRIGA: nada.

**Q7 Isto é a resposta ou a matéria-prima?**
É a resposta no `/photo-mockup` (renderiza e mostra). É matéria-prima no
`/calibrate`, que calibra e devolve o usuário para outra tela.
OBRIGA: reforça Q4.

**Q8 Qual default você escolheu pelo usuário?**
O `fit` da arte (`cover` para layout, `contain` + fundo para logo) e a detecção
automática do quad magenta. Ambos defensáveis e documentados no AGENTS.md.
OBRIGA: nada. É o melhor default do repo.

**Q9 Modele a jogada ótima do usuário. Ela te paga?**
Ferramenta interna: a jogada ótima é render em lote pelo CLI, sem abrir a tela. E
isso **te paga**, porque o CLI usa o mesmo core. O risco é a tela virar refinamento
de exceção e apodrecer sem ninguém notar.
OBRIGA: os testes precisam morar na lib compartilhada, não na tela. Reforça a
decisão pendente 3.

**Q10 Onde está o limite que motiva o upgrade?**
Não se aplica hoje (interna). Se aplicará no BOXY desktop, onde o limite é o acervo
plugável × PSDs da casa.
OBRIGA: nada nesta rodada.

**Q11 Este número mente em qual cenário?**
`calibrate/page.tsx:100-101` — o card de engine some calado se `/api/engine/stats`
cair (catch vazio). E `calibrate/page.tsx:209-212` engole falha ao carregar máscara
salva: o usuário vê "sem máscara" quando o certo era "não consegui carregar".
OBRIGA: conserto (fase 1).

**Q12 Se o backend cair, mostra erro ou mostra zero?**
Mostra vazio. `calibrate/page.tsx:164-174` e `:182-188` fazem `await r.json()` sem
checar `r.ok` — com 500 de corpo vazio o usuário lê o erro do parser, não o
problema. É exatamente o bug que `http-error.ts` foi escrito para matar, e ele não
é usado ali.
OBRIGA: conserto (fase 1). **Não verificado com backend parado de verdade** — ver
seção final.

**Q13 Que promessa isto faz que o banco não sustenta?**
`/scene` promete render pela cena e entrega lavado (Levels/Curves e FX `pass
through` perdidos no `extractScene`). A promessa está na existência da rota.
OBRIGA: reforça Q2.

**Q14 Se a escrita otimista falhar, o que fica registrado?**
O `settings.json` é escrito por merge (`photo-agent tag`), e o Mongo é espelho. O
risco conhecido é overwrite apagando estúdio — já aconteceu em produção.
OBRIGA: nada novo; a regra existe e está documentada.

**Q15 Papel ou propriedade?**
Não se aplica: sem multiusuário.

**Q16 Quantos pixels até o primeiro dado real?**
Não medido em pixels. A tela abre em canvas cheio, o cromo é a barra lateral.
OBRIGA: nada — a densidade aqui é defensável.

**Q17 Onde este elemento VAI FALTAR?**
Cena sem `analysis.json`, cena com `needsReview`, PSD cujo arquivo sumiu do disco.
O catálogo já se cura do terceiro (`psd-presence.ts`); os dois primeiros caem no
`if (!res.ok) return` do item 15.
OBRIGA: conserto (fase 1).

**Q18 O que isto ensina o usuário a fazer errado?**
Ensina que erro não existe. Três caminhos silenciosos (`page.tsx:557`,
`calibrate:100-101`, `calibrate:209-212`) treinam o operador a recarregar a página
em vez de reportar.
OBRIGA: conserto (fase 1).

**Q19 Se esta tela é a única coisa que o cliente vê, ele renova?**
Hoje não. Não pela estética — pelos 4 pipelines de render que fazem a mesma cena
sair diferente dependendo da porta de entrada.
OBRIGA: decisão pendente 2.

**Q20 Qual feature eu mato para abrir espaço?**
`/scene`. É a única do alvo com uso zero e promessa não sustentada.
OBRIGA: reforça Q2.

**Q21 Quem é o ICP desta tela?**
Um papel só: o operador do acervo (você). Não serve dois papéis, e isso é força.
OBRIGA: nada — e é o argumento a favor de desktop-only (decisão 1).

**Q22 Se o concorrente copiar pixel a pixel, o que sobra?**
Sobra o core WYSIWYG: prévia byte-idêntica ao render de produção, provada em
0,5/255 de diferença. Isso é mecanismo, não pixel, e é nomeável em uma frase.
OBRIGA: nada. É o ativo a proteger — e os 4 pipelines divergentes são exatamente
o que corrói ele.

**Q23 A promessa é do tamanho da prova?**
No `/photo-mockup`, sim. No `/scene`, não (Q13).

**Q24 As quatro camadas dizem a mesma frase?**
Não se aplica: sem landing nem preço nesta superfície.

**Q25 Este é um erro de categoria?**
Não. É ferramenta de operação, e está na prateleira certa.

**Q26 Quem mantém isto em seis meses, e como descobre que quebrou?**
Ninguém descobre. A matemática de coordenada tela↔imagem está inline no
`QuadEditor.tsx`, sem teste, e erro de sinal ou escala ali desalinha toda arte
renderizada em silêncio — só olhando o PNG.
OBRIGA: é o item de maior alavanca do plano inteiro. Fase 3.

**Q27 Se eu cobrasse por isto, quanto?**
Interna. Quem paga a manutenção é o tempo do operador, e os 2033 + 864 linhas com
17 itens de dívida são a fatura chegando.

**Q28 Qual decisão desta auditoria eu vou lamentar em três meses?**
Unificar `/calibrate` e `/photo-mockup` numa tela só (Q4) e descobrir que a
`/calibrate` tinha um uso que eu não vi — calibrar em lote, sem a tralha de render
em volta. **Mitigação: fase 2 extrai o núcleo compartilhado primeiro e mantém as
duas rotas vivas.** Fundir tela é fase 4, e só depois de você usar a versão
extraída por uma semana.

### Bloco fixo

**F1 O quanto estamos reinventando a roda?**
Reusado certo: Radix via `components/ui` (Dialog/Switch/Select), `@visant/masonry-gallery`,
MiniSearch, `lib/motion.ts`, `lib/brand.ts`, `photo-render-core.ts` como core único.
Escrito novo sem justificativa: os itens 2, 5, 6 e 11 da tabela — inversão de
máscara, fórmula de zoom, `fetchJson` e 112 botões. Nenhum deles precisou de busca:
o original já existia no próprio repo.
OBRIGA: fase 2.

**F2 O design system está consistente?**
`audit:design` em **zero erro** no alvo, e mesmo assim ~373 cores cruas e 143
`text-[Npx]`. Isso diz que o detector mede token declarado, não adesão. O exemplar
da casa é `ZoomPanViewer.tsx` e `ArtFramePanel.tsx` (usam `IconButton`); o
divergente é `calibrate/page.tsx` (33 botões crus, zero primitivo).
OBRIGA: fase 3, e o teto do `ui:audit` precisa passar a contar cor crua no alvo.

**F3 Responsivo e otimizado?**
Medido, não olhado: `/photo-mockup` +13px e `/calibrate` +1446px a 390px, 0 erro de
console nas duas. Otimização: sem cache no listador de cenas (item 17), waterfall
no deep link (item 16), e `photo-mockup/page.tsx` sem `next/dynamic` para as
ferramentas de canvas (7 canvases no chunk inicial, uma ativa por vez).
OBRIGA: decisão 1 + fase 1.

**F4 O fluxo está progressivo pro ICP?**
Caminho: (1) gerar cena com superfície magenta → (2) `finalize` detecta o quad →
(3) card na home → (4) "Abrir" leva ao `/photo-mockup` → (5) refina → (6) grava no
`settings.json` → (7) o CLI rende em lote. O "aha" é o passo 5, e o abandono é o
passo 2 quando a detecção reprova no QA e o usuário não sabe (o gate existe, mas
o aviso não chega na tela).
OBRIGA: mostrar `needsReview` no card. Fora do escopo desta rodada, entra no backlog.

**F5 O que esconder, compactar ou virar ícone?**

| Esconder | Compactar | Virar ícone | NÃO esconder |
|---|---|---|---|
| Ajustes de material procedural do `/calibrate` (uso raro, ~40px) | As duas linhas de dica em `CornersPanel.tsx:20` e `CropPanel.tsx:45` dizem a mesma gramática (~20px) | Nada. Os 2 botões sem rótulo acessível do `/calibrate` já são o problema oposto | O quad e a máscara. São a tela |

**F6 O que falta para o nível Vale do Silício?**
Dos treze: **feito** 3 (skeleton), 8 (motion do SSoT, confirmado limpo), 9
(densidade), 10 (um primário), 11 (default defensável), 12 (volta na posição).
**Falta** 1 e 2 (teclado/`focus-visible` não verificado; 2 botões sem rótulo em
`/calibrate`), 5 (erro/vazio/carregando colapsam em vazio — itens 15 e 18), 6
(mente por omissão — Q12), 13 (copy com 45 vícios de portão). **Não se aplica**
4, 7.
As três de maior alavanca por esforço:
1. **Erro deixa de ser silencioso** (itens 8, 15, 18) — meia hora, e é o que mais
   muda o dia do operador.
2. **`Quad` vira um tipo só** (item 1) — uma hora, e trava a classe inteira de bug
   de geometria no compilador.
3. **Coordenada sai do componente e vira lib testada** (Q26) — meio dia, e é o
   único jeito de o erro silencioso de render virar teste vermelho.

---

## Plano de execução

Quatro fases, ordenadas por risco decrescente e reversibilidade. **Nenhuma delas
cria componente novo de design system** — só extrai o que já existe duplicado.

### Fase 1 — Parar de mentir (meia hora, zero risco)
- `photo-mockup/page.tsx:557` ganha `toast.error` + `readError`.
- `calibrate/page.tsx` adota `readError` nos ~15 fetch crus.
- `calibrate/page.tsx:209-212` distingue "sem máscara" de "não carregou".
- `photo-mockup/page.tsx:552-571` vira `Promise.all`.
- ~~Copy do portão a zero~~ **feito** (50 strings, tabela acima, portão aberto).

### Fase 2 — SSoT do que está duplicado (um dia)
- `Quad`/`QuadPt`/`Pt`/`QuadCorners` → **um tipo** em `stores/editorDoc.ts`, com
  `key-color-core.ts` reexportando para o servidor. Apaga a sombra do `page.tsx:53-54`.
- `MaskCalibrate` passa a importar `invertMask` de `mask-compose.ts` **e** a fila do
  `useMaskEditor` (mata o race que já foi corrigido uma vez).
- Constante e fórmula de zoom saem para `lib/viewer-zoom.ts`, consumida pelo
  `ZoomPanViewer` (DOM) e pelo `CalibrateStage` (Konva).
- `scene/page.tsx` passa a usar `photo-mockup-io.ts`; apaga o `fetchJson` local.
- Decisão pendente 2 define o SSoT de render; os outros viram adaptador.

### Fase 3 — Teste onde o erro é calado (meio dia)
- Extrai a matemática de coordenada do `QuadEditor.tsx` para `lib/quad-math.ts`
  (pura) e escreve o teste: ida e volta tela↔imagem, quad degenerado, escala e
  rotação de canvas.
- Teste de `mask-compose` (inversão, cap 2048) e de `photo-render-core`.
- **Sem `@testing-library`** (decisão pendente 3).

### Fase 4 — Design system (um dia, só depois das outras)
- Cor de canvas puxa `ACC`/`ACC2` de `brand.ts` — mata o `#22c55e` do Tailwind.
- `<button>` cru → `IconButton` no `calibrate/page.tsx` (33) e `photo-mockup` (15).
- `ArtFramePanel` passa de `neutral` para `zinc`.
- `text-[Npx]` vira escala; `transition-colors` vira `transition-ui`.
- `ui:audit` ganha teto para cor crua no alvo, senão o item 9 volta.

---

## O que a rodada consertou nos detectores

| Regra | Era acusado | Conserto | Caso no fixture |
|---|---|---|---|
| extrator de copy | `console.debug(\`[render] ${ms}ms total · ${st}\`)` em `photo-mockup/page.tsx:930` acusava "bolinha" num log dentro de `NODE_ENV === "development"` | A chamada `console.*` é cortada antes de qualquer extração: saída de desenvolvedor não é interface | `copy-extractor.tsx`, linha `IGNORA` com `console.debug` e bolinha |

Portão foi de **46 para 45** só com isso. Self-test do extrator verde nos dois
sentidos depois da mudança (o falso negativo é o que importa: string nunca extraída
faz o portão dizer zero sobre texto que ninguém checou).

---

## Verificação final

| Portão | Resultado |
|---|---|
| impeccable · audit:design · copy | zero, zero, zero (359 strings de interface) |
| `npx tsc --noEmit` | 0 erro |
| `npx vitest run` | **400/400** (era 377; +23 de `quad-math`) |
| `npm run ui:audit` | tudo dentro do orçamento (botão só-ícone 12/12, raio 6/7) |
| `npm run visual:scene` | tudo ok — canvas desenha nas duas rotas, 0 erro de console, 0 botão sem rótulo |
| `npm run check:render-ab` | 3/3 renderizáveis em **0/255** |
| `npm run smoke` | 13/13 |

Ferramentas que a rodada deixou no repo (medição vira portão, não evento):
`npm run check:render-ab` e `npm run visual:scene`.

## Achado na auto-revisão (o que eu tinha aceitado sem checar)

A fila anti-race do `MaskCalibrate` veio acompanhada de um **guarda de eco**
(`echoRef`) que eu reportei como resolvido sem ler a lógica linha a linha. Lendo:

```js
if (!echoRef.current) { maskRef.current = mask; return; }
if (mask === echoRef.current.v) echoRef.current = null;
```

Se um write EXTERNO chegar enquanto o eco está pendente, o prop não bate com
`echoRef.v`, o eco **nunca limpa**, e a partir dali toda mudança externa é ignorada
para sempre naquela montagem. E o componente era montado **sem `key`**
(`calibrate/page.tsx:856`), então trocar de cena não remontava.

Caminho real: pintar e trocar de cena no mesmo tique — o `setMaskUrl(null)` do
`loadScene` colapsa no mesmo lote do eco. Sintoma: **a máscara da cena anterior
continua viva na nova**, e o próximo traço compõe em cima dela. Mudo.

Consertado com `key={scene.name}`: outra cena é outra sessão de edição, e remontar
zera os refs. Os dois únicos writes externos (`loadScene:199` e `:222`) acontecem
na troca de cena, então a chave cobre os dois.

**Lição, e ela é sobre processo:** trabalho de agente em código de concorrência
precisa de leitura linha a linha, não de placar verde. `tsc`, 400 testes e os três
detectores passavam com esse bug de pé.

## Verificação visual (a que faltava)

Capturas a 1600×950, dirigindo a UI até a ferramenta:

- **`/photo-mockup`, tool Cantos** — o quad cai **exatamente** no outdoor: cantos
  nos cantos, losangos de abaulamento nos pontos médios das arestas. É a prova de
  que a transformada afim extraída para `quad-math.ts` está certa; erro de sinal ou
  escala deslocaria o quad, e nenhum teste de lib pegaria isso.
- **`/calibrate`, modo Máscara** — verde da marca no instrumento ativo, no `+` e no
  "Aplicar caneta", com texto escuro legível; **"Inverter" visivelmente
  desabilitado**, o modelo do Photoshop na tela.
- Falso alarme registrado: a primeira captura saiu com o canvas **preto**. Não era
  defeito — a cena é servida com `raw=1` (obrigatório para leitura de pixel) e é
  pesada; com 9s de espera ela aparece. Medição apressada teria virado bug fantasma.

## Não verificado

- **Backend parado.** Q12 foi respondida lendo o código (`await r.json()` sem
  `r.ok`), não derrubando o servidor. Para verificar: parar o Next e o render-server
  da 4200 e reabrir as duas rotas.
- **Teclado e `focus-visible`.** Os 2 botões sem rótulo do `/calibrate` foram
  consertados (`aria-label` + `title` na navegação de cena) e o `visual:scene`
  agora falha se voltarem. O atalho `C` está exercitado. **Não** percorri a ordem
  de tabulação nem conferi se `focus-visible` alcança tudo que o hover revela.
- **Feel a 25% no DevTools.** Não rodado. O SSoT de motion está limpo por grep
  (nenhum `duration-*`/`ease-*` cru, nenhum `transition-all`), o que é evidência
  fraca comparada a olhar.
- **`prefers-reduced-motion`.** Não testado.
- **Dado real do pior caso.** As medições de 390px rodaram com a tela em estado
  inicial. Cena carregada, com máscara e luz, pode estourar mais.
- **Render em produção.** Toda medição foi em dev, que mente por dois.
- **Pintar máscara de verdade.** A fila serializada, o guarda de eco e o `key` por
  cena **não foram exercitados interativamente** — nenhum traço foi dado, nenhuma
  troca de cena no meio de um write foi reproduzida. É a lacuna mais incômoda que
  sobra: o bug do eco foi achado LENDO, não rodando, e o conserto foi verificado do
  mesmo jeito. Fechar isso pede `@testing-library` (recusado, decisão 3) ou um teste
  de ponta a ponta que o repo não tem.
- **Cobertura do `check:render-ab`:** 4 cenas de 136.
- **`npm run lint`** tem 357 warnings; a memória do repo registra ~305. A diferença
  não foi investigada — são warnings deliberados, mas o número subiu.
