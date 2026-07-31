# Plano — divulgação progressiva: só o que a atividade atual precisa

> **Skills aplicadas:** `visant-frontend` (Passo 0 + espinha de 12 + work-surface).
> **Branch:** `feat/detection-qa-gate` · **Modo:** auditoria de código + execução.
> Continuação de [`PLAN-e2e-burilamento.md`](PLAN-e2e-burilamento.md), que declarou
> `/photo-mockup` e `/calibrate` **fora de escopo**. Este plano entra exatamente ali.

## Classificação de superfície (Passo 0 — nunca pular)

| Região | Classe | Variável |
|---|---|---|
| `/photo-mockup` — canvas + rail + painel | **B — work** | throughput × decision quality |
| `/photo-mockup` — publicar / exportar | **C — trust** | entregável final |
| Home — painel direito (arte → render → download) | **B — work**, export **C** | throughput |
| Home — sidebar de filtros | **B — work** | decision quality |

Nenhuma região é classe A. Nenhum rótulo aqui vende nada — todo rótulo custa
atenção e tem de pagar o próprio espaço.

---

## A regra que gera as decisões

> **Um rótulo só fica se o controle for ambíguo sem ele. Um bloco só fica se a
> atividade atual puder agir sobre ele.**

Isso é a espinha 5 ("zero não é informação") e 6 ("chrome é um orçamento")
aplicadas ao *interior* do editor, não só ao topo da página. O editor já isola
por ferramenta — o que não isolava era o **conteúdo do painel**.

---

## Auditoria

### 1. Rail de ferramentas (`ToolRail.tsx`)

| Sev | Achado | Endereço |
|---|---|---|
| P1 | Cada botão do rail carrega um rótulo de **7,5px** sob o ícone. Abaixo do limiar de leitura — não é rótulo, é textura. E é **triplamente redundante**: o tooltip já diz nome + atalho, a barra do painel repete o nome, e o `CanvasContextChip` repete no canvas. 9 tools × 12px de texto ilegível = ~110px de rail. | `ToolRail.tsx:90-92` |
| P2 | Três pontinhos decorativos na barra de título do painel, imitando handle. A **barra inteira** já é o handle (`.panel-drag`). Não movem variável nenhuma → falham o cut test. | `ToolRail.tsx:112-116` |

### 2. Painel da ferramenta (`photo-mockup/page.tsx`)

| Sev | Achado | Endereço |
|---|---|---|
| **P0** | `SceneInfo` (miniatura da foto + tipo de superfície + "Re-detectar") renderiza em **todas as 9 ferramentas**, sem condição de tool. É uma miniatura de 48px **da imagem que ocupa a tela inteira atrás dela** — redundância pura — e um botão raro que reseta a detecção fica a um clique de distância enquanto você mexe em Luz, Cortar ou Aumentar. | `page.tsx:1822-1825` |
| P1 | Caixa dentro de caixa: o painel flutuante já tem borda + fundo + blur, e o conteúdo vem embrulhado de novo em `bg-zinc-800/40 border border-zinc-700/40`. A skill é explícita: *"box-inside-a-box is noise; promote the label typographically and delete the frame"*. | `page.tsx:1715, 1722`; `RenderPanel.tsx:85`; `SceneInfo.tsx:17` |
| P2 | Header: `Abrir` / `Salvar` / `Novo projeto` são ícone+texto, enquanto desfazer/refazer/atalhos no **mesmo header** são só-ícone. Duas gramáticas para ações de mesmo peso. | `page.tsx:1283-1311` |

### 3. `RenderPanel` — o painel mais pesado do produto

| Sev | Achado | Endereço |
|---|---|---|
| **P0** | **Sem arte, o painel inteiro renderiza mesmo assim**: Sombra, Realismo, Ajustes avançados, presets de Visual, ExportBar (com `src=null`), "Biblioteca" desabilitado, re-render desabilitado. Nada disso tem sobre o que agir — não existe render. É o maior caso de "mostrar o que a atividade não precisa" no app. A atividade, ali, é **uma só**: soltar a arte. | `RenderPanel.tsx:107-208` |
| P1 | "Biblioteca" é primário `disabled` até existir render — *a disabled primary is a lie*. Idem o botão de re-render. | `RenderPanel.tsx:199-207` |
| P1 | `ExportBar` renderiza formato + qualidade + botão com `src` nulo: três controles mortos. | `RenderPanel.tsx:195` |

