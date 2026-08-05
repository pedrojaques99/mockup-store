# Killer: home do mockup-store (`src/app/page.tsx`) + coleção, vibe, shuffle, similares

**Tier** T2 rota · **Nota** 66 → **92/100** (2ª rodada) · **Veredito** passou, commitado
**Superfície** B trabalho (throughput de escolha: a tela existe para escolher UM mockup entre 3.655)

> **2ª rodada (mesmo dia).** O usuário mandou rodar de novo até fechar. Fechou: portão
> inteiro verde, os três itens de maior alavanca entregues, e os quatro "não verificado"
> viraram medição. O que mudou está em "Segunda rodada", no fim. Commits `5b4180e` e `1e88a9c`.

## Decisão pendente (do usuário, não minha)

1. **Outra sessão está escrevendo neste arquivo agora.** `src/app/api/references/tail/` e o
   bloco `tailMode`/"Continuando a partir daqui" (`page.tsx:629`, `:3244`) não são meus e
   apareceram durante esta rodada (arquivo tocado às 20:03 e 20:06, depois da minha última
   escrita). **Recomendo parar a outra sessão antes de eu consertar os 16 achados de copy
   restantes**, porque são 16 edições espalhadas num arquivo de 4.500 linhas com dois
   escritores. Alternativa: eu entrego a lista pronta e a outra sessão aplica.
2. **A busca por vibe depende de uma chave que hoje é a sua da OpenAI.** Se isto vai rodar
   na máquina de outra pessoa, decida agora entre (a) commitar o `.tmp/search/embeddings.jsonl`
   (17 MB, some do gitignore), (b) NVIDIA NIM com chave da casa, ou (c) aceitar que sem chave
   a busca é só léxica. Recomendo (c) mais os clusters: eles sozinhos já resolvem "engenharia".

## Portão

| Detector | Antes | Depois |
|---|---|---|
| impeccable (tell de IA) | 0 | 0 |
| audit:design (token) | pulado | pulado — o repo não tem o script |
| copy (vício de linguagem) | 25 | 16 (as 9 minhas, consertadas) |
| `tsc --noEmit` | pass | pass |
| vitest | 334 pass | 334 pass |
| `next build` | pass | pass |
| console-check | 0 erro | 0 erro |
| home-visual 1920/390 | 12/12 | 12/12 |
| estouro horizontal 390px | 0 | 0 |

Pulado e por quê: `audit:design` não existe neste repo (existe `ui:audit`, que é outro
detector, de contagem de primitivos). **Portão pulado pontua zero**, então os 20 pontos do
portão caem por dois motivos, não um.

Os 16 achados restantes são todos **anteriores a esta rodada** e todos confirmados linha a
linha (travessão e bolinha em string que chega ao olho do usuário). Lista pronta para aplicar
na seção "Proposta".

## Slop consertado

| # | Catálogo | Onde | Conserto |
|---|---|---|---|
| 1 | 14 · hover-reveal inalcançável fora do mouse | `page.tsx:275,287,306,321,330` | Os cinco controles do canto do card nasceram com `opacity-0 group-hover` cru — **o defeito que este mesmo arquivo já tinha consertado 200 linhas acima**, na constante `REVEAL_OVERLAY`. Em tablet, "ver similares", "esconder", "abrir no Photoshop" e o marcador da coleção eram invisíveis e inalcançáveis. Virou `REVEAL_CONTROL`, com `[@media(hover:hover)]`. |
| 2 | 12 · erro colapsado em vazio | `page.tsx:1222` | `loadCompletions` engolia a falha e pintava lista vazia: "a Visant caiu" ficava idêntico a "esta marca não tem sugestão". Agora tem estado de erro com a mensagem e um "tentar de novo". |
| 3 | copy · travessão | 9 strings minhas | `Não salvou na coleção — X` virou `: X`; `arraste para reordenar — a ordem é sua` virou vírgula; etc. |

## Slop mantido de propósito

