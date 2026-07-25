# Auditoria de frontend — mockup-store (skill `visant-frontend`)

> **STATUS (2026-07-24): top 3 + violação de regra executados.**
> · #1 grid mentindo com API caída: estado de erro distinto do empty-state, `hasMore=false`
>   (mata o loop do IntersectionObserver), badge do header não contradiz mais o grid vazio,
>   botão "Tentar de novo" + retry inline no sentinel.
> · #2 ação primária: card deixou de ser `<button>` envolvendo `<a>`/`<button>` (HTML
>   inválido que matava o link "Abrir") → `<div role="button">` + Enter/Espaço; "Aplicar"
>   virou `<button>` de verdade, visível por `focus-within` e sempre visível onde não há
>   hover (`@media (hover:hover)`). Aplicado também no `SuggestionCard`, mesmo bug.
> · #3 `ExportBar` falha silenciosa: `toast.error` + `console.error`. Uma **segunda** falha
>   silenciosa foi achada e corrigida: o `launchQueue` do PWA (abrir `.vsn` pelo SO).
> · regra "sem IA na UI": 3 rótulos → "Visant", seguindo o padrão que já existia no código.
> Pendente: os itens de menor severidade da lista completa abaixo.

**Data:** 2026-07-24 · **Branch:** `feat/detection-qa-gate` · **Modo:** leitura de código (nenhum arquivo em `src/` foi alterado).

**Classificação de superfície (Passo 0 da skill):** todas as telas auditadas são **classe B — work surface** (variável: *throughput × decision quality*). Duas regiões são **classe C — trust**: a exportação do render (`ExportBar`) e as escritas de `settings.json` no `/calibrate`. Nenhuma região é classe A — não há hero, não há pitch, e isso está certo.

---

## Veredito geral

O **editor** (`/photo-mockup`) é a parte madura do produto: rail de ferramentas data-driven com `aria-pressed` e tooltip de atalho, cheatsheet `?` alimentado pelo registry (SSoT, nunca desatualiza), guarda destrutiva no "Novo projeto" que só interrompe quando há trabalho a perder, um único `<img>` persistente que preserva zoom/pan entre tools — isso é nível Linear. A **home/grid**, que é a porta de entrada e onde o usuário passa a maior parte do tempo, está um nível abaixo e carrega três defeitos de correção, não de gosto: um `fetch` que engole erro e renderiza o estado vazio errado ("tente redefinir seus filtros" quando a API caiu), uma corrida em `fetchPage` que trava o grid em skeleton permanente, e um card que aninha `<a>` e `<button>` dentro de um `<button>` — o que deixa a única porta de entrada do editor de cenas inacessível por teclado. A ação primária do produto inteiro ("Aplicar" a arte) é uma `<div onClick>` revelada só em `group-hover`: sem foco, sem toque, sem tecla. E o `ExportBar` — o entregável final — falha em silêncio num `catch {}`. O denominador comum não é falta de capricho visual: é **a UI mentindo sobre o estado do sistema** (espinha 9) em três lugares onde o usuário não tem como perceber.

---

## Tabela de achados

