# Auditoria de performance — cache, skeleton, render

> **STATUS (2026-07-24): top 3 + bônus executados.** Ver `docs/PLAN-search-facets.md` §8.
> · #1 thumbnails: `sharp` 640px/WebP q80 nos **três** pontos de escrita (o audit listou
>   dois; `buildBrandKit` era o terceiro) + `scripts/regen-previews.ts`. Medido no acervo:
>   **506,3 MB → 5,6 MB (99%)**. Leitura com fallback `.webp` → `.png` legado.
> · #2 `unoptimized`: removido dos 3 `<Image>` (2 do grid + o do painel direito).
> · #3 `MockupCard`: `React.memo` + handlers estáveis (prop passa o mockup por argumento,
>   não closure por card) + `key={ref.id}`.
> · bônus `/api/references/tags`: cache TTL 60s + dedup de chamadas concorrentes + `$limit`.
> · #6 `Cache-Control` de `/photo-previews` aplicado no `next.config.ts`.
> Pendente: os itens estruturais (server components / `loading.tsx` / quebrar o `page.tsx`).

**Escopo:** `src/app/api/references/**`, `src/lib/search-index.ts`, `src/lib/fs-walk.ts`,
`src/lib/psd-index.ts`, `src/app/page.tsx` (grid da home), `src/app/photo-mockup/page.tsx`.
**Stack real:** Next **15.5.19** (App Router) — *não* 16. Não existe `'use cache'` /
Cache Components aqui; as ferramentas válidas são `unstable_cache`, route segment config
(`revalidate`/`dynamic`), `headers()` no `next.config.ts` e o cache in-process que o
`search-index` já implementa. `node_modules/next/dist/docs/` não existe nesta instalação.

Nada foi editado. Só este documento.

---

## Veredito

O `search-index.ts` já é a peça bem resolvida do sistema: catálogo unificado, TTL de 60s,
dedup de builds concorrentes, `invalidateCatalog()` nos pontos de escrita. **O gargalo não
está no data-fetching — está nos bytes de imagem e no fato de a home inteira ser um único
client component de 2773 linhas.**

`public/photo-previews/` tem **130 arquivos somando 507 MB** — média de **3,9 MB por
thumbnail**, com picos de **17,5 MB**. O grid pede 60 cards por página. Como o `next/image`
está com `unoptimized`, o browser baixa os PNGs full-res crus: a primeira tela da home pode
puxar **centenas de MB**. Isso é uma ordem de grandeza pior que qualquer outra coisa aqui, e
o conserto é uma linha de `sharp` em dois lugares.

Depois disso: zero `loading.tsx`/`error.tsx` no projeto inteiro e zero SSR de dados (tudo
`"use client"`), então a home é tela preta → hidrata 2773 linhas → só aí começa a buscar.
E `MockupCard` não é memoizado, com closures inline nas props — qualquer tecla na busca
re-renderiza os 60+ cards.

---

## Tabela

