# Branding BOXY® no mockup-store

Estado: **feito** (04/08/2026).
SSoT: brand guideline `69e8e78b51a13978c9bc90d8` no Visant Labs, populado a partir
dos arquivos reais da marca no mesmo dia.

## O que estava errado

O app não usava a marca BOXY em lugar nenhum. Usava uma aproximação:

| Onde | Antes | Agora |
|---|---|---|
| Logo no header (2 telas) | `div` branco com `div` preto dentro | arquivo oficial via `<BoxyMark />` |
| Wordmark | texto "Boxy Store" em Geist | `BOXY LOGOTYPE GREEN.svg` |
| `--color-acc2` | `#3df27e` verde genérico | `#BFFF38` verde BOXY |
| `--color-acc` | `#22d3ee` ciano (fora da paleta) | `#84b028` verde-folha do gradiente |
| `--color-ink` | `#f5f4f0` off-white | `#D7DFC6` Sage |
| `--background` / `--foreground` | `#0a0a0a` / `#ededed` | `#161616` / `#D7DFC6` |
| `metadata.title` | "Mockup Store" | "BOXY® Mockup Store" |
| Favicon / ícone PWA | `/globe.svg` do scaffolding | `logo-boxy-icon.png` oficial |
| `public/` | 5 SVGs do scaffolding do Next | removidos (só 1 era referenciado) |

## Paleta oficial (extraída dos arquivos, não estimada)

| Hex | Nome | Papel | Origem |
|---|---|---|---|
| `#BFFF38` | BOXY Green | ação / ativo | `BOXY LOGOTYPE GREEN.svg` |
| `#84B028` | Leaf | em progresso / dica | meio do gradiente `Rodapé.png` |
| `#D7DFC6` | Sage | texto sobre escuro | `BOXY MIN LOGOTYPE GREY.svg` |
| `#4D6617` | Deep Olive | contorno sobre verde | fim do gradiente `Rodapé.png` |
| `#161616` | Ink Black | fundo | `BOXY LOGOTYPE BLACK.svg` |

Gradiente da casa (único): `linear-gradient(180deg, #D7DFC6 0%, #BFFF38 55%, #4D6617 100%)`.

**Decisão sobre o ciano** (estava em aberto): saiu. A paleta BOXY é mono-verde e não
tem um segundo matiz para gastar, então os dois acentos se separam por **ênfase**, e o
`acc` virou o verde-folha que já existe no gradiente da casa.

## Regra dura: logo não se redesenha

O componente só pode **apontar para o arquivo**. A primeira versão do `BoxyMark`
compunha o símbolo na mão (um `<rect>` com o raio que eu escolhi + a estrela
transladada e escalada até "bater no olho"). Bater no olho não é a marca: qualquer
raio, respiro ou proporção chutada cria uma variante não-autorizada que depois vaza
para peça impressa.

Os arquivos oficiais foram copiados **byte a byte** (sha256 conferido) de
`Z:\BOXY\@LOGO BOXY` para `public/brand/`.

Duas pegadinhas dos arquivos, ambas já pagas:
- O arquivo do símbolo **não é quadrado** (574×481): traz o ® ao lado. Forçar `w-7 h-7`
  encolhia a marca e deixava um cisco verde solto no canto. Sempre `w-auto`.
- Símbolo e logotipo **trazem cada um o seu ®**. Lado a lado, a marca registrada
  aparecia duas vezes em 120px. O lockup usa um OU outro: símbolo no estreito,
  logotipo a partir de `sm`.
- O corte "MIN LOGOTYPE" é mais leve: a 16px as hastes finas somem no fundo escuro.
  O header usa o corte principal.

## Cor em canvas: `src/lib/brand.ts`

`ctx.strokeStyle` e `style={{}}` não aceitam classe do Tailwind, então cada tool de
canvas tinha o hex na unha. Quando os tokens viraram BOXY, os `bg-acc2` seguiram e
**11 literais não** — a tela ficava meio pintada e ninguém via, porque cada literal
estava sozinho no seu arquivo. `lib/brand.ts` é o espelho JS do `@theme`, mesmo padrão
de `lib/motion.ts` ↔ `--ease-*`. Corrigidos: LuzOverlay, CropFrame, PenMaskCanvas,
SegmentCanvas, BrushCanvas, ZoomPanViewer, handle-style, photo-mockup/page.

## Guarda: `src/lib/__tests__/brand-tokens.test.ts`

5 asserções, todas provadas nos dois sentidos (regressão plantada → vermelho;
restaurado → verde):
1. `lib/brand.ts` espelha o `@theme` do `globals.css`.
2. As formas RGB batem com os hex.
3. Nenhum acento aposentado sobrevive em `src` (hex **e** triplas `r,g,b`).
4. `BoxyMark` não contém vetor inline e os arquivos que referencia existem.
5. Branco sobre o verde BOXY reprova em contraste; quase-preto passa.

`__tests__` fica fora da varredura: fixture legitimamente carrega hex que coincide
(`art-classify.test.ts` usa `#f5f4f0` como cor de borda de uma arte). Guarda que grita
em dado de teste vira guarda que alguém desliga.

## Verificação

- `tsc` limpo · 347 testes verdes (31 arquivos) · ESLint 0 erro · `ui:audit` no orçamento
- `visual:home` **12/12** e `visual:console` **0 erro / 0 aviso / 0 rede**, com o dev
  aquecido (home 12,8s → 0,41s) e a captura **aberta e olhada**, não só o texto do portão
- Home e `/photo-mockup` capturadas em 1920px e 390px

⚠️ **A armadilha que custou caro nesta rodada**: dois `next dev` + um `next start -p 3311`
dividiam o mesmo `.next`. O resultado foi `/` respondendo **404** e o portão de console
dando "0 erros" — medindo a página 404. Verde falso. A saída é o `NEXT_DIST_DIR` que o
`next.config.ts` já expõe: `NEXT_DIST_DIR=.next-dev npx next dev -p 3400`.

## Fora de escopo

- Trocar Geist por **Helvetica Now Display** (tipografia da marca, variável `TXT - BXY`
  no Figma `h2Rm8A8HAim44nb3gbubG8`). Exige licença.
- O botão "Entrar com Visant" segue violeta (`bg-violet-600`). É identidade da Visant
  num botão de login de plataforma — co-branding, não deriva. Não mexi sem decisão.
- Redesenhar layout. Isto foi troca de marca, não redesign.
