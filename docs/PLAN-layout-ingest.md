# Layout Ingest — metadado de arte pra mockup

Status: **protótipo validado no mockup-store. Ainda NÃO portado pro visantlabs-os.**
Validado em: 30 layouts da Urban Stay (`H:\Meu Drive\@Clientes VSN\Urban Stay®\_prod\Layouts`).

## O problema

O `brand-mockup-batch` encaixa a arte com `frameArt(mode:"cover")`, que preenche a
face do PSD **cortando** o excedente. Em layout tipográfico isso decepa o headline.
Medido no 1º lote Urban Stay: **9 de 20 mockups com corte ≥15%**; o pior descartou
**57% da arte** (face 4.16 recebendo arte 1.78). Um virou "EJA A VIDA / ELA NOSSA /
OLDURA."

O `--max-crop` (já em produção no batch) resolve com geometria de face, mas é um
número **global**: trata toda arte igual. Uma arte com margem folgada aguenta 20%
de corte; uma com texto colado na borda não aguenta 5%. Hoje pagamos o pior caso
pra todas — descartando cena boa por excesso de zelo.

Falta o dado por-arte: **"quanto dá pra cortar ESTA arte?"**

## O que foi testado (e o que os dados disseram)

Três métodos, cruzados contra o único gabarito confiável: artes de **fundo
chapado**, onde a geometria mede a margem de verdade.

| método | acerta | erra | veredito |
|---|---|---|---|
| **geometria** (energia de borda) | margem real em fundo chapado | não separa foto de texto → 0% em arte full-bleed | piso confiável, cobertura baixa |
| **VLM** (claude-haiku, bbox) | `kind`, descrição | **coordenada** | ✗ reprovado pra bbox |
| **OCR** (tesseract.js) | caixa medida + o texto | tipografia script / texto sobre foto | ✓ aprovado, com portão |

### 1. Geometria — funciona, cobertura baixa

Primeira tentativa ("conteúdo sobre fundo sólido, acha a bbox do que destoa")
**falhou**: 29/30 com safeCrop 0%. Esses layouts são full-bleed com gradiente
granulado (estética da marca) — tudo destoa da borda. Pior: min/max sobre todos
os pixels faz **um pixel de ruído zerar a margem**.

Corrigido pra **energia de borda** com corte por percentil (0.5%): gradiente tem
energia ~0, tipografia tem energia alta. Passou a acertar em fundo chapado
(`Frame 4785` → 13%, `Frame 4800` → 21%). Continua cego em arte fotográfica —
foto tem energia de borda em todo lugar, e pixel não distingue "detalhe de foto
na borda" de "headline na borda".

### 2. VLM — reprovado pra coordenada

Pedimos a `textBox` ao `claude-haiku-4-5` com schema forçado (`layout-vision.ts`).
Resultado: **caixas quantizadas** — 30 artes, três valores (0%/10%/20%). As
coordenadas cruas denunciam: `{x0:0.10, y0:0.10, x1:0.90, y1:0.90}` repetido arte
após arte. É prior genérico, não medição.

Agravante: **confidence 0.90–0.95**. Confiantemente errado. No `Frame 4785`
(margem real ~8%) respondeu 20% — seguir isso **decepa o headline**, o bug que
queríamos consertar. No gabarito `Frame 4800`: geo 21% vs visão 10%, **Δ=11%**.

→ VLM segue no pipeline **só pra `kind`/descrição**, onde acerta. Nunca pra
coordenada. Não sobrescreve `safeCrop`.

### 3. OCR — aprovado

`tesseract.js` (`por+eng`), caixa de palavra medida, união = `textBox`.
Cruzamento contra gabarito: **Δ=0% nos dois casos** (4800: 21%/21%; 4785: 13%/13%).
Prova de que lê e não chuta: devolveu `"VEJA A VIDA PELA NOSSA MOLDURA"` e
`"URBAN STAY, O CORAÇÃO QUE PULSA BC."` — os headlines reais.

