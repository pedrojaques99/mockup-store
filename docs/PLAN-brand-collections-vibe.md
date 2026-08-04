# Plano — Coleção por marca · Busca por vibe · Home que muda

> **Status: implementado** (04/08/2026). O que ficou diferente do plano está em
> "Como ficou de fato", no fim. `npm run search:embed` liga a camada densa;
> `npm run search:eval` mede o que ela acrescenta.

Três pedidos que se resolvem melhor juntos do que separados:

1. **Coleção por marca** — curar mockups à mão para a marca selecionada, navegável e com ajuda inteligente.
2. **Busca por vibe** — `"engenharia"` traz canteiro, obra, capacete, industrial, mesmo sem ninguém ter escrito "engenharia" em lugar nenhum.
3. **Home que muda** — a cada abertura, uma galeria diferente, enviesada pela marca ativa.

O elo entre eles: o **vetor**. O mesmo embedding que faz `"engenharia"` achar canteiro é o que
responde *"mais como este"* dentro da coleção e o que enviesa a home para a marca.

## O que já existe (não reinventar)

| Peça | Onde | Status |
|---|---|---|
| Catálogo unificado Mongo ⊕ filesystem, cache SWR | `src/lib/search-index.ts` | ✅ |
| Ranking puro/testável (MiniSearch BM25, cascata precisão→recall, sinônimos) | `src/lib/search-engine.ts` + `search-synonyms.ts` | ✅ |
| Telemetria que aprende com clique (`boostDocument`) | `src/lib/search-telemetry.ts` | ✅ |
| Lista persistida de ids com escrita atômica + `version` que invalida cache | `src/lib/hidden-store.ts` | ✅ — **é o molde da coleção** |
| Hidratar ids → cards **preservando ordem** | `refsByIds()` em `search-index.ts` | ✅ — curadoria ordenada sai de graça |
| Marca ativa (Visant), persistida, com swatches | `src/lib/visant.ts` + `page.tsx` (`localStorage["mockup-store:brandId"]`) | ✅ |
| Sugestão brand-aware (perfil LLM cacheado + score determinístico) | `src/lib/suggest-core.ts` + `brand-match.ts` | ✅ — vira o "completar coleção" |
| Multi-seleção na home (`sessionSelected`) | `page.tsx` | ✅ — vira "adicionar N à coleção" |
| SDK `openai` (compatível com NVIDIA NIM via `baseURL`) | `package.json` | ✅ |

O que falta é: a lista curada, a camada densa da busca, e um modo de ordenação.

---

## 1. Coleção por marca

**Store** — `src/lib/collection-store.ts`, espelho fiel do `hidden-store.ts`
(escrita atômica tmp+rename, cache em memória, `version` que invalida quem depende).

Arquivo `data/brand-collections.json`:

```jsonc
{
  "version": 1,
  "collections": {
    "<brandId>": {
      "name": "Coleção Acme",          // renomeável
      "items": [                        // ORDENADO — a ordem é curadoria
        { "id": "<SearchDoc.id>", "addedAt": 1754300000000, "note": "hero da campanha" }
      ],
      "updatedAt": 1754300000000
    }
  }
}
```

Por que arquivo e não Mongo: a home é **garantida offline** hoje (Mongo fora ⇒ catálogo só do
filesystem, sem quebrar). Curadoria manual é trabalho humano — não pode evaporar porque o
Atlas caiu. Mesmo argumento que tirou a lista de escondidos do `localStorage`.

Uma coleção por marca, não N. "Coleção da marca" é o conceito que o usuário pediu; pastas
dentro dela seriam invenção.

**API** — `src/app/api/collections/route.ts` (espelha `api/references/hide/route.ts`):

| Método | Entrada | Saída |
|---|---|---|
| `GET` | `?brandId=` | `{ brandId, name, items, references }` — cards hidratados por `refsByIds` (ordem preservada) |
| `GET` | *(sem brandId)* | `{ counts: { [brandId]: n } }` — para o badge do seletor de marca |
| `POST` | `{ brandId, ids[], member: boolean }` | toggle em lote |
| `PATCH` | `{ brandId, order?: string[], name?, note?: {id, text} }` | reordenar / renomear / anotar |

**UI** (`page.tsx`, dentro do que já existe — nenhum componente novo no design system):
- Botão marcador no card (hover; preenchido quando na coleção). Com N selecionados, o botão da
  barra de seleção vira **"Adicionar N à coleção de [marca]"**.
- `<Segmented>` no topo do grid: **Tudo · Sugeridos · Coleção**. "Coleção" busca
  `/api/collections?brandId=` em vez de `/api/references` — mesmo card, mesmo grid.
- Sem marca ativa, a aba "Coleção" fica desabilitada com o motivo dito ("selecione uma marca").
- Reordenar: arrastar o card dentro da aba Coleção (`PATCH order`).