| # | Frente | Item | Arquivo:linha | Ganho | Esforço |
|---|--------|------|---------------|-------|---------|
| 1 | Cache | Thumbnail do grid é o render full-res (3,9 MB médio / 17,5 MB pico) | `src/app/api/photo-mockup/[id]/publish/route.ts:70`, `src/lib/agent-mockup.ts:404` | **Alto** | Baixo |
| 2 | Cache | `unoptimized` no `next/image` anula otimizador, WebP/AVIF e `sizes` | `src/app/page.tsx:95`, `:243` | **Alto** | Baixo |
| 3 | Render | `MockupCard` sem `memo` + closures inline nas props | `src/app/page.tsx:57`, `:1790-1806` | **Alto** | Baixo |
| 4 | Skeleton | Zero `loading.tsx` / `error.tsx` em todo `src/app` | `src/app/` (ausente) | **Alto** | Baixo |
| 5 | Cache | `/api/references/tags` — agregação Mongo crua, sem cache, sem limite, em todo mount | `src/app/api/references/tags/route.ts:17-29`, consumido em `src/app/page.tsx:656` | **Alto** | Baixo |
| 6 | Cache | `/photo-previews/*` servido pelo static handler sem `Cache-Control` de longa duração | `next.config.ts` (sem `headers()`) | Médio | Baixo |
| 7 | Render | Home inteira é um client component de 2773 linhas; dados só depois da hidratação | `src/app/page.tsx:1` | **Alto** | Alto |
| 8 | Render | `fetchPage` tem `loading` nas deps + guard `if (loading) return` → requests engolidos | `src/app/page.tsx:600`, `:640` | Médio | Baixo |
| 9 | Cache | `getFacets` aceita `search` mas `matchesFacets` nunca lê `q.search` | `src/lib/search-index.ts:276-286`, `:346` | Médio | Baixo |
| 10 | Cache | `searchRefs` reconstrói o `Map byId` do catálogo inteiro a cada request | `src/lib/search-index.ts:293` | Médio | Baixo |
| 11 | Cache | `listPhotoScenes` — 168 dirs varridos em série, ~840 `existsSync` + ~500 `readFile` | `src/lib/agent-mockup.ts:420-445` | Médio | Médio |
| 12 | Cache | `findPsdForRef` faz varredura linear no fallback, por linha do Mongo → O(n·m) | `src/lib/psd-index.ts:81-88`, chamado em `src/lib/search-index.ts:113` | Médio | Baixo |
| 13 | Render | Grid sem virtualização; infinite scroll acumula `displayRefs` sem teto | `src/app/page.tsx:1178`, `:1790` | Médio | Médio |
| 14 | Render | Modais pesados (duplicates, ingest, sessão, brand assets) montados sempre | `src/app/page.tsx:2244`, `:2479`, `:2578`, `:2740` | Médio | Médio |
| 15 | Render | Lottie JSON (22 KB) importado estaticamente no bundle da home | `src/app/page.tsx:55` | Baixo | Baixo |

---

## Detalhamento

### 1. Thumbnail do grid é o render full-res — **o gargalo #1**

Os dois caminhos que escrevem o preview gravam o PNG de produção sem redimensionar:

`src/lib/agent-mockup.ts:404`
```ts
for (const r of results) if (r.ok && r.file) await copyFile(r.file, join(pub, `${r.sceneId}.png`));
```

`src/app/api/photo-mockup/[id]/publish/route.ts:70`
```ts
writeFile(join(PREV_DIR, `${id}.png`), renderBuf),
```

Resultado medido em disco:

```
130 arquivos · 507 MB · média 3,9 MB · maior 17,5 MB · menor 568 KB
```

O card renderiza num container `aspect-[4/3]` de ~`thumbSize` px (algumas centenas). Estamos
entregando de 20x a 200x mais pixel do que a tela consome.

**Fix** (`sharp` já é dependência e já está em `serverExternalPackages`): nos dois pontos,
em vez de copiar/escrever o buffer cru, gerar o derivado:

```ts
await sharp(buf).resize(640, null, { withoutEnlargement: true })
  .webp({ quality: 80 }).toFile(join(pub, `${id}.webp`));
```

Manter o full-res, se ainda for útil, sob outro nome (`<id>.full.png`) e apontar
`referenceImageUrl` para o `.webp`. Reprocessar o acervo existente é um script de uma
passada sobre `public/photo-previews/`.

**Ganho esperado:** ~3,9 MB → ~40-60 KB por card. Primeira tela do grid sai de centenas de
MB para poucos MB. LCP e o custo de banda caem junto.

**Atenção ao ler `referenceImageUrl`:** ele é montado em três lugares —
`src/lib/search-index.ts:159`, `src/app/api/photo-mockup/[id]/publish/route.ts:106` e o doc
do Mongo. Trocar a extensão exige tocar os três (ou manter `.png` como nome e só mudar o
conteúdo, que é o caminho de menor atrito).

---

### 2. `unoptimized` no `next/image`

`src/app/page.tsx:89-97`
```tsx
<Image
  src={mockup.referenceImageUrl}
  fill
  sizes={`${thumbSize * 1.5}px`}
  unoptimized          // ← desliga tudo
  loading="lazy"
/>
```

Com `unoptimized`, o `sizes` logo acima vira decoração: nenhum `srcset` é gerado, nenhum
WebP/AVIF, nenhum resize. Mesmo padrão em `SuggestionCard` (`:237-245`).

