<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

> **Setup e pré-requisitos moram no [`README.md`](README.md)** (`npm ci && npm run setup
> && npm run dev`, e o quadro do que cada peça ausente desliga). Este arquivo é o manual
> de operação: assume a máquina já de pé.

# Operação headless (agente via CLI)

Pedidos tipo "renderiza N mockups com a marca X" são atendidos pelo `scripts/agent-cli.ts` — fala direto com Mongo + Visant + render-server, sem precisar do Next:

```
npx tsx --env-file=.env.local scripts/agent-cli.ts brands
npx tsx --env-file=.env.local scripts/agent-cli.ts suggest --brand <id> --limit 20
npx tsx --env-file=.env.local scripts/agent-cli.ts render --brand <id> --count 20 --out .tmp/batch
```

- `render` escolhe os mockups via sugestão brand-aware (ou `--refs id1,id2` / `--search "billboard"`), baixa o logo da marca (ou `--art <path|url>`), enquadra por face (multi-face automático) e salva PNG/JPG numerados + `summary.json` no `--out`.
- Flags úteis: `--preview` (JPEG rápido), `--variant dark|light|icon` (variante do logo), `--mode cover|contain|stretch`, `--bg <hex|none>` (fundo do contain, default branco), `--padding 0.12`.
- Pré-requisitos: render-server rodando (`npm run render`, porta 4200) e Visant conectada (login pela UI uma vez — tokens ficam em `~/.visant/` — ou `VISANT_API_KEY` no `.env.local`).
- Sempre `npx tsx`, nunca `bun`, para scripts que acessam o Mongo (bun não resolve `mongodb+srv` no Windows).
- Debug de PSD: `bun scripts/debug-tree.ts <psd>` (árvore de camadas), `agent-cli.ts faces <psdFileName>` (faces editáveis), `bun scripts/render-cli.ts` (render sem TCP).

## Pipeline foto → mockup (sem PSD, sem Photoshop)

Converte fotos reais ou cenas geradas em mockups renderizados pelo engine Visant:

```
# 1. Detectar superfícies + extrair iluminação (cache em .tmp/photo-test-cv/)
bun --env-file=.env.local scripts/test-pipeline-cv.ts

# 2. Renderizar arte sobre as cenas detectadas
bun --env-file=.env.local scripts/photo-render.ts
bun --env-file=.env.local scripts/photo-render.ts --only nm_billboard_urbano,sp_paulista_billboard
```

- Adicionar nova foto: incluir em `PHOTOS[]` de `test-pipeline-cv.ts` + em `TARGETS[]` de `photo-render.ts`
- Imagens neon magenta (H≈300°): `neonMagenta: true` → detecção CV pura, zero LLM
- Arte: colocar PNGs em `Render/Art/`, referenciar por nome em `artFrame`
- Saída: `Render/Output/`
- Novas cenas: gerar via Visant `ai-generate-image` (gpt-image-2, 16:9, 2K) com superfície magenta flat → jogar em `Render/New Mockups/`

## Batch de mockups por marca/cliente

"crie N mockups com esses layouts" → `scripts/brand-mockup-batch.ts` (motor genérico; os `soccer248-batch*.ts` foram os primeiros casos):

```
npx tsx --env-file=.env.local scripts/brand-mockup-batch.ts \
  --layouts "H:/.../Layouts" --out "H:/.../Mockups" --count 20
```

- Pega os layouts (pasta ou CSV de arquivos), cura PSDs da biblioteca por categoria (billboard/poster/device/retail/signage, cotas proporcionais ao `--count`), casa cada arte por **aspect** da face e cospe full-res PNG numerado + `_summary.json`.
- Flags: `--preview` (JPEG rápido), `--fresh` (ignora summary, recomeça do 1), `--include billboard,poster` (filtra categorias), `--min-kb N` (descarta layouts pequenos), `--square` (só logo/ícone: pega PSDs com face ~1:1 — coaster, badge, sticker, selo, tag, mug, app icon, patch…).
- **Logo/ícone em mockups 1:1**: rode `scripts/prep-logo-squares.ts` (trim + recompõe o ícone centrado num quadrado com respiro, gera variações navy/amarelo/app-icon em `.tmp/soccer248-logo-art`) e depois `brand-mockup-batch --layouts .tmp/soccer248-logo-art --square`.
- **Retomável**: sem `--fresh`, pula o que já está no `_summary.json` e continua a numeração — dá pra ir disparando lotes na mesma pasta.
- **Lista explícita**: `--psds <lista.json|csv>` desliga a curadoria por categoria e o `--count` — renderiza exatamente esses PSDs, **na ordem da lista**. PSD sem doc no Mongo cai no `scanPsd` do arquivo (metade do catálogo é filesystem puro). É o canal que o `brand-kit --collection` usa.