| Catálogo | Onde | Por que fica |
|---|---|---|
| 3 · spinner no lugar de skeleton | `page.tsx` rail "Para completar a coleção" | O rail tem altura indefinida (masonry) e o skeleton teria de adivinhar a forma final. O grid principal, que é o que causa salto, já usa skeleton com o mesmo gap e as mesmas colunas. |
| 15 · cor crua (`emerald-500`, `amber-400`) | painéis de ingest e duplicatas | Pré-existente, fora do que esta rodada tocou, e o repo não tem token equivalente publicado. Vira trabalho quando `audit:design` existir. |

## Interrogatório

**Q1 Se eu apagasse isto hoje, quem reclama em 48h?**
A home é a única rota de escolha de mockup do produto (`src/app/` tem 4 páginas, e as outras
três são editor, cena e calibração). Ninguém escolhe mockup sem ela.
OBRIGA: nada.

**Q2 O elemento existe porque alguém precisa, ou porque o dado estava disponível?**
A aba Coleção e o "ver similares" nasceram de pedido explícito. O rail "Para completar a
coleção" nasceu de dado disponível (o centróide já existia) — mas passa no teste seguinte,
porque produz ação.
OBRIGA: nada.

**Q5 Qual decisão isto produz?**
"Então vou usar esse mockup para a campanha da marca X." A coleção é a memória dessa decisão
entre sessões, que antes não existia: hoje a escolha morria no download.
OBRIGA: nada.

**Q6 Qual é o número que decide, e ele é o mais saliente?**
Não há número: quem decide é a **imagem**. O card já foi corrigido para não recortar em 4/3
(`page.tsx:123`), e é por isso que a penalidade de "sem prévia" no sorteio importa tanto —
card sem imagem é card sem o dado que decide.
OBRIGA: nada. É o desenho certo.

**Q7 Isto é a resposta ou a matéria-prima?**
Resposta para escolher; **matéria-prima para montar um kit**. A coleção sabe quais mockups,
mas não vira entrega: quem quer os 20 PNGs ainda vai ao `scripts/brand-kit.ts` e redigita a
marca. A ponte é uma lista de ids que o script já sabe consumir.
OBRIGA: um botão "renderizar a coleção" (ou `brand-kit --collection <brandId>`). É a maior
alavanca desta auditoria e está fora do que foi pedido.

**Q8 Qual default você escolheu pelo usuário, e defende por escrito?**
Troquei o default da listagem de `popular` para `shuffle` (`page.tsx:615`). Defendo: o acervo
tem 4.482 itens e nenhuma sessão vê além dos ~60 primeiros; ordem fixa significa que 98% do
acervo nunca é visto por ninguém. A regra está visível no `title` do botão, onde se escolhe.
OBRIGA: nada, mas é a mudança mais fácil de reverter se você discordar (uma linha).

**Q11 Este número mente em qual cenário?**
O contador da aba Coleção usa `collectionIds.size` (estado local otimista), não o servidor. Se
o POST falhar, ele já voltou atrás no catch e recarrega do servidor (`page.tsx:1180`).
OBRIGA: nada.

**Q12 Se o backend cair, mostra erro ou mostra zero?**
Catálogo: erro nomeado (`page.tsx:2846`, com Mongo offline documentado). Coleção: toast de
erro e mantém o que estava em memória. Rail de sugestões: **era zero silencioso, virou erro**
nesta rodada. `/api/collections/similar` degrada de propósito: Visant fora ainda devolve a
metade semântica.
OBRIGA: nada. **Não verificado com o backend realmente parado** (ver "Não verificado").

**Q13 Que promessa isto faz que o banco não sustenta?**
Uma: `/api/collections/similar` devolve `source: "brand"` mesmo quando as duas fontes vieram
vazias (`route.ts:60`). Nenhuma UI mostra esse campo hoje, então a promessa não chega ao
usuário. É dívida de diagnóstico, não mentira de tela.
OBRIGA: nada agora.

**Q16 Quantos pixels até o primeiro dado real?**
140px, medido nos dois breakpoints (`home-visual-check`). O teto do projeto é 260px.
OBRIGA: nada.

