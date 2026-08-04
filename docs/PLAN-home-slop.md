# Home (grid do acervo) — tirar a cara de IA

Classe da superfície: **B — trabalho** (`visant-frontend`). Variável:
**throughput × qualidade da decisão**. A decisão desta tela é *qual mockup*.
Tudo que não ajuda a escolher um mockup é chrome, e chrome custa atenção.

**Estado: fechado.** Tier 1 e Tier 2 aplicados, todos os portões verdes.

---

## O portão determinístico não achou nada — e essa é a notícia

`npx impeccable detect src/app src/components` → **33 achados, ZERO reais.**
Triagem completa, porque alguém vai rodar de novo e perder o mesmo tempo:

| Achado | Nº | Veredito |
|---|---|---|
| `gray-on-color` | 25 | **falso positivo.** O detector pareia `bg-cyan-600 text-white` com `text-zinc-400` na mesma string de className — são ramos **mutuamente exclusivos** de um ternário. O cinza nunca está sobre o colorido. |
| `broken-image` | 7 | **falso positivo.** `<img>` com `src` dinâmico (canvas, preview, render), não placeholder. |
| `layout-transition` | 1 | **falso positivo.** `CropFrame:178` é `transition: outline-width` — o regex casou `width` dentro de `outline-width`, e outline é desenhado FORA da caixa: não causa reflow. |

O impeccable não mede o defeito desta tela. Ele cataloga tells de estilo; o
problema aqui era **hierarquia**, e "tudo grita" não é um anti-padrão que dê para
casar com regex.

**Todo defeito real foi achado rodando ou olhando.** Daí os dois portões novos
abaixo.

## O que estava errado

### 1. Tudo grita, então nada grita — *(espinha 2, 3)*

| Classe | Antes | Depois |
|---|---|---|
| `uppercase` | **70** | **3** |
| `font-black` | **69** | **1** (só o wordmark, que é logo e pode gritar) |
| `tracking-widest` | **53** | **0** |

O rótulo "TAXONOMIA", o eyebrow "ORDEM", o estúdio no rodapé do card e o botão
"APLICAR" tinham o mesmo tratamento tipográfico. O nome do mockup — o único dado
que decide o clique — era `text-[11px] font-bold text-neutral-300`: mais fraco
que os chips de tag da sidebar. Frases inteiras em caixa alta com
`tracking-widest` ("TENTE REDEFINIR SEUS FILTROS OU BUSCAR OUTRO TERMO") não se
leem, se decifram.

### 2. A interface se anunciava como inteligente — *(memória `no-ia-naming`)*

Bolinha `bg-emerald-500 animate-pulse` que pulsava para sempre sem reportar
estado; `MATCHES INTELIGENTES PARA …`; botão trocando para `Analisando` (terceira
cópia do mesmo estado, junto com o ícone girando e o `disabled`);
`aprende com o que você abre`. Tudo isso nomeia a máquina. Virou
**"Sugeridos para «marca»"**, com o peso no nome da marca.

### 3. Piso de contraste — defeito, não estilo

`text-neutral-600` sobre o fundo do app dá **2.53:1**; a contagem das tags em
`text-neutral-800` sobre `bg-neutral-900` dava **1.3:1** — o número existia no DOM
e não na tela. Neste dark, **600/700/800 são cor de borda, não de texto**; o piso
de texto é `neutral-500`.

### 4. Badge que 100% das linhas carrega não distingue nada

Pílula saturada `PSD`/`PHOTO` (emerald/blue, fora do tema — existe `acc`/`acc2`)
em todos os 51 cards, e linha de estúdio em `uppercase tracking-widest` em todos.
Pior: sem estúdio, o card **escrevia `"General"`** — a UI inventando um dado que o
banco não tem *(espinha 9)*.

### 5. Ausência renderizada como buraco — *(espinha 10)*

Card sem prévia era um ícone cinza no meio de um retângulo, indistinguível de
"carregando". Agora se nomeia: **"Sem prévia"** — é o registro que precisa de ação.

### 6. Taxonomia anunciava capacidade e o chevron mentia

