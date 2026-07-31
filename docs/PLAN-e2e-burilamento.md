# Plano — burilamento end-to-end da jornada (7 passos)

> **Skills aplicadas:** `visant-frontend` (classificação de superfície + espinha de 12),
> `visant-motion` (SSoT de motion, Emil Kowalski / Apple *Designing Fluid Interfaces*).
> **Branch:** `feat/detection-qa-gate` · **Modo:** auditoria de código + execução.

## Classificação de superfície (Passo 0 da skill — nunca pular)

| Região | Classe | Variável |
|---|---|---|
| Home / grid / busca / filtros | **B — work** | throughput × decision quality |
| Wizard de ingest + triagem | **C — trust** | escrita irreversível no Mongo + no acervo |
| Painel direito (arte → render → download) | **B — work**, com o export sendo **C** | throughput; entregável final |
| Modais (duplicatas, sessão, library) | **B — work** | throughput |

Nenhuma região é classe A. Está certo: não há hero, não há pitch. Qualquer
gradiente-herói aqui seria erro de classificação.

---

## A descoberta que reorganiza o plano

**Toda a animação de entrada do app é código morto.** O projeto usa Tailwind v4
(`@tailwindcss/postcss`, sem `tailwind.config`) e nunca instalou
`tailwindcss-animate` nem seu sucessor v4. Logo, estas classes **não existem em
nenhum stylesheet** e o navegador as descarta em silêncio:

| Classe | Ocorrências | Onde deveria animar |
|---|---|---|
| `animate-in` | 22 | wizard, modais, painel direito, cards, empty states |
| `fade-in` | 12 | todos os overlays |
| `slide-in-from-*` | 10 | wizard, toast de desfazer, logs |
| `zoom-in-*` | 6 | settings, duplicatas, library |
| `no-scrollbar` | 7 | sidebar, grid, rail de sugestões, modais |
| `animate-progress-indefinite` | 2 | barra do render + barra do scan de duplicatas |

Isto é exatamente a lição registrada na `visant-frontend`: *"uma classe utilitária
indefinida falha em silêncio e parece que funcionou"*. O código **descreve** uma
UI animada; a UI entregue não tem nenhuma dessas transições, e as duas barras de
progresso "indeterminadas" são retângulos brancos parados a 40% — que **mentem
sobre o estado do sistema** (espinha 9) durante justamente as duas operações mais
longas do produto.

