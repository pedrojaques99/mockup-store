# Plano — quebrar `app/page.tsx` (3.645 linhas)

> Companheiro de [`AUDIT-nivel-vale.md`](AUDIT-nivel-vale.md). O antecedente é o
> `REFACTOR_PAGE_HOOKS.md`, que fez o mesmo no `/photo-mockup` — e cuja lição
> ("parar nos hooks de domínio; o resto é oportunístico") vale aqui inteira.

## O tamanho do problema, medido

| | |
|---|---|
| linhas | **3.645** |
| `useState` | **82** |
| `useEffect` | **20** |
| `useCallback` | **18** · `useRef` **20** · `useMemo` **2** |
| regiões de JSX de primeiro nível | **13** |

82 `useState` num componente é o número que importa. Não é "arquivo grande" — é que
**toda mudança de estado re-renderiza tudo**, e é por isso que o `MockupCard` precisou
de `React.memo` + `useCallback` de identidade estável para o INP não desabar. Essa
memoização é um curativo sobre a causa; quebrar o componente é tirar a causa.

## A regra que ordena o trabalho

> **Extrair pelo dono do estado, nunca pelo tamanho do bloco.**
> Um pedaço de JSX que lê 12 estados do pai não vira componente: vira componente com
> 12 props, que é o mesmo acoplamento com mais arquivos. Extrai-se quando o estado
> vai junto.

Lição já paga no `/photo-mockup` (ver `REFACTOR_PAGE_HOOKS.md`): as extrações que
valeram foram as que **levaram o estado embora** (`useMaskEditor`, `io`); as que só
moveram JSX viraram listas de props.

## Fatias, em ordem de valor (cada uma é um PR)

### F1 — `useCatalog` (o maior ganho isolado) · ~14 estados
`refs`, `total`, `page`, `hasMore`, `loading`, `initialLoad`, `fetchError`,
`search`, `studio`, `aspect`, `activeTags`, `tagMode`, `sort`, `imageSearch`
+ `fetchPage`, o sync com a URL, o `IntersectionObserver` do scroll infinito e o
debounce da busca.

É uma unidade coesa de verdade: **todos** esses estados existem para produzir uma
lista e todos invalidam o mesmo fetch. Hoje eles moram no mesmo componente que o
render do painel direito, então mexer no zoom de um card re-renderiza a busca.

Saída: `src/hooks/use-catalog.ts`. Testável sem DOM (a lógica de `params` e de
paginação é pura).

### F2 — `<RightPanel>` (o dono do render) · ~20 estados
`selected`, `psdInfo`, `artSlots`, `activeSlot`, `frame`, `artDims`, `framingHint`,
`renderResult`, `rendering`, `renderLogs`, `renderElapsed`, `currentStep`,
`isPreviewResult`, `hiddenLayers`, `showSmartObjects`, `showAdjustments`…

Este é o bloco que mais se beneficia: **nada disso importa quando não há mockup
selecionado**, e hoje tudo re-renderiza a página inteira. Extrair o painel com o
estado dentro faz o grid parar de re-renderizar a cada tecla do painel.

⚠️ Dependência: `renderCache` e `handleCardApply` são compartilhados com o grid (o
card dispara render). Sobem para um `useRenderSession` antes, ou o painel vira um
componente com 15 props — exatamente o que a regra proíbe.

### F3 — `useRenderSession` · ~4 estados
`renderCache`, `renderingRefId`, `showSession`, `sessionSelected`. Pré-requisito do F2
e dono do modal de Sessão. Pequeno e destrava o F2.

### F4 — `<CatalogSidebar>` · ~6 estados
`studios`, `aspects`, `allTags`, `expandedDims`, `hideDuplicates`, `hiddenIds`,
`brands`/`brandId`, wizard de ingest. Já está visualmente isolado depois da
reescrita da sidebar; a extração é quase mecânica.

### F5 — `useDuplicates` + `<DuplicatesDialog>` · ~8 estados
`showDupes`, `dupesGroups`, `dupesScanning`, `dupesProgress`, `dupesFilter`,
`dupesSort`, `dupesSelected`… Bloco autocontido de ~300 linhas que **não conversa com
mais nada** — é o candidato mais barato e mais óbvio. Bom primeiro PR para calibrar o
ritmo.

### F6 — `<BrandSuggestions>` · ~5 estados
`suggestions`, `loadingSuggestions`, `suggestError`, `suggestLimit`, `showLibrary`.
Já tem o `SuggestionCard` extraído; falta levar o estado junto.

## Ordem de execução

`F5` (calibra) → `F3` (destrava) → `F2` (maior ganho de render) → `F1` → `F4` → `F6`.

## Como não quebrar

1. **Um PR por fatia**, com `tsc` + `lint` + `test` + `build` verdes em cada um.
2. **O estado se move junto ou não se move.** Se a extração produzir mais de ~6 props,
   parou no lugar errado — volta.
3. **Não mexer no `MockupCard`** durante o refactor: a memoização dele é o que segura
   o INP hoje, e trocar as duas coisas ao mesmo tempo torna impossível saber qual
   regrediu.
4. **Medir o INP antes e depois** do F2, que é onde a promessa está. Sem a medição,
   "melhorou a performance" é opinião.
5. **Parar quando o ganho acabar.** A meta não é "arquivo pequeno": é que uma
   interação não re-renderize o que não tem a ver com ela. Depois de F2+F1 o resto é
   oportunístico — a mesma linha de corte do `/photo-mockup`.

## Fora de escopo declarado
- Trocar por gerenciador de estado global. O projeto já tem `zustand` (usado no
  editor); trazê-lo para cá é uma decisão separada e não é pré-requisito de nada acima.
- Migrar os 211 botões para o `IconButton` — trilho próprio, ver a auditoria.