| # | Sev | Superfície | Achado | Arquivo:linha |
|---|---|---|---|---|
| 1 | **P0** | Home / grid | `fetch` de referências engole erro → renderiza "Nenhum mockup encontrado · tente redefinir seus filtros" | `src/app/page.tsx:633-638`, `1772-1781` |
| 2 | **P0** | Home / grid | Corrida em `fetchPage`: trocar filtro durante um load em voo trava o grid em skeleton permanente | `src/app/page.tsx:600`, `643-650` |
| 3 | **P0** | Home / card | `<a>` e dois `<button>` aninhados dentro do `<button>` do card — HTML inválido; "Abrir" (única entrada do editor de cenas) morta no teclado | `src/app/page.tsx:81`, `128`, `155`, `166` |
| 4 | **P0** | Home / card | "Aplicar" — a ação primária do produto — é `<div onClick>` revelada só por `group-hover`, sem `focus-within` e sem `(hover:hover)` | `src/app/page.tsx:142-150`, `262-271` |
| 5 | **P0** | Editor / export | `ExportBar.save()` falha em silêncio (`catch { /* noop */ }`): botão volta ao normal, nada baixa | `src/components/photo-tools/ExportBar.tsx:49-51` |
| 6 | **P0** | Home / teclado | Setas com `preventDefault` global, sem guarda de digitação/modificador/foco; sem `aria-live` na troca de seleção | `src/app/page.tsx:822-840` |
| 7 | **P1** | Editor + Calibrate | "AI" nomeado na UI (regra do projeto: nome funcional, nunca a tecnologia) | `src/app/photo-mockup/page.tsx:1678`, `1693`; `src/app/calibrate/page.tsx:699` |
| 8 | **P1** | Home / grid | Com marca selecionada, ~406px de chrome antes do 1º card; rail horizontal com `no-scrollbar` e sem setas | `src/app/page.tsx:1695-1757`, `1726` |
| 9 | **P1** | Home / filtros | Dedup e "esconder" rodam client-side sobre lista paginada; "N ocultos" e o total do header medem coisas diferentes, sem rótulo | `src/app/page.tsx:1178-1183`, `1358-1362`, `1489-1491` |
| 10 | **P1** | Home / grid | Estado vazio testa `refs`, o grid renderiza `displayRefs` → esconder tudo da página carregada dá tela em branco sem mensagem | `src/app/page.tsx:1772` vs `1790` |
| 11 | **P1** | Calibrate | Fila de cenas são `<div onClick>` (teclado morto); "Ignorar" só em hover sem `focus-visible`; 9 atalhos de tecla única sem cheatsheet e sem guarda de `<select>` | `src/app/calibrate/page.tsx:597-599`, `608-609`, `541-557` |
| 12 | **P1** | Editor / teclado | Handler de `Enter` do crop dá `preventDefault` mesmo com foco num `<button>` → Enter num botão aplica o corte em vez de acionar o botão | `src/app/photo-mockup/page.tsx:1092-1099` |
| 13 | **P2** | Home / grid | `key` com índice → alternar dedup/esconder remonta todos os cards seguintes e rebaixa as thumbs | `src/app/page.tsx:1792` |
| 14 | **P2** | Home | Controles mortos renderizados: toggle do painel direito inerte (`opacity-20 pointer-events-none`) e dezenas de chips `disabled` quando o teto de 5 tags é atingido | `src/app/page.tsx:1388`, `1659-1671` |
| 15 | **P2** | Home / motion | `duration-700` + `scale-110` em hover de card (interativo >300ms) e `scale-110` em chip dentro de flex-wrap (reflow); tokens `--motion`/`--ease` existem e não são usados | `src/app/page.tsx:93`, `241`, `1668`; `src/app/globals.css:7-10` |

---

## Detalhamento

### 1 — P0 · O grid mente quando a API cai

**Errado.** `fetchPage` só trata `AbortError`; qualquer outro erro (500 do Mongo, `data.references` undefined, JSON inválido) cai no `catch` vazio de `page.tsx:633-635`, `refs` fica `[]`, e o bloco de `page.tsx:1772` renderiza *"Nenhum mockup encontrado — tente redefinir seus filtros ou buscar outro termo"*. Pior: `hasMore` mantém o valor anterior (`true`) e o `IntersectionObserver` de `page.tsx:807-818` é recriado a cada toggle de `loading`, então o sentinel dispara de novo em loop — retry infinito, silencioso, sem nenhum sinal na tela. E o badge de total (`page.tsx:1358`) continua exibindo a contagem antiga ao lado de um grid vazio: dois números que se contradizem.

