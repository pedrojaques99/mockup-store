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