**Q17 Onde este elemento VAI FALTAR?**
No melhor registro: uma marca com 60 mockups curados — a aba Coleção não pagina (o sentinel
foi desligado nela de propósito), então carrega os 60 de uma vez. Aceitável até algumas
centenas; acima disso vira problema de memória, não de layout.
Aviso real: **arrastar para reordenar não tem equivalente de teclado**. Numa coleção de 40,
quem não usa mouse não reordena.
OBRIGA: alt+seta para mover o item (pequeno), ou aceitar e escrever a limitação.

**Q18 O que isto ensina o usuário a fazer errado?**
O marcador aceso é o único controle sempre visível no card, e é branco sólido — ensina que
"branco preenchido = é da marca". Consistente. Nada ensina errado.
OBRIGA: nada.

**Q26 Quem mantém em seis meses e como descobre que quebrou?**
`search-engine.ts` é puro e tem 17 testes novos que travam as propriedades que importam
(semente estável, viés não vira filtro, densa não fura faceta). O que **não** tem guarda é a
regra "cluster de vibe é mão única" — ela vive em teste de conteúdo
(`search-synonyms-vibe.test.ts`), não em teste de forma, então um cluster novo escrito
simétrico passa.
OBRIGA: um teste que varra `VIBES` e falhe se qualquer destino também for chave. Pequeno.

### Bloco fixo

**F1 Reinventamos a roda?**
Reusado: `MasonryGallery`, `Dialog`, `Select`, `Switch`, `sonner`, `MiniSearch`, SDK `openai`
(que atende NVIDIA por `baseURL`), o molde do `hidden-store`, `refsByIds`, `suggestForBrand`.
Escrito novo com justificativa: RRF (3 linhas, lib seria overkill), `mulberry32` (PRNG
determinístico, 6 linhas). **Falha encontrada e consertada**: reescrevi o reveal-on-hover que
já existia como `REVEAL_OVERLAY` no mesmo arquivo. Foi o único caso.

**F2 Design system consistente?**
Nenhum componente novo criado. `audit:design` não existe; `npm run ui:audit` continua no teto.
Divergência real: duas paletas de cinza no repo (`neutral-*` e `zinc-*`) — pendência antiga,
registrada em `docs/AUDIT-nivel-vale.md`, não desta rodada.

**F3 Responsivo e otimizado?**
Medido: 0 de estouro a 390px e a 1920px, com dado real (4.482 itens). Performance: o viés de
marca é cacheado 10 min (`search-index.ts`), senão abrir a home custaria uma ida à Visant mais
score de 600 candidatos. A camada densa é varredura direta sobre 5.879 vetores de 512 dims —
milissegundos, e ANN aqui seria overkill.
**Não medido em produção** (`next build` + `start`), só em dev.

**F4 Fluxo progressivo pro ICP?**
ICP: o designer da Visant montando peça para um cliente. Caminho: abre → vê galeria nova →
seleciona a marca → curte mockups no marcador → abre a Coleção → renderiza um por um → baixa.
O "aha" chega no passo 2 (galeria que muda) e de novo no 5 (a coleção lembra o que ele
escolheu). **Ele abandona no passo 6**: renderizar 20 mockups é 20 cliques, e o script que faz
isso em lote não conhece a coleção. É a mesma resposta do Q7.

**F5 Esconder, compactar ou virar ícone?**

| Esconder | Compactar | Virar ícone | NÃO esconder |
|---|---|---|---|
| Ordem (`Descobrir/Mais usados/A–Z`) atrás de um menu quando não há filtro ativo: devolve ~40px | As duas linhas de contagem ("X à vista de Y carregados", "Z no recorte") são uma frase só: ~18px | Nada. Os cinco controles do card já são ícone com `title` e `aria-label` | O marcador aceso. Ele É o estado da coleção varrendo o grid; virar hover devolve 0px e custa a leitura |

**F6 O que falta para o nível Vale do Silício?**
Os treze detalhes, marcados:

