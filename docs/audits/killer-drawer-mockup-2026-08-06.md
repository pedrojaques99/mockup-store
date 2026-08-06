# Killer: o que falta para o nível Vale do Silício — drawer de mockup + home

**Tier** T2 rota, com região T3 (o momento de comprometer: render final + download)
**Superfície** B trabalho no miolo · C confiança no rodapé
**Nota** 84/100 · **Veredito** vai pra PR com pendência listada e dona nomeada
**Alvo** `src/app/page.tsx` (5.057 linhas) · `src/components/ArtFramePanel.tsx` · caminhos de rede do fluxo inteiro
**Rodada anterior** `killer-drawer-mockup-2026-08-05.md` (38 → 92)

> **A nota caiu de 92 para 84 e isso não é regressão: é o alvo que cresceu.** A
> rodada de ontem auditou as ~410 linhas do drawer. A pergunta *"o que falta para
> o nível Vale do Silício"* obriga a olhar o **fluxo**, e três coisas que ficaram
> fora do recorte de ontem estão vivas: os caminhos de rede do arquivo inteiro, o
> segundo verde, e o SSoT de motion que ninguém importa. As notas não são
> comparáveis porque as réus não são as mesmas.

---

## A resposta, em ordem de alavanca

| # | O que falta | Estado | Custo |
|---|---|---|---|
| 1 | **O arquivo.** 5.057 linhas, 108 `useState`, 28 `useEffect`, 9 componentes. Ontem eram 4.920 e a Onda 4 mandava encolher: **cresceu 137 linhas** | pendente | alto |
| 2 | ~~Todo caminho de erro parseia corpo às cegas~~ | **consertado nesta rodada** (17 pontos + guarda) | — |
| 3 | **Dois verdes.** `emerald-*` de sucesso ao lado do `acc2` da marca, numa paleta documentada como mono-verde — e o código já sabe (`page.tsx:216`) | vivo | baixo |
| 4 | **Press fora do SSoT.** 61 `active:scale-` escritos à mão, e `pressable` do `lib/motion.ts` sem um único import neste arquivo | vivo | baixo |
| 5 | **O erro é o menor texto do rodapé.** 10px, e vários erros viram uma frase com vírgula | vivo | baixo |
| 6 | **O tempo do render não é anunciado antes do clique.** O contador só existe depois | vivo | baixo |

O item 1 é o único caro, e é o único que produz os outros. Os itens 3 a 6 são
todos "alguém escreveu certo em um lugar e o outro lugar não sabe" — que é
exatamente o que 5.057 linhas fazem com uma equipe, e o que fizeram com o
defeito de hoje.

---

## O que esta rodada consertou

### O defeito de hoje não era um ponto: era um padrão em 17 lugares

O `Gerar PNG` mostrou `SyntaxError: Unexpected end of JSON input`. A causa foi
corpo de requisição truncado (10 MB, clone do middleware), mas a **mensagem** veio
de outro defeito, uma camada acima:

```
if (!res.ok) { const err = await res.json(); … }   // corpo vazio ⇒ estoura aqui
```

A resposta de erro sem corpo é o que o Next devolve para **qualquer** exceção não
tratada num route handler. O parse estoura dentro do `try`, e o `catch` de fora
pinta a mensagem do parser em cima do erro real.

Varrendo `src/`, o mesmo shape aparecia em **17 pontos** (mais 5 que já usavam
`.catch(() => ({}))` à mão — o idioma existia, só não era de ninguém):

| Arquivo | Pontos |
|---|---|
| `src/app/page.tsx` | 13 |
| `src/app/photo-mockup/page.tsx` | 2 |
| `src/components/ingest/FolderBrowser.tsx` | 1 |
| `src/lib/photo-mockup-io.ts` | 1 (`fetchJSON`, usado por todo o editor de foto) |

Consertado com um dono só, `src/lib/http-error.ts`:

```ts
if (!r.ok) throw new Error(await readError(r));   // corpo do erro
const d = await r.json();                          // corpo do sucesso
```

A ordem é metade do conserto: `.json()` e `.text()` **consomem** o corpo, então
parsear antes do `ok` gasta o corpo do sucesso.

`readError` cai em cascata — campo `error`/`message` do JSON, texto puro, e o
status como último recurso, porque o status é a única coisa que toda resposta tem.
Duas coisas que ele **recusa** mostrar, e as duas saíram de teste que falhou
enquanto eu escrevia: JSON que parseou mas não tem campo de texto (despejar
`{"ok":false}` num toast é mostrar payload para quem não sabe o que é payload) e
HTML (a página de erro do dev tem centenas de linhas de markup).