### Renderizar a coleção curada na home — `brand-kit --collection`

A coleção por marca (marcador no card → `data/brand-collections.json`) vira entrega
num comando, sem redigitar a marca nem clicar 20 vezes:

> **Chave da coleção**: é o `brandId` (coleção da marca) **ou** um `col_…` (coleção
> avulsa, criada na home pelo botão de pasta — não precisa de marca). A API aceita
> `collectionId` e, por compat, `brandId`. `brand-kit --collection` continua sendo
> por marca. O nome default é neutro ("Coleção") e quem exibe o nome da marca é a UI:
> o servidor não conhece marca, e o antigo default `Coleção <id>` vazava id de banco
> para a tela.

```
npx tsx --env-file=.env.local scripts/brand-kit.ts \
  --brand <visantId> --collection --layouts "<dir criativos>" --out "<dir>"
```

- Renderiza **exatamente** os itens da coleção daquele brand id, **na ordem curada**
  (a ordem é trabalho humano — nada aqui reordena).
- **Um lote só**: com `--layouts`, a arte é o criativo (sai em `<out>/layouts`); sem
  ele (ou com `--only logo`), a arte é o logo/símbolo da marca (`<out>/logo`). Rodar
  as duas metades repetiria os mesmos mockups com duas artes.
- Incompatível com `--count`/`--refs`/`--search` — quem escolhe é a curadoria; aceitar
  as duas renderizaria outra coisa e o usuário só descobriria olhando os PNGs.
- Coleção vazia/inexistente: **falha** com o passo a passo de como curar. Não cai
  calado na sugestão automática.
- Item que não vira PSD renderizável (cena de foto, registro sem PSD, arquivo fora do
  disco) é pulado e listado com o motivo no fim, e também em `kit-summary.json`.
- Resume/`_summary.json` do motor continuam valendo.

Regras embutidas (mantêm consistência, vieram de erros reais):
- **device = face com aspect de tela** (retrato ~0.40–0.65), não a maior — senão pinta o cenário de fundo e deixa a tela com watermark.
- Cap de 8 faces (anti-OOM em murais de pôster) + try/catch por render.
- Murais multi-face recebem **layouts variados** (rotaciona entre os 3 mais próximos no aspect).
- Pré-requisito: render-server na 4200 (`npm run render`). PSDs resolvidos via `psd_metadata.filePath` no disco.

## Pipeline foto → kit de marca (sem PSD) — `scripts/photo-agent.ts`

O loop headless WYSIWYG: o que o agente gera é byte-idêntico ao app (mesmo core
`src/lib/photo-render-core.ts`). Lib-raiz `src/lib/agent-mockup.ts`; superfícies
(CLI/MCP/HTTP) são adaptadores finos. Sempre `npx tsx`.

```
# kit de marca em UMA tacada (gera nada — usa cenas já existentes na pasta):
#   finaliza (auto-detecta quad magenta) → tag estúdio → casa layout↔cena por
#   aspecto (layout=cover, logo=contain+fundo) → render WYSIWYG → previews → entrega
npx tsx scripts/photo-agent.ts kit --scenes-dir "Render/New Mockups/<Pasta>" \
  --layouts "<dir de layouts>" --logo "<file|dir>" --studio "Marca" \
  --bg "#16271a" --tags marca,campanha --out .tmp/kit-marca

# passos avulsos:
npx tsx scripts/photo-agent.ts scenes                      # lista cenas do store
npx tsx scripts/photo-agent.ts qa --dir "<pasta>"          # PRÉ-VOO: audita detecção (dry-run, sem bakar)
npx tsx scripts/photo-agent.ts finalize --dir "<pasta>" [--strict]  # imagem+quad → cena baked
npx tsx scripts/photo-agent.ts render --art <png|svg> --scenes "id,id" --fit cover
npx tsx --env-file=.env.local scripts/photo-agent.ts render --brand <visantId> --count N
npx tsx scripts/photo-agent.ts previews --art <logo>       # thumbnails do grid
npx tsx scripts/photo-agent.ts tag --scenes "id,id" --studio "Marca" --tags a,b
npx tsx scripts/photo-agent.ts gallery [--art <logo>]      # HTML+PNG de revisão
npx tsx scripts/photo-agent.ts dedupe [--apply]            # 1 por nome (pub>mais-assets)
```