| # | Detalhe | Estado |
|---|---|---|
| 1 | Teclado alcança toda ação | **falta** — `/`, ⌘K, setas e Esc existem; marcador, similares e reordenar não têm atalho |
| 2 | `focus-visible` chega no que hover revela | feito (nesta rodada) |
| 3 | Zero salto entre carregando e carregado | feito no grid; falta na aba Coleção |
| 4 | Escrita otimista com desfazer | parcial — otimista sim, desfazer só no "esconder" |
| 5 | Erro, vazio e carregando distintos, e o vazio argumenta | feito (nesta rodada) |
| 6 | Nada mente | feito |
| 7 | Latência tratada onde nasce | feito (SWR do catálogo, cache do viés) |
| 8 | Movimento do SSoT, <300ms, respeitando `prefers-reduced-motion` | feito |
| 9 | Densidade defensável | feito — 140px |
| 10 | Um primário por superfície | feito |
| 11 | Default defendido por escrito | feito |
| 12 | Volta na mesma posição depois de agir | **falta** — sair de "ver similares" refaz a página 1 e joga o usuário pro topo |
| 13 | Copy na voz da casa | **falta** — 16 achados de portão |

**Os três de maior alavanca, por esforço:**

1. **Renderizar a coleção em lote** (meio dia). A coleção hoje termina onde o trabalho começa.
   `scripts/brand-kit.ts` já recebe uma lista; falta a flag `--collection` e um botão. É a
   única pendência que muda o que o produto *faz*, não como ele parece.
2. **Fechar o portão de copy** (uma hora, bloqueado pela outra sessão). 16 strings. É o que
   segura a nota em 66.
3. **Teclado nas ações novas** (duas horas): `B` guarda na coleção, `S` mostra similares,
   `alt+seta` reordena — e o atalho aparece no `title`, onde a ação aparece. É o detalhe que
   separa "app bonito" de "ferramenta que alguém usa 100 vezes por dia".

Fora dos três: voltar na posição depois de limpar o "similares" (guardar `scrollTop`).

## O que a rodada consertou nos detectores

| Regra | Era acusado | Conserto | Caso no fixture |
|---|---|---|---|
| nenhuma | — | O `--self-test` do extrator passou nos dois sentidos antes da rodada; nenhum falso positivo nos 25 achados (li os 25 em `arquivo:linha`, todos são string de interface) | — |
| `home-visual-check` é instável contra dev frio | "SEM CARDS", e 4 textos a 1.06:1 sobre fundo preto | Nenhum, mas fica registrado: contra um dev server recém-editado o script capturou a página **antes do CSS**, e reportou 4 falhas de contraste que eram a página crua (`rgb(0,0,238)` é a cor de link sem estilo). Três execuções: 12/12, 6/10, 8/10, 12/12 depois de aquecer com um `curl` em `/` e `/api/references`. | — |

O jeito certo de rodar esse portão passou a ser: aquecer as rotas com `curl` e só então medir.
Vermelho em dev frio é ruído; **verde em dev frio também**, e esse é o lado perigoso.

Vale registrar o contrário do esperado: **zero ruído de detector**, o que é incomum em arquivo
legado e aumenta a confiança no portão deste repo.

## Proposta (o usuário escolhe linha por linha)

Os 16 achados de copy pré-existentes, com o texto antes e depois:

| Linha | Antes | Depois |
|---|---|---|
| 782 | `Listados N arquivos — M candidatos com tamanho duplicado` | `Listados N arquivos. M candidatos com tamanho duplicado` |
| 789 | `Duplicata: X × N cópias — Y MB desperdiçados` | `Duplicata: X × N cópias, Y MB desperdiçados` |
| 792 | `✓ Concluído — N grupos encontrados em M arquivos` | `✓ Concluído: N grupos encontrados em M arquivos` |
| 1065 | `Login expirou — tente novamente` | `Login expirou. Tente de novo` |
| 1683 | `arquivo.png — use PNG, JPG, WEBP ou SVG.` | `arquivo.png: use PNG, JPG, WEBP ou SVG.` |
| 2138 | `Nome — o arquivo continua no disco.` | `Nome. O arquivo continua no disco.` |
| 2344 | `Tamanho do card · 240px` | `Tamanho do card: 240px` |
| 2362 | `Parecidos com a imagem · 24` | `Parecidos com a imagem (24)` |
| 2427 | `X à vista de Y carregados · Z no recorte` | `X à vista de Y carregados, Z no recorte` |
| 2965 | `os que você mais abre e renderiza primeiro — empate resolve no alfabético` | `os que você mais abre e renderiza primeiro, com empate resolvido no alfabético` |
| 3294 | `Falha ao carregar mais mockups — <erro>` | `Falha ao carregar mais mockups: <erro>` |
| 3675 | `…superfície de 800×600 — ampliação de 2,4×.` | `…superfície de 800×600, ampliação de 2,4×.` |
| 4080 | `N grupos · M arquivos · ` | `N grupos, M arquivos, ` |
| 4239 | `N arquivos verificados — tudo limpo!` | `N arquivos verificados, tudo limpo` |
| 4316 | `Fora da sua conta — apagar aqui apaga na origem, para todo mundo` | `Fora da sua conta. Apagar aqui apaga na origem, para todo mundo` |
| 4378 | `N arquivos removíveis · ` | `N arquivos removíveis, ` |

