# Duplicatas: falso positivo, origem do arquivo e "esconder do catálogo"

Estado: **feito**. `tsc` limpo · 224/224 testes · build verde.

## 1. O falso positivo (o bug de verdade)

`.env.local` listava em `PSD_DIRS` uma pasta **e a pasta pai**:

```
Z:/BOXY/Produtos,
H:/Meu Drive/ASSETS VISANT/MOCKUPS MAISON,   ← filha
H:/Meu Drive/ASSETS VISANT,                  ← pai
H:/.shortcut-targets-by-id/…/[ MOCKUPS 1.0 ]
```

`walkDir` é recursivo. Todo arquivo dentro de `MOCKUPS MAISON` entrava **duas
vezes** na lista — mesmo caminho, mesmo tamanho, mesmo hash — e o agrupador
anunciava cada arquivo como cópia de si mesmo. O `MM_Billboard_BB-SEL-16.psd`
de 616 MB "duplicado" era um arquivo só, contado duas vezes.

Perigo real: rodar o `remove-dupes.ps1` em cima disso apagaria o **original** e
deixaria a cópia que nunca existiu. (O `.ps1` já se protegia por
`Resolve-Path`; a UI não.)

**Correção**

| Arquivo | O quê |
|---|---|
| `src/lib/fs-walk.ts` | `psdRoots()` — normaliza barra/casing/barra final e **descarta raiz contida em outra** |
| `src/app/api/duplicates/route.ts` | usa `psdRoots()` + dedupe por `realpathSync` antes de hashear (atalho do Drive, junction) |
| `src/lib/psd-index.ts` | mesmo bug: o catálogo de PSDs também varria a pasta duas vezes |
| `scripts/remove-dupes.ps1` | poda de raiz aninhada, junto do dedupe canônico que já existia |

Testes: `fs-walk.test.ts` — raiz aninhada, casing/barra, prefixo de nome que
*não* é aninhamento (`Mockups` vs `Mockups Antigos`), lista vazia.

## 2. Origem do arquivo — o que é seu e o que é de fora

`src/lib/path-origin.ts` (puro, roda no cliente e no servidor):

| Caminho | `kind` | Selo | `safeToDelete` |
|---|---|---|---|
| `Z:/BOXY/...` | `local` | Local | ✅ |
| `H:/Meu Drive/...` | `meu-drive` | Meu Drive | ✅ |
| `H:/.shortcut-targets-by-id/...` | `compartilhado` | Compartilhado | ❌ |
| `.../Drives compartilhados/...`, `Shared drives` | `compartilhado` | Compartilhado | ❌ |

Isso não é cosmético: apagar via atalho do Drive apaga **na conta do dono**,
para todo mundo — e às vezes nem há permissão, então a remoção falha calada.

Consequências:
- selo âmbar na linha do painel de duplicatas, com tooltip explicando;
- `keepScore` do `/api/duplicates` dá `-100` a arquivo de fora ⇒ ele é **sempre
  o "Manter"**, nunca entra em `removePaths`.

## 3. Esconder do catálogo (não apaga nada)

Já existia um "esconder" — mas em `localStorage`, por navegador: esconder no
desktop não valia no notebook, e o servidor continuava servindo o card.

Agora é estado do servidor:

- `src/lib/hidden-store.ts` — `data/hidden-refs.json`, array ordenado, escrita
  atômica (mesmo formato da ignore-list da calibração em `quad-store.ts`).
  Expõe `version`, que muda a cada escrita.
- `src/app/api/references/hide/route.ts` — `GET` devolve `{ids, references}`;
  `POST {ids|paths, hidden}` liga/desliga. `paths` existe porque o painel de
  duplicatas só conhece caminho no disco: o servidor resolve para ids do
  catálogo via `psdPath` (relação **não** é 1:1 — duas refs podem apontar para o
  mesmo `.psd`, e esconder o arquivo esconde todos os cards dele).
