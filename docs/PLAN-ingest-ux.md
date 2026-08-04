# Plano: UX/UI do ingest de nova pasta

> **Skills aplicadas:** `visant-killer` (portão + interrogatório), `visant-frontend`
> (Passo 0, espinha de 12, cut test), `visant-motion` (SSoT de easing/duração).
> **Tier do alvo:** T3 núcleo. Escreve no Mongo, roda na rota principal, e a escrita
> só se desfaz com `scripts/remove-dupes.ps1` na mão.
> **Status:** auditoria e projeto. Nenhum arquivo do app foi editado.

---

> **Estado: Fases 0 a 5 executadas.**
>
> **Fases 4 e 5:**
>
> | Item | Onde |
> |---|---|
> | Lista virtualizada | `@tanstack/react-virtual`; **17 linhas no DOM para 150 arquivos** |
> | Cabeçalho ordenável (arquivo, tamanho, veredito) | `IngestDialog.tsx`, `ordem` |
> | Menu de linha (mostrar no Explorer) | reusa `/api/open-file` |
> | Retomada por `sessionStorage` | fechar no meio não joga a triagem fora |
> | "Adicionar outra pasta" na conclusão | ingerir pasta raramente é uma pasta só |
> | Estado de cancelamento no relatório | diz que parou e que o que entrou ficou |
> | Estados próprios: pasta sem nada aproveitável, pasta já toda no acervo | eram becos sem saída que caíam na revisão vazia oferecendo um "Ingerir" impossível |
> | `npm run fixture:virt` | gera a pasta que torna a checagem de virtualização real |
>
> **Sobre o `data-table` do registry (decisão D2):** foi lido antes de decidir, e
> **não serve**. Ele arrasta `next-auth`, `class-variance-authority` e mais 8 itens de
> registry (`button`, `checkbox`, `context-menu`, `input`, `skeleton`, `table`…) para um
> repo que já tem os próprios 13 primitivos. O que faltava de verdade era virtualização,
> então entrou só `@tanstack/react-virtual`, que faz isso e nada mais. Ordenação e
> agrupamento são JS puro sobre um array que já está inteiro no cliente.
>
> **Um bug que só a checagem visual pegou:** com `useRef`, o virtualizer media o
> container antes de ele existir (a lista só monta na fase de revisão) e devolvia
> **zero linhas** para 150 itens, com o rodapé anunciando "Ingerir 150" sobre uma tela
> vazia. Portão verde em tsc, lint, 244 testes e `ui:audit`. O conserto é ref por
> estado, que força um render quando o elemento aparece.
>
> **Fase 3, a origem de verdade:**
>
> | Item | Onde |
> |---|---|
> | Miolo puro e testável (browse, stat, Drive) | `src/lib/fs-browse.ts` + 15 testes |
> | `GET /api/fs/stat` | validação ao vivo, debounce 300ms, e contagem do que está só na nuvem |
> | `GET /api/fs/browse` | navegador de pastas do app, portátil, lista unidades |
> | `POST /api/fs/pick-folder` | seletor nativo do Windows, com as 6 guardas da 6.1 |
> | `GET /api/fs/drive` | link do Drive vira caminho local, sem OAuth |
> | Aviso de arquivo não baixado do Drive | `FolderPicker.tsx` |
>
> Medido com as rotas no ar: `stat` aprova e reprova certo, `browse` lista as 5
> unidades, `pick-folder` recusa sem a flag (503), e o link do Drive do próprio
> `PSD_DIRS` resolveu para
> `G:/.shortcut-targets-by-id/1Dx_uPec.../[ MOCKUPS 1.0 ]` — inclusive achando que a
> montagem tinha mudado de `H:` para `G:`. O portão visual subiu para **18/18**.
>
> | Item | Onde |
> |---|---|
> | Os 6 achados de copy do fluxo | `page.tsx`, `IngestDialog.tsx` |
> | `IngestDialog` dono das 5 etapas | `src/components/ingest/IngestDialog.tsx` (era `IngestReviewSheet`) |
> | `IngestStepper`, `FolderPicker` | `src/components/ingest/` |
> | Etapa da origem sai da sidebar | `page.tsx`: `wizardStep`/`folderInput`/`reviewPath` viram um `ingestOpen` |
> | `openIngest` para de mexer no `leftPanelRef` | `page.tsx` |
> | Retorno do ingest vira toast do `sonner` | `page.tsx`, `handleIngested` |
> | "Marcar à vista" não marca lixo em silêncio | `IngestDialog.tsx`, `marcaveis` |
> | `walkDirAsync` com progresso e cancelamento | `src/lib/fs-walk.ts` + 5 testes |
> | Evento SSE `listing` na fase sem denominador | rota `/scan` e o loader |
> | `req.signal` respeitado nas duas rotas | `/scan` e `/ingest-folder` |
> | `AbortController` no commit do cliente | `IngestDialog.tsx` |
>
> Verificado: `tsc` 0, lint 0 erros, 229 testes, `ui:audit` dentro do teto, build de
> produção, `smoke` 13/13. O evento `listing` foi visto saindo numa varredura real de
> `Z:/BOXY/Produtos`, e o cancelamento fecha o stream sem erro pendurado no servidor.
> **Continua sem verificação visual**: a extensão do Chrome não estava conectada, então
> não houve medição a 390px nem feel-check.

## 0. Placar do portão (evidência, rodado hoje)

```
node ~/.claude/skills/visant-killer/scripts/killer-scan.mjs src/app/page.tsx
node ~/.claude/skills/visant-killer/scripts/killer-scan.mjs src/components/IngestReviewSheet.tsx src/components/ui
npm run ui:audit
```

| Portão | Alvo | Resultado |
|---|---|---|
| `impeccable detect` (tell de IA) | `page.tsx` | **zero** |
| `impeccable detect` | `IngestReviewSheet.tsx` + `components/ui` (14 arquivos) | **zero** |
| `audit:design` (token) | ambos | **PULADO**, o repo não tem esse script. Reportado, não omitido. |
| copy (vício de linguagem) | `page.tsx` | **18 achados** |
| copy | `IngestReviewSheet.tsx` + `ui` | **5 achados** |
| `npm run ui:audit` | repo | **9/9 métricas dentro do teto** (0 modal à mão, 0 switch à mão, 0 `transition-all`, 0 duração hardcoded, 12/12 botão só-ícone, 7/7 raio fora da escala) |

**Os 23 achados de copy foram conferidos linha a linha. Nenhum é falso positivo.**
Todos são string que chega no olho do usuário:

| Endereço | Texto | Vício |
|---|---|---|
| `page.tsx:642` | `Listados N arquivos — N candidatos...` | travessão |
| `page.tsx:649` | `Duplicata: X × N cópias — N MB desperdiçados` | travessão |
| `page.tsx:652` | `✓ Concluído — N grupos encontrados...` | travessão |
| `page.tsx:909` | `Login expirou — tente novamente` | travessão |
| `page.tsx:1270` | `${file.name} — use PNG, JPG, WEBP ou SVG.` | travessão |
| `page.tsx:1725` | `${name} — o arquivo continua no disco.` | travessão |
| **`page.tsx:1808`** | `+N refs · N PSDs · N analisados` | bolinha (retorno do ingest) |
| `page.tsx:1937` | `Tamanho do card · Npx` | bolinha |
| `page.tsx:1955` | `Parecidos com a imagem · N` | bolinha |
| `page.tsx:2017` | `N à vista de N carregados · N no recorte` | bolinha |
| `page.tsx:2506` | `...os que você mais abre e renderiza primeiro — empate resolve...` | travessão |
| **`page.tsx:2576`** | `Nada é gravado antes de você revisar o que entra — duplicata e lixo...` | travessão (estado vazio do ingest) |
| `page.tsx:2704` | `Falha ao carregar mais mockups — {fetchError}` | travessão |
| `page.tsx:3082` | `Arte com AxB para uma superfície de CxD —` | travessão |
| `page.tsx:3475` | `N grupos · N arquivos · ` | bolinha |
| `page.tsx:3634` | `N arquivos verificados — tudo limpo!` | travessão |
| `page.tsx:3711` | `Fora da sua conta — apagar aqui apaga na origem...` | travessão |
| `page.tsx:3773` | `N arquivos removíveis ·` | bolinha |
| **`IngestReviewSheet.tsx:375`** | `Nada foi gravado ainda — este é o pré-voo` | travessão |
| **`IngestReviewSheet.tsx:418`** | `N itens no acervo · N PSDs analisados` | bolinha |
| **`IngestReviewSheet.tsx:420`** | `· N já existiam` | bolinha |
| **`IngestReviewSheet.tsx:457`** | `Não deu para consultar o acervo — o cruzamento...` | travessão |
| `ui/Slider.tsx:47` | travessão em label | travessão |

Os 6 em negrito são do fluxo de ingest e entram como conserto na Fase 1. Os outros
17 são do resto do `page.tsx` e ficam registrados aqui como dívida conhecida, fora
do escopo deste plano.