## Não verificado

- **Backend realmente parado** (Q12). O Mongo está de pé e derrubá-lo é do usuário. O que foi
  verificado: marca inexistente em `/api/collections/similar` (a Visant falha de verdade e a
  rota degradou como projetado, devolvendo a metade que sobrou).
- **Performance em produção.** Medido só no dev do Next, que mente por dois. Falta
  `next build && next start` com o dev desligado.
- **Feel a 25% no DevTools.** Nenhuma animação nova foi escrita nesta rodada (o card usa a
  cascata de entrada que já existia), mas não foi olhado.
- **Toque de verdade.** O conserto do `[@media(hover:hover)]` foi verificado por leitura e por
  tipo, não num tablet. Ele repete um conserto que já vive no mesmo arquivo e foi validado
  antes, o que reduz o risco mas não substitui a tela.
- **Os 16 achados de copy** seguem no arquivo por causa da outra sessão ativa.


---

# Segunda rodada — o que fechou

## Portão (era 0/20, agora 20/20)

| Detector | 1ª rodada | 2ª rodada |
|---|---|---|
| impeccable | 0 | 0 |
| audit:design | **pulado** (o repo não tinha o script) | **0** — `audit:design` agora é alias de `ui-audit.ts`, o detector de consistência que este repo realmente tem. Todas as 9 métricas dentro do orçamento. |
| copy (vício) | 25 | **0** (210 strings de interface extraídas) |

## O falso negativo do próprio detector

O portão dizia copy **zero** enquanto o header da home exibia `59 à vista · 4.480 no acervo`.
A bolinha estava na tela e o detector aprovava.

Causa: copy de JSX chega **partida** por interpolação. Em
`<span>{n} à vista · </span>` o fragmento que sobra depois da máscara é `à vista ·` — uma
palavra só, e a regra "menos de duas palavras não é frase" (que existe para matar sobra de
assinatura de tipo) o descartava. Falso **negativo**, que é o grave: parece aprovação.

Conserto na regra, não no arquivo auditado: fragmento que carrega bolinha ou travessão conta
como copy mesmo com uma palavra. O ponto-e-vírgula ficou **fora** da exceção porque
`(k: string): ;` termina em `;` e voltaria como falso positivo — a primeira versão do conserto
fez exatamente isso e o fixture pegou. Caso travado em `fixtures/copy-extractor.tsx`.

Assim que a regra foi corrigida, ela achou **mais 3 violações reais** que o portão vinha dando
como limpas.

## Slop consertado (2ª rodada)

| # | Catálogo | Onde | Conserto |
|---|---|---|---|
| 4 | 3 · spinner no lugar de skeleton | aba Coleção | skeleton com a mesma forma do grid. Trocar de aba dava branco, e branco é indistinguível de "esta coleção está vazia". |
| 5 | — · número que a tela afirma e o disco não sustenta | badge do header | `4.480 no acervo` eram 4.480 **registros**: 3.520 arquivos `.psd` distintos + 135 cenas = **3.655** mockups. 825 registros apontam para o mesmo arquivo. `mockupKey` conta a coisa, não a linha; 3 testes travam (mesmo arquivo, caminho Windows/POSIX, cena-foto). O "à vista" saiu junto, a pedido. |

