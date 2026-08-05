# Killer: painel de detalhe do mockup (home) + header

**Tier** T2 rota · **Nota** 82/100 · **Veredito** vai pra PR com pendência
**Superfície** B trabalho (throughput: quantos mockups o designer entrega por hora)

## Decisão pendente (sua, não minha)

1. **O `emerald` que sobrou é semântica de sucesso, não ação.** Ele continua em
   logs de render, lista de duplicatas e checks (`page.tsx:3920`, `4380`, `4459`,
   `4493`). Recomendo **deixar como está**: ali verde significa "deu certo", num
   eixo diferente de "clique aqui", e trocar por `acc2` faria log de sucesso e
   botão de ação usarem a mesma cor. Se você preferir mono-verde absoluto, é uma
   passada de 6 linhas — mas aí precisa de outro sinal para sucesso.

## O achado que vale mais que os outros juntos

Você nomeou antes de mim: **o card de editar a arte conflitava com o preview do
render**. Confirmado no código, e é defeito de conceito, não de pixel.

Havia **duas superfícies grandes disputando o mesmo trabalho**:
- `page.tsx:3534` — a superfície do resultado (cena ou render), 4:3, topo do painel
- `ArtFramePanel` dentro de "Sua Arte" (`page.tsx:3758`) — uma segunda imagem
  grande, com cropper próprio, slider de zoom próprio e toggles próprios

Antes de renderizar, o topo mostrava a cena **sem** a arte e o bloco de baixo
mostrava a arte **sem** a cena. Nenhuma das duas mostrava a coisa que o usuário
está decidindo, e ajustar enquadramento virava editar num lugar e conferir no
outro, rolando entre eles. Duas imagens empilhadas também faziam o painel ler
como formulário com fotos, não como editor.

**Conserto:** `ArtFramePanel` ganhou `variant="source"`. A arte virou FONTE
(miniatura de 40px + nome + dimensões + modos + fundo) e o recorte abre sob
demanda. Sobrou **uma** superfície grande, que é a que mostra o resultado.
Medido na tela depois: `temZoomSlider: false` com arte carregada, nenhum segundo
preview.

## Portão

| Detector | Antes | Depois |
|---|---|---|
| impeccable (tell de IA) | 0 | 0 |
| audit:design (token) | 0 | 0 |
| copy (vício) | **5** | 0 (222 strings de interface) |
| tsc | pass | pass |
| lint | 0 erro | 0 erro |
| testes | 348 | 348 |
| 390px estouro | 0 | 0 |

Os 5 de copy foram **confirmados um a um em `arquivo:linha`** antes do conserto,
como a skill exige (ela já produziu 6 falso positivo em 12 numa rodada real).
Os 5 eram reais: 3 travessões em `title` de `ArtFramePanel`, 1 bolinha separadora
em texto renderizado, 1 travessão em `AuthChip:47` — esse último ainda dizia
"sua conta vira tenant da engine pai", jargão que não significa nada para um
designer, e virou "Entrar com a sua conta Visant".

O extrator de copy foi provado antes (`--self-test`: sem falso positivo e **sem
falso negativo**) — um zero de portão sem isso é zero sobre texto que ninguém leu.

## Slop consertado

| # | Catálogo | Onde | Conserto |
|---|---|---|---|
| 1 | Duas superfícies para uma decisão | `page.tsx:3758` | `variant="source"`: arte vira fonte, sobra um preview |
| 2 | Dois primários competindo | `page.tsx:3851` | um verde por vez, e ele é sempre o PRÓXIMO passo |
| 3 | Cor de fora da paleta na ação | `page.tsx:3874`, `3886` | `emerald-500` → `acc2` (o verde da BOXY) |
| 4 | Cor de ação gasta num substantivo | `page.tsx:440` | selo "PSD" era `emerald-500/90`; virou neutro |
| 5 | Cor de terceiro como ação principal | `AuthChip.tsx:48` | `violet-600` → cinza (login não é a ação da tela) |
| 6 | Jargão interno na interface | `AuthChip.tsx:47` | "tenant da engine pai" → "sua conta Visant" |

O item 2 só apareceu **na captura**, depois do conserto: eu tinha escrito a regra
"um verde por vez" e implementado errado — com um preview na tela, `RENDER FINAL`
e `GERAR PNG FINAL PARA BAIXAR` ficavam os dois verdes **e chamavam o mesmo
`handleRender(false)`**. Corrigido em `hasResult` (`page.tsx:2396`). É o argumento
inteiro a favor de abrir o PNG em vez de ler o texto do portão.

## Interrogatório (bloco fixo F1–F6)

- **F1 reuso** — nada de componente novo. `ArtFramePanel` já era SSoT compartilhado
  com o Scene Maker; ganhou uma variante em vez de um irmão. O `variant="full"`
  segue intacto, então o Scene Maker não muda.
- **F2 design system** — os botões passaram a usar `acc2`/`zinc-950` do tema, não
  hex. `ui:audit` dentro do orçamento; `audit:design` zero.
- **F3 responsivo/performance medidos** — 390px e 1440px com dado real e painel
  ABERTO: `scrollWidth == innerWidth` nos dois, zero erro de console. A linha de
  fonte compacta ajuda mais no 390 que no 1440.
- **F4 fluxo progressivo** — a ordem virou o fluxo real: veja o resultado → ajuste
  a fonte → renderize → baixe. O recorte (ajuste fino) saiu do caminho de quem só
  quer soltar a arte e renderizar.
- **F5 o que esconder** — o cropper. Ele é ajuste fino de uma minoria dos casos e
  ocupava a maior área do painel depois do preview.
- **F6 o que falta pro nível Vale do Silício** — o preview ainda não recompõe ao
  vivo enquanto você arrasta o recorte; ele espera um render. É a diferença entre
  editor e formulário, e é trabalho de engine, não de CSS. Fica listado, não feito.

## Verificação — o que rodou e o que NÃO rodou

| Checagem | Status |
|---|---|
| tsc, lint, 348 testes | ✅ |
| portão (3 detectores) + self-test do extrator | ✅ |
| 390px e 1440px com dado real, painel aberto e arte carregada | ✅ |
| captura ABERTA e olhada (achou o defeito 2) | ✅ |
| **backend parado** | ❌ **não rodei** |
| **teclado (`focus-visible` alcança o botão novo de recorte)** | ❌ **não rodei** |
| **feel a 25% no DevTools** | ❌ **não rodei** |

As três últimas são desconto explícito na nota. O botão "Ajustar recorte" é
`<button>` com `title` e `aria-expanded`, então deve alcançar por teclado — mas
"deve" não é medição, e por isso está listado como não rodado.

## Nota

| Faixa | Peso | Obtido | Por quê |
|---|---|---|---|
| Portão | 20 | 20 | 3 detectores em zero, achados confirmados linha a linha |
| Julgamento | 40 | 40 | 6 itens confirmados, 6 consertados |
| Interrogatório | 40 | 22 | F1–F6 respondidos com evidência; faltaram as perguntas de estado (backend parado, teclado, feel) — desconto de 18 |
| **Total** | | **82** | vai pra PR com pendência |
