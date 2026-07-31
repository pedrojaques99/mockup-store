# Auditoria — painéis, rails, navegação, botões, compartilhados e hardcoded

> **Este documento é uma foto. O placar vivo é `npm run ui:audit`.**
>
> Foi escrito à mão primeiro e os números envelheceram no mesmo dia — por isso
> viraram script (`scripts/ui-audit.ts`), que roda em 1s, tem teto por métrica e
> **falha o CI** quando algum estoura. Métrica que só existe em documento não é
> métrica. Skill: `visant-frontend`.
>
> ```
> npm run ui:audit                      placar + veredito
> npm run ui:audit -- --list <chave>    onde estão as ocorrências
> ```

## Placar final (tetos fixados no valor alcançado)

| Métrica | Antes | Agora | Teto |
|---|---|---|---|
| Modais escritos à mão | 12 | **0** | 0 |
| Switches escritos à mão | 2 | **0** | 0 |
| `<select>` nativo | 4 | **0** | 0 |
| Duração hardcoded numa transição | 41 | **0** | 0 |
| `transition-all` | — | **0** | 0 |
| Botão sem nome acessível | 2 reais | **0** | 0 |
| Arquivo misturando `zinc`/`neutral` | 1 | **0** | 0 |
| Raio fora da escala | 40 | **7** | 7 |
| Botão só-ícone à mão | 12 | 12 | 12 |

Os dois que não zeraram estão **pinados**: não podem crescer. Os 7 raios são
exceções deliberadas (swatch de 12px, `<kbd>`, alça de crop — `rounded-lg` num
quadrado de 12px deforma a peça). Os 12 botões só-ícone são o trilho da migração
para `IconButton`, que não cabe num turno sem virar diff cego.

### A guarda foi provada nos dois sentidos
Canário injetado (`fixed inset-0` + `<select>` + `transition-all duration-300`)
⇒ 4 métricas acusadas e **exit 1**. Removido ⇒ **exit 0**. Sem isso, seria teatro.

### Três detectores que mentiram antes de acertar
Registrado porque é a armadilha recorrente deste tipo de script:
1. Janela de 6 linhas para achar o rótulo do botão ⇒ **68 falsos positivos**.
2. Regex removendo props para achar texto ⇒ passou a comer o próprio rótulo, **22**.
3. `split("\n")` num repo **CRLF** ⇒ todo `$` de regex parou de casar em silêncio,
   e a métrica de botão só-ícone marcou **0 com 12 ocorrências na tela**.

A regra que ficou: **só acusa quando prova**. Rótulo dinâmico (`{preset.name}`) é
indecidível daqui, e indecidível não é acusação — o falso negativo é o erro barato.

## O placar original (à mão)

| Medida | Valor | Veredito |
|---|---|---|
| `<button>` escritos à mão | **211** | — |
| usos do `IconButton` compartilhado | **12** | **6%**. O primitivo existe e quase ninguém usa |
| modais `fixed inset-0` à mão | **12** | 9 sem `role="dialog"`/`aria-modal` |
| focus trap / scroll lock no projeto | **0** | ⚠️ correção, não polimento |
| paletas de cinza coexistindo | `zinc` 624 · `neutral` 476 | duas peles no mesmo produto |
| raios de borda distintos | **7** (`xl` 84 · `full` 79 · `lg` 78 · `2xl` 32 · `md` 28 · `sm` 6 · `3xl` 6) | não é escala, é ad-hoc |
| durações hardcoded vs tokens | **41 vs 11** | SSoT de motion cobria 21% |
| cores hex hardcoded em `.ts`/`.tsx` | **130** | parte legítima (constantes de algoritmo) |
| `Loader2` no projeto | **53** | um spinner para toda espera |
| `page.tsx` | **3.645 linhas** | ver `PLAN-refactor-page.md` |

---

## 1. Modais — o achado sério

Doze modais escritos à mão com `fixed inset-0`, **nove sem `role="dialog"` nem
`aria-modal`**, e **zero focus trap e zero scroll lock em qualquer lugar do projeto**
(varredura por `aria-modal`, `role="dialog"`, `document.body.style.overflow`).

Consequência concreta, não teórica: abrir Sessão/Duplicatas/Logs e apertar Tab manda
o foco para o grid **atrás** do modal; o leitor de tela nunca é informado de que existe
um diálogo; a página de trás rola por baixo. É comportamento quebrado, não estética —
e é exatamente a classe de coisa que não se escreve à mão.