**Verificação que NÃO foi feita** (e precisa ser antes de dar qualquer fase por
pronta): `npx tsc --noEmit`, lint, medição de estouro horizontal a 390px com dado
real, rodada com Mongo parado, e feel-check no DevTools a 25%. Nada aqui foi visto
rodando; isto é auditoria de código.

---

## 1. Mapa do que existe hoje

### 1.1 Arquivos e tamanhos

| Arquivo | Linhas | Papel |
|---|---:|---|
| `src/app/page.tsx` | 3886 | Monolito da home. Gatilho, campo de caminho, estado do wizard e montagem da folha. |
| `src/components/IngestReviewSheet.tsx` | 660 | Etapas 3, 4 e 5 (scan, aprovação, inserção) já implementadas num Dialog Radix. |
| `src/app/api/ingest-folder/scan/route.ts` | 203 | Pré-voo. GET com `stream=1` devolve SSE. Não escreve nada. |
| `src/app/api/ingest-folder/route.ts` | 310 | Commit. POST com `stream: true` devolve SSE. Escreve no Mongo. |
| `src/lib/ingest-triage.ts` | 266 | Triagem pura (novo / duplicata / lixo / já existe). dHash + heurística de lixo. |
| `src/lib/fs-walk.ts` | 76 | `walkDir` recursivo síncrono, `psdRoots()` poda raiz filha. |
| `src/lib/motion.ts` | 73 | SSoT de easing e duração. Espelho de `globals.css:25-33`. |
| `src/components/ui/` | 13 arquivos | Dialog, Popover, Select, Switch, Slider, Segmented, IconSegmented, IconButton, Tooltip, DropOverlay, FlyingPaperLoader, GlitchChars, masonry-gallery. |

### 1.2 O que o fluxo faz hoje, passo a passo

**Entrada (etapa 1).** Três gatilhos, três comportamentos diferentes:

1. `page.tsx:2042-2052`, ícone `FolderPlus` no header. `onClick={openFolderWizard}`.
2. `page.tsx:2579-2585`, botão "Adicionar pasta" no estado vazio do grid, que chama
   `leftPanelRef.current?.expand()` e depois `openFolderWizard()`.
3. `page.tsx:2226-2237`, o bloco que mostra o resultado do último ingest, dentro da
   sidebar.

`openFolderWizard` está em `page.tsx:1787-1796`:

```ts
const openFolderWizard = useCallback(() => {
  setFolderInput("");
  setWizardStep(1);
  setIngestResult(null);
  const panel = leftPanelRef.current;
  if (panel?.isCollapsed()) panel.expand();   // page.tsx:1794-1795
}, [leftPanelRef]);
```

**Origem (etapa 2).** `page.tsx:2238-2269`. Quando `wizardStep === 1`, aparece na
sidebar esquerda um bloco com rótulo "Caminho da pasta", um `<input type="text">`
com placeholder `ex: H:/Mockups/Layouts` (`page.tsx:2245-2253`), um botão "Revisar"
que só existe quando o campo tem conteúdo (`page.tsx:2256-2263`), e a linha "Nada é
gravado antes de você revisar" (`page.tsx:2265-2267`). Enter também dispara
(`page.tsx:2249`).

`openReview` (`page.tsx:1799-1803`) só faz `setReviewPath(path)`. Nenhuma validação,
nenhum `existsSync` do lado do cliente, nenhum feedback antes do modal abrir.

**Scan (etapa 3).** `IngestReviewSheet.tsx:101-158` abre
`GET /api/ingest-folder/scan?stream=1&path=...` e consome SSE na mão (leitura do
`ReadableStream`, split por `\n`, prefixo `data: `). A rota (`scan/route.ts:91-148`)
chama `walkDir` (síncrono), carrega as assinaturas do Mongo, e roda um pool de 8
workers que calculam `hashImage` (dHash) para imagem e `partialHash` (md5 dos
primeiros 2 MB) para PSD. Emite `progress` a cada 10 arquivos (`scan/route.ts:128`).

**Aprovação (etapa 4).** `IngestReviewSheet.tsx:444-618`. Chips de veredito que não
renderizam zero (`:476`, aplicando a espinha 5), busca por nome ou caminho (`:504`),
campo de estúdio único (`:515`), "marcar/desmarcar à vista" (`:522`), e a lista de
linhas com checkbox, miniatura, nome, caminho, dimensão, tamanho e o motivo do
veredito (`:541-613`). Default marcado é só `verdict === "new"` (`:146`). Rodapé com
contagem, bytes e o primário que some quando não há seleção (`:640-652`), o que
respeita "um primário desabilitado é mentira".

**Inserção (etapa 5).** `IngestReviewSheet.tsx:184-248` faz
`POST /api/ingest-folder` com `stream: true`. A rota (`route.ts:239-310`) monta o
SSE, e `runIngest` (`route.ts:86-237`) insere referências, insere PSDs órfãos, e
depois varre metadado de PSD. `tick` emite progresso a cada 5 passos
(`route.ts:145-151`). No fim chama `invalidateCatalog()` (`route.ts:235`).

**Retorno.** `handleIngested` (`page.tsx:1805-1821`) grava a string
`+N refs · N PSDs · N analisados` em `ingestResult`, limpa o campo, volta
`wizardStep` para 0, recarrega facetas e a página 1 do grid.

### 1.3 O que já está certo e não se toca

- SSE real nas duas rotas, com progresso vindo do trabalho de verdade.
- Triagem pura e testada (`src/lib/__tests__/ingest-triage.test.ts`).
- Dialog Radix com foco preso, ESC e scroll lock (`ui/Dialog.tsx`).
- Default como estratégia: só o novo vem marcado.
- Motivo do veredito escrito por item, nunca só a cor (`IngestReviewSheet.tsx:609`).
- Degradação honesta quando o Mongo cai (`scan/route.ts:58-82` e o aviso em `:453-461`).
- Primário some em vez de desabilitar, nos dois lugares.
- `Ctrl+A` marca o que está à vista e não a página do navegador (`:303-306`).

Isso é bastante coisa. O problema não está no miolo da folha de revisão. Está na
**boca do funil** e na **honestidade do progresso**.

---

## 2. Diagnóstico, etapa por etapa

### Classificação de superfície (Passo 0 de `visant-frontend`)

| Região | Classe | Variável |
|---|---|---|
| Gatilho no header e estado vazio | **B trabalho** | throughput |
| Origem (escolher a pasta) | **B trabalho** | throughput |
| Scan (pré-voo) | **B trabalho** | percepção de progresso |
| Aprovação | **C confiança** | dado que não se limpa depois |
| Inserção e retorno | **C confiança** | integridade do acervo |

Metade do fluxo é superfície C. Isso decide tudo: reversibilidade e correção mandam,
persuasão não existe, e qualquer ambiguidade sobre "o que já foi gravado" é defeito
de primeira grandeza.

### Etapa 1, Nova pasta