**Variável.** Decision quality e throughput. O usuário reconfigura filtros perseguindo um fantasma; e o Mongo offline é um cenário *documentado* deste projeto (o `AGENTS.md` diz que `/api/references` é "resiliente a Mongo offline") — ou seja, é o caminho esperado, não a exceção.

**Fix.** Estado de erro separado do estado vazio. No `catch`, `setLoadError(String(err))` e `setHasMore(false)` (mata o loop de retry). No render, antes do teste de `refs.length === 0`, um bloco de erro reusando o padrão já existente em `page.tsx:1719` (`bg-red-500/5 border-red-500/10 rounded-2xl` + `AlertTriangle`) com um botão "Tentar de novo" chamando `fetchPage(1, false)`. Zero componente novo.

### 2 — P0 · Skeleton eterno

**Errado.** `fetchPage` começa com `if (loading) return;` (`page.tsx:600`). O efeito de `page.tsx:643-650` limpa `refs`, seta `initialLoad = true` e chama `fetchPage(1, false)`. Se houver um load de página 2 em voo (scroll infinito), a chamada retorna na primeira linha — e nada mais reagenda. Resultado: `refs = []`, `initialLoad = true`, skeleton de 18 cards para sempre. Digitar na busca durante o carregamento inicial é o caminho mais fácil de reproduzir.

**Variável.** Throughput — a sessão termina ali; o usuário recarrega a página.

**Fix.** O `abortRef` (`page.tsx:603-605`) já existe justamente para isso: aborte o anterior e siga, em vez de sair. Trocar `if (loading) return;` por um guard só no caminho de `append` (o scroll infinito), e deixar a página 1 sempre passar. Como bônus, `loading` sai das deps do `useCallback` (`page.tsx:640`) e o observer para de ser recriado a cada tick.

### 3 — P0 · Card com interativos aninhados

**Errado.** `MockupCard` devolve um `<button>` raiz (`page.tsx:81`) que contém um `<a href>` (`128`), um `<button>` de abrir pasta (`155`) e um `<button>` de esconder (`166`). É HTML inválido — o parser do browser não aninha conteúdo interativo em `<button>`, o React reclama na hidratação, e na prática o `<a>` "Abrir" perde a ativação por Enter. Para mockups do tipo `photo`, esse link é a **única** rota até `/photo-mockup?scene=…`: o editor inteiro fica inalcançável sem mouse.

**Variável.** Throughput + a11y. O loop de refino manual descrito no `AGENTS.md` ("card → Abrir → /photo-mockup") depende dessa rota.

**Fix.** Raiz vira `<div role="group">` com um `<button>` de seleção em `absolute inset-0` (camada de fundo, `z-0`), e os controles reais empilhados acima em `z-10`. Padrão já usado no próprio repo em `calibrate/page.tsx` (linha de cena com botão de ignorar sobreposto) — só falta o botão de seleção real ali também (achado 11).

### 4 — P0 · A ação primária não tem caminho de teclado nem de toque

**Errado.** O overlay "Aplicar" é uma `<div onClick>` (`page.tsx:142-150`, e igual em `262-271` no `SuggestionCard`): sem `tabIndex`, sem `role`, sem `onKeyDown`. Ela só existe visualmente sob `group-hover:opacity-100`, sem `group-focus-within:` — e sem `[@media(hover:hover)]`, o que significa que num tablet (largura de desktop, zero hover) o overlay **nunca** aparece. Aplicar arte num mockup é a razão de existir do produto e não tem caminho algum fora do mouse.

**Variável.** Throughput, e a mais cara do conjunto — é a ação que o produto vende.

**Fix.** Trocar a `<div>` por `<button type="button">` com `onClick={(e) => { e.stopPropagation(); onApply(); }}`, e a classe de revelação por
`opacity-0 [@media(hover:hover)]:opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100`.
Regra da skill (`work-surface.md` → Hover): revelar por `(hover: hover)`, nunca por breakpoint nem por hover puro quando é a única rota.