**Risco encontrado: leitura parcial.** Fragmento vira caixa pequena vira corte
generoso. `Frame 4807` leu só `"PIE"` → concluiu **48% de corte livre**. Em arte
fotográfica não há geometria pra denunciar.

**Portão de qualidade** (`trustworthy`): `words >= 2 && meanConfidence >= 70 &&
letters >= 6`. Barrou os três casos (`"PIE"` 48%→1%, `"ec..."`, `"AY"` 10%→2%).
Onde o fundo é chapado, fica com `min(ocr, geometria)` — discordância significa
que alguém errou, então vale o mais cauteloso.

**Viés deliberado: conservador.** Corte demais = headline decepado (o bug).
Corte de menos = cena descartada (chato). Na dúvida, não corta.

## Aberto / não resolvido

**Resolvido na 2ª rodada:**

- **Outlier de 41% (`Frame 4784`)**: teto `UNVERIFIED_CROP_CAP` (default 20%,
  flag `--cap`) quando só o OCR mediu — fundo fotográfico, geometria cega,
  ninguém audita a leitura. Ficou 20%.
- **Cobertura 12/30 → 15/30**: `prepForOcr` (greyscale + normalise + 2× lanczos)
  e **dupla polaridade** — roda normal e invertido, fica com a leitura mais rica.
  Metade das artes é texto claro sobre fundo escuro e o tesseract espera o
  contrário. Sem binarizar: threshold global destrói texto sobre gradiente.
- **OCR silencioso era ambíguo** ("não há texto" vs "o OCR falhou"). Resolvido
  usando o VLM no que ele acerta: `hasText:false` + confiança ≥0.7 + kind
  pattern/other → libera até o teto. Julgamento semântico, não coordenada.
- **AppleDouble** (`src/lib/fs-walk.ts`): o walker abria `._Foo.psd` (resource
  fork do macOS que o Drive sincroniza) e falhava — 18 FAILs no scan.
- **`ONLY_NEW=1`** (`scripts/scan-psds.ts`): o scan relia os ~2k PSDs toda vez,
  o que o tornava impraticável por trigger. Agora filtra pelo banco antes de
  abrir arquivo. 1º uso indexou **630 PSDs novos** (2028 → 2658) invisíveis.

**Ainda aberto:**

- **OCR falha em script lettering** (o logo cursivo da marca) e em texto sobre
  foto → 15/30 caem no fallback geométrico (~1%). Conservador demais: perde cena
  boa, nunca quebra arte. Limite do tesseract, não bug.
## Bake-off: quem mede a caixa? (`scripts/textbox-bakeoff.ts`)

30 artes, gabarito = geometria em fundo chapado.

| método | cobertura | erro vs gabarito | dep nova |
|---|---|---|---|
| **Gemini** (`box_2d`) | **30/30** | 0.9pp | não — já no stack |
| OCR (tesseract) | 15/30 | 0.4pp | sim (WASM + worker) |
| Claude (haiku) | 0/30 nesta rodada | — | não |

**Veredito: Gemini.** Responde todas — inclusive os cards de lettering cursivo
onde o OCR é cego — com valores finos (6/21/28/12/4%), não os 0.10/0.90
quantizados do Claude. Nos dois casos de verdade conhecida os dois acertam
(`4800` real 21% → OCR 21%, Gemini 20%). Tesseract não se paga: 2× menos
cobertura por uma dep pesada.

**Chave: usar a convenção NATIVA do modelo.** Gemini detecta em `box_2d` =
[ymin, xmin, ymax, xmax] 0-1000 (y antes de x). Pedir noutro formato o testa fora
do que ele foi treinado — foi o que fez o teste inicial parecer que "VLM não
mede". O que não mede é o Claude; o Gemini mede.

Ressalvas honestas: o gabarito tem **n=1** (só uma arte de fundo chapado), então
0.4 vs 0.9pp não é diferença significativa. Fora do gabarito os dois discordam
~8pp em média — nenhum é verdade absoluta ali. E o 0/30 do Claude é anomalia
desta rodada (antes ele respondia); ele já tinha sido reprovado por chutar, não
por silêncio.

