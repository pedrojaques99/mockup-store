# Plano — Agente brand-aware: sugestões + render autônomo de mockups

## Objetivo
O agente (visantlabs-os) sugere e renderiza os melhores mockups **da biblioteca real de PSDs**
da mockup-store a partir dos dados da Brand Guidelines API — end-to-end:
o usuário vê sugestões rankeadas na UI, e o agente tem endpoints próprios para
operar e renderizar sozinho (logo da marca já aplicado no PSD).

## O que já existe e será aproveitado (não reinventar a roda)
| Capacidade | Onde | Status |
|---|---|---|
| Render PSD completo (smart object, warp, hideLayers, preview, SSE) | `scripts/render-server.ts` + `/api/render` | ✅ pronto |
| Biblioteca indexada com tags por dimensão (niche/style/…) + full-text | MongoDB `references` + `/api/references*` | ✅ pronto |
| Enquadramento da arte (cover/contain/stretch, matemática pura) | `src/lib/art-frame.ts` | ✅ pronto (client; matemática é portável p/ server) |
| Brand Guidelines API (colors, typography, strategy, archetypes, voice, logos) | visantlabs-os `routes/brand-guidelines.ts` | ✅ pronto |
| Contexto de marca LLM-ready | visantlabs-os `lib/brandContextBuilder.ts` | ✅ pronto |
| Auth por API key (`visant_sk_…`) e MCP com 70+ tools | visantlabs-os `mcp-server/shared.ts` + `platform-mcp.ts` | ✅ pronto |
| `suggest-mockups` da marca | visantlabs-os | ⚠️ existe, mas sugere **prompts de IA generativa** — não conhece a biblioteca de PSDs reais |

**O gap é só a ponte:** ninguém cruza marca ↔ biblioteca de PSDs, e não há endpoint headless para o agente.

## Arquitetura

```
Brand Guidelines API (api.visantlabs.com)
        │  GET /brand-guidelines/:id  (API key)
        ▼
mockup-store ── src/lib/visant.ts (client HTTP)
        │
        ├─ /api/suggest ──── perfil da marca → score na biblioteca → ranking
        │       │             (mapeamento marca→tags via 1 chamada LLM, cacheada)
        │       ▼
        │   UI: seletor de marca + rail "Sugestões para [marca]" + render 1-clique
        │
        └─ /api/agent/v1/* ── endpoints headless (bearer token) para o agente:
                suggest │ render │ jobs/:id
                          ▲
visantlabs-os MCP ────────┘  novas tools: mockup_store_suggest / render / job
```

## Decisões chave
1. **A inteligência de sugestão mora na mockup-store** (ela é dona da biblioteca).
   A Visant API entra só como fonte de dados da marca.
2. **Mapeamento marca→tags com 1 chamada LLM cacheada** por `(brandId, currentVersion)`:
   envia o brand context compilado + o vocabulário real de tags da biblioteca
   (`/api/references/tags`) e recebe JSON `{niche[], style[], keywords[], avoid[]}`.
   - Lib validada: `@anthropic-ai/sdk` com `claude-haiku-4-5` (barato, structured output).
   - Alternativa sem chave Anthropic: heurística pura (match de strings do strategy/
     archetypes contra tags) — fica como fallback automático.
3. **Score determinístico no MongoDB** (sem LLM por request): peso por match de
   niche/style + text score + bônus `has_psd` + diversidade de estúdio. Reprodutível e instantâneo.
4. **Logo da marca como arte default**: o agente renderiza sem upload — baixa o logo
   da guideline (variant `light`/`dark` escolhido por contraste vs. cor média do SO),
   enquadra server-side (mesma matemática do `art-frame.ts`, modo `contain`) e envia ao render-server.
5. **Auth do endpoint do agente**: bearer `MOCKUP_STORE_AGENT_KEY` (env). Render local
   não consome créditos Visant — sem billing aqui.

## Entregas

