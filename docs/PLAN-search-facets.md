# Plano — Busca decente + facetas no grid

Status: **implementado** (fases 0–4). Build verde, 144 testes passando, validado end-to-end
contra o acervo real (1620 itens).
Escopo: `/api/references`, `/api/references/facets|studios|tags`, barra de filtros da home.

---

## 0. Já feito — filtro por estúdio (bug)

`settings.json` é o SSoT de `studio`/`tags` por cena (é o que `photo-agent tag` escreve),
mas o publish gravava `studio: "Photo Scene"` chapado no Mongo, e no merge do grid o doc
do Mongo vence o item do filesystem. Toda cena publicada perdia o estúdio real.

| Arquivo | Mudança |
|---|---|
| `api/photo-mockup/[id]/publish/route.ts` | `studio` vem de `settings.studio` → `body.studio` → `"Photo Scene"`; `tags` faz união com `settings.tags` |
| `api/references/route.ts` | cenas `type:"photo"` escapam do filtro studio/tags do Mongo; overlay do `settings.json` por cima do doc; facetas reavaliadas em memória (`matchesFacets`) |
| `api/references/studios/route.ts` | cenas photo saem da agregação do Mongo e são contadas pelo `settings.json` (publicadas incluídas) |

Conserta as cenas **já publicadas** sem migração no banco.

---

## 1. Diagnóstico da busca atual

Tudo em `src/app/api/references/route.ts`:

1. **Dois algoritmos diferentes na mesma resposta.** Mongo `$text` (≥3 chars) ou `$regex`
   (<3) para PSDs; `String.includes()` para cenas do filesystem. Mesma query, semânticas
   diferentes, resultados incoerentes na mesma página.
2. **O ranking é jogado fora.** O `textScore` é calculado (`:134`) e descartado pelo
   `.sort(localeCompare)` do merge (`:164`) — que é o caminho da home (`has_psd=true`).
   Na prática a home ordena por nome alfabético, sempre.
3. **Sem match parcial.** `$text` tokeniza por palavra: "billb" não acha "billboard".
   É o oposto do que a pessoa espera ao digitar.
4. **Zero tolerância a erro.** "bilbord", "outddor", "Soccer 248" vs "Soccer248" → 0 resultados.
5. **Sem sinônimos.** O acervo é PT+EN misturado: quem digita "outdoor" não acha
   "billboard", "camiseta" não acha "tshirt", "prédio" não acha "facade".
6. **Regex sem escape** (`:85-87`): `(`, `[`, `*` no termo vazam pro motor de regex.
7. **Campos de menos.** Não busca em `psdFileName`, `smartObjectName`, `studio` nem
   `dimensions.*` — justamente onde mora o vocabulário útil do acervo.

## 2. Decisão de lib — MiniSearch

Nenhuma lib de busca instalada hoje. Avaliados:

| Lib | Prós | Contras | Veredito |
|---|---|---|---|
| **MiniSearch 7.2.0** | índice invertido + BM25; `prefix` **e** `fuzzy` (edit distance) juntos; `boost` por campo; `processTerm`/`termExpansion` (hook nativo pra sinônimos); `filter` pra facetas; ~10kB, zero deps; roda no server | precisa manter o índice em memória | **escolhido** |
| Fuse.js 7.5.0 | fuzzy famoso | O(n) por query, sem índice; sem stemming; ranking pobre em multi-campo; sem hook de sinônimo | não |
| Orama 3.x | híbrido léxico+vetorial, facetas nativas | peso e complexidade (embeddings, persistência) pro tamanho do acervo | overkill agora |
| Mongo Atlas Search | fuzzy + sinônimo gerenciados | exige cluster Atlas com Search habilitado; não cobre as cenas do filesystem | não |

Manter o `$text` do Mongo **só** como fallback se o índice não estiver quente.

## 3. Arquitetura

**Chave: catálogo unificado.** Hoje Mongo e filesystem são buscados separados e depois
colados — daí a incoerência. Inverte-se: carrega o catálogo inteiro (Mongo + FS, já com o
overlay do `settings.json`), indexa uma vez, e busca/facetas/paginação rodam sobre ele.

`src/lib/search-index.ts` (novo):

```ts
buildCatalog()   // Mongo + listPhotoScenes() + overlay settings.json → SearchDoc[]
getIndex()       // MiniSearch quente, TTL ~60s + invalidate() no publish/tag
searchRefs(q, { studio, tags, tagMode, aspect, page, limit })
```

`SearchDoc`: `id, name, studio, description, tags[], psdFileName, smartObjectName,
mockupType, aspect, source: "mongo"|"fs", type`.