### 5 — P0 · O entregável final falha em silêncio

**Errado.** `ExportBar.save()` termina em `catch { /* noop */ }` (`ExportBar.tsx:49-51`). Canvas com taint, `toBlob` retornando `null` num render muito grande, `crossOrigin` recusado — tudo vira "nada aconteceu". O botão sai do estado `busy` e volta ao normal, indistinguível de sucesso.

**Variável.** Retenção e confiança (superfície C). O usuário conclui que "o app não salva" e o bug nunca chega até você.

**Fix.** O `<Toaster />` do sonner já está montado em `photo-mockup/page.tsx:1338`. `import { toast } from "sonner"` e no catch: `toast.error("Não deu pra exportar", { description: String(e) })`. Duas linhas, zero componente novo.

### 6 — P0 · Teclado da home

**Errado.** `page.tsx:822-840`: `ArrowRight/Left/Up/Down` com `preventDefault()` incondicional. As guardas exigidas pela skill não existem — não checa `e.target` (campo de busca no header, `page.tsx:1347`, e o input do wizard de pasta), não checa `metaKey/altKey/ctrlKey`, não checa foco em `<button>/<a>/<select>`. Com um mockup selecionado, mover o cursor no campo de busca navega o grid; `Alt+←` (pular palavra) idem. E a troca de seleção não é anunciada — não há `aria-live` em lugar nenhum de `page.tsx`, num loop que é literalmente "seleciona → próximo".

**Variável.** Throughput + integridade da interação (espinha 8: teclado é feature de retenção).

**Fix.** Ordem de guarda canônica da skill, na ordem: (1) combo com modificador → trata e sai; (2) `e.target` é INPUT/TEXTAREA/contentEditable → só trata `Escape` (blur) e sai; (3) qualquer outro modificador → sai; (4) foco dentro de `button/a/select` → sai; (5) tecla pura → trata. O editor já implementa os passos 2 e 3 corretamente em `photo-mockup/page.tsx:1080-1083` — copiar dali. Somar um `<div aria-live="polite" className="sr-only">{selected?.name}</div>` no painel direito.

### 7 — P1 · "AI" nomeado na UI

**Errado.** `photo-mockup/page.tsx:1678` renderiza o texto literal `AI` no badge de toggle; `1693` mostra `AI · 2.3s` no chip de tempo; `calibrate/page.tsx:699` tem `title="AI vision (Claude) — análise mais precisa…"` num ícone `Sparkles` roxo (`text-purple-400`) — o combo sparkles-roxo é justamente o tell genérico que a skill manda cortar. Regra do projeto (MEMORY: *no-ia-naming*): IA é detalhe de implementação, não diferencial.

**Nota:** o código já acerta em `photo-mockup/page.tsx:779`, onde `upMode === "ai"` vira o rótulo **"Visant"**. É o padrão a seguir.

**Fix.** `1678`: `{showAiResult ? "Suavizado" : "Original"}`. `1693`: `` `Suavizado · ${…}s` ``. `calibrate:699`: `title="Análise detalhada — mais precisa, ~1s + custo"` e trocar `text-purple-400` por `text-acc2` (token do DS, `globals.css:35`).

### 8 — P1 · Orçamento de altura com marca selecionada

**Medido** (leitura de código, não renderizado):

| Bloco | px |
|---|---|
| Header `h-14` | 56 |
| `main` `p-8` (topo) | 32 |
| Cabeçalho "Matches Inteligentes" + `mb-6` | ~56 |
| Rail de sugestões (card `w-48`, `aspect-[4/3]` + label `p-3`) | ~190 |
| `pb-6` do rail + `mb-12` da seção | 72 |
| **Total até o 1º card do grid** | **~406** |

Sem marca, são 88px — exemplar. Com marca, o rail sozinho custa ~318px e ele é `overflow-x-auto` com `no-scrollbar` (`page.tsx:1726`): não há barra, não há setas, não há gradiente de borda. O botão "Ver mais" (`1741-1754`) fica no fim de uma pista horizontal que o usuário não sabe que rola.