**P0. O clique reconfigura o layout do usuário como efeito colateral.**
`page.tsx:1794-1795` expande a sidebar esquerda à força. Quem trabalhava com a
sidebar colapsada (mais grid à vista) perde a configuração e não recebe de volta:
não há nada que a recolha depois. O comentário no código admite o motivo ("o gatilho
vive no header e o campo vive na sidebar"), o que é o diagnóstico da causa, não a
justificativa da solução.

**P0. A sidebar é o container errado.** O fluxo tem cinco etapas, uma tabela de
aprovação com sete colunas de informação por linha, duas barras de progresso longas
e um relatório final. A sidebar tem `minSize="15%"` e `maxSize="28%"`
(`page.tsx:2084-2086`), rola junto com a taxonomia inteira, e o bloco de ingest fica
espremido entre "Esconder duplicados" e "Filtros Ativos". Três consequências
concretas:

1. **Competição por atenção.** Espinha 2, neutralidade é omissão. A sidebar tem
   Switch de duplicados, contador de ocultos, filtros ativos, taxonomia com N
   dimensões. O campo de caminho entra como mais um dos oito blocos, com o mesmo
   peso tipográfico dos outros, para uma ação que se faz uma vez por sessão e que
   grava no banco.
2. **Competição por largura.** Um caminho como
   `H:/.shortcut-targets-by-id/1Dx_uPec62b4ddACJYlRsdWqQlHyfMhPY/[ MOCKUPS 1.0 ]/...`
   tem 90 caracteres. Numa coluna de 15% a 28%, o campo mostra dez.
3. **O fluxo já muda de container no meio.** Etapa 2 na sidebar, etapas 3 a 5 num
   Dialog em cima de tudo. O usuário começa numa gramática e termina em outra, sem
   transição que ligue as duas.

**P1. Três gatilhos com três comportamentos.** O do header não expande nada além do
painel, o do estado vazio expande e abre, e o resultado aparece num quarto lugar.
Espinha 12 aplicada ao interior: uma ação, uma gramática.

**P1. O retorno da escrita mora onde o usuário pode não estar olhando.**
`page.tsx:2230-2235` renderiza `ingestResult` dentro da sidebar. Se a sidebar estiver
colapsada quando o ingest termina (e ela pode estar, porque `handleIngested` não a
expande), a única confirmação de uma escrita no banco fica invisível. O repo já tem
`sonner` instalado e em uso (`page.tsx:3746` chama `toast.error`), então o padrão
certo já existe e não está sendo usado aqui.

### Etapa 2, Origem

**P0. Não existe seletor de pasta.** O campo é texto puro
(`page.tsx:2245-2253`). O usuário tem que ir no Explorer, copiar o caminho da barra
de endereço, e colar. O placeholder usa `/` (`ex: H:/Mockups/Layouts`) mas o Explorer
copia com `\`. A rota normaliza (`route.ts:251`), então funciona, mas a UI mente
sobre o formato esperado.

**P0. Zero validação antes de abrir o modal.** `openReview` (`page.tsx:1799-1803`)
só grava o estado. Caminho digitado errado, pasta inexistente, unidade de rede
desconectada: tudo isso vira um modal que abre, mostra "Lendo a pasta…", e depois
cai na tela de erro vermelha. O custo de um `HEAD` que responde "existe, N arquivos"
antes de abrir é milissegundos, e transforma erro em correção no lugar.

**P1. Nenhum atalho para as raízes que o app já conhece.** `PSD_DIRS` tem três
caminhos configurados e `psdRoots()` (`fs-walk.ts:55-70`) já os resolve sem
sobreposição. O usuário digita à mão um caminho que o servidor já tem numa variável.

**P1. Nada sobre Google Drive.** Colar
`https://drive.google.com/drive/folders/1Dx_uPec...` no campo hoje produz uma pasta
não encontrada, sem explicação.

### Etapa 3, Scan

**P0. O progresso mente na parte mais lenta.** `scan/route.ts:95` chama
`walkDir(normalized, ALL_EXTS)`, que é **recursivo e síncrono**
(`fs-walk.ts:14-45`, `readdirSync` + `statSync` por arquivo). Nenhum evento de
progresso sai antes disso terminar, porque `total` só existe depois
(`scan/route.ts:107`). Numa pasta em `H:` (mount do Drive Desktop) com milhares de
arquivos, essa varredura é a fase mais cara do scan inteiro, e durante ela a UI
mostra `FlyingPaperLoader` sem `progress`, com o texto fixo "Lendo a pasta…"
(`IngestReviewSheet.tsx:365`) e um `currentFile` vazio de 4px de altura
(`:370-372`). Barra sem valor, arquivo sem nome, tempo indeterminado. É exatamente
o padrão de "spinner no lugar de informação" do catálogo de slop.

**P1. Cancelar não cancela.** `abortRef.current?.abort()`
(`IngestReviewSheet.tsx:180`) aborta o `fetch` do cliente. A rota não lê
`req.signal` em lugar nenhum, então o pool de 8 workers continua decodificando a
pasta inteira no servidor depois que o usuário fechou o modal. Fechar e reabrir três
vezes deixa três scans rodando.

**P1. Não há retomada.** Fechar o modal joga fora `items`, `summary` e
`selected`. Reabrir refaz todo o hash perceptual da pasta. Numa pasta grande isso são
minutos jogados fora por um Esc acidental. O Esc, aliás, fecha sem confirmar
(`:300-302`), e só é bloqueado durante `ingesting`.

**P1. `maxDuration = 300` sem plano B.** Cinco minutos de teto
(`scan/route.ts:23`). Uma pasta de 3 mil PSDs lendo 2 MB de cada por rede pode
estourar, e o que o usuário vê é o stream morrer no meio, sem mensagem.

**P2. Scan e inserção usam a mesma ilustração.** `FlyingPaperLoader` aparece nas duas
fases (`IngestReviewSheet.tsx:349-378`), e o único diferenciador é o texto. As duas
fases têm consequências opostas (uma não grava nada, a outra grava no banco). A
distinção mais importante do fluxo está no elemento de menor peso visual.

### Etapa 4, Aprovação

**P1. A lista não escala.** `IngestReviewSheet.tsx:541` faz
`visible.map(...)` sem virtualização, e cada linha monta um `<img>` que dispara
`/api/local-image?path=...&w=64` (`:575`). Com 3 mil itens são 3 mil nós e 3 mil
requisições de miniatura (`loading="lazy"` ajuda no fetch, não no DOM). O registry da
casa tem `data-table` justamente para isso.

**P1. Cabeçalho de coluna não existe.** As colunas de dimensão e tamanho
(`:598-603`) são números sem rótulo. Numa superfície C, número sem nome corrompe
interpretação (regra "quando dois números medem coisas diferentes, a UI nomeia qual
é qual"). E sem cabeçalho não há ordenação: numa pasta grande, ordenar por tamanho é
como se acha o lixo depressa.

**P1. Estúdio é um campo só para o lote inteiro.** `:515-520` aplica um estúdio a
todos os selecionados, mesmo quando a pasta tem subpastas com nomes diferentes. A
triagem já calcula `studio` por item a partir da pasta imediata
(`ingest-triage.ts:170`), e o commit já aceita `studio` por arquivo
(`route.ts:41`, `route.ts:103`). A capacidade existe nas duas pontas e a UI não a
expõe. Dado o SSoT de `settings.json` para estúdio (AGENTS.md), errar estúdio no
ingest é caro de desfazer.

**P2. O grupo de duplicatas é invisível como grupo.** `groupKey` e `isGroupLeader`
existem em `TriagedItem` (`ingest-triage.ts:43-45`) e a UI só mostra o texto "cópia
de X" (`:243`). Não dá para ver as 4 cópias juntas nem trocar qual é o representante,
que é a decisão de verdade quando o líder eleito está errado.

**P2. `GlitchChars` no rodapé da revisão.** `:626` põe caracteres piscando ao lado da
contagem de selecionados. `GlitchChars` existe para dizer "a máquina está mexendo"
(comentário em `GlitchChars.tsx:16-17`). Na fase de revisão nada está mexendo: o
usuário está lendo e decidindo. Falha o cut test, e pior, anima ao lado do único
número que ele precisa ler com calma.

**P2. Não há como abrir o arquivo para decidir.** A miniatura de 40px é tudo que se
tem para julgar. `/api/open-file` já existe e já sabe revelar no Explorer e abrir no
app associado.

### Etapa 5, Inserção

**P0. Nenhum abort no commit.** `IngestReviewSheet.tsx:200-208` faz o `fetch` sem
`signal`. O modal bloqueia Esc e clique fora durante `ingesting`
(`:316-317`), o que é correto, mas um F5 ou uma aba fechada deixa `runIngest`
escrevendo no Mongo sem ninguém acompanhando, e sem registro de que aquilo aconteceu.
Espinha 9: a UI não pode mentir para o banco, e aqui ela simplesmente para de saber.

**P1. O progresso do commit conta passos, não itens.** `totalSteps = images + psds +
psds` (`route.ts:143`), então o denominador é maior que o número de arquivos
selecionados. A UI escreve "Ingerindo 300/900" (`:366`) para 500 arquivos marcados.
O número está errado do ponto de vista do usuário, embora esteja certo do ponto de
vista da rota.

**P1. `send()` sem espera na fase de metadado.** O `tick` chama `onProgress` a cada 5
passos (`route.ts:147`), mas `scanPsd` (`route.ts:222`) é síncrono e pesado. A fase
3 do commit (varredura de metadado de PSD) pode ficar longos trechos sem emitir nada,
com a barra parada num número que não avança.

**P2. A tela de conclusão só oferece "Ver no acervo".** `:435-440` fecha o modal.
Não há "ingerir outra pasta" (o caso real é ingerir várias pastas seguidas), nem
"copiar relatório", nem link para os itens que falharam.

**P2. Erros ficam num scroll de 128px.** `:424-433` mostra até 20 linhas de erro
numa caixinha, e o resto some sem dizer que sumiu.

---

## 3. O fluxo proposto

Um Dialog Radix único, `IngestDialog`, dono das cinco etapas. A sidebar deixa de
participar do fluxo. O gatilho abre o Dialog direto, sem tocar no layout.

Largura: `w-[min(1120px,94vw)]`, altura `h-[min(760px,88vh)]`. Isso é maior que o
`max-w-5xl` de hoje e serve a tabela de aprovação, que é a tela que precisa de
largura. Nas etapas 1 e 2 o conteúdo fica centrado numa coluna de 520px dentro do
mesmo quadro, então a caixa não muda de tamanho entre passos (largura constante evita
o layout dançando entre etapas, e permite animar só o conteúdo).

Um **stepper de 5 pontos** no topo, sempre presente. Ele paga o próprio espaço em
superfície C: o usuário precisa saber a qualquer momento se já gravou alguma coisa.
Os passos 1 e 2 se fundem visualmente num único cabeçalho quando o caminho já está
escolhido.

### 3.1 Etapa 1 e 2, Origem

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ▣ ADICIONAR PASTA AO ACERVO                                             [×]  │
│ ●───○───○───○───○   Origem · Varredura · Aprovação · Inserção · Fim          │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│                 ┌────────────────────────────────────────┐                   │
│                 │  DE ONDE VÊM OS ARQUIVOS               │                   │
│                 │                                        │                   │
│                 │  ┌──────────────────────────────────┐  │                   │
│                 │  │ 📁  Escolher pasta no Windows    │  │  ← primário       │
│                 │  └──────────────────────────────────┘  │                   │
│                 │                                        │                   │
│                 │  ou cole um caminho ou link do Drive   │                   │
│                 │  ┌──────────────────────────────────┐  │                   │
│                 │  │ H:\Meu Drive\ASSETS VISANT\...   │✓ │  ← valida ao vivo │
│                 │  └──────────────────────────────────┘  │                   │
│                 │  ✓ 1.284 arquivos, 41,2 GB             │  ← eco do servidor │
│                 │                                        │                   │
│                 │  RAÍZES CONHECIDAS                     │                   │
│                 │  ▸ Z:\BOXY\Produtos                    │                   │
│                 │  ▸ H:\Meu Drive\ASSETS VISANT          │                   │
│                 │  ▸ [ MOCKUPS 1.0 ]  (atalho do Drive)  │                   │
│                 │                                        │                   │
│                 │  RECENTES                              │                   │
│                 │  ▸ Urban Stay®\_prod\Layouts   3d atrás │                   │
│                 └────────────────────────────────────────┘                   │
│                                                                              │
├──────────────────────────────────────────────────────────────────────────────┤
│  Nada é gravado antes de você aprovar item a item        [Cancelar] [Varrer] │
└──────────────────────────────────────────────────────────────────────────────┘
```

O botão "Varrer" só existe quando a validação voltou positiva. Sem caminho válido,
o lugar dele tem texto quieto, o mesmo padrão que já está em
`IngestReviewSheet.tsx:640-643` e `page.tsx:2254-2263`.

**Estado de caminho inválido:**

```
│  │ H:\Mockups\Layout                │✗ │                                     │
│  ✗ Pasta não encontrada. A unidade H: está montada?  [Escolher no Windows]   │
```

**Estado de link do Drive colado:**

```
│  │ https://drive.google.com/drive/folders/1Dx_uPec... │⟳│                    │
│  ⟳ Procurando a pasta no Drive montado neste computador…                     │
│  ✓ Achei: H:\.shortcut-targets-by-id\1Dx_uPec...\[ MOCKUPS 1.0 ]             │
```

**Estado de link do Drive que não resolve:**

```
│  ✗ Esse link aponta para uma pasta que não está montada em disco.            │
│    Abra a pasta no Google Drive para computador e cole o caminho local.      │
│    [Como faço isso?]                                                          │
```

### 3.2 Etapa 3, Varredura

Duas fases visíveis, porque são duas fases reais e uma delas hoje é um buraco:

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ▣ ADICIONAR PASTA AO ACERVO                                             [×]  │
│ ●───●───◐───○───○   Origem · Varredura · Aprovação · Inserção · Fim          │
│ H:\Meu Drive\ASSETS VISANT\MOCKUPS MAISON                                    │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│                        ┌───────┐        ┌───────┐                            │
│                        │ 📂    │ ✈  ✈   │  📁   │      ← FlyingPaperLoader   │
│                        └───────┘        └───────┘                            │
│                                                                              │
│                  ████████████████████░░░░░░░░░░  62%                         │
│                  Analisando 794 de 1.284                                     │
│                  Kraft-Box-Mockup-Front.psd                                   │
│                                                                              │
│                  NADA FOI GRAVADO. ESTE É O PRÉ-VOO.                         │
│                                                                              │
├──────────────────────────────────────────────────────────────────────────────┤
│  1min 20s decorrido, ~50s restantes                        [Parar varredura] │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Sub-fase de listagem (o buraco de hoje), com progresso real:**

```
│                  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  listando                    │
│                  1.284 arquivos em 37 pastas                                 │
│                  ...\MOCKUPS MAISON\Packaging\Kraft                          │
```

Contagem que sobe e caminho da pasta corrente. Sem barra de porcentagem, porque
durante a listagem o total é desconhecido e uma barra fingindo saber seria teatro.
Contador que sobe é progresso honesto sem denominador.

### 3.3 Etapa 4, Aprovação

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ▣ ADICIONAR PASTA AO ACERVO                                             [×]  │
│ ●───●───●───○───○   Origem · Varredura · Aprovação · Inserção · Fim          │
│ H:\Meu Drive\ASSETS VISANT\MOCKUPS MAISON        1.284 itens, varrido em 2m  │
├──────────────────────────────────────────────────────────────────────────────┤
│ [Tudo 1284] [● Novos 812] [● Duplicatas 291] [● Lixo 118] [● Já no acervo 63]│
│                                              9,4 GB de lixo e duplicata fora │
│ ┌──────────────────────────┐ Estúdio do lote [MOCKUPS MAISON ▾]  [Marcar ✓]  │
│ │ 🔍 filtrar nome ou pasta │                                                  │
│ └──────────────────────────┘                                                  │
├──────────────────────────────────────────────────────────────────────────────┤
│ ☑ │    │ ARQUIVO                    │ ESTÚDIO      │ DIMENSÃO ▾│ TAMANHO │ ▸ │
├───┼────┼────────────────────────────┼──────────────┼───────────┼─────────┼───┤
│ ☑ │ ▨  │ Kraft-Box-Front            │ Packaging    │ 4000×3000 │ 184 MB  │ ● │
│   │    │ ...\Packaging\Kraft        │              │           │ novo    │   │
├───┼────┼────────────────────────────┼──────────────┼───────────┼─────────┼───┤
│ ☑ │ ▨  │ Falling-Cards-Blur         │ Editorial    │ 5000×3333 │ 412 MB  │ ● │
│   │    │ representante de 4 cópias  │              │           │ novo    │ ⌄ │
│ ├─┈┈┈┈ 3 cópias agrupadas ┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┤   │
│ │ ☐ │ ▨ │ Falling Cards Blur (1)   │              │ 5000×3333 │ 411 MB  │ ○ │
│ │   │   │ [tornar representante]   │              │           │ cópia   │   │
├───┼────┼────────────────────────────┼──────────────┼───────────┼─────────┼───┤
│ ☐ │ ▨  │ Kraft-Box-Front_thumb      │ Packaging    │  180×135  │ 4 KB    │ ● │
│   │    │ derivado (thumbnail)       │              │           │ lixo    │   │
└───┴────┴────────────────────────────┴──────────────┴───────────┴─────────┴───┘
│  812 marcados, 38,1 GB          [Cancelar]  [Gravar 812 no acervo]           │
└──────────────────────────────────────────────────────────────────────────────┘
```

Mudanças em relação a hoje, cada uma com a variável que move:

| Mudança | Variável |
|---|---|
| Cabeçalho de coluna com ordenação (dimensão, tamanho, veredito) | decision quality: achar o lixo grande em dois cliques |
| Estúdio por linha, editável, com o do lote como padrão | integridade do dado (estúdio é SSoT em `settings.json`) |
| Grupo de duplicata colapsado, expansível, com "tornar representante" | decision quality: o líder eleito às vezes está errado |
| Virtualização da lista | throughput: 3 mil itens sem 3 mil nós no DOM |
| Linha com menu de contexto (abrir no app, revelar na pasta) | decision quality: 40px de miniatura não decide um PSD |
| `GlitchChars` sai do rodapé | atenção: nada está mexendo nesta fase |
| Rótulo do primário passa a "Gravar N no acervo" | confiança: o verbo diz que é escrita |

### 3.4 Etapa 5, Inserção

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ▣ ADICIONAR PASTA AO ACERVO                                                  │
│ ●───●───●───◐───○   Origem · Varredura · Aprovação · Inserção · Fim          │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│                        ┌───────┐        ┌───────┐                            │
│                        │ 📂    │ ✈  ✈   │  🗄   │   ← destino vira o acervo  │
│                        └───────┘        └───────┘                            │
│                                                                              │
│                  ████████████████████████░░░░░░  71%                         │
│                  Gravando 578 de 812                                         │
│                  Kraft-Box-Front.psd                                          │
│                                                                              │
│                  ✓ 578 referências     ⟳ 0 de 291 PSDs analisados            │
│                                                                              │
│                  GRAVANDO NO ACERVO. NÃO FECHE ESTA JANELA.                  │
├──────────────────────────────────────────────────────────────────────────────┤
│  Já gravado é permanente. Parar agora mantém o que entrou.  [Parar]          │
└──────────────────────────────────────────────────────────────────────────────┘
```

O ícone de destino muda de pasta para acervo, e o texto de rodapé fala o que já é
irreversível. As duas sub-fases (gravar referências, analisar metadado de PSD) ficam
visíveis como duas contagens, porque hoje a segunda fase é onde a barra parece
travar.

**Conclusão:**

```
│                              ✓                                               │
│                   INGEST CONCLUÍDO                                           │
│         812 itens no acervo, 291 PSDs analisados, 63 já existiam             │
│                                                                              │
│   ⚠ 4 com problema  [ver detalhe]  [copiar relatório]                        │
│                                                                              │
│         [Adicionar outra pasta]        [Ver no acervo]                       │
```

### 3.5 Fechar no meio: as três respostas

| Momento | O que acontece | Por quê |
|---|---|---|
| Etapa 1 ou 2 | Fecha direto | Nada foi feito |
| Etapa 3 (varrendo) | Fecha, e o scan **para de verdade** no servidor via `req.signal`. Toast quieto: "Varredura interrompida" | Não gravou nada, e deixar 8 workers rodando é desperdício invisível |
| Etapa 4 (aprovação) | Fecha, e o resultado do scan **fica guardado**. Reabrir na mesma pasta oferece "Retomar de onde parou (varrido há 4 min)" | Refazer o hash de uma pasta grande custa minutos |
| Etapa 5 (gravando) | ESC e clique fora bloqueados (já é assim hoje). O botão "Parar" existe e para no próximo item, mantendo o que já entrou | Metade escrita é o estado real; fingir atomicidade seria mentir |

O guardado da etapa 4 vive em `sessionStorage` com chave `ingest:<caminho>` e TTL
curto (30 min). É estado de UI, não fonte de verdade, e não justifica tabela nova.

---

## 4. Motion

Todo valor sai de `src/lib/motion.ts` e de `globals.css:25-33`. Nenhum
cubic-bezier nem duração escrita à mão.

| O que anima | Token | Por quê |
|---|---|---|
| Dialog entrando | `transitions.base` (200ms, `EASE_OUT`), `opacity` + `scale .97 → 1` | Modal é 200 a 300ms. Nunca `scale(0)`. Origem `center`, porque modal não é ancorado a gatilho (gotcha 5 do `visant-motion`). |
| Troca de etapa dentro do Dialog | `AnimatePresence mode="wait"` + `transitions.fast` (160ms), `opacity` + `x: ±12` | Movimento lateral curto carrega a direção do fluxo. `x` e `opacity` são GPU. A caixa tem largura fixa, então nada de animar `width`. |
| Ponto do stepper acendendo | `transitions.base` em `background-color` e `scale`, com `EASE_IN_OUT` | O ponto já está na tela e morfa de estado, e `EASE_IN_OUT` é a regra para movimento on-screen. |
| Barra de progresso | `transform: scaleX()` com `transition-duration: var(--dur-base)` e **`linear`** | Progresso é valor constante. `EASE_OUT` numa barra faz ela parecer acelerar e frear a cada tick, o que lê como instabilidade. |
| Papéis voando (`FlyingPaperLoader`) | Já usa `DUR`/`EASE_OUT` e `useReducedMotion` (`FlyingPaperLoader.tsx:3-6`) | Reuso direto. A ilustração descreve a operação em vez de só ocupar o tempo. |
| Linha da tabela entrando | `itemEnter(i)` com stagger capado em 0.24s | Já é o padrão da casa. Numa lista virtualizada, só as linhas do primeiro viewport recebem stagger, o resto entra sem delay. |
| Grupo de duplicata expandindo | `height: auto` do framer com `transitions.fast` | Exceção consciente: é o único caso onde altura precisa animar, e o framer resolve com `transform` quando dá. Se medir mal, cai para crossfade de opacidade. |
| Press em botão e linha | `pressable` (`whileTap: scale .985`, `transitions.press`) | O `whileTap` precisa da própria transition (gotcha 3). Já está no SSoT. |
| Chip de veredito trocando de estado | `transition-colors` com `[transition-duration:var(--dur-fast)]` | Nunca `transition-all` (gotcha 4). O `ui:audit` já trava isso em zero. |
| Conclusão, o ✓ aparecendo | `transitions.base` + `scale .9 → 1` | Momento raro, pode ter um pouco de peso. Sem bounce, sem spring: mola é para gesto e momento. |
| `prefers-reduced-motion` | Papéis param no meio do voo, barras continuam, troca de etapa vira crossfade sem `x` | Reduced motion tira movimento, nunca tira o resultado (gotcha 6). |

**Os dois momentos de espera, e por que o progresso é honesto nos dois:**

1. **Varredura.** Duas sub-fases com progresso de naturezas diferentes. Listagem
   sem denominador (contador que sobe) porque o total é genuinamente desconhecido.
   Hash com denominador (barra + `done/total`) porque a rota já sabe o total
   (`scan/route.ts:107`). Estimativa de tempo restante calculada da taxa observada
   dos últimos 20 eventos, e escondida enquanto a taxa não estabilizar (mostrar
   "restam 4h" no terceiro segundo é pior que não mostrar nada).
2. **Inserção.** O denominador passa a ser o número de arquivos selecionados e não
   `totalSteps` (`route.ts:143`). As duas sub-fases (gravar, analisar metadado)
   viram duas contagens visíveis, porque a segunda hoje é onde a barra parece
   morrer.

**O que não anima.** O número de selecionados no rodapé da aprovação. É o dado que
o usuário lê antes de autorizar uma escrita, e número que se anima é número que se
lê errado. `GlitchChars` sai dali pelo mesmo motivo.

---

## 5. Componentes

### 5.1 Reusar sem tocar

| Componente | Onde já está | Uso no fluxo |
|---|---|---|
| `Dialog` / `DialogContent` | `ui/Dialog.tsx` | O container das 5 etapas. `bare` + cartão interno, como o `IngestReviewSheet` já faz em `:314-323`. Foco preso, ESC e scroll lock vêm de graça. |
| `FlyingPaperLoader` | `ui/FlyingPaperLoader.tsx` | Etapas 3 e 5, com `progress` e `label` diferentes e o ícone de destino trocado por prop. |
| `GlitchChars` | `ui/GlitchChars.tsx` | Só na sub-fase de listagem da varredura, onde a máquina está de fato mexendo sem denominador. Sai do rodapé da aprovação. |
| `Select` | `ui/Select.tsx` | Estúdio do lote, e estúdio por linha. Radix, já na casa. |
| `Segmented` | `ui/Segmented.tsx` | Filtro de veredito, se os chips virarem grupo exclusivo. |
| `Popover` | `ui/Popover.tsx` | Menu de linha (abrir no app, revelar na pasta, tornar representante). Já é origin-aware. |
| `Tooltip` / `IconButton` | `ui/Tooltip.tsx`, `ui/IconButton.tsx` | Ações só-ícone na tabela. `IconButton` obriga `label`, então nenhum ícone fica mudo. |
| `DropOverlay` | `ui/DropOverlay.tsx` | Arrastar pasta do Explorer sobre o Dialog na etapa 2 (ver 6.1 para o que dá e o que não dá). |
| `sonner` | já instalado, usado em `page.tsx:3746` | Retorno do ingest, substituindo o `ingestResult` que hoje mora na sidebar. |
| `motion/react` | já instalado | Todas as transições, com os tokens de `lib/motion.ts`. |
| `lib/ingest-triage.ts` | puro e testado | Intocado. Toda a lógica de veredito continua onde está. |

### 5.2 Vem do registry Visant (`visant-ui.vercel.app/r/<nome>.json`)

| Item | Por que ele, e não código novo |
|---|---|
| **`data-table`** | "Tabela densa com ordenação, seleção, edição inline e menu de contexto". É literalmente a lista de requisitos da etapa 4: cabeçalho ordenável, seleção múltipla, estúdio editável na linha, menu por linha. Escrever isso à mão em cima do `<div role="button">` de hoje (`IngestReviewSheet.tsx:546-611`) seria reinventar um item que já existe testado. |
| **`status-ticker`** | "Texto que segura atenção numa espera longa, com passo, cronômetro e glitch". Resolve exatamente o decorrido e o "o que está acontecendo agora" das etapas 3 e 5, no lugar de somar um `useEffect` de cronômetro na unha. |
| **`chip`** | "Badge de filtro com contagem que nunca renderiza zero". Os chips de veredito de hoje (`IngestReviewSheet.tsx:476-492`) já implementam essa regra à mão. Trocar pelo item consolida a decisão num lugar só. |
| **`inline-edit`** | "Editar no lugar, Enter salva, Esc cancela". O estúdio por linha. |

O repo não tem shadcn inicializado (registrado em `GlitchChars.tsx:9-12`), então o
caminho é o mesmo já usado para `FlyingPaperLoader`, `GlitchChars` e `DropOverlay`:
colher o item, trocar `framer-motion` por `motion/react`, apontar cor para o token
`acc` da casa, e documentar a procedência no topo do arquivo. Nenhum hex novo.

**`data-table` merece uma ressalva honesta:** o item é do registry mas nunca foi
usado neste repo, e ele carrega drag, marquee e multi-select que aqui não servem. A
adoção precisa de uma leitura do arquivo antes de qualquer estimativa. Se o item vier
grande demais para o uso, a alternativa correta é `@tanstack/react-table` (headless,
sem estilo, resolve cabeçalho, ordenação e virtualização) e não uma tabela à mão.
Essa escolha fica como **decisão pendente** na seção 8.

### 5.3 O que precisa ser novo, e o pedido de permissão

Três peças não existem em lugar nenhum, e nenhuma delas é componente de design
system (nenhuma desenha vocabulário visual novo):

1. **`IngestDialog.tsx`**, orquestrador das 5 etapas. É a evolução do
   `IngestReviewSheet.tsx` atual, absorvendo as etapas 1 e 2 que hoje moram na
   sidebar. Composição de primitivos existentes, zero desenho novo.
2. **`FolderPicker.tsx`**, o corpo da etapa 2 (campo validado, raízes conhecidas,
   recentes, resolução de link do Drive). Composição de `Popover`, `Select` e input
   com pele já existente.
3. **`IngestStepper.tsx`**, os 5 pontos do topo. Cinco `<span>` e uma linha. Se isso
   crescer para além disso, é sinal de que virou decoração.

**Pedido explícito de permissão, para o dono decidir linha a linha:**

| Peça | Tipo | Precisa de OK? |
|---|---|---|
| `IngestDialog.tsx` | composição de primitivos existentes | **sim**, é arquivo novo |
| `FolderPicker.tsx` | composição | **sim** |
| `IngestStepper.tsx` | composição | **sim** |
| Colher `data-table` do registry | item do registry | **sim**, e depois de ler o arquivo |
| Colher `status-ticker`, `chip`, `inline-edit` | itens do registry | **sim** |
| `@tanstack/react-table` (se `data-table` não servir) | dependência nova | **sim** |
| Editar `IngestReviewSheet.tsx`, `page.tsx`, as duas rotas | arquivos existentes | **sim** |

Nada disso foi feito. Este documento é a única coisa escrita.

---

## 6. Decisões técnicas

### 6.1 Seletor de pasta do Windows: o que é real

**As três APIs de browser não servem, e o motivo é o mesmo nas três.** O servidor
precisa de um **caminho absoluto** para `walkDir` (`fs-walk.ts:14`). O browser não
entrega caminho absoluto por design (é vazamento de dado do sistema de arquivos):

| Opção | O que entrega | Por que não serve aqui |
|---|---|---|
| `showDirectoryPicker()` (File System Access) | `FileSystemDirectoryHandle` com `.name` e iteração de entradas. **Nunca o caminho.** Só Chromium, exige contexto seguro e gesto do usuário. | Sem caminho, a rota não tem o que varrer. Entregar os bytes pelo handle significaria fazer upload de dezenas de GB de PSD para indexar o que já está no disco. |
| `<input webkitdirectory>` | Lista de `File` com `webkitRelativePath` relativo à pasta escolhida. Sem caminho absoluto. | Mesmo problema, e ainda materializa a lista inteira de arquivos na memória do browser. |
| Arrastar pasta do Explorer | `DataTransferItem.webkitGetAsEntry()`, nome e árvore relativa. `File.path` só existe em Electron. | Mesmo problema. |

**A estratégia certa, e ela é melhor do que qualquer uma das três.** O app roda
local: o Next server e o Explorer estão na mesma máquina, com o mesmo usuário e o
mesmo desktop. E o repo **já executa processo nativo do Windows a partir de uma rota**
(`api/open-file/route.ts` chama `execFile("explorer", ...)` e `execFile("cmd", ...)`).
Então o seletor de pasta do Windows de verdade é possível:

> **Primário: `POST /api/fs/pick-folder`.** O servidor abre o diálogo nativo de
> escolher pasta e devolve o caminho absoluto.

Verificado nesta máquina agora:

```
pwsh = 7.6.3
Shell.Application  OK      (COM, diálogo estilo Vista, aceita pasta inicial)
System.Windows.Forms OK    (FolderBrowserDialog, fallback)
powershell.exe presente em C:\WINDOWS\System32\WindowsPowerShell\v1.0
```

Guardas obrigatórias, porque isto abre uma janela do SO a partir de um POST:

- `process.platform === "win32"`, senão 501.
- Só aceita requisição de `localhost` / `127.0.0.1`, senão 403.
- Atrás de `INGEST_NATIVE_PICKER=1` no `.env.local`, desligado por padrão.
- Timeout de 120s matando o processo, senão um diálogo esquecido segura um handle
  para sempre.
- Um diálogo por vez (mutex em módulo), senão dois cliques abrem duas janelas.
- `execFile` sem shell, argumentos como array, exatamente como
  `open-file/route.ts:24-27` já faz. O caminho volta pelo stdout, nunca interpolado
  em string de comando.
- Se o servidor rodar em sessão sem desktop (serviço, container), o diálogo não
  aparece e o timeout resolve, caindo no fallback.

> **Fallback e caminho portátil: `GET /api/fs/browse?path=`.** Um navegador de
> pastas renderizado pelo app, lendo o disco com `readdirSync` e listando só
> diretórios. Lista as unidades quando `path` vem vazio. Isto funciona em qualquer
> browser, em qualquer SO, e não abre janela nenhuma do sistema. É também o que
> torna a tela testável.

> **Via expressa: colar ou digitar o caminho**, que é o que existe hoje, com duas
> coisas que faltam: normalização de `\` para `/` no cliente (para o eco bater com
> o placeholder) e validação ao vivo via `HEAD /api/fs/stat?path=` com debounce de
> 300ms, respondendo `{ exists, isDirectory, entryCount, sizeBytes }`.

> **Conveniência: arrastar a pasta do Explorer sobre o Dialog.** Não dá o caminho,
> dá o nome e a contagem de entradas de primeiro nível. Com isso o servidor procura,
> dentro das raízes de `psdRoots()`, uma pasta com aquele nome. Um resultado, oferece
> confirmar. Vários, mostra a lista. Nenhum, diz que não achou e manda usar o
> seletor. Nunca resolve sozinho, sempre confirma, porque a heurística pode errar.

> **Endgame: Electron.** `docs/PLAN-desktop-hybrid.md` já prevê o app desktop. Lá
> `dialog.showOpenDialog({ properties: ["openDirectory"] })` é a resposta canônica,
> sem guarda nenhuma. O `pick-folder` acima é o que dá esse comportamento hoje, e
> some no dia que o Electron chegar.

### 6.2 Google Drive: o que dá e o que não dá

O dono usa `H:/Meu Drive/...` e `H:/.shortcut-targets-by-id/...` (`.env.local`,
`PSD_DIRS`). Isso muda tudo, e para melhor.

**Descoberta verificada em disco agora:**

```
PSD_DIRS contém  H:/.shortcut-targets-by-id/1Dx_uPec62b4ddACJYlRsdWqQlHyfMhPY/[ MOCKUPS 1.0 ]
ls confirma      H:/.shortcut-targets-by-id/1Dx_uPec62b4ddACJYlRsdWqQlHyfMhPY  existe
```

`1Dx_uPec62b4ddACJYlRsdWqQlHyfMhPY` é exatamente o formato do ID que aparece numa
URL `https://drive.google.com/drive/folders/<ID>`. O Drive para computador materializa
pastas compartilhadas em `<mount>/.shortcut-targets-by-id/<ID>/<nome>`.

**Então colar o link do Drive resolve para caminho local, sem OAuth nenhum**, quando
a pasta é compartilhada e está montada:

1. Extrair o ID da URL (`/folders/([-\w]{20,})` e `[?&]id=([-\w]{20,})`).
2. Descobrir os mounts do Drive: para cada unidade existente, testar
   `<letra>:/.shortcut-targets-by-id`, `<letra>:/Meu Drive`, `<letra>:/My Drive`, e
   `%USERPROFILE%/Google Drive`. Somar os pais das entradas de `psdRoots()`.
3. Testar `existsSync(<mount>/.shortcut-targets-by-id/<ID>)`. Se existe, ler a única
   subpasta e devolver o caminho completo.
4. Achou, mostra o caminho resolvido e pede confirmação antes de varrer. Não achou,
   diz o que fazer (abrir no Drive para computador e colar o caminho local).

Cobre o caso real do dono com zero configuração e zero credencial.

**O que não dá, dito sem rodeio:**

| Tentativa | Veredito |
|---|---|
| Link de pasta do **Meu Drive** (não compartilhada) | O ID **não** vira caminho: pasta própria mora em `<mount>/Meu Drive/<hierarquia>`, sem nenhum diretório por ID. Sem a API do Drive não há como saber o nome nem os pais. A resposta honesta é pedir o caminho local. |
| Link público, baixar o conteúdo | Pasta pública não se enumera sem a API. E baixar dezenas de GB de PSD para um temp duplica o que o mount já entrega, e quebra o modelo do produto, que indexa por `psdPath` no disco (`route.ts:68`). **Rejeitado.** |
| OAuth `drive.metadata.readonly` para resolver ID em nome e cadeia de pais | Tecnicamente funciona e cobriria o caso do Meu Drive. Custa projeto no GCP, tela de consentimento, armazenamento e renovação de token, tudo para um app local de um usuário. **Fica como opção de Fase 4**, e só se o caso do Meu Drive doer de verdade. |
| Arquivos que o Drive deixa "só na nuvem" (streaming, não espelhado) | O `walkDir` vê o placeholder e `statSync` reporta tamanho, mas ler os primeiros 2 MB (`scan/route.ts:33-48`) **dispara download** por arquivo. Numa pasta de 3 mil PSDs isso é a diferença entre 2 minutos e 2 horas. A UI precisa detectar (atributo de arquivo offline no Windows) e avisar antes de varrer: "N arquivos ainda não estão baixados. A varredura vai baixá-los." |

O último ponto é o mais importante desta seção e não estava em lugar nenhum do
código nem dos planos existentes.

### 6.3 Progresso: streaming, e o que falta nele

**As duas rotas já fazem SSE via `ReadableStream`.** Verificado:
`scan/route.ts:170-202` e `route.ts:272-309`. Polling está fora de questão e nem
precisa ser cogitado. O que falta é honestidade, não mecanismo:

| Buraco | Conserto |
|---|---|
| `walkDir` síncrono roda antes do primeiro evento (`scan/route.ts:95`) | Trocar por versão assíncrona (`fs/promises.opendir`) que emite `{type:"listing", files, dirs, currentDir}` a cada N entradas. É o conserto de maior valor do plano inteiro: transforma o trecho mais lento e mais mudo em progresso visível. |
| `req.signal` ignorado nas duas rotas | Ler `req.signal.aborted` no laço dos workers (`scan/route.ts:113`) e no `tick` do commit (`route.ts:145`). No commit, abortar significa parar antes do próximo item e emitir `{type:"aborted", ...report parcial}`, nunca reverter. |
| Denominador do commit é `totalSteps` e não arquivos (`route.ts:143`) | Emitir os dois: `filesDone/filesTotal` para o usuário, e a fase corrente (`ref` / `psd` / `meta`) como sub-linha. |
| Fase de metadado emite pouco (`route.ts:216-232`) | `scanPsd` é síncrono e pesado. Emitir por PSD nessa fase, não a cada 5 passos. |
| `maxDuration = 300` nas duas rotas | Numa pasta grande em rede isso estoura. Subir e, mais importante, mandar heartbeat SSE a cada 10s para o proxy não derrubar a conexão ociosa. |
| Sem estimativa de tempo | Calcular da taxa dos últimos 20 eventos, e só mostrar depois de 10s de amostra. |

### 6.4 Estados vazios, erro, cancelamento e retomada

| Estado | Hoje | Proposto |
|---|---|---|
| Acervo vazio | `page.tsx:2563-2586`, já bom, com o argumento certo. O botão expande a sidebar. | Mesmo texto, sem o travessão (portão), e o botão abre o Dialog direto. |
| Pasta válida com zero arquivo aproveitável | Cai na revisão com lista vazia e "Nada neste recorte" (`IngestReviewSheet.tsx:535`), que é a mensagem de filtro, não de pasta vazia | Estado próprio: "Achei N arquivos, nenhum é imagem ou PSD" com a lista de extensões encontradas. Erro e vazio são estados diferentes e não se colapsam. |
| Mongo caído | Já degrada com aviso (`scan/route.ts:79`, aviso em `:453-461`). Correto. | Mantido. O commit também precisa dizer o que aconteceu se o Mongo cair no meio da escrita, o que hoje vira linha em `report.errors` e some. |
| Caminho inexistente | Modal abre, varre, mostra erro vermelho | Validação antes de abrir a etapa 3, no próprio campo. |
| Erro no meio do scan | Tela vermelha com "Escanear de novo" (`:394-399`), que joga fora tudo | Manter o botão, e acrescentar "voltar e trocar a pasta", que é o que resolve o erro mais comum (caminho errado). |
| Fechar no meio | Ver tabela 3.5 | Ver tabela 3.5 |
| Retomada | Não existe | `sessionStorage`, chave por caminho, TTL 30 min, oferecida e nunca automática. |

---

## 7. Advogado do diabo (T3, 20 perguntas mais posicionamento)

Respondidas com evidência. Só sobem para o dono as que mudam o que se constrói.

**Conceito do fluxo**

1. *Este fluxo deveria existir?* Sim. É a única porta de entrada de conteúdo do
   produto, e o `agent-cli` não é alternativa para quem não vive no terminal.
2. *Cinco etapas é o número certo, ou é cerimônia?* Quatro são reais (origem, varrer,
   aprovar, gravar). A quinta (conclusão) é o recibo de uma escrita irreversível, e
   em superfície C recibo paga o próprio espaço. Mas a etapa 1 (nova pasta) e a 2
   (origem) são a mesma tela: o stepper mostra 5 pontos, o usuário vive 4 telas.
3. *A tabela de aprovação vale o custo de construir?* A pergunta certa é a inversa, e
   o código já respondeu: a versão anterior pedia confirmação em cima de duas
   contagens (`scan/route.ts:16-19`), e o resultado foi acervo poluído que hoje se
   limpa com `remove-dupes.ps1` na mão. A tabela é o que impede a próxima poluição.
4. *A jogada ótima do usuário paga?* A jogada ótima é clicar "marcar tudo" e gravar,
   ignorando a triagem. Hoje nada impede: "Marcar à vista" (`:522`) marca lixo e
   duplicata junto se o filtro estiver em "Tudo". Conserto: "Marcar à vista" com
   filtro "Tudo" pede confirmação quando incluiria lixo, ou marca só o que não é
   lixo e diz que fez isso. **Isto é um defeito real e vai para a Fase 1.**
5. *E se a aprovação fosse opcional?* Um "confio na triagem, grave o que é novo"
   direto da etapa 2, pulando a 4. Tenta o caso "já rodei nessa pasta dez vezes".
   Recomendação: **não na primeira versão.** Atalho que pula a única barreira de uma
   escrita irreversível é exatamente o que produziu o acervo sujo de hoje. Reavaliar
   depois de medir quantas vezes o usuário desmarca alguma coisa na etapa 4.

**Hierarquia de atenção**

6. *Qual o dado que decide na etapa 4?* O veredito e o tamanho. Hoje o veredito é uma
   pílula de 8px no canto direito (`:605-610`) e o nome do arquivo tem 11px em bold
   à esquerda. O peso está no nome, que raramente decide. Conserto: veredito vira
   coluna com peso, e a linha inteira recebe uma faixa de cor à esquerda.
7. *Qual o número que o usuário lê antes de autorizar?* "N selecionados" no rodapé
   (`:628`). Está em 10px, ao lado de `GlitchChars` piscando. É o número mais
   importante da superfície C inteira, com o menor peso da tela e um distrator do
   lado.
8. *O que some se a janela for estreita?* Não medido. Vai como pendência de
   verificação: a tabela a 390px precisa de medição real com dado real.
9. *Zero renderiza em algum lugar?* Não nos chips (`:476` filtra `> 0`), e sim no
   `currentFile` da varredura, que reserva 4px de altura vazia (`:370`). Reserva de
   espaço é correta (evita pulo de layout), mas ali cabe o nome da pasta corrente
   em vez de nada.

**Bloco fixo F1 a F6**

10. *F1 Reuso.* Onze primitivos existentes cobrem quase tudo (5.1). Quatro itens do
    registry cobrem o resto (5.2). Três composições novas (5.3). Nenhum vocabulário
    visual novo.
11. *F2 Consistência do design system.* `ui:audit` em 9/9 dentro do teto. Duas
    paletas (`zinc` e `neutral`) coexistem por decisão registrada (`Dialog.tsx:15`),
    e o ingest é `neutral`. Ponto de atenção: `IconButton` é `zinc` por padrão
    (`IconButton.tsx:23`), então usá-lo no Dialog `neutral` mistura paleta num
    arquivo, que é uma das métricas do `ui:audit`. Precisa de `variant` neutro ou de
    outro botão.
12. *F3 Responsivo e performance, medidos.* Não medidos. Declarado.
13. *F4 Fluxo progressivo para o ICP.* O ICP é o dono do acervo, que faz isso uma vez
    por sessão e conhece os caminhos. Por isso "raízes conhecidas" e "recentes" na
    etapa 2 valem mais que o seletor bonito: o caminho ótimo dele é dois cliques,
    não navegar árvore.
14. *F5 O que esconder ou virar ícone.* O campo de estúdio do lote pode nascer
    colapsado com o valor sugerido pela pasta, e só abrir quando clicado. As colunas
    de dimensão e tamanho podem virar uma só ("4000×3000, 184 MB") em janela estreita.
15. *F6 O que falta para o nível Vale do Silício.* Três coisas, nesta ordem: progresso
    na listagem (hoje é um buraco mudo), cancelamento que cancela de verdade, e
    retomada do scan. As três são sobre respeitar o tempo do usuário, que é o que
    separa ferramenta de formulário.

**Integridade e confiança**

16. *A UI mente para o banco em algum lugar?* Sim, uma vez: fechar a aba durante o
    commit deixa o servidor escrevendo e o cliente sem saber (`:200-208`, sem
    `signal`). O acervo fica num estado que a UI nunca reportou.
17. *Erro silencioso?* `runIngest` engole erro por item em `report.errors`
    (`route.ts:178`, `:211`, `:229`) e a UI mostra 20 e some com o resto
    (`:428`). Um lote com 300 erros parece um lote com 20.
18. *O default é bom?* Sim, e é a melhor decisão do fluxo atual: só `new` vem marcado
    (`:146`). Falta a regra estar escrita na tela em uma linha, ao lado do "Marcar à
    vista", que é o que a espinha 4 pede.
19. *Alguma ação destrutiva sem confirmação?* Não. O ingest não apaga nada. Vale
    dizer isso na tela: "Gravar não apaga nem move arquivo nenhum do disco." Reduz o
    medo que faz o usuário abandonar o fluxo.
20. *O que acontece se rodar duas vezes na mesma pasta?* A triagem marca tudo como
    `exists` (`ingest-triage.ts:177-186`) e o default deixa tudo desmarcado, então o
    primário some e a tela diz "Marque ao menos um item" (`:641`). Correto no
    comportamento, ruim na mensagem: o certo é "Esta pasta já está toda no acervo",
    que é informação, e não uma instrução para fazer algo que não faz sentido.

**Posicionamento**

O ingest é a promessa do produto na primeira sessão. O que ele diz hoje, com o campo
de texto na sidebar, é "cole um caminho e torça". O que ele precisa dizer é "aponte
uma pasta e eu te mostro o que vale a pena guardar antes de guardar". A triagem
perceptual é a coisa mais difícil que este produto faz e ela está escondida atrás de
uma caixa de texto de 15% de largura. Promessa do tamanho da prova: a prova existe
(`ingest-triage.ts`, 266 linhas testadas), a promessa é que não aparece.

---

## 8. Decisões pendentes (sobem para o dono)

Recomendação primeiro, em cada uma.

| # | Decisão | Recomendação |
|---|---|---|
| D1 | Diálogo nativo do Windows via `/api/fs/pick-folder`, ou só o navegador de pastas do app? | **Os dois.** Nativo atrás de flag como primário (é o que foi pedido, e a máquina suporta), navegador do app como fallback sempre presente. |
| D2 | `data-table` do registry ou `@tanstack/react-table`? | Ler o `data-table` primeiro. Se trouxer drag e marquee que não servem, **tanstack**, que é headless e resolve virtualização junto. |
| D3 | OAuth do Drive para resolver link do Meu Drive? | **Não agora.** O caso do dono é pasta compartilhada, resolvido sem credencial. Reavaliar se o Meu Drive doer. |
| D4 | Atalho que pula a aprovação para pastas já conhecidas? | **Não na primeira versão.** Ver pergunta 5. |
| D5 | Consertar os 17 achados de copy fora do ingest no `page.tsx`? | Fora do escopo deste plano, mas é dívida registrada. Vale um passe só, separado. |
| D6 | O `IngestReviewSheet.tsx` evolui ou é substituído? | **Evolui.** O miolo das etapas 3 a 5 está certo. Renomear para `IngestDialog` e absorver as etapas 1 e 2. |

---

## 9. Plano de execução em fases

### Fase 0, portão (bloqueante, meia hora)

- Consertar os 6 achados de copy do fluxo de ingest: `page.tsx:1808`,
  `page.tsx:2576`, `IngestReviewSheet.tsx:375`, `:418`, `:420`, `:457`.
- Reconferir com `killer-scan` nos dois alvos.
- Achado de portão vira conserto, não proposta. Isso precede qualquer redesenho.

### Fase 1, o container certo (bloqueante)

O que o dono pediu, e sem isso nada mais importa.

1. `IngestDialog.tsx` como dono das 5 etapas, evoluído de `IngestReviewSheet.tsx`.
2. `IngestStepper.tsx`, 5 pontos.
3. Etapa 2 sai da sidebar. Removem-se `wizardStep`, `folderInput` e o bloco
   `page.tsx:2238-2269`. `openFolderWizard` (`page.tsx:1787-1796`) deixa de mexer no
   `leftPanelRef`.
4. Os três gatilhos (header `:2042`, estado vazio `:2579`, e um atalho de teclado)
   passam a fazer a mesma coisa: abrir o Dialog.
5. `ingestResult` (`page.tsx:2230-2235`) sai da sidebar e vira `toast` do `sonner`,
   que já está instalado e em uso.
6. Conserto da jogada ótima (pergunta 4): "Marcar à vista" nunca marca lixo em
   silêncio.

### Fase 2, progresso honesto (bloqueante)

7. `walkDir` assíncrono com evento de listagem. É o conserto de maior valor do plano.
8. `req.signal` respeitado nas duas rotas. Parar de varrer para de verdade, e parar
   de gravar para no próximo item mantendo o que entrou.
9. `AbortController` no commit do cliente (`IngestReviewSheet.tsx:200`).
10. Denominador do commit em arquivos, com as duas sub-fases visíveis.
11. Heartbeat SSE de 10s e revisão do `maxDuration`.
12. Aviso de arquivo do Drive não baixado antes de varrer.

### Fase 3, origem de verdade

13. `GET /api/fs/stat` para validação ao vivo do campo.
14. `GET /api/fs/browse` para o navegador de pastas do app.
15. `POST /api/fs/pick-folder` para o diálogo nativo, com as seis guardas da 6.1.
16. Resolução de link do Drive por `.shortcut-targets-by-id`.
17. Raízes conhecidas (de `psdRoots()`) e recentes.

### Fase 4, aprovação que escala

18. Adotar `data-table` ou tanstack (D2), com virtualização.
19. Cabeçalho ordenável, e peso tipográfico no veredito e no tamanho.
20. Estúdio por linha com `inline-edit`.
21. Grupo de duplicata colapsado, com troca de representante.
22. Menu de linha usando `/api/open-file`.
23. Retomada por `sessionStorage`.

### Fase 5, polimento (nada aqui é bloqueante)

24. `status-ticker` do registry com decorrido e estimativa.
25. `chip` do registry no lugar dos chips à mão.
26. Ícone de destino diferente entre varredura e inserção no `FlyingPaperLoader`.
27. `GlitchChars` sai do rodapé da aprovação e vai para a sub-fase de listagem.
28. `DropOverlay` para arrastar pasta, com reconciliação por nome e confirmação.
29. "Adicionar outra pasta" e "copiar relatório" na conclusão.
30. Estado próprio para "pasta sem arquivo aproveitável" e para "pasta já toda no
    acervo".

### Verificação obrigatória ao fim de cada fase

`npx tsc --noEmit`, lint, `npm run ui:audit`, `killer-scan` nos arquivos tocados,
medição de `scrollWidth - innerWidth` a 390px com pasta real e grande, uma rodada
com o Mongo parado, uma rodada com uma pasta em `H:` com arquivo só na nuvem, e
feel-check no DevTools a 25%. Nunca `next build` com o dev de pé.

---

## 10. Nota

| Dimensão | Nota | Por quê |
|---|---:|---|
| Portão determinístico | 7/10 | `impeccable` zero e `ui:audit` 9/9 dentro do teto. Copy com 23 achados reais, 6 deles no fluxo de ingest. `audit:design` não existe no repo. |
| Arquitetura do fluxo | 8/10 | Triagem pura e testada, SSE nas duas rotas, degradação honesta com Mongo caído. Miolo sólido. |
| Container e entrada | 3/10 | Sidebar como container de fluxo multi-etapa, clique que reconfigura o layout, três gatilhos com três comportamentos, retorno de escrita num painel que pode estar fechado. |
| Honestidade do progresso | 4/10 | A fase mais lenta da varredura é a única sem progresso. Cancelar não cancela. Denominador do commit não é o que o usuário conta. |
| Superfície de confiança | 6/10 | Default certo, motivo escrito por item, primário que some em vez de desabilitar. Contra: fechar a aba durante a escrita deixa o servidor escrevendo sem ninguém sabendo, e erros somem depois do vigésimo. |
| Motion | 8/10 | SSoT respeitado, zero `transition-all`, zero duração hardcoded, reduced motion tratado. Contra: `GlitchChars` animando ao lado do número que decide a escrita. |
| **Geral** | **6/10** | Miolo de 8, boca de funil de 3. O trabalho está quase todo na entrada e no progresso, e quase nada na lógica. |

**Esta auditoria está incompleta em um ponto, e o relatório precisa dizer isso:**
nada foi visto rodando. Sem medição a 390px com dado real, sem rodada com o backend
parado, e sem feel-check, as notas de responsivo, de erro e de feel são leitura de
código, não observação. As três verificações estão na lista de cada fase.