**Fix:** remover `unoptimized` dos dois cards. As imagens são locais (`/photo-previews/...`),
então o otimizador do Next resolve sem precisar de `remotePatterns`. Se o item 1 for feito
primeiro, isto vira ganho incremental; se não for feito, isto sozinho já corta a maior parte
do peso — o otimizador redimensiona para o `sizes` declarado.

O `<Image priority>` em `:1880` está correto (preview grande do painel de detalhe).

---

### 3. `MockupCard` sem `memo`

`src/app/page.tsx:57` declara `function MockupCard(...)` sem `memo`, e `:1799-1804` passa
três closures novas por render:

```tsx
onSelect={() => selectRef(ref)}
onApply={() => { selectRef(ref); pendingRenderRef.current = ref; }}
onHide={() => hideMockup(ref)}
```

Como a página é um único componente com dezenas de `useState` (busca, filtros, brand, modais,
render logs…), **toda** mudança de estado re-renderiza os 60+ cards — cada um com `<Image>`,
badges e overlays. É o custo de INP mais óbvio da home.

**Fix:** `const MockupCard = memo(function MockupCard(...))` + estabilizar os handlers.
O caminho mais barato: passar `ref` inteiro e um handler estável por ação
(`onSelect={selectRef}` recebendo o objeto), com `selectRef`/`hideMockup` em `useCallback`
de deps vazias (ou via `useRef` para o estado que eles leem).

Nota relacionada: a `key` é `` `${ref.id}-${i}` `` (`:1792`) — incluir o índice quebra a
reconciliação quando o infinite scroll prepend/reordena. `key={ref.id}` basta, já que
`displayRefs` é deduplicado em `:1178`.

---

### 4. Zero `loading.tsx` / `error.tsx`

Varredura em `src/app`: nenhum `loading.tsx`, `error.tsx`, `template.tsx` ou `not-found.tsx`.

Existe um skeleton **client-side** decente em `src/app/page.tsx:1760-1771` (18 cards
pulsando), mas ele só aparece *depois* que o bundle da home baixou, parseou e hidratou.
Entre o HTML e esse skeleton há tela vazia.

**Onde colocar (descrição, não implementação):**

- `src/app/loading.tsx` — shell global: barra superior + sidebar de filtros em cinza +
  grade de 18 retângulos `aspect-[4/3]`. É literalmente o markup que já existe em
  `:1760-1771`, extraído para um componente compartilhado entre o `loading.tsx` e o estado
  `initialLoad`. Elimina a tela preta inicial sem duplicar design.
- `src/app/photo-mockup/loading.tsx` — o editor é o bundle mais pesado do app: rail de
  ferramentas à esquerda (ícones em placeholder), canvas central como retângulo 16:9, painel
  direito com 4 linhas de controle. Sem isso, abrir "Abrir" num card dá vários segundos de
  nada.
- `src/app/calibrate/loading.tsx` — mesma forma do photo-mockup, versão reduzida.
- `src/app/error.tsx` — hoje uma exceção no client derruba a árvore inteira sem UI.
- **Suspense por segmento:** só compensa depois do item 7. Com tudo `"use client"`, não há o
  que streamar — o servidor não busca nada.

O `photo-mockup/page.tsx:3` já importa `Suspense` (necessário por causa do `useSearchParams`),
então o padrão não é estranho ao repo.

---

### 5. `/api/references/tags` — agregação Mongo em todo mount

`src/app/page.tsx:652-658` dispara, em todo mount da home, `/studios` **e** `/tags`.

O `/studios` (`src/app/api/references/studios/route.ts:12`) sai do catálogo cacheado — ótimo.
O `/tags` (`src/app/api/references/tags/route.ts:17-29`) é outra coisa: agregação crua no
Mongo com `$unwind` duplo sobre `community_presets`, **sem cache, sem `$limit`**, a cada
carregamento de página.

Pior: ele é uma **fonte de verdade concorrente**. O `getFacets` foi escrito exatamente para
matar essa divergência (o comentário em `facets/route.ts:2-6` diz isso), mas o `/tags` velho
continua vivo e é ele que a home consome (`page.tsx:656`, alimentando `setAllTags` usado em
`:1639`).