Consequência para o plano: não existe "polir a animação existente". A camada de
motion tem de ser **construída**, e a correção certa é instalar a lib oficial
(`tw-animate-css`, descrita como *"TailwindCSS v4.0 compatible replacement for
tailwindcss-animate"*), nunca reescrever keyframes à mão.

---

## Auditoria por passo da jornada

### 1. Usuário abre o app
| Sev | Achado | Endereço |
|---|---|---|
| P1 | Nenhum estado de **primeiro uso**: acervo vazio cai no empty-state de busca ("tente redefinir seus filtros") — mas não há filtro nenhum aplicado, e a ação certa é *ingerir uma pasta*, que fica escondida na sidebar. Empty state é argumento (espinha 10) e aqui não argumenta nada. | `page.tsx:1953-1962` |
| P1 | Chrome antes do 1º card: header 56px + padding 32px, e com marca selecionada o rail de sugestões empurra tudo. `LayoutGrid` + slider de tamanho ocupam o header central sem nomear variável. | `page.tsx:1460-1474` |
| P2 | O toggle do painel direito renderiza inerte (`opacity-20 pointer-events-none`) quando não há seleção — controle morto não renderiza (espinha 5). | `page.tsx:1521` |
| P2 | Sem `prefers-reduced-motion` em lugar nenhum. | global |

### 2. Ingerir pastas de mockups
| Sev | Achado | Endereço |
|---|---|---|
| **P0** | O wizard tem 2 passos, mas o passo "Scan" devolve **só duas contagens** (`psdCount`, `refCount`). O usuário confirma uma escrita irreversível no Mongo **sem ver um único arquivo**. Superfície de trust decidida às cegas. | `api/ingest-folder/scan/route.ts`, `page.tsx:1718-1749` |
| **P0** | O ingest de verdade dedupa só por `findOne({name})` **exato** — não usa `normalizeName`/`mockupSignature` que o próprio projeto já tem em `lib/dedup.ts`. "Falling-Cards-Blur" e "Falling Cards Blur (1)" entram os dois. | `api/ingest-folder/route.ts:67` |
| **P0** | Zero filtro de lixo: thumbnails de 4KB, `_MACOSX`, `Thumbs.db`, JPGs de 80px, arquivos de preview — tudo vira card no grid. | `lib/fs-walk.ts` (só filtra `._*`) |
| P1 | O `studio` é **sempre** o nome da pasta-raiz, sem chance de renomear na hora. | `route.ts:54` |
| P1 | Ingest é `POST` monolítico: nada de progresso, nada de cancelar. Pasta com 3 mil PSDs = botão travado sem sinal. | `route.ts:40-135` |
| P1 | O resultado é uma string (`+12 refs, 3 PSDs, 3 scanned`) num `<p>`, e some sem histórico. | `page.tsx:1682-1687` |

### 3 e 5. Animação de carregar / ingerir
| Sev | Achado | Endereço |
|---|---|---|
| **P0** | A barra "indeterminada" do render é `animate-progress-indefinite` — **classe inexistente** → barra branca imóvel em 40% enquanto o render roda. Idem no scan de duplicatas. | `page.tsx:2103`, `2747` |
| P1 | Ingest não tem animação nenhuma: só um `Loader2` dentro do botão. Sem etapa, sem contagem, sem arquivo atual — e o `/api/duplicates` já prova que o padrão SSE-com-log existe neste projeto. | `page.tsx:1745` |
| P1 | Skeleton do grid só aparece no `initialLoad`; trocar de filtro mostra o grid antigo até o novo chegar (sem sinal de que a lista está obsoleta). | `page.tsx:1921` |
| P2 | `duration-700` + `scale-110` no hover do card: interativo acima de 300ms (regra `visant-motion` §2.3). | `page.tsx:115`, `285` |
| P2 | `transition-all` em ~40 lugares — anima propriedades não intencionais e janka. | global |

### 4. Escolher / remover ingests (anti-duplicação e lixo)
**Não existe.** É o maior buraco da jornada. Hoje o caminho é: confiar no scan
cego → gravar tudo → depois esconder card por card no grid (`hiddenIds`, em
`localStorage`, que **não remove nada do banco**). O modal de duplicatas existe,
mas é read-only e termina mandando o usuário rodar `scripts\remove-dupes.ps1` na
mão — um beco sem saída dentro do produto (`page.tsx:2886`).

### 6. Filtro, busca, busca por imagem
| Sev | Achado | Endereço |
|---|---|---|
| **P0** | **`/api/search-by-image` existe e não tem UI nenhuma.** Zero referência no frontend. Capacidade construída e não entregue. | `api/search-by-image/route.ts` |
| P1 | Busca sem estado de "buscando", sem contagem de resultado para a query, sem limpar (✕), sem `⌘K`/`/` para focar. | `page.tsx:1477-1488` |
| P1 | Dedup + ocultos rodam **client-side sobre a página carregada**; o badge do header conta o total do servidor. Dois números medindo coisas diferentes lado a lado, sem rótulo (regra: "quando dois números medem coisas diferentes, a UI nomeia qual é qual"). | `page.tsx:1491`, `1650` |
| P1 | Esconder tudo da página carregada → tela branca: o empty-state testa `refs`, o grid renderiza `displayRefs`. | `page.tsx:1953` vs `1971` |
| P1 | Chips `disabled` aos montes quando o teto de 5 tags é atingido — dezenas de controles mortos renderizados. | `page.tsx:1825-1833` |
| P2 | `scale-110` em chip dentro de `flex-wrap` → reflow do bloco inteiro no toggle. | `page.tsx:1829` |
| P2 | Facetas só na sidebar esquerda; nenhuma pílula de "filtro ativo" no topo do grid, onde o olho está. | — |

### 7. Subir imagem e aplicar no mock
| Sev | Achado | Endereço |
|---|---|---|
| **P0** | Drop de arte **só existe dentro do painel direito e só quando `faces.length > 0`** (`page.tsx:2266`). Não há drop na página. Arrastar um PNG sobre o grid não faz nada — o navegador abre o arquivo. | `page.tsx:2266-2333` |
| **P0** | `handleArtSelect` sai silenciosamente se o arquivo não for imagem (`page.tsx:1043`): arrastar um PDF/SVG errado não dá **nenhum** retorno. Falha silenciosa numa ação primária. | `page.tsx:1043` |
| P1 | `sonner` está instalado e **não é usado na home** — erros de render viram caixinha vermelha no rodapé do painel, e `copyRenderAsPng` falha só no `console.error`. | `page.tsx:1038`, `2373` |
| P1 | Sem aviso de **baixa resolução**: `soInnerWidth/Height` são conhecidos e a dimensão da arte também; ninguém compara. Render sai borrado sem avisar. | `page.tsx:1403` |
| P1 | Sem sugestão de enquadramento: `PLAN-upload-render-ux.md` já decidiu *layout = cover, logo = contain + fundo da marca*, e a UI não aplica esse default por tipo de arte. | `lib/art-frame.ts` |
| P1 | "Aplicar" no card dispara **preview**, mas o card não distingue preview de render final — o `renderCache` guarda os dois com a mesma cara. | `page.tsx:1260`, `1986` |
| P2 | Botão de download só aparece para render final; depois de um preview o usuário não tem caminho óbvio para o PNG. | `page.tsx:2363` |

---

## Decisões (confirmadas com o usuário)

1. **Motion:** instalar `motion@12` + `tw-animate-css@1.4` (lib oficial v4). SSoT
   em `src/lib/motion.ts` espelhado nos tokens de `globals.css`. Nada de
   cubic-bezier hardcoded em componente.
2. **Triagem:** dry-run completo — hash perceptual (dHash), heurística de lixo,
   cruzamento com o acervo, e commit **seletivo**.
3. **Componentes:** autorizado criar em `src/components/ui`, seguindo estritamente
   a linguagem visual existente.
4. **Fluxo:** este documento e execução emendada.

---

## Entregas

### F0 — Fundação de motion (SSoT) — *pré-requisito de tudo*
- [x] `npm i motion tw-animate-css`
- [x] `@import "tw-animate-css"` → as 50 classes mortas passam a existir
- [x] `@utility no-scrollbar` + `@keyframes progress-indefinite` reais
- [x] Tokens `--ease-out/-in-out/-drawer` + `--dur-press/fast/base/slow` no `:root`
- [x] `src/lib/motion.ts` — `EASE_*`, `DUR`, `transitions`, `fadeInUp`, `itemEnter`, `pressable`
- [x] Guarda global de `prefers-reduced-motion`
- [x] Varredura de `transition-all` → escopo mínimo; `duration-700` interativo → `--dur-slow`

### F1 — Abrir o app (passo 1)
- [x] Estado de **primeiro uso** distinto do empty-state de busca, com a ação certa (ingerir pasta) como primária
- [x] Entrada em cascata curta e capada do grid (`itemEnter`)
- [x] Remover controles mortos; `⌘K` / `/` focam a busca

### F2 — Ingest com triagem (passos 2, 4)
- [x] `GET /api/ingest-folder/scan` reescrito: SSE, dHash perceptual (`sharp`), detecção de
      lixo, cruzamento com o acervo, agrupamento; degrada com `degraded: true` se o Mongo
      cair, em vez de impedir o ingest
- [x] `POST /api/ingest-folder` aceita **lista explícita** (commit seletivo) + SSE; um
      `findOne` por arquivo virou UMA carga de assinaturas (3 mil arquivos = 3 mil
      round-trips a menos); PSD corrompido vira linha de erro, não derruba o lote
- [x] `IngestReviewSheet` — miniatura, dimensão, tamanho e **motivo escrito** por item;
      filtro por veredito; estúdio editável; ⌘A marca o que está à vista; Esc fecha
- [x] Dedup do ingest passa a usar `mockupSignature` (o que já existia em `lib/dedup.ts`)
- [x] `src/lib/ingest-triage.ts` — puro e testável (21 testes), no mesmo desenho de
      `search-engine.ts` ⟷ `search-index.ts`

**Prova em pasta real** (`Render/New Mockups`, 81 arquivos): 77 novos, 4 duplicatas,
8,9 MB barrados. **3 das 4 vieram de `rendered/`** — `01_billboard_urbano` vs
`01_billboard_urbano-mockup`, nomes diferentes que dedup por nome+tamanho jamais casaria.
É o dHash pagando o próprio custo.

### F3 — Animações de carregamento (passos 3, 5)
- [x] `animate-progress-indefinite` passa a existir (render + scan de duplicatas deixam de
      exibir barra parada durante trabalho em andamento)
- [x] `FlyingPaperLoader` — papéis voando de uma pasta aberta para uma fechada, colhido do
      `visantlabs-os`. É o único loader da casa que **descreve a operação**: ingerir é
      literalmente mover arquivo de pasta para pasta
- [x] `GlitchChars` do registry `@visant` como batimento do sistema (o pré-voo e o rodapé
      da triagem), em vez de spinner mudo
- [x] Cascata de entrada do grid — CSS + `animationDelay` capado em 240ms, **não**
      `motion.div`: envolver 60 cards memoizados desfaria a memoização que segura o INP
- [x] Grid em meio-tom + `aria-busy` durante refetch (antes mostrava a lista antiga como se
      fosse o resultado do filtro novo)

### F4 — Busca, filtro e busca por imagem (passo 6)
- [x] **UI de busca por imagem**: botão na barra → downscale a 512px no cliente →
      `/api/search-by-image` → `?ids=` hidrata preservando a ordem do vetor → chip com
      miniatura, contagem e saída explícita
- [x] `refsByIds` em `search-index.ts` + `?ids=` em `/api/references` (adaptador fino, um
      formato de card só)
- [x] Campo de busca com estado de carregando (o debounce de 300ms era tela morta), `/` e ⌘K
- [x] Os dois números do header nomeados ("51 à vista · 4.544 no acervo")
- [x] Empty-state que respeita `displayRefs` (esconder tudo dava tela branca)
- [x] Chips no teto de tags deixam de renderizar mortos — clicar troca a mais antiga
- [x] **Pílulas de filtro ativo acima do grid**, cada uma removível e "limpar tudo".
      Os filtros moram na sidebar, que o usuário colapsa — e aí o grid mostrava um
      recorte sem dizer que era um recorte, fazendo parecer que o acervo encolheu.
      Nada ligado ⇒ barra nenhuma. *Verificado: `334 no filtro` + chip "Paisagem ×".*

### F5 — Arte → render (passo 7)
- [x] Drop de arte **na página inteira**, com contador de profundidade (senão o overlay
      pisca a cada borda de card cruzada) e `preventDefault` que impede o navegador de
      abrir o arquivo e perder a sessão
- [x] Rejeição de arquivo dá retorno (`sonner`), nunca silêncio
- [x] Aviso de baixa resolução comparando `artDims` com `soInner*` (>1.5× de ampliação)
- [x] Falhas que morriam no `console.error` agora avisam: copiar PNG e render
- [x] Depois de um preview existe caminho até o arquivo ("gerar PNG final para baixar")
- [x] **Enquadramento decidido na entrada** (`src/lib/art-classify.ts`, puro, 10 testes).
      A regra do `AGENTS.md` — *layout = cover; logo = contain + fundo da marca* — existia
      só em documento: toda arte caía em `DEFAULT_FRAME` e o logo do cliente saía
      **cortado** nas bordas do billboard. É o erro mais caro e mais silencioso deste
      produto, porque o PNG fica bonito e a marca, decepada.
      Sinais: vetor · alfa transparente · borda chapada + pouca tinta · **proporção
      casando com a face** (que vem antes do teste de borda, senão um layout full-bleed
      de fundo sólido ganharia tarja à toa). A decisão aparece escrita no painel com o
      inverso a um clique — automatismo silencioso numa etapa que produz o entregável
      vira surpresa no arquivo.
      *Verificado no app: logo com alfa → "Marca detectada · fundo transparente —
      encaixado inteiro, sem corte"; ruído full-bleed → "Layout detectado · composição —
      preenche a superfície inteira".*
- [x] **Bug achado no caminho:** o `<input type="file">` da arte vivia dentro do bloco
      `faces.length > 0`. Num PSD com smart object e sem face editável — que renderiza
      normalmente via `selectedSo` — o input não existia e o "Adicionar arte" do preview
      chamava `fileInputRef.current?.click()` num ref **nulo**: a ação primária não fazia
      nada, em silêncio. Movido para fora do bloco.
- [x] **Bug de tipografia:** `layout.tsx` baixa Geist e Geist Mono do Google e publica
      `--font-geist-sans`, e o `body` de `globals.css` sobrescrevia tudo com
      `Arial, Helvetica, sans-serif`. O app pagava duas webfonts e renderizava na fonte de
      sistema. Não era escolha de tipografia — era a cascata comendo a decisão do layout.
      *Verificado: `getComputedStyle(body).fontFamily` agora resolve em `Geist`.*

### F6 — Verificação
- [x] `npx tsc --noEmit` limpo
- [x] `npm test` — **198 testes, 21 arquivos** (21 novos da triagem + 10 do enquadramento
      + 2 da guarda de CSS)
- [x] `npm run build` verde
- [x] `npm run lint` — **0 erros** e **350 warnings, abaixo do baseline de 351**;
      **zero** achados em qualquer arquivo novo. A única supressão é
      `react-hooks/set-state-in-effect` em `IngestReviewSheet`, com motivo escrito: as
      escritas são todas pós-`await` num stream SSE, que é o caso que a própria
      documentação da regra chama de "subscrever a um sistema externo"
- [x] Guarda de regressão de classe utilitária — **e provada nos dois sentidos**: passa
      limpa e falha com uma classe inventada injetada. A primeira versão dela tinha dois
      furos (resolvia `exports["."]` só como string; e `includes("@utility animate-")`
      aprovava qualquer `animate-*`), os dois corrigidos
- [x] Medição a 390px **com 51 cards reais**: 24 elementos cortados → **0**; a busca era
      inalcançável (começava em x≈676) → visível. Re-medido a 900px também
- [x] `npx impeccable detect` — 33 achados triados (ver abaixo)
- [x] Pré-voo exercitado numa pasta real (81 arquivos) e a folha de revisão percorrida no
      navegador; **nada foi gravado no acervo** — o commit é decisão do usuário
- [x] **Feel-check a 25%** — `document.getAnimations()` com `updatePlaybackRate(0.25)`
      reaplicado a cada 30ms (mesmo efeito do painel Animations). 53 animações simultâneas
      na troca de filtro, todas em `rate: 0.25`, `animationName: enter`, sem estados
      sobrepostos no crossfade. Delays 0/20/40/60/80ms com `fill-mode: backwards`
- [x] **Reduced motion** — bloco `@media (prefers-reduced-motion: reduce)` confirmado **no
      CSS servido** (varredura de `document.styleSheets`), junto de `.no-scrollbar` e
      `progress-indefinite`. O `FlyingPaperLoader` usa `useReducedMotion`: congela os
      papéis e mantém a barra, que é informação, não animação
- [x] **Enquadramento inteligente exercitado no app** com duas artes sintéticas (logo com
      canal alfa e composição full-bleed), pelo caminho de drop global

### Triagem do `impeccable detect`
| Achado | Veredito |
|---|---|
| `page.tsx:2662` gray-on-color | **Falso positivo** — o fundo é `bg-red-500/10`, o detector não lê o modificador de opacidade |
| `globals.css` font-family Arial | **Real — corrigido.** Não era escolha tipográfica: o `layout.tsx` já baixava Geist e o `body` sobrescrevia com Arial. Ver F5 |
| `photo-mockup:1432/1436` broken-image | **Fora do escopo declarado** — `<img>` de overlay transparente, `src` definido em runtime |
| `calibrate`/`scene` gray-on-color | Fora do escopo declarado (o plano isenta essas rotas) |

---

## Estado final

Os sete passos da jornada estão cobertos e verificados no app rodando, com dados reais.
Fora de escopo continua fora de escopo, e está declarado no fim deste documento — não é
gap, é fronteira: o engine de render, o `/photo-mockup`, o `/calibrate` e a remoção física
de arquivo do disco.

Uma coisa que este documento **não** afirma: que o commit do ingest foi executado. O
pré-voo foi rodado numa pasta real de 81 arquivos e a folha percorrida no navegador, mas
**nada foi gravado no acervo** — a escrita é irreversível pelo produto e a decisão é do
usuário.

---

## Fora de escopo (declarado)
- Reescrever o engine de render (`photo-render-core`, `psd-engine`) — funciona.
- `/photo-mockup` e `/calibrate` — a auditoria anterior os classificou como a
  parte madura; só recebem os ganhos herdados da fundação de motion.
- Remoção física de arquivos do disco pelo produto: continua sendo trabalho do
  `scripts/remove-dupes.ps1`; o que entra aqui é **não ingerir** o lixo.