### Duas guardas novas, e a de varredura foi provada reprovando

| Guarda | O que trava |
|---|---|
| `src/lib/__tests__/http-error.test.ts` | 8 casos do `readError`, sendo o primeiro o corpo vazio que causou tudo |
| `src/lib/__tests__/error-body-parse.test.ts` | varredura da árvore: nenhum `res.json()` desprotegido decide sobre resposta que falhou |
| `check:render-failure -- C` (novo caso) | injeta 500 **sem corpo** e reprova se o aviso vazar `SyntaxError`/`JSON input` |

A varredura foi rodada **antes** do conserto e listou os 17 com `arquivo:linha`;
o caso C foi rodado com a regressão reintroduzida à mão e reprovou com a
mensagem certa. Guarda que nunca foi vista reprovando não é guarda.

### E o teto de corpo, que era a causa de baixo

`experimental.middlewareClientMaxBodySize: "64mb"` no `next.config.ts`, mais um
`try/catch` no `req.json()` da rota que devolve **413 com motivo** em vez de 500
vazio. Medido: 9 MB passava, 10 MB quebrava; agora 32 MB passa e 80 MB devolve a
frase certa.

---

## Portão

| Detector | Resultado |
|---|---|
| `impeccable` (tell de IA) | **0** |
| `audit:design` (token) | **0** |
| copy (vício de linguagem) | **0** (247 strings de interface) |
| `killer-scan --self-test` | sem falso positivo, sem falso negativo |
| `tsc --noEmit` | limpo |
| lint | **0 erros** (56 warnings pré-existentes, política do repo) |
| vitest | **377/377**, 35 arquivos (eram 368/33) |
| `visual:drawer` | **7/7** — inclusive "exatamente um primário verde" e "anel de foco presente" |
| `visual:home` | **12/12** (1920px e 390px) |
| `visual:console` | 0 erro, 0 aviso, 0 falha de rede |
| `check:render-failure` A · B · C | 3/3 verdes |

Pulado: nada.

⚠️ **`npm run visual:drawer` sem argumento aponta para a porta 3000 e o dev deste
repo roda na 4100** — o portão sai vermelho por motivo errado. Precisa de
`-- --url http://localhost:4100`. Candidato a virar default do script.

---

## Slop confirmado, ainda vivo

### 1. Dois verdes na mesma superfície (catálogo #15 + #1)

`page.tsx:4285` — `text-emerald-400` para `step === "complete"`
`page.tsx:4287` — `text-emerald-500` no rótulo do passo
`page.tsx:2781` — pílula inteira em `emerald-500/10` + `border-emerald-500/20`
`page.tsx:4801-4802` — o ícone de sucesso do ingest

E o primário do mesmo rodapé é `bg-acc2` (#BFFF38). São **dois verdes sem relação
nenhuma** numa marca cuja regra escrita é: *"a paleta da BOXY é mono-verde: não
existe um segundo MATIZ para gastar"* (`globals.css`, bloco da marca).

O que fecha o caso é que **o próprio arquivo já sabe**. `page.tsx:216`, num
comentário sobre outra coisa: *"e o emerald/blue nem é do tema (o design system
tem acc/acc2/ink)"*. O diagnóstico foi feito, aplicado num lugar, e não virou
regra. É a mesma assinatura do clone de botão de ontem: comentário não é trava.

Conserto: sucesso usa `acc2`; `emerald` sai. 40 ocorrências de cor crua
(`amber`/`emerald`/`red`) no arquivo — vermelho e âmbar têm defesa (erro e aviso
não têm token na marca mono-verde), verde não tem.

### 2. Press escrito à mão, 61 vezes (catálogo #17)

`active:scale-[0.97]` × 55 e `active:scale-[0.98]` × 6, em `page.tsx`.
`src/lib/motion.ts:70` exporta `pressable` com `scale: 0.985` e a transição de
press própria — e **nenhum import de `@/lib/motion` existe em `page.tsx`**.

Ontem eram quatro escalas; hoje são duas. O caminho está certo e parou no meio: a
consolidação foi feita por busca e substituição, não trocando o dono. Enquanto o
valor for literal, o próximo botão nasce com um terceiro número.

Conserto, no molde do `transition-ui` que esta mesma tela já ganhou: `@utility
press` no `globals.css`, espelhando `DUR.press` e o `0.985` do SSoT. Uma linha de
CSS mata 61 literais e fecha a porta.

### 3. O erro é o menor texto do rodapé (hierarquia invertida)

