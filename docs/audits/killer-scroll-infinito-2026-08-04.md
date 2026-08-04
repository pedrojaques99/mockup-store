# Killer: scroll infinito da home

**Tier** T2 rota (região de listagem dentro de `src/app/page.tsx`) · **Nota 68/100** ·
**Veredito** não vai pra PR enquanto o portão de copy estiver vermelho
**Superfície** B trabalho (escolher mockup é o trabalho; throughput e qualidade da escolha)

## Decisão pendente (sua, não minha)

1. **Virtualizar a lista.** Hoje nada sai do DOM: `masonry-gallery.tsx:88-95` monta todos os
   itens, sempre. Com 60 por página mais 30 por cauda, dez rolagens dão ~900 cards vivos.
   A imagem tem `loading="lazy"` (`page.tsx:173`), então a rede se segura, mas o DOM e o
   estilo não. **Recomendo `@tanstack/react-virtual`** sobre o masonry atual, medindo antes
   (F3 abaixo diz como). Alternativa mais barata: teto de janela deslizante (guardar só as
   últimas N páginas e recriar ao rolar pra cima). Muda o item do registry, então precisa
   do seu aval — o `masonry-gallery.tsx` é cópia verbatim de `Vintageuiuxlibrary` e correção
   sobe no registry primeiro.
2. **Instalar o primitivo `Skeleton`** (`npx shadcn@latest add skeleton`). É o que fecha o
   slop #3 abaixo, e o repo não tem primitivo de carregamento nenhum em `ui/`.
3. **Voltar na mesma posição.** "Abrir" é navegação de página inteira
   (`page.tsx:228`, `href="/photo-mockup?scene="`). Voltar refaz da página 1 e joga fora a
   rolagem e a cauda. Recomendo guardar `refs`/`tail`/scroll em `sessionStorage` por chave
   de recorte. Escopo médio, alavanca alta: é o passo 12 da lista do Vale.

## Portão

| Detector | Antes | Depois |
|---|---|---|
| impeccable (tell de IA) | 0 | **0** |
| audit:design (token) | pulado | **pulado — o repo não tem `audit:design`** |
| copy (vício) | 25 | **16** (todos pré-existentes, fora da região auditada) |
| tsc | pass | **pass** |
| lint (erros) | 0 | **0** (14 warnings, teto do repo) |
| vitest | 334 pass | **334 pass** |
| 390px (estouro) | não medido | **não medido** — ver "Não verificado" |

Os 25 do portão de copy viraram 16 **durante a auditoria**: há outro editor mexendo em
`src/app/page.tsx` neste momento (linhas 1132, 2941, 3001 e outras trocaram `—` por `:`/`,`
entre duas rodadas do script). Por isso não varri o arquivo inteiro: sweep em arquivo com
dois donos vira conflito. Consertei a minha (`page.tsx:3247`, tinha travessão **e**
"x, não y") e deixo os 16 como lista de trabalho:

`782 · 789 · 792 · 1065 · 1683 · 2138 · 2965 · 3294 · 3675 · 4239 · 4316` (travessão)
`2344 · 2362 · 2427 · 4080 · 4378` (bolinha separadora)