- **Gerar cenas-base novas** (contexto da marca, superfície magenta 16:9): skill
  `visant-mockup-creator` (Visant `ai-generate-image`) → salva em `Render/New Mockups/<Pasta>/`.
  O `finalize`/`kit` auto-detecta o quad magenta (`detectKeyColorQuad`, CV puro) — sem
  `quads.json` precisa. Se a pasta tem `quads.json` (quad corrigido à mão), ele vence.
- **Gate de QA na detecção** (`detect-qa.ts`): cada detecção auto ganha um veredito
  `ok|review|reject` (ambiguidade de 2º painel, fill-ratio, geometria). Reprovou ⇒
  `finalize` cai na cascata SAM (`detectQuadSAM`); sem SAM, baka com `needsReview`
  no `analysis.json` (`--strict` dropa em vez de bakar). Rode `qa` antes p/ triar.
  Plano: `docs/PLAN-detection-qa.md`.
- **Grid (home)**: `/api/references` é adaptador fino sobre `src/lib/search-index.ts` —
  UM catálogo unificado (Mongo PSDs+publicadas ⊕ filesystem `data/`+`.tmp/photo-scenes/`),
  resiliente a Mongo offline, cacheado com stale-while-revalidate (TTL 60s). Busca =
  MiniSearch (BM25, peso por campo, prefixo, fuzzy em cascata) + sinônimos PT/EN em
  `search-synonyms.ts`. Facetas (estúdio/tag/aspecto) numa passada em
  `/api/references/facets`. Thumbnail = `public/photo-previews/<id>.webp` (reduzido a
  640px/q80 na escrita — o PNG cru chegava a 17 MB por card; leitura cai pro `.png`
  legado, converta com `npx tsx scripts/regen-previews.ts`).
  "Esconder Duplicados" agrupa por nome. Plano/medições: `docs/PLAN-search-facets.md`.
- **A busca aprende e se mede** (`search-telemetry.ts`): toda query vira linha em
  `.tmp/search/queries.jsonl`; todo clique num resultado vira sinal que reordena o
  ranking (`boostDocument`). `npm run search:report` mostra queries com ZERO resultado
  (buraco de vocabulário → vira sinônimo novo) e onde a cascata está resolvendo.
  O miolo do ranking é puro e testável em `search-engine.ts` — `search-index.ts` só
  carrega/cacheia o catálogo.
- **Ferramentas de saúde**: `npm run doctor` (cena sem estúdio, Mongo divergindo do
  settings.json, thumbnail faltando/gigante, nome duplicado — `--fix` só alinha o Mongo
  ao arquivo, nunca inventa estúdio) · `npm run smoke -- --url http://localhost:4100`
  (o app sobe? o grid lista? o filtro filtra? a busca acha?).

### PSD apagado no disco não vira card — `psd-presence`

O Mongo é espelho do disco, e o disco muda sem avisar. Apagar uma pasta de PSD
deixava o registro para trás e o card abria em erro (aconteceu: uma pasta
duplicada de 152 GB saiu e 30% do catálogo virou fantasma na mesma hora).

- **Leitura (automático)**: `src/lib/psd-presence.ts` roda no `buildCatalog` e
  esconde o registro cuja **pasta** sumiu. Confere pasta, não arquivo — medido:
  3.000 `existsSync` de arquivo no Drive = 2.600 ms, 357 de pasta = 280 ms, e
  ninguém apaga arquivo a arquivo. Não escreve nada.
- **Duas travas que não podem sair**: raiz do `PSD_DIRS` inacessível = disco
  desmontado, não deleção (nada some); e se >50% dos PSDs sumirem de uma vez,
  esconde **zero** e loga — card fantasma é menos grave que home vazia.