`page.tsx:4257-4261` — o banner que diz **por que o entregável falhou** é
`text-[10px]`, dentro de um rodapé onde o botão é `text-xs font-semibold` (12px) e
o passo atual é maior ainda.

E `.map(l => l.detail).join(", ")`: com render multi-face, dois erros viram uma
frase corrida separada por vírgula, sem quebra e sem qual face falhou.

Conserto: `text-xs` no banner, e uma linha por erro em vez de `join`.

---

## Slop mantido de propósito

| Catálogo | Onde | Por que fica |
|---|---|---|
| #3 spinner no lugar de skeleton | 13 `animate-spin` em `page.tsx` | 11 são indicador **dentro** de botão ou ícone de refresh, que é o uso certo e não colapsa layout. Os dois de área cheia (`:4575`, `:4981`) estão em diálogo, não no grid. Não deduzo sem medir salto de layout — vira proposta, não achado. |
| #2 dinheiro em `font-mono` | 8 usos | Todos em dimensão, caminho de arquivo e log — serial e código, que é exatamente o que o catálogo manda deixar em mono. |
| cor crua vermelha e âmbar | 29 usos | Erro e aviso não têm token numa paleta mono-verde. Inventar `--color-erro` sem o dono da marca decidir é pior. |

---

## Interrogatório — bloco fixo

**F1 O quanto estamos reinventando a roda?**
Melhorou hoje: 17 tratamentos de erro à mão viraram um `readError`. Continua
reinventado: o **press** (item 2 acima) e o `Skeleton`, que não existe em
`src/components/ui/` — todo estado de carregando do app é spinner ou nada, por
falta de primitivo. `Skeleton` é o item mais óbvio para `npx shadcn@latest add`.
OBRIGA: `@utility press` no `globals.css`; `Skeleton` só com o seu ok (é
componente novo de design system).

**F2 Design system consistente?**
`audit:design` zero. Mas duas famílias de cinza (`neutral-*` no `page.tsx`,
`zinc-*` no `IconSegmented.tsx` — decisão registrada na memória
`ui-primitives-and-audit` e ainda pendente), dois verdes (item 1) e dois valores
de press (item 2). Nenhum dos três é detectável: são todos "cor válida do
Tailwind" e "número válido".
OBRIGA: os três viram token ou utility. O cinza é decisão sua.

**F3 Responsivo e otimizado?**
`visual:home` 12/12 em 1920px **e** 390px, sem rolagem horizontal em nenhum dos
dois. `visual:drawer` mede o painel na largura mínima e nada estoura. `priority`
já saiu da imagem de prévia. Telefone segue fora de escopo por decisão sua.
OBRIGA: nada.

**F4 Fluxo progressivo para o ICP?**
O caminho está bom: grid → drawer → arte → prévia automática no hover-apply →
enquadramento → primário único → download. O buraco que sobra é o **contrato de
tempo**: o render final leva de 20 a 60 segundos e nada diz isso *antes* do
clique. O contador (`page.tsx:3898`) só aparece depois que a espera começou.
OBRIGA: o primário anuncia a ordem de grandeza antes de ser clicado.

**F5 O que esconder, compactar ou virar ícone?**
A rodada de ontem devolveu ~170px e a densidade atual se defende: o `visual:home`
mede 188px de cromo até o primeiro card, contra um teto de 260px. Não encontrei
gordura nova que valha o risco.
OBRIGA: nada.

**F6 O que falta para o nível Vale do Silício?**

| # | Item | Ontem | Hoje |
|---|---|---|---|
| 1 | Teclado alcança toda ação | falta | **feito** (`visual:drawer` navega por Tab) |
| 2 | `focus-visible` em tudo | falta | **feito** (anel presente, medido) |
| 3 | Zero salto de layout | feito | feito |
| 4 | Otimista com desfazer | n/a | n/a |
| 5 | Erro/vazio/carregando distintos | quase | **feito** — os 3 caminhos de falha do render avisam, e agora avisam **o motivo certo** |
| 6 | Nada mente | **falta** | **feito no que foi medido** — era aqui que morava o `SyntaxError` |
| 7 | Latência percebida tratada | feito | quase (F4: falta o contrato de tempo) |
| 8 | Movimento do SSoT, <300ms, reduced-motion | parcial | quase — `prefers-reduced-motion` está tratado em `globals.css:88`, mas o press não vem do SSoT (item 2) |
| 9 | Densidade defensável | falta | **feito** (188px medidos) |
| 10 | Um primário por superfície | **falta** | **feito** (portão conta, 1) |
| 11 | Default defendido, regra visível | quase | quase — o `reason` do enquadramento segue no `title` |
| 12 | Volta na mesma posição | feito | feito |
| 13 | Copy na voz da casa | falta | **feito** (portão de copy em zero) |