Os cinco de bolinha são linha de status densa (`2427`: "N à vista de M carregados · T no
recorte"); trocar o separador é decisão de layout, não achar-e-substituir. Vão como proposta
de gosto no fim.

## Slop consertado

| # | Catálogo | Onde | Conserto |
|---|---|---|---|
| 1 | **#12 Erro colapsado em vazio** | `page.tsx:1346` (versão anterior) | O `catch` da cauda fazia `setTailDone(true)`, e o rodapé então dizia **"Você viu o acervo inteiro"**. Rota caindo virava conclusão sobre o tamanho do acervo. Agora `tailError` é estado próprio, com mensagem e "Tentar de novo" (`page.tsx:3334-3348`), e o fim exige `!tailError`. |
| 2 | Ação do usuário desfeita pela sugestão | `page.tsx:2205-2211` | A cauda renderizava `tail` cru: "Esconder" e "Esconder Duplicados" valiam só acima da costura, e o mockup que o usuário mandou sumir voltava trinta cards abaixo. Agora existe `displayTail` com o mesmo filtro do grid, e `hiddenIds` entra no `exclude` da requisição. |
| 3 | Copy: travessão + "x, não y" | `page.tsx:3247` | "acabou o filtro, não o acervo — " → "o filtro acabou aqui. " |

## Slop mantido (com motivo, e sem seu aval não mexo)

| Catálogo | Onde | Por que fica |
|---|---|---|
| **#3 Spinner no lugar do skeleton** | `page.tsx:3313-3318` | Consertar exige o primitivo `Skeleton`, e criar componente de design system sem autorização é proibido. Decisão pendente 2. |
| **#17 Movimento** (`animation-delay` sob reduced-motion) | `globals.css:77-84` + `page.tsx:3298` | O bloco zera `animation-duration` mas não `animation-delay`; com `enterDelay` até 240ms, quem pediu menos movimento vê o card invisível por 240ms e depois um pop. Conserto é uma linha (`animation-delay: 0 !important`) em CSS global compartilhado — e o arquivo tem outro editor agora. |

## Interrogatório

**Q3 Qual é a versão disto que caberia numa frase? Por que a tela é melhor?**
A frase seria "busque de novo com outro termo". A tela é melhor porque o usuário **não sabe
o termo**: ele reconhece o mockup ao ver. Por isso a cauda é semântica antes de léxica
(`tail/route.ts:52-58`), e por isso ela existe. OBRIGA: nada, é a defesa da feature.

**Q5 Qual decisão isto produz?**
"Esse serve." O scroll existe para chegar no card que ele aplica. OBRIGA: nada.

**Q7 Isto é a resposta ou a matéria-prima?**
Matéria-prima assumida: o grid não escolhe, ele apresenta. Legítimo numa superfície de
escolha visual. OBRIGA: nada.

**Q8 Qual default você escolheu pelo usuário, e você o defende por escrito?**
Três, e todos ficam visíveis: pré-carga a 1,5 altura do container (`page.tsx:1378`),
cauda de 30 por vez (`page.tsx:1334`), e a ordem da cauda vinda do centróide dos **últimos
24** vistos (`tail/route.ts:47-48`). O terceiro é o único discutível: 24 é o recorte do
"assunto do momento"; centróide de 400 cards é o centróide do acervo, que não significa nada.
OBRIGA: a regra da cauda aparece na faixa ("parecidos com o que você acabou de ver"),
então o default está visível onde ele acontece. Nada a mudar.

**Q11 Este número mente em qual cenário? / Q12 Se o backend cair, mostra erro ou zero?**
Mentia. Era o achado 1 acima. Agora erro e fim são estados separados nos dois caminhos
(paginação: `page.tsx:3319`; cauda: `page.tsx:3334`). OBRIGA: verificar com o backend
parado — **não feito**, ver "Não verificado".

**Q13 Que promessa isto faz que o banco não sustenta?**
"Você viu o acervo inteiro" só é verdade se a camada 3 da rota (`tail/route.ts:76-80`)
varrer mesmo tudo. Ela varre: `searchRefs` sem filtro, ordenado por popularidade, menos o
`exclude`. A frase se sustenta. OBRIGA: nada.

**Q16 Quantos pixels verticais até o primeiro dado real?**
Não medido (grid vazio, ver "Não verificado"). O `py-20` do sentinela (`page.tsx:3312`) são
160px de nada no rodapé — aceitável porque é fim de lista, não topo.

**Q17 Onde este elemento VAI FALTAR?**
Na busca com **um** resultado. Aí a cauda domina a tela e o único resultado real vira
minoria visual. A faixa "Continuando a partir daqui" é o que separa os dois, e é por isso
que ela é visível. OBRIGA: nada, mas é o caso a olhar quando você abrir a tela.

**Q18 O que isto ensina o usuário a fazer errado?**
A não confiar no filtro, se a costura não estiver clara. Por isso a faixa não é sutil e o
texto muda com filtro ativo ("o filtro acabou aqui"). OBRIGA: nada.

**Q26 Quem mantém isto em seis meses, e como descobre que quebrou?**
Ninguém descobre. **Zero teste** cobre a cauda: `src/lib/__tests__/` não tem nada de
`tail`, e a lógica de decisão (as três camadas, o `exclude`) mora na rota, onde não é
testável sem subir o Next. OBRIGA: extrair a escolha de camada para `src/lib/` e travar em
vitest. É o item de menor esforço e maior meia-vida da lista.

### Bloco fixo

**F1 Reuso.** Reusado: `MasonryGallery` (registry da casa), `MockupCard`, `dedupeRefs`,
`centroidRank`, `searchRefs`, `refsByIds`. Escrito novo: só a rota `tail` (50 linhas de
orquestração) e o `loadTail`. Nenhum utilitário de formatação escrito dentro do componente.
`IntersectionObserver` nativo em vez de `react-intersection-observer`: uma dependência para
15 linhas não se paga, e a `root`/`rootMargin` são justamente o que a lib esconde.
**Dívida:** `loadTail` e `fetchPage` são duas paginações no mesmo componente. Se aparecer
uma terceira lista infinita, vira hook `useInfiniteFeed`. Hoje não.

**F2 Design system.** Sem cor crua na região (impeccable zero). A cauda copia o cabeçalho de
seção de "Para completar a coleção" (`page.tsx:3200`) — mesma régua, mesmo `text-[11px]
font-bold`, mesmo ícone a `w-3.5`. `audit:design` não existe no repo: **portão pulado, e
isso está descontado na nota.**

**F3 Responsivo e performance.** Não medido, e é a maior lacuna desta rodada.
O que já se sabe sem medir: sem virtualização (decisão 1); `loadTail` depende de `refs` e
`tail` inteiros, então o `IntersectionObserver` é recriado a cada página (barato, mas é
churn); `dedupeRefs` roda sobre a cauda inteira a cada append (`page.tsx:2205`).
Para medir: `documentElement.scrollWidth - innerWidth` a 390px **com dado real**, e o
profile em produção, nunca no dev (StrictMode conta o dobro).

**F4 Fluxo para o ICP.** ICP: o designer que precisa entregar N mockups de uma marca hoje.
Caminho: (1) abre a home, (2) escolhe marca ou busca, (3) rola, (4) aplica a arte, (5)
exporta. O "aha" é o passo 4, e a cauda encurta o passo 3 — que era onde ele abandonava,
porque o filtro acabava e a tela dizia que a biblioteca tinha acabado junto. Ponto de
abandono que sobra: o passo 3 **depois** de voltar do passo 4 (decisão pendente 3).

**F5 Esconder, compactar, virar ícone.**

| Esconder | Compactar | Virar ícone | Não esconder |
|---|---|---|---|
| — | O `py-20` do sentinela vira `py-12` quando há cauda: são dois rodapés seguidos hoje (**~64px**) | — | A faixa da costura. Ela é a honestidade da tela: sem ela a sugestão passa por resultado do filtro |

**F6 O que falta para o nível Vale do Silício.** Os treze:

| # | Item | Estado |
|---|---|---|
| 1 | Teclado alcança toda ação | feito (ações do card são botões reais, sem hover-reveal) |
| 2 | `focus-visible` no que hover revela | não se aplica (nada é revelado por hover no card) |
| 3 | **Zero salto entre carregando e carregado** | **falta** — spinner, não skeleton |
| 4 | Otimista com desfazer | feito (esconder tem desfazer, `page.tsx:3349`) |
| 5 | Erro, vazio e carregando distintos | **feito nesta rodada** (era o achado 1) |
| 6 | Nada mente | **feito nesta rodada** (o "fim" e o item escondido que voltava) |
| 7 | Latência percebida na origem | feito (pré-carga a 1,5 altura; a página chega antes do rodapé) |
| 8 | Movimento do SSoT, interrompível, reduced-motion | **falta** — `animation-delay` não zera |
| 9 | Densidade defensável | não medido |
| 10 | Um primário por superfície | feito |
| 11 | Default defendido por escrito | feito (Q8) |
| 12 | **Volta na mesma posição depois de agir** | **falta** — decisão pendente 3 |
| 13 | Copy na voz da casa | **falta** — 16 achados pré-existentes no arquivo |

**Os três de maior alavanca por esforço, e paro aqui:**

1. **Skeleton no lugar do spinner** (item 3). Uma instalação de primitivo e ~15 linhas.
   É o que faz a lista infinita parecer instantânea sem ser mais rápida.
2. **Voltar na mesma posição** (item 12). `sessionStorage` por chave de recorte, ~40 linhas.
   É o passo onde o ICP abandona hoje.
3. **Virtualizar** (F3). Maior esforço dos três, e o único que decide se a lista infinita
   aguenta ser infinita de verdade.

## O que a rodada consertou nos detectores

| Regra | Era acusado | Conserto | Caso no fixture |
|---|---|---|---|
| — | nenhum falso positivo nesta rodada | — | — |

O `--self-test` do extrator passou nos dois sentidos antes do portão (12 strings do fixture,
zero falso positivo, zero falso negativo). Os 16 achados de copy que sobraram foram
conferidos um a um em `arquivo:linha`: **todos são string que chega no olho do usuário**,
nenhum é comentário nem menos de subtração.

## Proposta de gosto (escolha linha por linha)

| Onde | Antes | Depois |
|---|---|---|
| `page.tsx:2427` | `12 à vista de 60 carregados · 1.204 no recorte` | `12 à vista de 60 carregados. 1.204 no recorte` |
| `page.tsx:2362` | `Parecidos com a imagem · 12` | `Parecidos com a imagem (12)` |
| `page.tsx:2344` | `Tamanho do card · 128px` | `Tamanho do card: 128px` |
| `page.tsx:3312` | `py-20` no sentinela | `py-12` quando há cauda (devolve ~64px) |

## Não verificado

- **Estouro a 390px com dado real.** `GET /api/references` e `/api/references/facets` estão
  devolvendo **500** no dev server desta máquina (a rota `tail` responde na mesma
  instância, e `searchRefs`/`getFacets` chamados direto por `tsx` devolvem 135 refs e as
  três facetas — o processo é que está podre). Grid vazio esconde todo estouro, então medir
  agora seria medir nada. **Precisa:** reiniciar o `npm run dev` e rodar a medição.
- **Backend parado.** O conserto do achado 1 nunca foi visto falhando. Precisa: derrubar a
  rota `tail` e confirmar que aparece o erro com "Tentar de novo", e **não** "Você viu o
  acervo inteiro".
- **Feel a 25% no DevTools.** Não rodado.
- **`visant-motion` e `visant-copy` carregadas como skill.** Não carregadas: o portão de
  copy rodou (é o detector), e o julgamento de motion se limitou ao que o catálogo de slop
  cobre. Um achado de motion (o `animation-delay`) saiu daí mesmo assim.
- **`audit:design`.** Não existe no repo. Portão pulado, contado como zero na nota.
