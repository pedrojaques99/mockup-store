# Brand Mockup Kit — white-label (1 brand id → kit pronto)

Metralha um **kit de mockups inteligentes** pra qualquer marca: N mockups com
**layouts** (criativos de campanha do cliente) + N com **logo/símbolo**, curando
cena/PSD coerente por categoria. White-label: a **marca vem do Visant Labs** (só
pluga o `--brand <visantId>`).

## Como funciona

```
npx tsx --env-file=.env.local scripts/brand-kit.ts \
  --brand <visantId> \
  --layouts "<pasta dos criativos do cliente>" \
  --out "<pasta de saída>" \
  --count 10
```

Saída:
```
<out>/layouts/   ← N mockups com os criativos (billboard, poster, device, retail)
<out>/logo/      ← N mockups com o símbolo em face ~1:1 (coaster, badge, mug, sticker…)
<out>/kit-summary.json
```

## Pipeline

1. **Marca via Visant** — `getBrandGuideline(brandId)` (src/lib/visant, mesmo
   client do agent-cli): nome + paleta + logos. Cores são a SSoT da marca.
2. **Artes quadradas do logo** — resolve o símbolo (`--symbol <path|url>`
   override, senão `pickLogo(icon→primary)` do Visant), e gera variantes 1:1 nas
   cores da marca:
   - `--mono` (símbolo é silhueta): recolore via `dest-in` → símbolo na cor de
     destaque sobre fundo escuro, e vice-versa, + app-icon tight.
   - sem `--mono`: trim + centraliza o logo como está sobre fundos da marca.
   Auto-pick de cores: `dark` = menor luminância, `accent` = maior croma/vivacidade.
3. **Lote layouts** — dispara `brand-mockup-batch.ts --layouts <clientLayouts>
   --count N` → cura billboard/poster/device/retail por aspect da face.
4. **Lote logo** — dispara `brand-mockup-batch.ts --layouts <squaresTmp> --square
   --count N` → faces ~1:1.
5. **kit-summary.json** — junta os dois `_summary.json`.

## Por que não reinventa

- Motor de render/curadoria = `brand-mockup-batch.ts` (já validado nos lotes
  Soccer248). O orquestrador só **pluga a marca do Visant + prepara as artes 1:1**
  e chama o motor 2×.
- Client Visant = `src/lib/visant.ts` (`getBrandGuideline`/`pickLogo`), o mesmo
  que o `agent-cli render --brand` usa.

## Pré-requisitos

- render-server na 4200 (`npm run render`).
- Visant conectada (env `VISANT_API_KEY` ou login pela UI; tokens em `~/.visant/`).
- `npx tsx` (nunca `bun`) — acessa Mongo.

## Notas de marca (Visant)

- Logos no Visant costumam ser **lockups horizontais + thumbnails baixa-res** →
  pra metade `logo` (faces 1:1) passe `--symbol` com um símbolo/ícone em alta
  (vetor de preferência). A **paleta** sempre vem do Visant.