**9 de 13 fechados.** O que falta é: o contrato de tempo (7), o press do SSoT (8),
a regra do enquadramento fora do `title` (11) — e o item que não está na lista
porque não é de tela.

**Q28 (T3) Qual decisão desta auditoria eu vou lamentar em três meses?**
A mesma de ontem, e agora com placar: **deixar o drawer dentro do `page.tsx`.**
Ontem eram 4.920 linhas e a Onda 4 mandava extrair. Hoje são **5.057** — cresceu
137 linhas na direção contrária, e o defeito de hoje é a fatura: o `res.json()`
seco estava na linha 2.229 de um arquivo que ninguém lê inteiro, e o mesmo shape
existia em mais 12 lugares do mesmo arquivo porque não havia onde um `readError`
morar. Um arquivo desse tamanho não produz bug exótico; produz **o mesmo bug
treze vezes**.

---

## Aplicado depois do relatório (mesma sessão, com o seu ok)

| # | O que | Prova |
|---|---|---|
| 3 | **Um verde só.** 26 `emerald-*` viraram `acc2` em `page.tsx`, `IngestDialog`, `FolderPicker` e `Switch` | `audit:design` 0 · `visual:drawer` mede contraste |
| 4 | **`@utility press`** no `globals.css`, espelhando o `pressable` do SSoT. 61 literais no `page.tsx` + 12 no `IngestDialog` + os 2 primitivos | `grep active:scale-` = 0 no `page.tsx` |
| 5 | **Banner de erro** de 10px → `text-xs`, e `.join(", ")` → uma linha por erro | `check:render-failure C` |
| 6 | **Contrato de tempo** antes do clique, e ele vira medida real depois do primeiro render | `check:render-failure B/C` |
| — | **Um cinza só.** 55 `zinc-*` → `neutral-*` em TODO o `components/ui/` | `tsc`, 400 testes |
| — | **`Skeleton`** oficial do shadcn, aplicado nas duas listas que colapsavam | `tsc`, lint |
| 1 | **Folhas do drawer extraídas** (ver medição abaixo) | `visual:drawer` 7/7, captura aberta |
| — | **Medida da superfície no cabeçalho de "Sua arte"** (pedido seu, no meio da rodada) | captura: `Arte: BC Bottom · 2317×1500` |

### A extração: a medição derrubou o plano aprovado

`MockupDrawer.tsx` com "props explícitas" foi **medido antes de ser escrito**: o
bloco usa **80 bindings** do componente pai (~65 depois de tirar locais de `map`).
Um componente de 65 props não reduz acoplamento — ele mantém o mesmo acoplamento,
agora atravessando uma fronteira de arquivo, e faz toda mudança futura tocar dois
arquivos em vez de um. Foi por isso que não fiz o corte aprovado.

O que foi feito é o corte que **de fato** desacopla, escolhido por razão
props/linhas:

| Componente | Linhas | Props | Estado que saiu da página |
|---|---|---|---|
| `components/mockup/SmartObjectList.tsx` | 115 | 8 | — (mas o `useEffect` de sincronia virou handler) |
| `components/mockup/PsdDetails.tsx` | 83 | 5 | `showAdjustments` |
| `components/mockup/types.ts` | 52 | — | `Face`, `PsdInfo`, `ArtSlot`, `SmartObjectInfo`, `AdjustmentInfo` |

`page.tsx`: **5.057 → 4.984 linhas**, e o número enganaria se ficasse sozinho — o
saldo é −135 de JSX movido +60 de recurso novo (Skeleton, contrato de tempo,
banner). Saíram junto dois estados mortos (`showAdjustments`, `expandSoList`) e um
`useEffect` que observava o próprio estado.

O rodapé (o próximo corte) precisa de 14 props. É o que sobra do plano original,
e é bem menor que 65.

### O portão pegou uma regressão minha, e essa é a história da rodada

A primeira versão do contrato de tempo tinha `!rendering` na condição: a linha
**sumia quando o render começava** e empurrava o botão primário ~14px no instante
do clique. `check:render-failure B` e `C` passaram a reportar *"o botão nunca
ficou clicável"* — salto de layout embaixo da ação que entrega o arquivo, num
pilar (F6 nº 3) que o relatório tinha acabado de marcar como feito. A linha agora
ocupa o slot sempre, com altura fixa e texto para os três estados.

Um portão que só roda quando tudo está verde não teria pego: os dois casos foram
rodados porque a regra é rodar todos depois de cada mexida, não só os do que se
tocou.