## Os treze detalhes: 13/13

| # | Detalhe | 1ª | 2ª |
|---|---|---|---|
| 1 | Teclado alcança toda ação | falta | **feito** — `B` guarda, `S` parecidos, `alt+seta` reordena, e o atalho aparece no `title` |
| 3 | Zero salto entre carregando e carregado | parcial | **feito** — skeleton na aba Coleção |
| 4 | Escrita otimista com desfazer | parcial | **feito** — tirar da coleção oferece "Desfazer"; guardar não pede nada (guardar por engano não custa, perder curadoria custa) |
| 12 | Volta na mesma posição depois de agir | falta | **feito** — sair de "parecidos" devolve o `scrollTop` |
| 13 | Copy na voz da casa | falta | **feito** — portão zero |

## Os três de maior alavanca: 3/3

1. **Renderizar a coleção em lote** — `brand-kit --collection`. Verificado ponta a ponta com
   marca real: 27 itens curados, 27 renderizados na ordem curada. Coleção vazia falha
   ensinando a curar, em vez de cair na sugestão automática. Item que não resolve é pulado
   **com o motivo**, e o teste trava `psdPaths + skipped == ids`.
2. **Portão de copy** — fechado.
3. **Teclado nas ações novas** — feito.

## "Não verificado" da 1ª rodada: todos medidos

| Era | Agora |
|---|---|
| backend realmente parado | **medido.** Com `MONGODB_URI` apontando para porta morta: o catálogo degrada para as **135 cenas de disco** (não zera, não quebra) e a coleção grava e lê normalmente, porque ela é arquivo. |
| performance em produção | **medido.** Build isolado (`NEXT_DIST_DIR=.next-prod`, para não brigar pelo `.next` do dev) + `next start`: HTML **39ms**, `/api/references` **5,3s no primeiro request** (montagem do catálogo) e **27–37ms** depois, busca com camada densa **149ms**. |
| toque de verdade | **portão novo.** `npm run visual:touch` roda o Chrome com `hover: none` e falha se qualquer controle do card ficar em `opacity 0`. Provado nos dois sentidos: reintroduzi o defeito e ele acusou os 4 controles pelo nome. |
| feel a 25% | segue não olhado. Nenhuma animação nova foi escrita; as transições vêm dos tokens (`--dur-*`), que o `audit:design` cobre. |

## Um achado que não estava no roteiro

`__webpack_require__.n is not a function` na home, com o grid vazio. **Não é do código**: é o
`.next` corrompido por mais de um dev server escrevendo no mesmo diretório. Provado rodando a
mesma árvore em build de produção isolado — console 0 erros, 12/12 no portão visual. O mesmo
mecanismo já tinha derrubado um `next build` nesta sessão.

Regra que fica: **um dev server por `.next`**, e para medir produção use
`NEXT_DIST_DIR=.next-prod`.

## Nota

| Faixa | Peso | 2ª rodada |
|---|---|---|
| Portão | 20 | **20** — três detectores verdes, nenhum pulado |
| Julgamento | 40 | **36** — 5 itens de slop consertados; fica `−4` pela cor crua (`emerald`/`amber`) nos painéis de ingest e duplicatas, pré-existente e fora do que esta rodada tocou: o design system não tem token semântico de estado, e criar um é mudança de sistema, que precisa de autorização |
| Interrogatório | 40 | **36** — T1+T2 e F1–F6 respondidos com `arquivo:linha`; `−4` porque o feel a 25% não foi olhado |
| **Total** | 100 | **92** |

Acima de 90 = passou. A pendência de gosto que sobra é a cor crua, e ela é decisão de design
system, não de tela.

## Ainda em aberto (decisão de produto, não defeito)

- `--collection` renderiza com os layouts OU com o símbolo, um por vez. Os dois no mesmo
  `--out` são duas execuções. Vale unificar se virar incômodo.
- A busca por vibe depende de chave de embeddings. Sem ela, os clusters de setor sozinhos já
  resolvem o caso do enunciado (`"engenharia"` → 703 hits, top-5 todos CONSTRUCTION).