- ⚠️ **`npm run psd:repoint` ANTES de podar. Sempre.** Arquivo quase nunca some:
  ele muda de lugar (pasta renomeada, cópia duplicada removida). O repoint aponta
  o registro pro arquivo sobrevivente — um campo, segundos, sem abrir PSD — e
  preserva as faces/smart objects já extraídos. Na limpeza de 05/08/2026 ele
  religou **1.870 registros e perdeu zero**; podar direto teria apagado os 1.870.
  - Reindexar **não** substitui: `ONLY_NEW` do `scan-psds` pula por `fileName`, e
    `fileName` tem índice único — o doc morto bloqueia a reinserção do vivo.
  - `psd_metadata` desempata por `sizeBytes`; `community_presets` não tem tamanho,
    então resolve pelo `psd_metadata` (fileName único = resposta autoritativa).
    Por isso as duas fases rodam nessa ordem, no mesmo comando.
  - Nome repetido com 2+ candidatos e sem tamanho fica **intocado** e é listado:
    é o único jeito de apontar pro PSD errado, e o erro sairia calado num render.
- **Escrita (manual)**: `npm run psd:prune` (dry-run) → `-- --apply`, para o que
  sumiu de verdade. Limpa `psd_metadata` e `community_presets`. `--rapido` usa a
  checagem por pasta; o default é exato, porque apagar doc pede certeza.
- Placar no `catalogStats()` (`presenca`), visível em `/api/diag/memory`.

### Pack plugável do app desktop — `npm run pack:publish`

Monta (e sobe pro R2) o acervo que o app mostra antes de o usuário plugar pasta.

```
npm run pack:publish                 # audita + monta .tmp/pack/catalog.json
npm run pack:publish -- --limite 10  # amostra
npm run pack:publish -- --apply      # sobe (precisa R2_* no .env.local)
```

- **Só entra `license: boxy`** (ver triagem abaixo). Retomável por `--fresh`.
- **Item que não renderiza não é publicado**: cada PSD passa por um render real
  com arte diagnóstica (gradiente + grade + chapados — arte chapada esconde erro
  de blend). Dois portões, e o segundo só existe porque o primeiro deixou passar:
  - desvio-padrão < 4 ⇒ "mockup cinza";
  - **teste diferencial**: renderiza a MESMA cena com duas artes distintas e
    exige que > 0,3% do quadro mude. Pixel que muda é pixel que a arte controla.
    Quebrado dá **0,00%** — sinal limpo, sem zona cinzenta.
- ⚠️ **Não meça "a arte apareceu" procurando cor saturada no quadro.** Foi a
  primeira tentativa e ela erra nos dois sentidos: `Metropole 02 - Lambe` tem o
  pôster BRANCO (arte não entrou) e pontuou 3,4% porque o **grafite da parede**
  tem vermelho e amarelo; enquanto crachá e copo, legítimos, dão 2,2%. Cenário
  colorido é indistinguível de arte por cor. Só o diferencial resolve, porque o
  cenário é idêntico nos dois renders e se cancela.
- ⚠️ **Preencher face é `computeFaces` do engine, NUNCA `meta.smartObjects`.**
  Preenchendo todo SO, a arte pinta o cenário de fundo. Custou uma prévia
  destruída pra lembrar do que o próprio AGENTS.md já avisava.
- ⚠️ **E o slot é `face.smartObject`, NUNCA `face.name`.** `name` é rótulo curto
  de UI ("Frente", "Arte") e não identifica camada; `smartObject` é o path único
  do representante. Mandando o rótulo, o render casa o alvo errado — a arte cobre
  a cena inteira e a face fica com o placeholder. **O QA automático aprova**
  (imagem cheia de contraste, desvio alto), então só a contact sheet pega. Um
  item em doze estava assim e o script tinha dito 110/112 ok.
- A prévia do card **é** o render de QA: o usuário vê o mockup funcionando, não
  uma foto de catálogo que pode não bater com o resultado.

### Cena não substitui PSD (ainda) — `npm run pack:fidelity`

```
bun scripts/scene-fidelity.ts --amostra 6      # ou --psd "<arquivo>"
```