### Dois achados de portão no caminho

O alvo cresceu (o `components/ui/` inteiro entrou), e com ele dois vícios de copy
pré-existentes: travessão em `ui/Slider.tsx:47` e ponto-e-vírgula em
`ingest/IngestDialog.tsx:845`. Os dois estavam em `title=`, que chega no olho do
usuário. Confirmados na linha e consertados — portão é portão.

### ⚠️ Outra sessão está trabalhando neste repo

Detectado no meio da rodada: `HEAD` andou de `5b87e08` para `5cde8ae` e 20
arquivos que eu não toquei apareceram modificados — `photo-tools/*`,
`calibrate/page.tsx`, `photo-mockup/page.tsx`, um `check:render-ab` novo no
`package.json`, um `scripts/contrast-guard.ts`. O trabalho é limpeza de copy
(travessão) e portões de render.

Por isso **`photo-tools/` e `photo-mockup/` ficaram de fora** da conversão de
cinza, mesmo sendo onde mora a maior parte dos 611 `zinc-*` restantes. Converter
611 linhas num arquivo que outro processo está editando é como se perde trabalho.

## Decisões pendentes (suas, não minhas)

**1. O rodapé como próximo corte** (14 props, medido). Depois dele o que sobra em
`page.tsx` é grid + diálogos, e aí `MockupDrawer` volta a fazer sentido — com
props que cabem numa assinatura.

**2. Os 611 `zinc-*` de `photo-tools/` e `photo-mockup/`.** Ficaram de fora pela
colisão com a outra sessão. É mecânico (a escala é 1:1) e vale uma passada quando
aquela frente parar.

**3. `IngestDialog` grita.** 20 rótulos em `uppercase tracking-widest font-black`,
que é o mesmo vício (catálogo #13) que o drawer já expurgou. Não toquei porque não
estava na lista que você aprovou.

---

### Resolvido nesta sessão (era decisão pendente)

- **`Skeleton`**: instalado do registry oficial, **sem `shadcn init`**. O repo não
  tem `components.json`, e o `init` reescreve o `globals.css` — onde moram o
  `@theme` da marca e as utilities `transition-ui`, `press` e `no-scrollbar`. O
  item foi buscado em `ui.shadcn.com/r/.../skeleton.json` e transcrito com uma
  adaptação declarada: `bg-accent` não existe aqui, e `accent` seria o verde de
  AÇÃO — esqueleto verde-limão convidaria o clique.
- **Cinza**: `neutral`, e a conversão foi maior que o previsto — não era só o
  `IconSegmented`: `Dialog`, `Popover`, `Segmented`, `Select`, `Slider`, `Tooltip`
  e `IconButton` também estavam em `zinc`. 55 ocorrências, todo o `components/ui/`.

---

## Proposta de gosto (você escolhe linha por linha)

| Onde | Antes | Depois |
|---|---|---|
| `page.tsx:4285-4287` | verde `emerald` no passo concluído | verde `acc2` da marca |
| `page.tsx:4257` | banner de erro em `text-[10px]`, erros unidos por vírgula | `text-xs`, uma linha por erro |
| rodapé | `Gerar PNG · 2/2` | `Gerar PNG · 2/2` com a ordem de grandeza do tempo ao lado |
| 61 literais | `active:scale-[0.97]` | `press` (utility espelhando `DUR.press` e `0.985`) |

---

## Não verificado

- **Render-server realmente derrubado.** As falhas continuam injetadas na
  resposta (o `curl localhost:4200` mente: ele fala TCP puro). O que mudou hoje é
  que o caminho `res.ok === false` **deixou de ser hipótese**: foi exercitado com
  respostas reais da rota (404, 413) e estava quebrado. A lição vale registrar —
  ontem esse caminho estava listado como "não exercitado", e não exercitado era,
  de fato, defeituoso.
- **O teto de corpo foi levantado, não removido.** 64 MB. Uma arte de 8000×8000
  em duas faces ainda passa disso. A falha agora é honesta (413 com motivo), mas
  não existe aviso *antes* do clique, e não medi qual é a maior arte real do
  acervo.
- **Salto de layout dos dois spinners de área cheia** (`:4575`, `:4981`). Não
  medido, por isso não virou achado.
- **`prefers-reduced-motion` na tela.** A regra existe em `globals.css:88` e
  cobre `animation` e `transition` globalmente; não abri o app com o sistema
  pedindo menos movimento para confirmar o que o Lottie faz.
- **Onda 4.** O drawer segue dentro das 5.057 linhas, e "um primário por rodapé"
  continua travado por portão visual, não por teste de árvore.