Config do MiniSearch:

```ts
fields: ["name", "studio", "tags", "mockupType", "description", "psdFileName", "smartObjectName"]
searchOptions: {
  boost: { name: 6, tags: 4, studio: 3, mockupType: 2 },
  prefix: true,
  fuzzy: (t) => (t.length <= 4 ? 0 : 0.2),   // typo tolerance só em termos longos
  combineWith: "AND",                         // AND com fallback pra OR se der 0
}
processTerm: (t) => deburr(t.toLowerCase())   // "prédio" ≡ "predio"
```

`/api/references` vira um adaptador fino sobre `searchRefs()`. O `$text` do Mongo sai do
caminho quente (o índice de texto pode ficar, é barato).

## 4. Camada semântica (sem embeddings)

`src/lib/search-synonyms.ts` — dicionário PT↔EN + conceitos, expandido no `termExpansion`:

```
outdoor|billboard|painel|placa|ooh
camiseta|tshirt|t-shirt|camisa|apparel
predio|fachada|facade|building|wall|muro|parede
celular|phone|mobile|iphone|device|tela|screen
copo|caneca|mug|cup   ·   adesivo|sticker|decal
sacola|bag|shopping   ·   embalagem|package|box|caixa
cartaz|poster|pôster  ·   loja|retail|store|vitrine|storefront
```

Cobre "outdoor na rua" (multi-token: `outdoor`→billboard + `rua`→street/urbano). Custo:
um arquivo, zero infra. **Se depois quiser embeddings de verdade**, o gancho é o mesmo
ponto — Orama com vetor, ou re-rank com `ai-describe-image` já disponível no Visant MCP.
Não fazer agora (overkill).

## 5. Facetas na UI

⚠️ Toca componentes → **precisa da tua aprovação antes de eu mexer**, e usando o design
system existente (a home hoje é um `page.tsx` de 2773 linhas, sem componente de grid).

- Chips combináveis: **estúdio** · **categoria/superfície** · **aspecto** (1:1 / 16:9 /
  retrato) · **tags** — cada um com contagem, e desmarcável.
- Contagens vêm do próprio catálogo (uma passada), não de 2 endpoints de agregação —
  `/api/references/studios|tags` podem virar um só `/api/references/facets`.
- Estado das facetas na URL (compartilhável, sobrevive a F5).
- Aspecto é derivado (`sceneAspect()` já existe) — é o filtro que o pipeline mais usa
  ("casar arte↔cena por aspecto") e hoje não existe na UI.

## 6. Fases — todas entregues

| # | Entrega | Arquivos |
|---|---|---|
| 0 | fix do filtro por estúdio (3 bugs, 1 destrutivo) | ver §0 |
| 1 | catálogo unificado + MiniSearch; `/api/references` vira adaptador (175 → 40 linhas) | `lib/search-index.ts` |
| 2 | sinônimos PT/EN + normalização sem acento | `lib/search-synonyms.ts` |
| 3 | `/api/references/facets` (estúdio/tag/aspecto numa passada); `/studios` passa a sair do mesmo catálogo | `api/references/facets/route.ts` |
| 4 | chips de aspecto (1:1 / Retrato / Paisagem) na sidebar, reusando a linguagem visual existente | `app/page.tsx` |

### Três defeitos que só apareceram medindo

Documentados porque a intuição errou nos três:

1. **`"bilbord"` → 0 hits.** `fuzzy: 0.2` dá ~1 edição; o typo estava a 2. Virou cascata
   de 3 passes (exato+prefixo → fuzzy → fuzzy+OR), afrouxando só quando vem pouco
   resultado. Quem escreveu certo não paga o ruído de quem escreveu errado.
2. **`"camiseta"` → 1444 de 1620 itens.** `"t-shirt"` no dicionário era tokenizado em
   `["t","shirt"]` e o `"t"` com prefix-match pegava todo doc com palavra começando em T.
   Um hífen envenenava o grupo inteiro. Sinônimo agora é partido e caco < 3 letras é
   descartado (`MIN_SYNONYM_LEN`) — 1444 → 170. Tem teste de regressão.
3. **`"predio"` → 876.** O grupo fundia `predio` com `parede/wall/muro` — mas quase todo
   mockup *está* numa parede. Grupos separados → 517.

### Ganho medido

| | antes | depois |
|---|---|---|
| `"bilbord"` (typo) | 0 hits | 441, billboard no topo |
| `"outdoor"` | não achava `billboard` | 637, billboards no topo |
| `"camiseta"` | não achava `t-shirt` | 170 apparel |
| ranking na home | descartado (ordem alfabética) | BM25 com peso por campo |
| filtro por aspecto | só no CLI | na sidebar |
| catálogo (2º request) | ~6s | servido do cache, rebuild atrás |