**Variável.** Throughput — o grid principal some abaixo da dobra exatamente quando a marca (o modo de trabalho real) está ativa.

**Fix.** (a) Trocar `no-scrollbar` por um `scrollbar-thin` ou adicionar máscara de gradiente lateral (`mask-image: linear-gradient(to right, black 90%, transparent)`) para sinalizar continuação. (b) `mb-12` → `mb-6` e `pb-6` → `pb-3`: recupera ~48px sem tocar em conteúdo. (c) Considerar colapsar o rail para uma linha de cabeçalho clicável quando o usuário rola o grid.

### 9 — P1 · Dois números que medem coisas diferentes

**Errado.** `displayRefs`/`hiddenDupes` (`page.tsx:1178-1183`) são calculados sobre `refs` — só as páginas já carregadas (60 por página, `page.tsx:609`). O rótulo "**N ocultos**" (`1490`) portanto cresce a cada scroll e não descreve o catálogo, descreve o buffer. Ao lado, o header mostra `{total} Mockups` (`1358`), que vem do servidor e é *pré-dedup*. Dois números, mesma unidade, tipos diferentes, nenhum rótulo distinguindo — é o caso "quando dois números medem coisas diferentes, a UI diz qual é qual".

**Variável.** Decision quality — o usuário usa o total para decidir se vale filtrar mais.

**Fix.** Mínimo e honesto: rotular o local como local — `{hiddenDupes} ocultos nesta lista`. Melhor: mover o dedup para o servidor (`/api/references`) e devolver `total` já deduplicado, já que o toggle está `true` por padrão (`page.tsx:400`) — hoje o default do produto é uma visão cujo total nunca bate.

### 10 — P1 · Buraco no estado vazio

**Errado.** O ramo de vazio testa `refs.length === 0` (`page.tsx:1772`) mas o grid mapeia `displayRefs` (`page.tsx:1790`). Esconder manualmente todos os itens da página carregada dá `refs.length > 0` e `displayRefs.length === 0`: um `<main>` em branco, sem mensagem, com só o sentinel de "Fim da Biblioteca" no rodapé.

**Variável.** Throughput — o usuário fica sem próximo passo.

**Fix.** Trocar o teste por `displayRefs.length === 0` e diferenciar a cópia: se `hiddenIds.size > 0`, o texto vira "Tudo nesta página está oculto" com o botão "Restaurar ocultos" *inline* (o handler `persistHidden(new Set())` de `page.tsx:1499` já existe), em vez de mandar mexer nos filtros.

### 11 — P1 · Fila do /calibrate é inacessível

**Errado.** Cada cena é uma `<div onClick>` (`calibrate/page.tsx:597-599`) — sem `tabIndex`, sem `role`, sem `onKeyDown`. O botão "Ignorar (não é cena)" (`608-609`) é `opacity-0 group-hover:opacity-100` sem `focus-visible` e é o único caminho da ação. E a tela tem **nove** atalhos de tecla única (`s`, `o`, `d`, `m`, `w`, `k`, `f`, `r`, setas — `541-557`), nenhum anunciado em `<kbd>` e sem cheatsheet, enquanto `/photo-mockup` tem um (`ShortcutsHelp`, aberto por `?`). A guarda de digitação em `544` cobre só `INPUT`/`TEXTAREA` — não cobre `<select>`, então digitar para procurar uma opção dispara toggles de modo.

**Variável.** Throughput numa tela de fila (o padrão "agir → próximo item" é exatamente o caso de uso).