### 4. Home — painel direito e sidebar (`page.tsx`)

| Sev | Achado | Endereço |
|---|---|---|
| P1 | `Preview Rápido` + `RENDER FINAL` lado a lado, **os dois** `disabled` a 30% quando não há arte. Dois primários = nenhum, e dois primários mortos = ruído puro exatamente no momento em que a única ação certa (soltar a arte) está logo acima. | `page.tsx:2815-2839` |
| P1 | Acordeão "Smart Objects (N)" renderiza com **N=1**: uma lista de um item que já está ativo. Não há escolha a fazer — controle morto. | `page.tsx:2589` |
| P2 | Bloco "Info do arquivo" permanente: um cabeçalho centralizado com ícone `History` anunciando três dados que se explicam sozinhos (nome do arquivo · MB · px). O rótulo custa uma linha e não desambigua nada. | `page.tsx:2694-2703` |
| P2 | Rótulos de seção da sidebar (`Marca Selecionada`, `Filtros`) sobre controles que já se nomeiam: o `select` diz "Sem marca", o outro diz "Todos Estúdios". | `page.tsx:1893, 1922` |
| P2 | Slider de tamanho do card exibe `230px` ao vivo — número de engenheiro num controle cujo feedback **é o próprio grid mudando de tamanho**. | `page.tsx:1733` |

---

## Entregas

### G0 — Rail e painel (o quadro do editor)
- [x] Rail só-ícone (48→40px por botão): o rótulo sai das 9 pastilhas ilegíveis e
      sobrevive onde é legível — tooltip (com atalho), barra do painel, chip do canvas
- [x] Pontinhos decorativos removidos
- [x] Caixa-dentro-de-caixa desfeita nos painéis de superfície e no `RenderPanel`
- [x] Header do editor com uma gramática só: ações de arquivo viram `IconButton`
      (tooltip obrigatório pelo próprio componente)

### G1 — O painel segue a atividade
- [x] `SceneInfo` só em **Cantos** e **Superfície** — as duas ferramentas cuja
      atividade *é* identificar a superfície. Nas outras 7, a cena já está na tela
- [x] `SceneInfo` sem moldura própria (deixou de ser um bloco dentro de um bloco)

### G2 — `RenderPanel`: um passo de cada vez
- [x] **Sem arte ⇒ só a zona de soltar.** Iluminação, visual, exportação, publicação,
      custo e "Melhorar" só existem depois que há o que renderizar
- [x] "Biblioteca" e o re-render só renderizam quando há render (nada de primário morto)
- [x] `ExportBar` só quando há imagem para exportar

### G3 — Home
- [x] Botões de render só quando há pelo menos uma face preenchida
- [x] "Smart Objects" só quando há mais de um (com um, não há escolha)
- [x] "Info do arquivo": rótulo fora, dado dentro
- [x] Rótulos redundantes da sidebar fora; `230px` fora

### G4 — Grid masonry (pedido do usuário, no mesmo lote)
- [x] `@visant/masonry-gallery` do registry da casa em `components/ui/masonry-gallery.tsx`
      (copiado verbatim; correção sobe no registry primeiro). O round-robin do
      componente é o que torna isto viável num feed infinito: anexar página nunca
      reordena o que já está na tela
- [x] `useContainerColumns` — colunas pela largura do **contêiner**, não da janela
      (o grid vive entre dois painéis colapsáveis; `useMasonryColumns` do registry lê
      `window.innerWidth` e daria o número errado aqui)
- [x] Card com **aspecto verdadeiro** medido no `onLoad` + cache de módulo. O grid
      antigo enquadrava tudo em 4/3 com `object-cover`: billboard, pôster e 1:1
      chegavam recortados ao olho que está justamente escolhendo entre eles
- [x] **Armadilha registrada:** o `aspect` do catálogo é do quad/face do smart object,
      **não** da imagem de preview. Usá-lo teria recortado exatamente o que a mudança
      existe para deixar de recortar