**Fix, na ordem de preferência:**
1. Migrar o cliente para `/api/references/facets`, que já entrega `studios + tags + aspects`
   numa chamada sobre o catálogo cacheado, e aposentar `/tags` e `/studios`. Corrige
   performance *e* a divergência de contagem. Requer adaptar o shape (`facets.tags` é uma
   lista plana; `allTags` é agrupado por dimensão) — ver "Requer decisão".
2. Paliativo, se a migração não couber agora: envolver `dimensionTags()` em `unstable_cache`
   com `revalidate: 300` e tag `'catalog'`.

---

### 6. `Cache-Control` para `/photo-previews/*`

Arquivos em `public/` que não passam pelo pipeline de assets do Next são servidos sem
`immutable` e revalidam a cada navegação. Com PNGs de 3,9 MB, cada revalidação é uma
ida-e-volta cara (mesmo terminando em 304).

**Fix** — `next.config.ts` já existe e não tem `headers()`:

```ts
async headers() {
  return [{
    source: "/photo-previews/:path*",
    headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
  }];
}
```

**Cuidado:** `immutable` só é seguro porque o nome do arquivo é o id da cena — e o
`publish` **sobrescreve** `<id>.png` (`publish/route.ts:70`). Com `immutable`, um republish
não apareceria para quem já tem o arquivo em cache. Ou se usa `max-age=3600` sem `immutable`,
ou se acrescenta `?v=<mtime>` ao `referenceImageUrl` gerado em `search-index.ts:159`. A
segunda é a correta; a primeira é a barata.

---

### 7. Home inteira em `"use client"`

`src/app/page.tsx:1` é `"use client"` com 2773 linhas. Não há Server Component nenhum na
árvore da home. Consequência em cascata: nenhum dado vai no HTML inicial, o `search-index`
(que já está pronto e cacheado no servidor) só é consultado via `fetch` **depois** da
hidratação, e Suspense/streaming não têm o que fazer.

Mesmo quadro em `photo-mockup/page.tsx` (2019 linhas), `calibrate/page.tsx` (864) e
`scene/page.tsx` (437) — todos `"use client"` na raiz.

**Fix incremental, sem reescrita:** transformar `src/app/page.tsx` num Server Component fino
que chama `searchRefs({ page: 1, limit: 60, requirePsd: true })` e `getFacets()` direto (sem
HTTP) e passa como `initialRefs` / `initialFacets` para um `<HomeClient>` — o arquivo atual
renomeado. O client usa isso como estado inicial e só refetcha quando filtro/busca mudam.
Corta o waterfall `HTML → JS → hidratar → 4 fetches → render` para `HTML já com dados`.

Esforço alto (é o arquivo mais crítico do app), ganho alto. Ver "Requer decisão".

---

### 8. `fetchPage` engole requests

`src/app/page.tsx:600` `if (loading) return;` combinado com `loading` na lista de deps do
`useCallback` (`:640`). O `useEffect` de `:643-650` chama `fetchPage(1, false)` quando
busca/filtros mudam — se uma requisição estiver em voo, a nova é **descartada silenciosamente**
e o grid fica mostrando o resultado do filtro anterior.

Já existe um `AbortController` (`:603-605`) fazendo a coisa certa. O guard `if (loading)`
é redundante com ele e ativamente nocivo.

**Fix:** remover o guard e tirar `loading` das deps — deixar o abort resolver a corrida.

---

### 9. `getFacets` ignora o `search`

`src/app/api/references/facets/route.ts:14` passa `search` adiante, e `getFacets`
(`search-index.ts:346`) o repassa a `matchesFacets` — que nunca lê `q.search`
(`:276-286` só olha `studio`, `aspect`, `requirePsd`, `tags`).

Então as contagens de faceta são sempre globais, não refletem a busca ativa. É um bug de
correção com sintoma de performance: a UI promete contagens que o grid não entrega, e o
usuário filtra às cegas.

**Fix:** quando `q.search` estiver preenchido, restringir o `pool` ao conjunto de ids que o
MiniSearch retorna para aquela query (o `buildQuery` + `mini.search` já existem, é só
reaproveitar e passar o `Set<id>` como filtro extra). Ou, se o comportamento global for
intencional, remover o parâmetro da rota para não mentir.