6+ dimensões × 10 chips = 60+ controles permanentes ocupando a rolagem inteira da
sidebar, **com o chevron dizendo "recolhido"**. `minimalist 1493` de um acervo de
4.483 não é filtro, é decoração com número. Agora recolhido mostra só as tags
**ativas** daquela dimensão (quase sempre nenhuma) e o cabeçalho ganha um badge
com quantas estão ligadas. A sidebar virou uma lista de 12 nomes escaneável.

### 7. A 390px a sidebar era ilegível — e o portão aprovava

O painel é `defaultSize="20%"` / `minSize="15%"`: a 390px isso vira uma coluna de
~60-78px onde "Logo construction" mostra "Logo construc" e os dois selects viram
"S." e "T.". O badge de contagem ficava **por cima** do campo de busca.

**Nada disso reprovava.** A raiz é `overflow-hidden`, então o conteúdo cortado
dentro do painel não faz o documento rolar — `scrollWidth === clientWidth`, portão
verde, tela quebrada. É a armadilha registrada em `visual-gate-overflow-trap`,
paga de novo: medir o documento passa sempre; quem acusa é **medir o elemento
contra a caixa dele, e olhar a captura**.

Conserto: abaixo de `lg` a sidebar recolhe sozinha (o botão do header continua
abrindo) e o badge de contagem some — contagem é contexto, buscar é a ação de todo
dia. E o portão ganhou a checagem `scrollWidth > clientWidth` por elemento, que
teria pego isto sem ninguém olhar.

### 8. `1:1 / Retrato / Paisagem` não parecia clicável

Sem caixa quando desligadas, as três opções liam como três palavras soltas.
**Só a captura mostra isso** — no código elas são `<button>` e parecem certas.
Um trilho comum (`bg-neutral-900/60` com `p-0.5`) diz "isto é um controle" sem
dar peso a nenhuma opção.

---

## Defeitos funcionais achados ao rodar

### `<button>` dentro de `<button>` → hydration failure

A linha "Esconder duplicados" era um `<button>` envolvendo o `<Switch>` do Radix,
que renderiza `<button role="switch">`. HTML inválido, e o custo não era teórico:

```
Hydration failed because the server rendered HTML didn't match the client.
As a result this tree will be regenerated on the client.
```

O React **descartava o HTML do servidor e regenerava a árvore inteira** a cada
carregamento da home. Era o badge "3 Issues" do overlay do Next, visível na
captura e em nenhum outro lugar. Consertado com `<label htmlFor>` + `id` no
`Switch` — a linha inteira continua clicável, de graça, pelo navegador.

É a MESMA classe que o comentário em `page.tsx:125` diz ter consertado no card
("botão não pode conter conteúdo interativo"). Voltou pela sidebar.

### `[object Event]` — 12 sites

`img.onerror = rej` / `fr.onerror = rej` passa o **Event do DOM** direto ao
`reject()`. O overlay do Next e o `toast.error` imprimem `String(event)` →
literalmente `[object Event]`: o erro acontece, interrompe o fluxo, e não diz o
quê, onde, nem com qual URL.

`tsc` aceita (`rej` é `(reason?: any) => void`), ESLint aceita, e nenhum teste
exercita o caminho de falha de uma imagem. É um **padrão**, não um valor.

- [x] 12 sites rejeitam com `new Error("… ${url}")`
- [x] guarda em `src/lib/__tests__/reject-with-error.test.ts`, **provada nos dois
      sentidos** (reverti um site → apontou `mask-compose.ts:18`)
- [ ] **qual dos 12 disparou continua desconhecido.** O `console-check` acusa 0
      erros na home, então não é do carregamento — é de uma ação (upload/render).
      Na próxima vez o erro diz o próprio nome.

### Regressão revelada, não criada

Tirar o `uppercase` dos cabeçalhos de dimensão expôs que `DIM_LABELS` só cobre
parte das chaves: a coluna mostrava "aesthetic", "angle", "Material", "texture".
Com CAIXA ALTA os dois casos pareciam iguais. Conserto na fonte (`dimLabel()`
normaliza `_` e capitaliza), não repondo a maquiagem.

---

## Os dois portões novos