### G5 — Segunda passada na sidebar (revisão do usuário: "feinho, muito coisa, confuso")

O topo da sidebar eram **cinco caixas empilhadas com o mesmo peso** e **três estilos
de borda diferentes** — `h-10 rounded-xl bg-neutral-900 border` nos selects, `h-9
border` nos chips e no toggle, `h-11 border-2 dashed` na pasta. Cinco molduras de peso
igual não produzem hierarquia: o olho lê uma pilha, não uma estrutura. E o rótulo
"Esconder duplicados" **quebrava em duas linhas** assim que a contagem entrava ao lado.

- [x] Marca e estúdio viram **linhas**, não caixas: o valor é o controle (`text-sm`
      bold quando ativo, mute quando é o padrão) + chevron. Régua fina só entre os dois
      — e só quando há marca conectada, senão vira um traço solto sob o header
- [x] Chips de formato sem moldura quando desligados: o chip aceso **é** a informação;
      três molduras vazias só competiam com ele
- [x] "Esconder duplicados" vira linha com switch; a contagem é só o número
- [x] "Restaurar ocultos" vira uma linha de texto ("Restaurar 9 ocultos")
- [x] **Agrupamento por espaço** (`gap` pequeno dentro da zona, `mb-5` entre zonas) no
      lugar de bordas — zero caixas no bloco inteiro
- [x] **"Adicionar pasta" foi para o header** (pedido do usuário, e é a classificação
      certa: ação global do acervo, não filtro). Era uma laje tracejada de 44px
      disputando peso com os controles do dia a dia por algo feito uma vez por sessão.
      O gatilho **expande a sidebar** se ela estiver colapsada — senão clicar seria uma
      ação primária em silêncio, já que o campo de caminho mora lá

### G6 — Terceira passada: inteligência, cache e os bugs da fila

**A ordenação era um default acidental.** `search-engine.ts:186` — sem query, a
listagem era `a.name.localeCompare(b.name)`, **sempre**, sem UI para trocar. Por isso
o acervo abria com `01`, `01 Displacement`, `01 Displacement Pequena`,
`01 Form Displacer`, `01 Form Displacer Pequena`: cinco variações do mesmo bundle nas
cinco primeiras posições, porque nome de arquivo não é critério de escolha de mockup.

E havia desperdício puro: a telemetria já media **popularidade global**
(`signals.docs[id]`, escala log, anti-feedback-loop) e o sinal só entrava no ranking
**quando havia query** — a primeira tela de toda sessão ignorava tudo o que o produto
tinha aprendido.

- [x] `sort: "popular" | "name"` no motor (puro). Default = popularidade, desempate
      alfabético — determinístico, então acervo zerado cai no A→Z de antes
- [x] Boost carregado nos **dois** caminhos; `?sort=` na API, na URL e no controle
      "Ordem · Mais usados · A–Z" acima do grid, com a regra no `title`. Não renderiza
      durante a busca (lá quem ordena é a relevância — seria controle morto)
- [x] 5 testes novos

**O laço de aprendizado estava cortado nas duas pontas.** `selectRef` só mandava o
sinal `if (q)` — com busca de texto —, e a rota `click` **também** exigia query.
Navegar o grid não ensinava nada: `signals.json` tinha 2 docs no acervo inteiro, um
deles do smoke test. Sem isso, "Mais usados" seria igual ao alfabético para sempre.
- [x] Clique registrado sempre (a query virou contexto opcional), nos dois lados
- [x] Render final também registra — é o sinal mais forte de "este mockup serve", e
      como o contador é incremental ele naturalmente pesa o dobro de só abrir

**27,5% do grid renderizava um placeholder cinza.** 55 de 200 itens da primeira página
sem `referenceImageUrl` — e 39 deles com um **irmão** de mesmo nome-base que tinha a
foto (`01 Displacement` cego, `01 Displacement Pequena` com a imagem: o mesmo mockup,
ingerido duas vezes).
- [x] `borrowSiblingThumbnails` (puro, 5 testes): empresta do irmão de mesmo nome-base
      **e mesmo estúdio**. Só empresta, nunca inventa — sem irmão continua sem imagem,
      porque "não temos preview deste PSD" é verdade e o grid tem de poder dizê-la.
      **754 thumbnails recuperadas** no acervo real; correção de leitura, o Mongo não
      é tocado

