<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

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

Regras embutidas (mantêm consistência, vieram de erros reais):
- **device = face com aspect de tela** (retrato ~0.40–0.65), não a maior — senão pinta o cenário de fundo e deixa a tela com watermark.
- Cap de 8 faces (anti-OOM em murais de pôster) + try/catch por render.
- Murais multi-face recebem **layouts variados** (rotaciona entre os 3 mais próximos no aspect).
- Pré-requisito: render-server na 4200 (`npm run render`). PSDs resolvidos via `psd_metadata.filePath` no disco.