**Fix.** (a) `<div>` → `<button type="button" className="w-full text-left …">` e o botão de ignorar sai de dentro dele para um wrapper `relative` (mesmo padrão do achado 3). (b) Somar `group-focus-within:opacity-100 focus-visible:opacity-100` no botão de ignorar. (c) Montar `<ShortcutsHelp>` aqui também — o componente já é genérico (`ShortcutsHelp.tsx:24`), só precisa de props para a lista da tela; **isso mexe em componente, ver seção de aprovação**. (d) Somar `SELECT` à guarda da linha 544.

### 12 — P1 · Enter do crop rouba o Enter dos botões

**Errado.** `photo-mockup/page.tsx:1092-1099`: com `tool === "crop"` e um `cropArea` definido, qualquer `Enter` no `window` dá `preventDefault()` e chama `handleApplyCrop()`. A guarda cobre INPUT/TEXTAREA/contentEditable mas não foco em `<button>`/`<a>`. Um keydown num botão focado borbulha até o `window`; cancelá-lo cancela a ativação do próprio botão. Tabular até "Cancelar" e apertar Enter **aplica** o corte.

**Variável.** Integridade — é uma ação que altera a imagem base e é o oposto do que o botão prometia.

**Fix.** Somar ao guard: `if (t && (t.tagName === "BUTTON" || t.tagName === "A" || t.tagName === "SELECT")) return;`. Uma linha, e o mesmo guard serve para o handler de tools em `1078-1085`.

### 13 — P2 · `key` com índice

`key={`${ref.id}-${i}`}` (`page.tsx:1792`): o índice faz parte da identidade, então alternar "Esconder duplicados" ou ocultar um card remonta todos os cards seguintes — as `<Image>` remontam e as thumbs reaparecem (`loading="lazy"`, `unoptimized`). `key={ref.id}` resolve; se houver risco real de id duplicado vindo do merge Mongo+filesystem, deduplicar por id no `useMemo` de `1178` em vez de mascarar com o índice.

### 14 — P2 · Controles mortos renderizados

O toggle do painel direito fica `opacity-20 pointer-events-none` quando não há seleção (`page.tsx:1388`) — visível, inerte, sem explicar por quê: "dead controls don't render". Renderize só quando `selected`. Igualmente, ao atingir o teto de 5 tags (`1659-1671`), *todos* os chips não-ativos da taxonomia viram `disabled opacity-50 cursor-not-allowed` de uma vez — dezenas de controles mortos simultâneos, com a explicação escondida num `title`. Melhor: manter os chips ativos e, no clique além do teto, substituir a tag mais antiga (ou mostrar uma linha única "Máximo de 5 tags — remova uma" acima da taxonomia, uma vez, em vez de N chips cinzas).

### 15 — P2 · Motion fora dos tokens

`globals.css:7-10` define `--motion-fast: 140ms`, `--motion: 180ms`, `--motion-slow: 260ms`, `--ease`. A home não usa nenhum: `duration-700` no zoom da thumb (`page.tsx:93`, `241`) é mais que o dobro do teto de 300ms para feedback interativo, e `scale-110` no chip de tag ativo dentro de um `flex-wrap` (`page.tsx:1668`) empurra os chips vizinhos a cada clique. Trocar por `duration-[--motion-slow]` (ou `duration-200`) no zoom, e por peso/cor em vez de escala no chip (o chip já vira `bg-white text-black` — a escala não acrescenta informação e custa reflow).

---

## Fluxo de teclado (obrigatório em superfície B)

| Tela | Existe | Quebra | Falta |
|---|---|---|---|
| Home | `Escape` (fullscreen → seleção), setas ←→↑↓, `Ctrl+V` cola arte | setas sequestradas dentro do campo de busca e sob `Alt`/`Cmd`; nenhum atalho anunciado em `<kbd>`; "Aplicar"/"Abrir"/"Esconder" inalcançáveis | `Enter` para aplicar no item selecionado; `aria-live` na troca de seleção; cheatsheet |
| `/photo-mockup` | tools (`V/C/S/P/R`), `?` cheatsheet, `Ctrl+Z`/`Ctrl+Shift+Z`, `Esc` fecha painel, `Enter`/`Esc` no crop, `Ctrl` = perspectiva da luz | `Enter` do crop rouba botões focados (achado 12) | guard de `BUTTON/A/SELECT` |
| `/calibrate` | 9 atalhos de tecla única + `Ctrl+Z`/`Y` | guard cobre só INPUT/TEXTAREA; fila navegável só por mouse | `<kbd>` nos controles, cheatsheet, fila focável |