**Performance: o catálogo levava 14s para montar.** Medido com `npm run perf:catalog`
(script novo), não estimado:

| Etapa | Antes | Depois |
|---|---|---|
| Mongo (5.811 docs) | 0,8s | 0,8s |
| `listPhotoScenes` | 0,2s | 0,2s |
| **`findPsdForRef` × 3.772** | **9,2s** | **0,34s** (1º) · **0,003s** (seguintes) |
| — dentro dele: walk de 5.951 PSDs | — | 4,5s (uma vez por processo) |

- [x] A causa: o fallback por substring varria a lista inteira chamando `normalize()`
      (4 regex + `toLowerCase`) em **cada nome, a cada uma das 3.772 consultas**.
      Normalização movida para o índice: o fallback virou `String.includes` sobre
      strings prontas
- [x] Memo de resolução por (nome, estúdio), incluindo o `null` — o catálogo se
      reconstrói a cada 60s refazendo as mesmas consultas com as mesmas respostas
- [x] Medido no app: `/api/references` **74ms** quente, facetas **51ms**

**Bugs da fila**
- [x] **Select nativo**: a lista do `<select>` é desenhada pelo SO (fundo branco,
      realce azul do Windows) e nenhum CSS alcança. Trocado pelo `@radix-ui/react-select`
      — o mesmo primitivo que já sustenta Popover e Tooltip aqui. Wrapper fino em
      `ui/Select.tsx`, contagens em coluna alinhada
- [x] **Double spinner** no rail de sugestões: um `Loader2` solto + o ícone do botão
      girando, para a mesma operação. Ficou só o do botão, que ganhou rótulo de estado
- [x] **Chip de enquadramento**: três orações, ícone de raio e moldura tingida para
      dizer uma coisa. Virou estado + saída (`Preenchendo a superfície` · `Encaixar`);
      o porquê foi para o `title`
- [x] **Abrir no Photoshop** (hover do card, sem rótulo). `/api/open-file` só fazia
      `explorer /select,` — revelava na pasta, nunca abria o app. Ganhou `mode: "open"`
      (`cmd /c start`), e de quebra saiu do `exec` com string interpolada para
      `execFile` + validação de metacaracteres e existência do arquivo.
      ⚠️ **O ícone é o wordmark "Ps", não o logo da Adobe**: o `simple-icons` — a fonte
      padrão para ícones de marca — **removeu os ícones da Adobe** por questão de marca
      registrada, e não há hoje um logo do Photoshop licenciado para empacotar
- [x] Gap do grid 32px → 16px (e o skeleton passou a usar o mesmo, senão o grid
      "pulava" de largura quando os dados chegavam)

### G7 — Verificação
- [x] `npx tsc --noEmit` limpo
- [x] `npm test` — 198 testes, 21 arquivos, verdes
- [x] `npm run lint` — 0 erros, 350 warnings (baseline 351; não subiu)
- [x] `npm run build` verde
- [x] **No app rodando:** painel Render sem arte = só a zona de soltar · `SceneInfo`
      presente em Cantos, ausente em Luz · rail só-ícone · header só-ícone ·
      masonry com 4 colunas e alturas variadas (billboard 16:9 sem corte)
- [x] Slider de tamanho → 450px reduz para 2 colunas (largura 1133px), como esperado
- [x] Sem erros no console

**Não verificado (dito em voz alta):** a reação do masonry ao *redimensionar o painel*
depende do `ResizeObserver`, e nesta sessão o Chrome estava com a aba oculta
(`document.hidden === true`, **zero frames de rAF**) — com o pipeline de render parado
nenhum `ResizeObserver` dispara, nem o do app nem um criado à mão para testar. O
caminho de montagem inicial e o do slider foram verificados; o de resize do painel não.

---

## Fora de escopo (declarado)
- Engine de render e `/calibrate` — continuam como estão.
- Mover ações raras do editor (`Abrir`/`Salvar`) para um menu `⋯`: o ganho é o
  mesmo do só-ícone e o custo de descoberta é maior. Não compensa hoje.