## Estado final

**mockup-store:** `layout-ingest.ts` gera o sidecar; `brand-mockup-batch.ts`
consome `safeCrop` **por arte** dele, com fallback pro `--max-crop` global (sem
sidecar, comportamento antigo intacto). tesseract fica como referência de
validação cruzada, não vai pro prod.

**visantlabs-os (branch `dev`):** `placement.textBox`/`safeCrop`/`safeCropSource`
preenchidos pelo Gemini dentro do `assetAnalysis` que já existia — sem pipeline
novo, sem migration (`media` é `Json?`). `category` derivada de `placement.kind`.

**Ainda aberto:** OCR falha em script lettering (limite do tesseract, agora
irrelevante). Validar o `box_2d` do Gemini num acervo maior que n=1 de gabarito.

## Onde isso mora no prod (visantlabs-os)

**A casa já existe.** `server/types/brandGuideline.ts:11-41` — `BrandAssetAnalysis`
já tem `placement`, comentado como *"how the asset composites onto a mockup
surface"*, com `kind`, `hasText`, `luminance`, `aspectRatio`, `dominantColor`,
`hasTransparency`, `contrastSafeOn`. Preenchido por `scheduleAssetAnalysis`
(`server/lib/brand/assetAnalysis.ts`, gemini-2.5-flash) no upload de media.

Falta **um campo**: ele sabe `hasText: true`, não sabe **onde**.

**Port mínimo, sem migration** (`media` é coluna `Json?` — `prisma/schema.prisma:583`):

```ts
placement?: {
  ...
  textBox?: { x0: number; y0: number; x1: number; y1: number };
  safeCrop?: number;        // fração total cortável, centrado
  safeCropSource?: 'ocr' | 'geometry';
}
```

1. Portar `layout-ocr.ts` (OCR + portão) e a parte de geometria do
   `layout-ingest.ts` pro `assetAnalysis.ts`.
2. `scheduleAssetAnalysis` passa a escrever `placement.textBox`/`safeCrop`.
   Continua sendo o LLM que dá `kind`/`description` — não mexer nisso.
3. `brand-mockup-batch` lê `safeCrop` por arte em vez do `--max-crop` global.

## Bugs achados no prod (independentes deste plano)

1. **`smart-analyze` é `requireAdmin`** (`server/routes/plugin.ts:2421-2423`) mas é
   anunciado como tool livre e gratuita → não-admin toma **403**.
2. **`upload-image` força `.png`/`image/png`** (`server/services/r2Service.ts:93`)
   ignorando o `contentType` declarado → webp/jpeg/svg gravados com rótulo errado.
3. **`label` de media não tem gerador dedicado**: ou vem do caller, ou é efeito
   colateral não-especificado do `EXTRACTION_PROMPT` (`server/lib/brand-extract.ts:35-54`
   — sem regra de tamanho/idioma/estilo). O `analysis.description`, que *tem*
   prompt real, nunca escreve em `label`. Ingest casa label↔asset **por índice de
   array** (`brand-guidelines.ts:896`) → desalinhou, rotula errado em silêncio.
4. `BrandGuidelineMedia.category` declarado e **nunca escrito**.
5. `prisma/schema.prisma:614` — comentário corrompido (`\ ` em vez de `//`).
6. `assetAnalysis.ts:26` hardcoda `gemini-2.5-flash` em vez de `GEMINI_MODELS.*`.

## Arquivos

- `scripts/layout-ingest.ts` — orquestra; gera `<layouts>/_layouts-meta.json`
- `src/lib/layout-ocr.ts` — OCR + portão de confiança + `safeCropFromBox`
- `src/lib/layout-vision.ts` — VLM (kind/descrição; bbox só pra comparação)

```
npx tsx --env-file=.env.local scripts/layout-ingest.ts --layouts "<dir>" --ocr --ai
```