- [x] `ui/Dialog.tsx` sobre `@radix-ui/react-dialog` (mesma família do Popover/Tooltip
      que já estava no projeto), com duas peles (`neutral` = loja, `zinc` = editor)
- [x] **Os 6 modais do `page.tsx` convertidos** — Configurações, Duplicatas, Biblioteca,
      Logs, Sessão, Tela cheia. `fixed inset-0` no `page.tsx`: **12 → 0**

Restam com casco próprio: `IngestReviewSheet`, `LuzAssetModal`, `ShortcutsHelp` (os
três **já** declaravam `role="dialog"`/`aria-modal`, então não estão mentindo — mas
continuam sem trap). Fila, não dívida escondida.

## 2. Switch — a mesma peça em dois tamanhos

Duas implementações à mão: `w-7 h-4` com knob `w-3` na loja, `w-7 h-3.5` com knob
`w-2.5` no painel de render. Nenhuma anunciava `role="switch"`.

- [x] `ui/Switch.tsx` sobre `@radix-ui/react-switch`; as duas trocadas

## 3. Motion — o SSoT existia e cobria 21%

`--dur-press/fast/base/slow` estão no `globals.css` desde o burilamento anterior, e
**41 lugares continuavam com `duration-300`/`200`/`150` na mão** contra 11 usando token.

- [x] Varredura automática: só troca quando a classe também tem `transition-*`.
      Hardcoded **41 → 14**, tokens **11 → 29**
- [x] Os 14 restantes são todos `animate-in` — ali `duration-*` **é** a API correta
      (`tw-animate-css`), não defeito

---

## O que fica na fila (nomeado, não escondido)

### A. Botões — 211 à mão, 12 no primitivo
O `IconButton` já existe, com tooltip obrigatório e variantes. O que falta não é o
componente, é a **migração** — e ela não cabe num turno sem virar um diff cego de
milhares de linhas. Caminho: migrar por superfície (rail → painéis → header → card),
uma por vez, com o visual conferido a cada passo.

### B. Duas paletas de cinza
`zinc` (editor) e `neutral` (loja) são cinzas diferentes — zinc é mais frio. Lado a
lado leem como dois produtos. **`photo-mockup/page.tsx` mistura as duas** (43 zinc /
11 neutral), que é o único caso claramente errado; o resto é fronteira de superfície.

Duas saídas honestas: (1) declarar a regra — zinc é a pele do editor, neutral é a da
loja — e corrigir só quem mistura; ou (2) unificar em uma. A (2) mexe em ~1.100
ocorrências e **precisa de decisão sua**, não minha.

### C. Sete raios de borda
Sem escala definida. O caminho barato é decidir três (`lg` controle, `xl` cartão,
`2xl` painel/modal) e deixar `full` para pílulas — depois um lint que rejeite o resto.

### D. O registry tem 25 itens e o projeto usa 1
Colhi só o `masonry-gallery`. Casam direto com coisa escrita à mão aqui:
`chip` (pastilhas de filtro), `segmented-control`, `rail` (trilho com scroll-snap —
o rail de sugestões é isso), `sticky-filterbar`, `scrub-input` (os sliders de painel),
`plate`, `drop-overlay`, e `status-ticker`/`working-glyph`/`turbulence-field` para os
53 `Loader2`. Cada um é uma troca pequena e verificável.

### E. `page.tsx` com 3.645 linhas
Plano dedicado em [`PLAN-refactor-page.md`](PLAN-refactor-page.md).

---

## Verificação desta rodada

`tsc` limpo · lint **0 erros / 350 warnings** (baseline 351) · **208 testes** · build verde.

**No app rodando**, com o diálogo de Configurações aberto:

| Contrato | Medido |
|---|---|
| `role="dialog"` | ✅ |
| foco entra no diálogo | ✅ `dlg.contains(document.activeElement)` |
| foco **preso** | ✅ 12 × Tab e não escapou |
| fundo inerte | ✅ irmãos com `aria-hidden` |
| interação de fundo travada | ✅ `body { pointer-events: none }` |
| ESC fecha + foco volta ao gatilho | ✅ (tecla real; o botão volta com anel de foco) |

Duas ressalvas honestas:
- **`aria-modal` não é emitido.** O Radix marca os irmãos com `aria-hidden` em vez
  disso — é a rota mais robusta e o contrato de leitor de tela está cumprido, mas se
  alguém procurar o atributo, ele não está lá.
- A sonda por JS deu `fechouComEsc: false`: o Radix mantém o nó durante a animação de
  saída. **Confirmado por tecla real + captura de tela**, não pela sonda.