---

### 10. `Map byId` reconstruído por request

`src/lib/search-index.ts:293`
```ts
const byId = new Map(docs.map((d) => [d.id, d]));
```

Roda em **todo** `searchRefs`. O `fetchMongoDocs` tem `.limit(20_000)` (`:105`), então no
pior caso são 20k alocações de par + 20k inserts por request — antes de qualquer busca.

**Fix:** o `Map` é derivado puro de `docs`, que já é cacheado. Construir junto com o índice,
em `getIndex()` (`:233-237`), e devolver `{ mini, docs, byId }`. Invalidado pelo mesmo
`invalidateCatalog()` que já existe. É a mesma memoização que o `indexCache` faz na linha
acima.

---

### 11. `listPhotoScenes` varre 168 diretórios em série

`src/lib/agent-mockup.ts:426-443`: `for (const id of await readdir(root))` com `await`
dentro do laço. Por cena: 2-3 `existsSync` de guarda + `existsSync` do `settings.json` +
3 `readFile` (`analysis.json`, `meta.json`, `settings.json`). Com 168 diretórios em
`.tmp/photo-scenes` + 2 em `data/`, dá ~840 syscalls de stat e ~500 leituras de arquivo,
**sequenciais**, a cada rebuild do catálogo. Em disco de rede (o repo vive em `Z:`) isso é
caro de verdade.

Some `search-index.ts:159`, que faz mais um `existsSync` por cena para decidir se o preview
existe.

**Fix:**
- Trocar o laço por `Promise.all(ids.map(...))` — I/O paralelo, mudança local e contida.
- Substituir os `existsSync` + `readFile` em sequência por um `readFile` com `catch` (uma
  syscall em vez de duas).
- Elevar o `CATALOG_TTL_MS` de 60s (`search-index.ts:24`). Os pontos de escrita já chamam
  `invalidateCatalog()` (`ingest-folder/route.ts:124`, `publish/route.ts:122`), então o TTL
  curto está protegendo apenas contra edições feitas fora do app (o `photo-agent tag` pela
  CLI). 5 minutos é uma troca melhor.

---

### 12. `findPsdForRef` — fallback linear por linha do Mongo

`src/lib/psd-index.ts:81-88`:
```ts
if (normRef.length >= 8) {
  const match = psds.find((p) => { const pNorm = normalize(p.name); ... });
}
```

Chamado dentro do `.map()` de `fetchMongoDocs` (`search-index.ts:113`), uma vez por
documento sem `psdPath`. Quando o índice normalizado não casa — o caso comum para os refs
sem PSD associado — cada linha varre a lista inteira de PSDs, com um `normalize()` (4
`replace` com regex) por item. É O(n·m) no rebuild do catálogo.

**Fix:** pré-computar `normalize(p.name)` uma vez em `buildIndex` (`:27-34`), guardando
`Array<{norm, psd}>` ao lado do `Map`. Mantém o algoritmo, elimina o trabalho repetido. Se o
custo persistir, memoizar por `refName` — o mesmo nome se repete entre rebuilds.

---

### 13. Grid sem virtualização

`displayRefs` (`page.tsx:1178`) cresce por acumulação no infinite scroll (`:626`,
`setRefs(prev => [...prev, ...])`). Após alguns scrolls são centenas de `MockupCard` no DOM,
cada um com `<Image>`, overlays com `backdrop-blur` e transições. O `backdrop-blur-sm` em
elementos de hover (`:133`, `:144`) é caro de compor mesmo invisível.

**Fix:** o item 3 (memo) resolve a maior parte do sintoma. Se não bastar, `@tanstack/react-virtual`
sobre o grid. **Não escrever virtualização à mão.** Verificar antes se já existe no
`package.json`.

---

### 14. Modais pesados sempre montados

O mesmo componente hospeda o grid, o painel de detalhe do PSD, o modal de duplicados
(`:2479-2560`, com SSE), o de ingestão (`:2578`), o de sessão (`:2244`) e o de brand assets
(`:2740`). Todos entram no bundle inicial da home.