### 1. Cliente Visant + seleção de marca (fundação)
- `src/lib/visant.ts` — `listBrandGuidelines()`, `getBrandGuideline(id)`, `getLogoUrl(g, variant)`.
  Env: `VISANT_API_URL`, `VISANT_API_KEY`. Cache em memória (TTL 5 min).
- UI: dropdown de marca no header (persistido em `localStorage`).

### 2. Motor de sugestões + UI
- `src/lib/brand-match.ts` — perfil da marca (LLM cacheado em MongoDB `brand_profiles`
  + fallback heurístico) e função pura de score (testável com vitest).
- `src/app/api/suggest/route.ts` — `GET ?brandId=…&limit=24` → `{profile, suggestions[]}`
  com `{ref, score, reasons[]}`.
- UI: rail horizontal "Sugestões para [marca]" acima do grid; card mostra motivo
  ("niche: cosmetics · style: minimal"); clique já seleciona a ref com o logo da marca
  pré-carregado no framer.

### 3. API do agente (headless)
- `src/app/api/agent/v1/suggest/route.ts` — mesmo motor, resposta JSON compacta p/ LLM.
- `src/app/api/agent/v1/render/route.ts` — POST
  `{brandId, refId | psdPath, artUrl?, logoVariant?, smartObject?, mode?, preview?}`
  → resolve arte (logo da marca ou `artUrl`), enquadra server-side, enfileira no
  render-server → `{jobId}`.
- `src/app/api/agent/v1/jobs/[id]/route.ts` — status/resultado (PNG ou base64).
- `src/lib/server-frame.ts` — port server-side do enquadramento (node `canvas` já é dependência).
- Middleware de auth bearer compartilhado nos 3 routes.

### 4. Tools MCP no visantlabs-os (lado do agente)
- `mcp-server/shared.ts` + `server/mcp/platform-mcp.ts`: registrar
  `mockup_store_suggest`, `mockup_store_render`, `mockup_store_get_job`
  apontando para `MOCKUP_STORE_URL` (+ `MOCKUP_STORE_AGENT_KEY`).
- Com isso o agente Claude do Visant (e qualquer cliente MCP) opera o fluxo completo:
  *pegar marca → sugerir PSDs → renderizar → devolver imagem ao usuário*.

## Arquivos
| Arquivo | Ação |
|---|---|
| `src/lib/visant.ts` | novo — client da Visant API |
| `src/lib/brand-match.ts` | novo — perfil + score (puro, testado) |
| `src/lib/server-frame.ts` | novo — enquadramento server-side |
| `src/lib/__tests__/brand-match.test.ts` | novo — vitest |
| `src/app/api/suggest/route.ts` | novo |
| `src/app/api/agent/v1/{suggest,render,jobs/[id]}/route.ts` | novos |
| `src/app/page.tsx` | editar — seletor de marca + rail de sugestões |
| `.env.local` | + `VISANT_API_URL`, `VISANT_API_KEY`, `MOCKUP_STORE_AGENT_KEY`, `ANTHROPIC_API_KEY` (opcional) |
| visantlabs-os `mcp-server/shared.ts`, `server/mcp/platform-mcp.ts` | editar — 3 tools novas |

## Riscos / observações
- **mockup-store é local** (PSDs em drives locais): o agente em nuvem só alcança os
  endpoints via tunnel (ex.: `cloudflared`). Para uso local (Claude Code/Cursor na mesma
  máquina) funciona direto em `localhost`. Decisão de exposição fica fora deste plano.
- Logos sem PNG transparente degradam o resultado → o render usa modo `contain` com
  fundo derivado da paleta da marca como mitigação.
- Tags da biblioteca vêm de `community_presets`; refs sem tags caem no text-score
  (nunca somem do ranking).

## Fora de escopo (v2)
- Compliance check do render final contra a guideline (cores/área de proteção do logo).
- Sugestão multimodal (vision sobre a imagem de referência).
- Batch render de campanha inteira (N PSDs de uma vez) — trivial de adicionar depois sobre o `/api/agent/v1/render`.