## 7. Riscos & o que ficou de fora

- **Memória do índice**: catálogo inteiro em RAM (~1620 docs, trivial). Acima de ~50k,
  persistir serializado (`MiniSearch.toJSON`/`loadJSON`).
- **Invalidação**: `invalidateCatalog()` está em publish e ingest-folder. Escrita
  **fora do processo** (CLI `photo-agent tag`) não invalida nada — quem cobre é o TTL de
  60s com stale-while-revalidate. Aceito de propósito.
- **`listPhotoScenes()` varria o disco a cada request** — o catálogo cacheado consertou
  isso de graça.
- **Não feito**: estado das facetas na URL (compartilhável/F5), chips de tag na sidebar
  (o filtro de dimensões antigo continua), e busca vetorial. Ver §8.

## 8. Rodada 2 — "nível vale do silício"

### Feito

| # | Item | Como |
|---|---|---|
| 1 | **Ranking que aprende com o uso** | `search-telemetry.ts` + `POST /api/references/click`. Clique vira sinal (global + afinidade query↔doc), entra como `boostDocument`. Escala **logarítmica** de propósito: o 1º clique vale muito mais que o 100º, senão os 3 mockups mais usados afundam o acervo pra sempre — o feedback loop que mata a descoberta. Popularidade **desempata**, não sequestra: tem teste provando que o conjunto de resultados não muda. |
| 2 | **Métrica de busca** | Toda query vira linha em `.tmp/search/queries.jsonl`. `npm run search:report` mostra queries com ZERO resultado (buraco de vocabulário → candidato a sinônimo) e em que passe da cascata cada uma resolveu. Era o sinal que teria pego o bug do `"t-shirt"` sem ninguém medir na mão. |
| 3 | **Motor puro e testável** | O ranking saiu pra `search-engine.ts` (zero I/O); `search-index.ts` só carrega/cacheia. Deu pra testar recall e relevância contra catálogo sintético: 21 testes novos. |
| 4 | **Smoke de ponta a ponta** | `npm run smoke` — a home sobe? o grid lista? o filtro filtra? a busca acha? a paginação repete item? Sai com código 1, serve de gate no CI. |
| 5 | **Doctor do acervo** | `npm run doctor` — cena sem estúdio, Mongo divergindo do `settings.json`, thumbnail faltando/gigante, nome duplicado. `--fix` só faz a correção segura (alinhar Mongo → arquivo); nunca inventa estúdio, e cospe o comando pronto pro humano decidir. |
| 6 | **Thumbnails** | Escrita passa por `sharp` (640px, WebP q80) nos **três** pontos que gravavam o render cru. Medido: **506,3 MB → 5,6 MB (99%)**. `scripts/regen-previews.ts --dry\|--delete-legacy` converte o legado; leitura tem fallback `.webp` → `.png`. |

### O quarto defeito, achado por um teste

O teste `"query exata resolve no primeiro passe"` falhou — e não era o teste que estava
errado. Com poucos resultados, a cascata **substituía** o resultado do passe exato pelo do
passe frouxo: uma query com 3 acertos perfeitos era inundada por fuzzy+OR e os 3 certos
afundavam. Agora cada passe só **acrescenta na cauda**; o topo é sempre do passe mais
estrito. Foi o primeiro bug que a suíte pegou sozinha, em vez de eu ir medir na mão — que
é exatamente o ponto de ter motor puro.

### Ainda em aberto

1. **Busca por imagem / semântica real.** "acha um mockup parecido com esta foto",
   "outdoor à noite chuvoso" — não sai de dicionário. Precisa de embedding (CLIP pra
   imagem) + índice vetorial. O gancho é `search-engine.ts`, que já recebe o catálogo
   pronto. É a única da lista que exige infra nova, por isso ficou por último.
2. **`page.tsx` com ~2800 linhas.** Continua o maior risco de manutenção do repo. Plano
   parcial em `docs/REFACTOR_PAGE_HOOKS.md`.
3. **Teste de UI de verdade.** O smoke cobre HTTP, não interação — ninguém garante que
   um clique no chip filtra. Playwright em 3–4 fluxos.
4. **Qualidade de dado** (o doctor mede, o humano decide): 126 cenas sem estúdio, 6 sem
   thumbnail, 25 nomes duplicados — `05_busstop_shelter` existe **10 vezes**. Busca boa
   não compensa catálogo sujo.