Compara as duas pipelines com a mesma arte e mede pixel a pixel:
`composePsd` (produção) vs `extractScene → renderScene` (o Scene Package).

**Resultado em 05/08/2026: 0 de 6 pixel-perfect.** Divergência de 164–229/255 em
~100% dos pixels, e a assinatura é sempre a mesma: o render pela cena sai
**lavado** (preto vira cinza, contraste e saturação somem). O `extractScene`
achata o PSD em `base`+`over` e perde a pilha de ajuste (Levels/Curves, grupo FX
em `pass through`). Em 5 dos 6 **a extração não avisou nada** — falha calada.

- Por isso o pack sobe **PSD** (14,7 GB) e não cena (seria 6x menor).
  `catalog.json` já reserva `sceneUrl` pra trocar sem mexer no cliente.
- Consequência viva: `/scene` e `/api/scene/extract` usam esse caminho e
  entregam render lavado hoje. É página de laboratório, não linkada no app.
- O `renderScene` em si está OK — o pipeline de foto monta o `SceneDoc` pelo
  `buildPhotoSceneDoc`, sem passar pelo `extractScene`.

### Licença do acervo — `npm run psd:triage`

Diz o que pode ser distribuído (app desktop, pack plugável) e o que não sai
daqui. Carimba **pasta**, o arquivo herda pelo prefixo mais longo.

```
npm run psd:triage                                    # relatório
npm run psd:triage -- --set "Z:/BOXY/Produtos=boxy"   # carimba (repetível, aceita #índice)
npm run psd:triage -- --only desconhecido --rescan
```

- `data/psd-license.json` (merge, nunca overwrite). Default `desconhecido`, e
  `desconhecido` **não distribui** — o erro caro aqui é o silencioso.
- Só `boxy` vira download público. Scan fica em cache; `--rescan` relê o disco.

## Peso do app: dev ≠ produção

Antes de caçar vazamento, saiba em qual dos dois você está olhando. Medido no
mesmo roteiro (boot → home → catálogo → 7 páginas → 8 buscas):

| | `next dev` | `next start` |
|---|---|---|
| boot | 566 MB | **265 MB** |
| depois de compilar a home | 1086 MB | 266 MB |
| fim do roteiro | **1384 MB** | **296 MB** |

**O 1,4 GB é o bundler, não o app.** Compilar a home sozinha custa +520 MB, e o
crescimento sob carga é +300 MB no dev contra +31 MB em produção — ou seja, não
há vazamento no código do app.

Precisa da máquina leve (lote de render, muitos apps abertos)? Rode em modo
produção, num `distDir` próprio para não brigar com o dev aberto:

```
NEXT_DIST_DIR=.next-prod npx next build
NEXT_DIST_DIR=.next-prod npx next start -p 4100
```

Medido nessa configuração: **219 MB de RSS** contra os ~1,5 GB do dev. Perde o
hot reload — é para usar, não para editar.

Para conferir de novo:

```
npm run perf:memory -- --url http://localhost:4100 --carga
```

Ele lê `/api/diag/memory` (rota fechada em produção) e separa `heapUsado`
(objeto JS vivo — é aqui que vazamento aparece), `external` (Buffer/ArrayBuffer)
e `rss` (a marca d'água que o Gerenciador de Tarefas mostra e que o V8 quase
nunca devolve ao SO). Aperto de memória na máquina: `DEV_NO_SOURCEMAPS=1`.

⚠️ **Turbopack não roda neste repo hoje.** `next dev --turbopack` derruba toda
rota que toca o engine (`Can't resolve '@visant/psd-engine'`): o pacote é um
symlink para fora da árvore e o Turbopack recusa o caminho real, inclusive por
`resolveAlias` absoluto. O bloco `turbopack` do `next.config.ts` já está pronto
para o dia em que o engine virar dependência publicada — aí valem os ~900 MB.

## Corpo de requisição tem teto de 10 MB (e ele corta calado)

Existe `src/middleware.ts`, e todo request que casa o matcher (`/api/:path*`) tem o
corpo **clonado** pelo Next antes de chegar na rota. O clone tem teto
(`DEFAULT_BODY_CLONE_SIZE_LIMIT`, 10 MB) e, estourado, **trunca em silêncio** — o
middleware nem lê corpo nenhum, mas a rota recebe um JSON cortado no meio.