Ordem de guarda correta (a mesma para os três): modificador → digitando → outro modificador → foco em controle → tecla pura.

---

## O que NÃO mudar

Estas decisões estão certas e são exatamente o que um redesign apressado destrói primeiro:

- **`resetPhoto` só confirma quando há trabalho a perder** (`photo-mockup/page.tsx:1158-1162`). Guarda destrutiva condicional, com texto que nomeia o que se perde. Não transformar em confirm incondicional.
- **O painel do `ToolRail` nunca fecha por clique fora** (`ToolRail.tsx:8-9`) — proposital, para permitir mexer no canvas com o painel aberto. É a decisão certa num editor.
- **`ShortcutsHelp` deriva do registry `PHOTO_TOOLS`** (`ShortcutsHelp.tsx:47`) — SSoT, nunca desatualiza. Qualquer generalização precisa preservar isso.
- **Um único `<img>` base persistente no `ZoomPanViewer`** (`photo-mockup/page.tsx:1427-1448`): zoom/pan sobrevivem à troca de tool e não há flash de imagem. Não trocar por um `<img>` por tool.
- **`Ctrl+Z` cede para varinha/SAM no tool Máscara** (`photo-mockup/page.tsx:1061-1065`): o undo local vence o global no contexto certo. Sutil e correto.
- **`dedupeRefs` agrupa por nome normalizado + bucket de tamanho, e tamanho ausente só casa com ausente** (`src/lib/dedup.ts`) — conservador de propósito. Não afrouxar.
- **`selectRef` descarta os slots extras e reseta o crop ao trocar de mockup** (`page.tsx:846-858`): impede que estado de arte vaze entre PSDs com faces diferentes.

---

## Uma tensão real

**O dedup client-side (achado 9) é o caso em que a recomendação tem custo de verdade.**

Mover o dedup para o servidor conserta o total e torna "N ocultos" verdadeiro — mas o `/api/references` mescla Mongo (PSDs + publicadas) com filesystem (`data/`, `.tmp/photo-scenes/`) e é explicitamente resiliente a Mongo offline (`AGENTS.md`). Deduplicar server-side significa colapsar itens *antes* de saber se as duas fontes concordam, e num modo degradado (Mongo fora) o dedup passaria a esconder itens com base em metadados parciais — exatamente o cenário em que esconder é mais perigoso.

Opções: **(a)** dedup server-side — total honesto, risco de esconder demais no modo degradado; **(b)** manter client-side e só rotular ("N ocultos nesta lista") — custa zero, mas o total do header continua não batendo com o que se vê; **(c)** desligar o default `hideDuplicates = true` — total volta a bater, e o usuário paga com um grid ruidoso que foi justamente o problema que o toggle resolveu.

**Recomendação: (b) agora, (a) quando o merge tiver uma chave estável.** O rótulo custa uma string e elimina a mentira; o dedup no servidor entra junto com a chave canônica de cena. **Gatilho para revisitar:** se alguém reportar "o contador diz 4.000 mas eu só consigo rolar até 900", (a) sobe de prioridade — significa que o total está sendo lido como promessa de conteúdo, não como tamanho do acervo.

---

## Quick wins (<30min cada)