- `src/lib/search-index.ts` — nova *view visível*, memoizada por
  `(carimbo do catálogo, versão dos escondidos)`. Esconder um card **não** paga
  os ~6s de rebuild do catálogo cru, e o índice MiniSearch é reconstruído só
  para a view — antes o `indexCache` continuaria servindo o que foi escondido.
  `searchRefs`, `getFacets` e `refsByIds` (busca por imagem) passam todos por
  ela, então o item some do grid, das facetas e da busca por imagem de uma vez.

Cliente (`src/app/page.tsx`):
- carrega a lista do servidor no mount e **migra uma vez** o que estava preso no
  `localStorage`, apagando a chave antiga;
- escrita otimista com rollback + toast quando o servidor recusa (antes a UI
  dizia que salvou de qualquer jeito);
- botão 👁️‍🗨️ por linha no painel de duplicatas: "Esconder do catálogo (não apaga
  o arquivo)". Toast diz quantos cards saíram, ou avisa que o arquivo nunca
  esteve no catálogo (`matched: 0`);
- "Restaurar N ocultos" agora reexibe no servidor.

## 4. Botão de pasta que falhava calado

`/api/open-file` responde 404 se o arquivo sumiu — a UI ignorava a resposta e o
botão simplesmente não fazia nada. Agora dá `toast.error`.

## 5. Painel "Ocultos"

O chip da toolbar deixou de ser "Restaurar N ocultos" (tudo-ou-nada) e virou
"N ocultos", que abre o painel: thumbnail, estúdio, `psdPath` e **Reexibir** por
item, mais "Restaurar todos" no header. A lista vem do `GET /api/references/hide`
— tem de vir do servidor, porque o card escondido já não está em `refs` (o
catálogo o filtrou, que é exatamente o ponto).

Se sobrar id sem card (ref apagada do Mongo depois de escondida), o painel diz
quantos são em vez de fingir que a lista bate.

O botão de fechar é escrito à mão, como nos outros modais desta página: o
`IconButton` do design system exige um `TooltipProvider`, que só existe no rail
do editor.

## 6. `.env.local` limpo

`H:/Meu Drive/ASSETS VISANT/MOCKUPS MAISON` saiu da `PSD_DIRS` (já está dentro de
`ASSETS VISANT`), com comentário explicando por quê. O `psdRoots()` podaria de
qualquer jeito — não pedir o erro é de graça.

## Verificação (dev server, acervo real)

| Passo | Resultado |
|---|---|
| `POST /hide {ids}` num item | catálogo 5880 → 5879 |
| busca pelo nome do item escondido | 4 vizinhos, **o item não** — o índice MiniSearch respeita o esconder |
| `GET /references?ids=<escondido>` | 0 (busca por imagem também respeita) |
| `GET /hide` | o item aparece no painel, com nome |
| `POST /hide {hidden:false}` | volta a 5880 |
| `POST /hide {paths}` com um `.psd` real | `matched: 2` — o mesmo arquivo servia **dois** cards |
| `POST /hide {paths}` com caminho inexistente | `matched: 0`, lista intacta, sem erro |

E a medição do falso positivo em si, no acervo real (contando entradas do walk,
sem hashear — o hash pela rede levava 15 min):

```
raízes ANTES: 4 | DEPOIS de psdRoots(): 3
ANTES   { entradas: 12795, unicos: 10826, repetidos: 1969 }
DEPOIS  { entradas: 10823, unicos: 10823, repetidos: 0 }
```

**1.969 caminhos repetidos** — cada um virava um grupo de duplicata do arquivo
com ele mesmo. Agora: zero.

### Efeito colateral medido: `MAX_DEPTH`

`10826 → 10823`: 3 arquivos entravam **só** pela raiz-filha, porque
`fs-walk.MAX_DEPTH = 5` conta a partir de cada raiz — de `MOCKUPS MAISON` eles
estavam ao alcance, de `ASSETS VISANT` não. São PNGs de `(footage)/3_precomps-footage/`
de composições do After Effects, ou seja, intermediários de render que não
deveriam mesmo estar no acervo. Ficou como está **de propósito**; o registro aqui
é porque `MAX_DEPTH` trunca a varredura em silêncio em qualquer pasta funda, e
isso vale saber antes de caçar "sumiu um arquivo".

## Não feito

Nada pendente do combinado.