O estrago era mudo em três camadas: `req.json()` da rota estoura → o handler morre
antes de qualquer `NextResponse.json` → o Next devolve **500 com corpo vazio** → o
`res.json()` do cliente estoura de novo. O usuário lia
`SyntaxError: Unexpected end of JSON input` — a mensagem do parser em cima do erro
real, que ficava invisível. Medido: **9 MB passa, 10 MB quebra**.

Quem estoura isso é o caminho normal do produto: `arts[]` leva PNG full-res em
base64 (+33%) e mockup multi-face manda **uma arte por face** — dois smart objects
de 2000×2832 já passam de 10 MB (foi assim que apareceu). `/api/search-by-image` e
`/api/calibrate/render` mandam imagem inteira pelo mesmo cano.

- **Teto**: `experimental.middlewareClientMaxBodySize: "64mb"` no `next.config.ts`.
  Mexer no matcher do middleware não é o conserto — o header `x-tenant` é para as
  rotas de API, é justamente onde os corpos grandes passam.
- ⚠️ **Nunca `await res.json()` seco depois de `if (!res.ok)`.** Resposta de erro
  sem corpo é o caso comum (todo 500 que o Next gera sozinho), e o parse estourando
  dentro do `try` faz o `catch` mostrar o erro do parser. `res.text()` → parse
  tolerante → fallback no status, que é o que sempre existe.
- **Portão**: `npm run check:render-failure -- C` injeta um 500 sem corpo e reprova
  se o aviso vazar "SyntaxError"/"JSON input". Provado nos dois sentidos.

## Imagem de fora do `public/` — `/api/local-image`

O grid usa `next/image`, e para gerar cada variante o otimizador **busca a fonte
e a carrega inteira em memória**. Metade do acervo mora no Google Drive, com PNG
de 13 MB servindo de thumbnail: medido, 29 cards do grid somavam **64 MB de
fonte** para entregar ~119 KB ao browser.

A rota agora normaliza a fonte (`src/lib/image-cache.ts`): WebP de lado 1600,
gravado em `.tmp/img-cache` com chave `caminho+mtime+tamanho+largura`. Mesma
medição depois: **0,64 MB — 100× menos**.

- `&w=N` — derivado nessa largura. **Era ignorado**: o `IngestDialog` pedia
  `w=64` para uma bolinha de 64px e recebia o arquivo original.
- `&raw=1` — bytes originais, em stream. **Obrigatório para quem lê pixel**: o
  `/calibrate` monta canvas com `naturalWidth` e compara com as dimensões do
  arquivo real; um derivado reduzido deslocaria todo quad calibrado em silêncio.
- Só extensão de imagem passa. Antes, qualquer arquivo saía como
  `application/octet-stream` — `?path=` era um leitor de arquivo arbitrário.
- `npm run img:warm` pré-gera os derivados do catálogo (idempotente, retomável).
- `minimumCacheTTL` de 31 dias no `next.config.ts`: com o default de 4h o
  otimizador voltava ao Drive buscar os 13 MB para regerar o mesmo WebP.
- ⚠️ **`settings.json` é o SSoT de `studio`/`tags` da cena** — quem escreve é
  `photo-agent tag`, e o doc do Mongo é só espelho (o grid faz overlay do arquivo por
  cima). Todo write nesse arquivo é **merge, nunca overwrite**: publish e finalize já
  apagaram o estúdio de cenas em produção sobrescrevendo-o. Escrita fora do processo
  (CLI) não invalida o cache — quem cobre é o TTL. Dentro do app, chame
  `invalidateCatalog()`.
- **Refino manual**: card → "Abrir" → `/photo-mockup?scene=<id>` (quad/máscara/warp/
  material/luz). Salva no `settings.json`; o loop respeita (WYSIWYG).
- **Lições de fit**: layout (creative full-bleed) = `cover`; logo = `contain` + `--bg`
  na cor da marca; comp pronta = `cover`. Casar arte↔cena por **aspecto**.
- **Marca no Visant Labs** (white-label, brand id): skill `brand-mockup-kit`.
  Marca com **assets locais + cenas novas**: este pipeline (`visant-mockup-creator` + `kit`).