**Fix:** `next/dynamic` com `ssr: false` para os quatro modais. O padrão já está no repo —
`calibrate/page.tsx:18` usa `next/dynamic`. Extrair cada modal para seu arquivo é o
pré-requisito, e é o mesmo movimento do item 7.

Sobre `photo-mockup/page.tsx`: os imports estáticos pesados são `magic-wand-tool` e
`guided-filter` via `SegmentCanvas`. O `onnxruntime-web/all` (840 KB) **não** vaza para o
bundle da página — `SegmentCanvas.tsx:17-19` importa `Sam2Client` (worker) e tipos
apagados em compilação; o `ort` fica no chunk do worker. Aqui está correto como está.

---

### 15. Lottie estático

`src/app/page.tsx:55` — `import boxLoaderData from "../../public/lottie/box-loader.json"`.
22 KB de JSON no bundle da home para uma animação de loading. Como o arquivo já vive em
`public/`, dá para carregá-lo por `fetch` no momento em que o loader aparece. Ganho baixo,
esforço baixo — item de arredondamento.

---

## Quick wins

Ordem de execução sugerida. Tudo abaixo é local, reversível e não mexe em arquitetura.

1. **Downscale dos previews** (`agent-mockup.ts:404`, `publish/route.ts:70`) + script de
   uma passada para reprocessar os 130 arquivos existentes. Sozinho, é o maior ganho da
   auditoria.
2. **Remover `unoptimized`** (`page.tsx:95`, `:243`).
3. **`memo` no `MockupCard`** + handlers estáveis + `key={ref.id}`.
4. **`src/app/loading.tsx`** reaproveitando o skeleton de `:1760-1771`, e `src/app/error.tsx`.
5. **Remover o guard `if (loading) return`** e tirar `loading` das deps (`:600`, `:640`).
6. **`headers()` no `next.config.ts`** para `/photo-previews/*` (com `max-age` moderado até
   resolver o versionamento — ver item 6).
7. **Memoizar o `byId`** dentro de `getIndex()` (`search-index.ts:233`).
8. **`Promise.all` no `listPhotoScenes`** (`agent-mockup.ts:426`) + `CATALOG_TTL_MS` para
   5 min.
9. **Pré-normalizar nomes de PSD** em `psd-index.ts:27`.
10. **`unstable_cache`** em `dimensionTags()` (`tags/route.ts:14`) enquanto a migração para
    `/facets` não acontece.

---

## Requer decisão

**A. Aposentar `/api/references/tags` e `/studios` em favor de `/facets`.**
O `/facets` foi escrito para ser a fonte única (ver o comentário em `facets/route.ts:2-6`),
mas a home ainda consome os dois endpoints antigos. O bloqueio é de shape: `facets.tags` é
uma lista plana `{name, count}`, enquanto a UI agrupa por dimensão (`page.tsx:1639`,
`Object.entries(allTags)`). Para migrar é preciso ou o `getFacets` passar a devolver as tags
agrupadas por `TAG_DIMS` (a informação existe — `dimsToTags` em `:68` hoje achata tudo), ou a
UI abandonar o agrupamento. É uma decisão de produto sobre o filtro, não de performance.

**B. Server Component na raiz da home (item 7).**
Ganho grande e estrutural, mas mexe no arquivo mais crítico do app e no fluxo que a equipe
usa todo dia. Faz sentido como trabalho dedicado, com o split de modais (item 14) junto —
são o mesmo refactor. Não misturar com os quick wins.

**C. Versionamento dos previews.**
`immutable` só é seguro com URL versionada, e o `publish` sobrescreve `<id>.png` no lugar.
Duas saídas: `?v=<mtime>` no `referenceImageUrl` (`search-index.ts:159`), ou nome com hash de
conteúdo. A primeira é trivial; a segunda é mais limpa mas obriga a atualizar o documento do
Mongo a cada republish. Escolher antes de ligar o `immutable`.

**D. Escopo do `getFacets` com busca ativa (item 9).**
Contagens globais ou contagens restritas à query? Hoje o código promete o segundo e entrega
o primeiro. Qualquer uma serve, desde que a rota pare de aceitar um parâmetro que ignora.
