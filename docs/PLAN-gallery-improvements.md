# Plano — Melhorias da galeria de mockups (5 pedidos)

Origem: pedidos sobre a tela principal (`src/app/page.tsx`) da mockup-store.
Decisões já travadas com o usuário entre parênteses.

## 1 + 2. Detectar e esconder mockups duplicados

**Assinatura (decisão: nome normalizado + tamanho PSD).** Itens do Mongo, não
arquivos de disco — o `/api/duplicates` (hash de disco) continua sendo outra
ferramenta. Casos reais: `Falling Cards Blur` vs `Falling-Cards-Blur`,
`Full Boxes` vs `Full-Boxes`, `Falling Cards 02 (1)/(2)`.

- Novo util `src/lib/dedup.ts`:
  - `mockupSignature(name, psdSizeBytes?)`: lowercase → tira acento → tira
    extensão / `-preview` / `média` / `(n)` → colapsa `[-_ ]+` → `trim`, e
    concatena com o `psdSizeBytes` em KB (bucket `0` quando ausente, então só
    agrupa com outro também-ausente → conservador, evita falso positivo).
  - `keepScore(ref)`: escolhe o representante mais "limpo" (penaliza `(n)`,
    separadores `-`/`_`, `preview`). Menor score = mantém.
- `page.tsx`: estado `hideDuplicates` (default ligado) + `useMemo` que deriva
  `displayRefs` e `hiddenDupes` a partir de `refs`. Grid passa a mapear
  `displayRefs`. Toggle em **Filtros** mostrando a contagem oculta.

## 3. "Filtro básico" — limpar o dropdown de Estúdios (decisão)

O grid já manda `has_psd=true`. O que faltava era o dropdown listar lixo
(`halftone-export.png`, `halftone-export (1).png`) e contar tudo, não só PSD.

- `src/app/api/references/studios/route.ts`: `$match` só conta docs com
  `psdFileName`/`psdPath` ou `type:"photo"`; descarta nomes de estúdio que
  parecem arquivo (`/\.(png|jpe?g|gif|webp|psd|psb|tiff?)$/i`).

## 4. Regenerar / sugerir mais nos Matches Inteligentes

`/api/suggest` já aceita `refresh=true` (re-roda o perfil LLM) e `limit`.

- `page.tsx`: extrai `loadSuggestions({force,limit})`; botão **Regenerar**
  (`RefreshCw`) no header dos matches (force) + chip **Ver mais** que cresce o
  `suggestLimit` (+12) e recarrega.

## 5. Multi-tag até 5, com toggle AND/OR (decisão: ambos)

- `page.tsx`: `activeTag: string` → `activeTags: string[]` (cap 5) +
  `tagMode: "AND" | "OR"`. `toggleTag` adiciona/remove e bloqueia além de 5
  (botões não-selecionados ficam esmaecidos quando cheio). Bloco "Filtro Ativo"
  vira lista de chips + toggle AND/OR + limpar tudo.
- `src/app/api/references/route.ts`: aceita `tags` (CSV, máx 5) + `tagMode`.
  Cada tag vira `$or` sobre `tags` + as 7 dimensões; combina por `$and` (AND) ou
  achata num `$or` único (OR). Search e tags entram juntos via `$and` top-level.
  Mantém compat com `tag` singular.

## Arquivos tocados
- `src/lib/dedup.ts` (novo)
- `src/app/page.tsx`
- `src/app/api/references/route.ts`
- `src/app/api/references/studios/route.ts`
- (sem mudança de schema; nada persiste novo)

## Verificação
`npx tsc --noEmit` + `npm run lint` verdes; smoke manual dos 5 fluxos.