1. `ExportBar.tsx:49` — `toast.error` no catch. **2 linhas.** (achado 5)
2. `photo-mockup/page.tsx:1678,1693` + `calibrate/page.tsx:699` — trocar "AI" por "Suavizado"/"Análise detalhada"; `text-purple-400` → `text-acc2`. (achado 7)
3. `photo-mockup/page.tsx:1095` e `1081` — somar `BUTTON/A/SELECT` ao guard; `calibrate/page.tsx:544` — somar `SELECT`. **3 linhas.** (achados 11d, 12)
4. `page.tsx:1772` — testar `displayRefs.length` e diferenciar a cópia quando `hiddenIds.size > 0`. (achado 10)
5. `page.tsx:1792` — `key={ref.id}`. (achado 13)
6. `page.tsx:1388` — renderizar o toggle do painel direito só quando `selected`. (achado 14, metade)
7. `page.tsx:93,241` — `duration-700` → `duration-200`; `page.tsx:1668` — remover `scale-110`. (achado 15)
8. `page.tsx:1490` — `{hiddenDupes} ocultos nesta lista`. (achado 9, mitigação)
9. `page.tsx:1696,1726` — `mb-12`→`mb-6`, `pb-6`→`pb-3`, tirar `no-scrollbar` do rail. **~48px recuperados.** (achado 8)
10. `page.tsx:600,640` — guard de `loading` só no caminho `append`. (achado 2)

Os achados 1, 3, 4, 6 e 11a-c são maiores que 30min e devem virar tarefas próprias.

---

## Precisa de aprovação (mexe em componente)

Nada aqui foi executado. Todos exigem seu OK antes de qualquer edição.

1. **Reestruturar `MockupCard` e `SuggestionCard`** (`page.tsx:57-182`, `214-283`) — raiz `<div role="group" className="relative">` + botão de seleção em `absolute inset-0 z-0` + controles em `z-10`; "Aplicar" vira `<button>`; classes de revelação passam a `(hover:hover)` + `focus-within`. Resolve os achados 3, 4 e parte do 15. É o item de maior impacto do relatório. Sem componente novo — só recomposição do markup existente.
2. **Generalizar `ShortcutsHelp`** (`ShortcutsHelp.tsx:24`) para aceitar as seções por prop, e montá-lo em `/calibrate` e na home. Hoje é hard-coded no registry do photo-mockup. Alternativa sem tocar no componente: duplicar — pior, dois lugares para desatualizar.
3. **Bloco de estado de erro no grid** (achado 1) — não é componente novo se reusar o padrão inline de `page.tsx:1719`; vira componente se você quiser um `<ErrorState>` compartilhado entre home, `/calibrate` e `/scene` (que tem o mesmo problema em `scene/page.tsx:181,219`). Recomendo o inline primeiro.
4. **Tornar as linhas da fila do `/calibrate` focáveis** (`calibrate/page.tsx:597-609`) — mesma recomposição do item 1.

---

## O que NÃO foi verificado (honestidade de relatório)

- **Nenhuma tela foi aberta.** Esta é uma auditoria de código. Os números de altura (achado 8) foram derivados das classes Tailwind, não medidos no browser.
- **`npx impeccable detect` não foi rodado** — não está instalado neste repo e a skill pede que rode antes de abrir a tela. Fiz a varredura equivalente à mão (gradientes, roxo/violeta, bounce, duração de motion): **os únicos tells encontrados** foram o `text-purple-400`/`Sparkles` de `calibrate:699,763-765` e o `text-violet-400` de `calibrate:613`. Nenhum gradiente decorativo nas superfícies principais — o dark neutro é consistente e correto.
- **`npm run audit:design` não existe** neste `package.json` (scripts: `dev`, `build`, `start`, `lint`, `test`, `test:watch`, `render`, `render:ps`).
- **`tsc`/`build`/`test` não foram rodados** — nenhuma alteração foi feita, então não havia o que validar.
- Os achados 1, 2 e 12 são deduções de leitura de código com caminho de reprodução descrito; **valem uma reprodução manual antes do fix**, conforme o protocolo "verifique a alegação antes de agir sobre ela".