**A parte inteligente** — dentro da aba Coleção, o rail *"Completar a coleção"*:
união de `suggestForBrand()` (perfil da marca) com os **vizinhos semânticos dos itens já
curados** (centróide dos embeddings da coleção → top-k), menos o que já está lá. Ou seja: a
coleção ensina o que buscar. É o mesmo motor da feature 2, sem código novo.

---

## 2. Busca por vibe (híbrida, BYOK)

Escolha do usuário: **embeddings + expansão de vocabulário**, com provedor plugável
(OpenAI / NVIDIA NIM / qualquer endpoint compatível — BYOK).

### 2a. Camada densa

`src/lib/embeddings.ts` — um provedor, três configurações. NVIDIA NeMo Retriever expõe
`/v1/embeddings` compatível com OpenAI em `https://integrate.api.nvidia.com/v1`, então o
mesmo SDK `openai` atende os dois; a diferença é `baseURL` + `model`.

```
EMBEDDINGS_PROVIDER = openai | nvidia | custom | off   (default: auto-detecta pela chave)
EMBEDDINGS_BASE_URL = https://integrate.api.nvidia.com/v1
EMBEDDINGS_MODEL    = text-embedding-3-small | nvidia/llama-3.2-nv-embedqa-1b-v2 | ...
EMBEDDINGS_API_KEY  = ...        (cai para OPENAI_API_KEY / NVIDIA_API_KEY)
EMBEDDINGS_DIMS     = 512        (só onde o modelo aceita redução)
```

Assimetria de retrieval (`input_type=query|passage`) tratada no adaptador: NVIDIA aceita o
sufixo `-query`/`-passage` no nome do modelo para manter compatibilidade OpenAI; OpenAI ignora.

`src/lib/semantic-index.ts`:
- Texto do doc = `name · studio · tags · mockupType · description` (o que o card mostra).
- Cache incremental em `.tmp/search/embeddings.jsonl`: `{id, hash, dims, vec(base64 float32)}`.
  Só re-embeda o que mudou de hash — reindexar o acervo inteiro é evento raro, não custo por request.
- `semanticSearch(query, k)` = cosseno em varredura direta. Com ~20k docs × 512 dims é
  aritmética de milissegundos; ANN aqui seria overkill.
- Embedding da query cacheado (memória + disco).
- **Sem chave ⇒ lista densa vazia ⇒ comportamento idêntico ao de hoje.** A busca nunca depende de rede.

### 2b. Fusão

RRF (Reciprocal Rank Fusion) em `search-engine.ts`: `score(d) = Σ 1/(60 + rank_i(d))` sobre a
lista léxica e a densa. RRF descarta as escalas — BM25 vai de 0 a 15, cosseno de 0.6 a 0.95, e
normalizar as duas é onde essas fusões costumam apodrecer. É a prática consolidada e cabe em
três linhas.

A cascata léxica atual (exato → fuzzy → OR) continua intacta: ela entra na fusão como uma das
listas, então quem escreveu o nome certo continua no topo.

### 2c. Vocabulário de contexto (offline, custo zero)

`search-synonyms.ts` ganha **clusters de vibe**: `engenharia → obra, canteiro, construção,
capacete, industrial, guindaste, andaime…` — e os irmãos (saúde, moda, gastronomia, tecnologia,
educação, esporte, imobiliário, automotivo, beleza, jurídico, música). Determinístico, testável,
e melhora o lado léxico mesmo com a rede fora.

`npm run search:report` já lista as queries com ZERO resultado — é dali que sai o próximo cluster.

### 2d. Medição (senão é fé, não engenharia)

- `scripts/embed-catalog.ts` (`npm run search:embed`) — constrói/atualiza o cache de vetores.
- `scripts/search-eval.ts` (`npm run search:eval`) — um fixture de queries de vibe
  (`"engenharia"`, `"clima de startup"`, `"loja de rua"`, `"vibe minimalista"`) com os ids que
  deveriam aparecer; imprime recall@10 **antes e depois** da camada densa. Sem esse número,
  "ficou mais inteligente" é opinião.

---

## 3. Home que muda, enviesada pela marca

`SortMode` ganha `"shuffle"`; `SearchQuery` ganha `seed?: number` e `biasIds?: string[]`.

- PRNG determinístico (`mulberry32`) semeado por `(seed, id)` — mesma semente, mesma página, mesmo
  resultado. Sem isso, paginar embaralha de novo e o usuário vê repetido.
- **Viés de marca**: os ids que a sugestão brand-aware devolve entram com peso maior e ocupam
  majoritariamente a primeira dobra; o resto do acervo entra embaralhado atrás. Home vira vitrine
  da marca ativa sem virar um filtro (o acervo continua todo lá).
- Sem marca ativa: embaralhamento com o peso de popularidade que já existe, para não afundar o bom.
- Semente nova a cada carga da página (`useState(() => Date.now())`), estável durante a sessão de
  scroll. Trocar de marca gera nova semente.
- Continua sendo função pura em `search-engine.ts` → testável sem I/O.

---

## Arquivos