Os defeitos acima são invisíveis para `tsc`, ESLint e vitest. Agora têm dono:

### `npm run visual:home -- --url http://localhost:3000`

`scripts/home-visual-check.ts` — puppeteer, mede a home a 1920px e 390px:

1. **grid com dados reais** (empty-state esconde todo estouro — já aconteceu aqui)
2. estouro horizontal do documento
3. nada cortado pela borda do header (a raiz é `overflow-hidden`: o elemento não
   faz rolar, ele só some)
4. **nenhum texto cortado DENTRO de um painel** — `scrollWidth > clientWidth` por
   elemento. É o único que pega a sidebar espremida; os três acima aprovavam ela.
   Ignora quem tem `text-overflow: ellipsis` (truncar é decisão de design) e
   caixas com menos de 24px (painel recolhido, não conteúdo espremido).
5. **orçamento de cromo** — px até o primeiro card, teto 260 (hoje: **140px**)
6. **piso de contraste 3:1** em todo texto visível

> ⚠️ **A armadilha do oklch.** A primeira versão reprovava a página inteira com
> `1.00:1`. Tailwind v4 emite `oklch()` e `getComputedStyle` **devolve** `oklch()`;
> um parser de "pegue os números da string" lê `oklch(0.922 0 0)` como
> `r=0.922,g=0,b=0`. A versão atual **pinta a cor num canvas 1×1 e lê o pixel** —
> funciona para qualquer sintaxe que o navegador entenda, hoje e no próximo espaço
> de cor. E o fundo é o **efetivo**: sobe a árvore compondo camadas, porque o
> `backgroundColor` do próprio nó é quase sempre `rgba(0,0,0,0)`.
>
> ⚠️ **`__name is not defined`.** `tsx`/esbuild roda com `keepNames` e embrulha
> arrows nomeados num helper que não existe no contexto da página. Código de
> `page.evaluate` com `const f = () => …` morre. Passe como **string**.

### `npm run visual:console -- --url http://localhost:3000`

`scripts/console-check.ts` — `console.error`, `pageerror`, `unhandledrejection`
e HTTP ≥ 400. Foi ele que nomeou o hydration failure.

---

## Placar final

| Portão | Estado |
|---|---|
| `npx tsc --noEmit` | limpo |
| `npm run test` | 25 arquivos, **245** testes |
| `npm run lint` | 0 erros (355 warnings, política do repo) |
| `npm run build` | compilado |
| `npm run ui:audit` | 9/9 dentro do teto |
| `npx impeccable detect` | 33 achados, **0 reais** (triagem acima) |
| `npm run visual:home` | **12/12** em 1920px e 390px |
| `npm run visual:console` | **0 erros, 0 avisos, 0 falhas de rede** |
| olhar a captura | feito — 2 defeitos vieram só daí |

## Aberto de propósito

Três, todos declarados — nenhum é "achei que estava ok":

- **Causa-raiz do `[object Event]`.** Os 12 sites agora nomeiam o próprio erro e
  o `console-check` acusa 0 na home, então não é do carregamento: é de uma ação
  (upload / render / publish). Precisa da repro para fechar.
- **Os diálogos** (ingest, ocultos, settings, logs) receberam a desescalada
  tipográfica junto, mas o `visual:home` **só abre a home** — não foram medidos.
  O `visual:ingest` cobre um deles. Um `visual:dialogs` é o próximo portão.
- **`page.tsx` tem 3833 linhas** com `MockupCard` dentro. Fora do escopo deste
  trabalho; plano em `docs/REFACTOR_PAGE_HOOKS.md`.

## A lição que este trabalho pagou

Os portões estáticos estavam **todos verdes** enquanto a home (a) descartava o
HTML do servidor a cada load por HTML inválido, (b) tinha texto a 1.3:1 e (c)
ficava ilegível a 390px. O `impeccable` deu 33 achados e nenhum era real.

Nada disso é culpa dos portões — é o limite deles. `tsc` tipa valores, não
hierarquia; ESLint lê sintaxe, não contraste; vitest exercita funções, não
telas. **Rodar e olhar** achou o que os cinco portões não acharam, e as duas
coisas viraram script para não depender de alguém lembrar.
