# PLAN — clone-and-run

**Objetivo:** um dev novo faz `git clone`, roda dois comandos e vê o app funcionando —
sem te perguntar nada, sem acesso ao Z:/, sem Mongo, sem credencial.

**Princípio:** a garantia não pode morar num README (README apodrece). Ela mora no CI.
O que prova que o clone funciona é um job que **clona, instala, sobe e bate HTTP no app**.
O README só explica o que o CI já provou.

---

## 1. Diagnóstico

### O que já está de pé (não mexer)

- `.npmrc` já tem `legacy-peer-deps=true` — o conflito `ag-psd` 30 vs peer `^28` está
  resolvido no repo, o dev novo não tropeça nisso.
- `package-lock.json` versionado; `.gitignore` já barra `.tmp/`, `/data/`, `/Render/`,
  `/public/photo-previews/`, `.env*`, `*.traineddata`.
- `.git` = 5,8 MB. Zero binário grande versionado. Repo é enxuto.
- `scripts/smoke.ts` já existe e já é exatamente o teste certo ("a home responde? o
  filtro filtra? a busca acha?"). Só não está ligado em lugar nenhum.
- Catálogo degrada gracioso: `search-index.ts:136` engole a falha do Mongo e
  `listPhotoScenes().catch(() => [])` engole a falta de disco. **A home não dá 500 sem
  Mongo** — ela vem vazia.

### Bloqueadores duros

> **B0 é o bloqueio que anula todos os outros. Sem ele resolvido, o resto é decoração.**

#### B0 — `@visant/psd-engine` é um link para uma pasta fora do repo — ✅ RESOLVIDO em 10/08/2026

> `@visant/psd-engine@0.2.0` está publicado (npm, MIT, `pejaques`) e o `package.json`
> daqui pede `^0.2.0`. `grep Cursor/visantlabs-os package-lock.json` dá **zero**, e o CI
> ganhou um passo que falha se o caminho local voltar. Os dois jobs perderam o clone do
> `visantlabs-os` — não existe mais repositório irmão no caminho crítico.
>
> Medido depois da troca: `tsc --noEmit` 0 erros, 459 testes em 40 arquivos passando.
>
> ⚠️ O que a 0.2.0 carrega além dos exports: a correção da **cena lavada**. O
> `extractScene` perdia a pilha de ajuste (grupo `FX` em `pass through` virava um `over`
> chapado), e agora adjustment layer vira `role: 'adjust'` com LUT, aplicado em ordem de
> documento. Isso muda o comportamento de `/scene` e `/api/scene/extract` — ver
> `scene-fidelity` antes de assumir que os números antigos valem.
>
> O diagnóstico abaixo fica como registro do que o defeito era.

`package.json:28` declara `"@visant/psd-engine": "^0.1.0"`, mas o lockfile revela o que
isso é de verdade (`package-lock.json:5009-5012`):

```json
"node_modules/@visant/psd-engine": {
  "resolved": "../../Cursor/visantlabs-os/packages/psd-engine",
  "link": true
}
```

É `Z:\Cursor\visantlabs-os\packages\psd-engine` — um repositório irmão que **não existe
em nenhuma outra máquina** e que nenhum doc menciona. O pacote não está em registry
nenhum.

Consequência, medida e não suposta: `npm ci` passa, e aí o `tsc` explode com **15
erros `TS2307: Cannot find module '@visant/psd-engine'`** em
`src/app/api/psd-info/route.ts:3`, `src/app/api/calibrate/render/route.ts:13`,
`src/app/api/scene/[sceneId]/render/route.ts:5,34`, `src/app/api/scene/extract/route.ts:34`,
`src/app/scene/page.tsx:5`, `src/lib/agent-mockup.ts:97`, `src/lib/photo-scene.ts:7`,
`src/lib/psd-scan.ts:4`, `src/lib/render-cache.ts:55`, `src/workers/render.worker.ts:20`
e nos testes. O engine também é o miolo do `scripts/render-server.ts:5-12` — sem ele o
caminho de render inteiro está morto, e ele está listado em
`next.config.ts:28` (`serverExternalPackages`), então precisa existir em runtime também.

**Correção do que eu disse antes: o CI nunca passou.** São 4 runs, 4 falhas
(2026-06-18, 06-19, 07-25, 07-31), todas parando no `tsc`, o segundo passo. O CI não
prova que o clone builda — ele vem gritando há dois meses exatamente este defeito.

Os ~11 erros `TS7006` (implicit any) que aparecem junto **não são independentes**: eles
cascateiam do módulo faltando. `psd-scan.ts:67` faz `.filter((l) => …)` sobre o retorno
de `flattenLayers`, que vem do engine — sem o módulo, `l` não tem tipo. Rodando `tsc`
nesta máquina, onde o link existe, o resultado é **0 erros**. Ou seja: os 26 erros do
CI são um defeito só, e ele morre inteiro quando o pacote resolver.

E `next.config.ts:5-6` liga `eslint.ignoreDuringBuilds` + `typescript.ignoreBuildErrors`,
ou seja o `build` não é portão de tipo — quem seria é o `tsc --noEmit` do CI, e ele
está vermelho.

**A saída é muito mais barata do que parecia: o pacote JÁ ESTÁ no npm público.**
`npm view @visant/psd-engine` devolve `0.1.0`, publicado em 2026-06-12, licença MIT,
sob o usuário `pejaques`. O problema é que **a 0.1.0 ficou para trás**: o
desenvolvimento continuou no link local sem republicar. Comparando os exports:

| Publicado 0.1.0 | Local (linkado) |
|---|---|
| `flattenLayers`, `replaceLinkedSmartObjects`, `perspectiveWarp`, `composePsd`, `coverArtCanvas`, `BLEND_MAP`, `computeFaces`, `SO_TARGET`, `BRAND_HIDE`, `SO_DECOR` | tudo isso **mais** `resolveSoTarget`, `applyHideRules`, `createNodeAdapter`, `initializeAgPsdCanvas`, `createBrowserAdapter`, `preloadDisplacementMaps`, `createBrowserFsCallbacks`, `extractScene`, `renderScene`, `applyDisplacementFilter`, `buildAdjustmentLut` |

O app importa 8 símbolos que a versão publicada não tem. Por isso instalar do registry
hoje não resolveria — é preciso republicar.

**O conserto, verificado:**

```bash
cd Z:/Cursor/visantlabs-os/packages/psd-engine
npm version minor            # 0.1.0 → 0.2.0
npm publish --access public  # o prepublishOnly já roda o build

cd Z:/BOXY/mockup-store
npm i @visant/psd-engine@^0.2.0   # tira o link do lockfile
```

Atenção ao range: o atual é `^0.1.0`, e em `0.x` o caret trava o minor — ele **não**
pegaria a 0.2.0 sozinho. O `npm i` acima já reescreve.

Isto é a única coisa em todo este plano que precisa da sua mão: é publicação num
registry público, irreversível, na sua conta e em outro repositório.

| # | Problema | Evidência |
|---|---|---|
| B1 | **`tsx` não é dependência.** 3 scripts npm chamam `tsx` pelado (`smoke`, `doctor`, `search:report`) e ele não está no `package.json` nem no `node_modules`. Num clone limpo esses comandos morrem com "command not found". | `package.json:12-14`; `node_modules/.bin/` não tem `tsx`; `node_modules/tsx/` não existe |
| B2 | **O CI nunca chega a exercitar o B1.** `ui:audit` e `perf:catalog` usam `npx tsx` (que baixaria o pacote na hora), mas o job morre no `tsc` antes disso. `doctor` e `smoke` não rodam no CI em run nenhum. | `package.json:17-18` vs `.github/workflows/ci.yml:31-48` |
| B3 | **README é o boilerplate do `create-next-app`.** Zero palavra sobre Mongo, Visant, render-server, PSD_DIRS ou variável de ambiente. O `AGENTS.md` documenta *uso* (pipelines, CLIs), nunca *setup*. 26 docs de plano em `docs/`, zero de onboarding. | `README.md` |
| B4 | **26 variáveis de ambiente, nenhuma documentada, sem `.env.example`.** O dev novo não tem como saber o que é obrigatório, o que é opcional, nem o que cada ausência desliga. | grep `process.env.` em `src/` + `scripts/` |
| B5 | **Clone limpo = app vazio.** `data/`, `public/photo-previews/` e `Render/` são gitignorados (0 arquivos versionados). O dev sobe o app, vê um grid vazio e não sabe se quebrou ou se é assim mesmo. | `git ls-files data public/photo-previews Render` → 0 |
| B6 | **`npm run render` exige `bun`**, que não é declarado em lugar nenhum — e o `AGENTS.md` ainda avisa "sempre `npx tsx`, nunca `bun`" para scripts com Mongo. Contradição não explicada para quem chega. | `package.json:15-16` |

### Fricção (não bloqueia, mas irrita)

- **F1** — `src/app/api/overlays/list/route.ts:10-13` tem `Z:/Recursos 2.0/…` e
  `H:/Meu Drive/…` cravados no código. Degrada gracioso (`existsSync`), então não
  quebra — mas é config de máquina dentro do runtime. Vira env var.
- **F2** — sem `engines` nem `packageManager` no `package.json`. Nada impede alguém de
  entrar com Node 18 e descobrir sozinho.
- **F3** — `MONGODB_URI!` / `MONGODB_DB_NAME!` com non-null assertion (`src/lib/db.ts:3-4`).
  Sem env, `new MongoClient(undefined)` estoura dentro de cada rota que usa Mongo. O
  catálogo trata, as outras rotas não — o erro que chega é críptico.
- **F4** — sem `LICENSE`. `private: true` hoje; se vai ser clonado por outro, precisa
  de uma resposta explícita.
- **F5** — Windows-only nas beiradas: 2 scripts `.ps1`, e paths absolutos `Z:/`/`H:/`
  em ~10 scripts de laboratório (`photo-render.ts`, `debug-cv-detect.ts`,
  `extract-scene.ts`, `brand-mockup-batch.ts`). **Nenhum no runtime do app** — são
  bancada de teste pessoal. Não valem refactor; valem uma linha no README dizendo que
  são bancada.
- **F6** — diretório `Z:tmp/` no root, vazio, resultado de um path join errado em algum
  script. Lixo — apagar e achar quem cria.

---

## 1.5. Estado da execução

Tudo abaixo já está feito e verificado num clone simulado (cópia da árvore para fora do
repo, **sem `.env.local`, sem `data/`, sem Mongo, sem chave, sem `Z:/`**), com o
`psd-engine` resolvido por `file:` para simular o pós-publish:

| Item | Estado | Prova |
|---|---|---|
| B0 `psd-engine` | ✅ `0.2.0` no npm, link fora do lockfile, portão no CI | clone limpo em `C:/Temp`: `npm ci` + `tsc` 0 + 459 testes + `next build` |
| B1 `tsx` | ✅ vira devDependency; scripts passam a chamá-lo direto | `npm run setup` roda |
| B2 CI não exercitava | ✅ job `clone-and-run` novo, nos 3 SOs | `.github/workflows/ci.yml` |
| B3 README | ✅ reescrito | `README.md` |
| B4 `.env.example` | ✅ 26 variáveis comentadas por efeito + `.gitignore` liberando o arquivo | `.env.example` |
| B5 app vazio | ✅ `fixtures/demo-scenes/deadbeefcafe0001` (1,06 MB), semeada pelo setup | grid lista 1 card |
| B6 bun não declarado | ✅ documentado (quando precisa e quando não) | `README.md` |
| F1 `Z:/`+`H:/` na API | ✅ vira `OVERLAY_DIRS` | `src/app/api/overlays/list/route.ts` |
| F2 sem `engines` | ✅ `engines.node >= 22.11` + `packageManager` | `package.json` |
| F3 `getDb()` críptico | ✅ falha nomeando a variável que falta | `src/lib/db.ts` |
| F6 `Z:tmp/` | ✅ removido (era digitação avulsa, não código) | — |
| F4 LICENSE | ⏳ **sua decisão** | — |
| Árvore suja | ⏳ **precisa de commit seu** | `git status` |

**Resultado medido do smoke:** `13/13` num clone limpo (1 cena, zero serviço) **e**
`13/13` na biblioteca real (4.483 referências, Mongo e `PSD_DIRS` ligados).

Dois defeitos reais apareceram só porque o smoke passou a rodar de verdade:

1. **O smoke estava quebrado e ninguém sabia.** Ele procurava a string
   `"Todos Estúdios"` no HTML; o refactor de UI trocou para `"Todos os estúdios"` e,
   pior, o filtro virou um Select do Radix — cujos itens só existem depois de abrir,
   num portal. A string nunca vai estar no HTML do servidor. A asserção certa é o
   controle (`aria-label="Estúdio"`), não o item.
2. **As buscas do smoke eram fixas** em `billboard`/`outdoor`, então falhavam em
   qualquer biblioteca sem essa palavra — inclusive na cena de demonstração. Agora o
   termo sai do próprio catálogo, o typo é derivado dele, e o teste de sinônimo PT↔EN
   verifica a **simetria** do mapa, que é a invariante de verdade e independe de dataset.

---

## 2. Plano

Cinco fases. **A fase 0 é pré-requisito de tudo** — enquanto ela não fecha, nenhuma
outra fase tem efeito observável, porque o clone não compila.

### Fase 0 — Resolver o `psd-engine` e ficar verde (resolve B0, B2)

1. Escolher uma das 4 saídas do B0 e executar. Recomendo **registry privado ou dep de
   git**: mantém o desenvolvimento no repo irmão e conserta o clone.
2. Corrigir os ~11 `TS7006` (são anotações de tipo triviais, não refactor).
3. **Obter um run verde do CI.** Sem isso, nada aqui é verificável.

### Fase 1 — Destravar (resolve B1, B3, B4, B6, F2)

1. `npm i -D tsx` e trocar todo `npx tsx` por `tsx` nos scripts do `package.json`
   (mais rápido, e passa a ser versionado em vez de baixado a cada run).
2. `engines: { "node": ">=22" }` + `packageManager` no `package.json`.
3. **`.env.example`** — atenção: `.gitignore:34` é `.env*`, que engoliria o próprio
   exemplo. Precisa virar `.env*` + `!.env.example`. Com as 26 variáveis agrupadas e
   comentadas por efeito:
   - *nada obrigatório para subir* — deixar isso explícito na primeira linha;
   - `MONGODB_URI` / `MONGODB_DB_NAME` → sem elas, catálogo só lê disco;
   - `PSD_DIRS` → sem ela, nenhum PSD entra no catálogo;
   - `VISANT_*`, `ANTHROPIC/OPENAI/GEMINI/REPLICATE/NVIDIA_API_KEY` → desligam
     features nomeadas, uma a uma;
   - `RENDER_PORT`, `RENDER_ENGINE`, `MAX_CONCURRENT_RENDERS`… → defaults já embutidos.
4. **Reescrever o `README.md`**: o que é o produto, `npm run setup && npm run dev`, a
   tabela de degradação (o que funciona sem cada serviço), o pré-requisito `bun` só
   para `npm run render`, e um link para o `AGENTS.md` como manual de operação.

### Fase 2 — `npm run setup` (o script esperto)

Um `scripts/setup.ts` idempotente, rodável quantas vezes quiser:

- confere versão do Node contra `engines` e falha cedo com mensagem clara;
- copia `.env.example` → `.env.local` se não existir (nunca sobrescreve);
- semeia a demo (fase 3) se `data/` estiver vazio;
- imprime o **quadro de degradação medido, não prometido**: para cada serviço
  (Mongo, Visant, render-server:4200, `PSD_DIRS`, `bun`), diz `ok` / `ausente → isto
  aqui fica desligado`;
- termina dizendo a próxima linha a digitar.

Isso reaproveita a espinha do `scene-doctor.ts` — mesma ideia, alvo diferente
(ambiente em vez de cena).

### Fase 3 — Dado de demonstração (resolve B5)

Uma cena real hoje pesa **9 MB** (`photo.png` + `photo-clean` + `photo-prepared` em
full-res). Versionar isso é inviável.

**Proposta:** `fixtures/demo-scene/` com **uma** cena reduzida a 1280px (~800 KB), que o
`setup` copia para `data/photo-scenes/` quando o diretório está vazio. Um card no grid
já responde a pergunta "quebrou ou está vazio?", e exercita o caminho inteiro
(catálogo → thumbnail → abrir → `/photo-mockup`).

> Decisão sua: **1 cena versionada (~800 KB)** ou **baixar um pack de demo de um GitHub
> Release** (repo fica em 5,8 MB, mas exige rede no setup). Recomendo a cena versionada
> — offline, determinística, e 800 KB não machucam.

### Fase 4 — Travar no CI (resolve B2, e é o que impede tudo isso de apodrecer)

Um job novo `clone-and-run`, separado do `verify`:

```yaml
clone-and-run:
  runs-on: ubuntu-latest
  steps:
    - checkout / setup-node 22
    - npm ci
    - npm run setup          # sem .env.local nenhum — é o caso do dev novo
    - npm run build
    - npx next start -p 3123 &
    - npm run smoke -- --url http://localhost:3123
```

Sem Mongo, sem chave, sem Z:/. Se o app não subir e o grid não listar a cena de demo,
o CI fica vermelho. É isto que transforma "dá pra clonar e rodar" de promessa em fato
verificado a cada push — e é o que pega o próximo `process.env.X!` que alguém
introduzir.

Bônus barato: rodar o job também em `windows-latest` e `macos-latest` para provar que
o `sharp`/`canvas` instalam nas três plataformas.

### Fase 5 — Higiene (opcional, rápido)

- `OVERLAY_DIRS` vira env var com default vazio (F1).
- `getDb()` com mensagem de erro que nomeia a variável faltando (F3).
- Decidir `LICENSE` (F4).
- Apagar `Z:tmp/` e achar o path join que o cria (F6).
- Uma linha no README marcando os `scripts/` de laboratório como bancada pessoal,
  não API pública (F5).

---

### Fase 5 — Higiene (opcional, rápido)

Além dos itens F1/F3/F4/F6 acima:

- **Duas lockfiles**: `bun.lock` (153 KB) e `package-lock.json` (431 KB) convivem no
  disco. `.gitignore:55` ignora o `bun.lock` com o comentário "project uses npm (see
  AGENTS.md)" — mas o `AGENTS.md` nunca diz isso, e metade dos comandos documentados
  são `bun …`. Escolher e escrever a regra de verdade.
- **Árvore suja no `master`**: 7 arquivos versionados modificados e 6 não-versionados,
  incluindo `src/lib/hidden-store.ts` e `src/lib/path-origin.ts` que outros arquivos já
  importam. **Um clone hoje sairia sem código que o repo referencia.** Commitar antes de
  qualquer coisa.
- 5 `PLAN-*.md` soltos no root duplicando a convenção do `docs/`, mais
  `.next-dev-luz.log` e `tsconfig.tsbuildinfo`.
- `scripts/soccer248-batch*.ts` e `prep-logo-squares.ts` apontam para
  `H:/Meu Drive/@Clientes VSN/Soccer248/…` — dado de cliente nomeado num repo que vai
  ser clonado por terceiro. Vale decidir.

---

## 3. Ordem sugerida

**Fase 0 primeiro, sem alternativa.** Depois 1 → 3 → 2 → 4. (A demo precisa existir
antes do `setup` semear, e o `setup` antes do CI chamá-lo.) Fase 5 a qualquer momento,
menos a árvore suja, que é agora.

Fases 1–4 são meio dia. A fase 0 é a incógnita: se for publicar o `psd-engine` num
registry, é uma tarefa de dia inteiro com decisão de infra junto.