| Arquivo | Ação |
|---|---|
| `src/lib/collection-store.ts` | novo — lista curada por marca, escrita atômica |
| `src/app/api/collections/route.ts` | novo — GET/POST/PATCH |
| `src/lib/embeddings.ts` | novo — provedor BYOK (OpenAI/NVIDIA/custom) |
| `src/lib/semantic-index.ts` | novo — cache incremental + busca por cosseno |
| `src/lib/search-engine.ts` | editar — RRF, `sort: "shuffle"`, `seed`, `biasIds` |
| `src/lib/search-index.ts` | editar — plugar a camada densa e o viés |
| `src/lib/search-synonyms.ts` | editar — clusters de vibe |
| `src/app/api/references/route.ts` | editar — params `seed`, `brandId`, `sort=shuffle` |
| `src/app/page.tsx` | editar — aba Coleção, marcador no card, semente por sessão |
| `scripts/embed-catalog.ts`, `scripts/search-eval.ts` | novos |
| `src/lib/__tests__/{collection-store,semantic-fusion,shuffle,synonyms-vibe}.test.ts` | novos |

## Riscos assumidos

- **Sem chave de embeddings** o produto não regride: a busca volta a ser exatamente a de hoje,
  agora com os clusters de vibe. A camada densa é aditiva por construção.
- **Custo**: indexar o acervo é uma vez (centavos); por request só se embeda a query, cacheada.
- **Reordenar arrastando** é a única peça de UI realmente nova — se der atrito, a coleção continua
  útil na ordem de adição.

---

## Como ficou de fato

O que o plano não previu e a implementação aprendeu:

- **O vocabulário de vibe resolve o caso do enunciado sozinho, offline.** `"engenharia"`
  devolve 703 resultados com os cinco primeiros sendo `HM_CONSTRUCTION_*` — sem rede, sem
  chave, só os 15 clusters de setor. A camada densa passou a ser o que cobre o que
  *nenhum* cluster previu, e não o motor principal. O teste que existia para provar o
  resgate teve de ser reescrito porque a premissa "o léxico não acha isto" deixou de ser
  verdade — é a melhor forma de um teste falhar.
- **Os clusters são mão única, não classe de equivalência.** `engenharia → obra` sim;
  `obra → engenharia` não. Simétrico, `"coffee"` passaria a trazer padaria, vinho e
  restaurante: quem sabe o que quer pagaria o ruído de quem não sabe.
- **`car` ficou fora do cluster automotivo.** Com `prefix: true`, ele casa
  `card`/`cardboard`/`cardstock` — e o acervo é feito de cartão. É a armadilha do hífen
  outra vez, agora por prefixo.
- **A home embaralhada precisou de uma penalidade para card sem prévia.** Medido na
  primeira captura: 4 dos 15 cards da primeira dobra eram "Sem prévia" — o sorteio
  gastando a área mais cara da tela com o item que não dá para escolher pelo olho.
  Penalidade (`-0.35`), não filtro: o item continua na lista.
- **Semente por carga da página, não por request.** Duas sementes → duas galerias
  completamente diferentes (verificado pela API); a mesma semente → a mesma ordem em
  qualquer página, que é o que impede card repetido no scroll infinito.
- **`sort` virou o campo com três valores** (`shuffle` é o novo default da home), e o
  `seed`/`brandId` viajam na querystring de `/api/references`.

### Adendos pedidos durante a execução

- **"Ver similares" no hover do card** (`/api/references/similar`): responde a pergunta que
  se faz olhando UM card, que nem `/api/search-by-image` (precisa de arquivo) nem
  `/api/suggest` (fala da marca) respondiam. Usa `centroidRank` de um id só; sem vetor,
  cai para uma busca pelas próprias tags do mockup e o chip avisa `(por tags)` — um botão
  que às vezes acerta menos é melhor que um botão que às vezes não faz nada. O grid entra
  no mesmo modo "resposta em vez de catálogo" da busca por imagem, com chip que desfaz.
  Verificado no acervo real: pedir similares de `HM_CONSTRUCTION_046` devolve seis
  `HM_CONSTRUCTION_*`, modo `semantic`.
- **Nenhum ícone de estrela no repo.** As 19 ocorrências de `Sparkles` (lucide) saíram,
  cada uma trocada pelo ícone que descreve a ação — `Pipette` no conta-gotas, `Waves` no
  relevo, `Expand` em expandir cena, `MousePointerClick` na seleção de objeto,
  `ScanSearch` em ver similares, `ListPlus` em completar a coleção. Estrela/brilho é
  decoração genérica: não diz o que o botão faz e ainda carimba "isto aqui é IA", que é
  detalhe de implementação, não diferencial.

Medições e portões desta entrega: 334 testes verdes, `tsc --noEmit` limpo, `npm run build`
verde, `console-check` com 0 erros e 0 avisos, `home-visual-check` 12/12 — e a captura foi
aberta, que é como a penalidade de prévia foi descoberta.

## Fora de escopo

- Múltiplas coleções por marca / pastas.
- Compartilhar coleção (export para o `brand-kit.ts` — trivial depois: é uma lista de ids).
- Reranking com cross-encoder.
