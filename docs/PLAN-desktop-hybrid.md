# PLAN — BOXY Desktop App (híbrido local + API)

> "Baixe o app, mostre seus mockups e use-os na store."
> Catálogo local (PSDs do usuário) + catálogo BOXY (PSDs de autoria própria, servidos por API).

## Decisão de arquitetura

| Camada | Escolha | Por quê |
|---|---|---|
| Shell | **Electron + electron-builder** | App já é Next + Node (ag-psd, render-server TCP, fs). Tauri exigiria sidecar Node — complexidade sem ganho. RN/Flutter = rewrite total. |
| Catálogo local | **SQLite (better-sqlite3)** embarcado | Elimina Mongo do cliente. PSDs do usuário ficam no disco dele, indexados localmente. Zero custo recorrente, offline-first. |
| Catálogo BOXY | **API hospedada (Next no Vercel + Mongo Atlas)** | Mesmo stack atual. Serve metadados, thumbnails e renders — nunca o `.psd`. |
| Render local | PSDs do usuário → render-server local (como hoje) | Já funciona. |
| Render BOXY | **Servidor** (modelo C — ver abaixo) | Protege o ativo. |

## Modelo C — proteção dos PSDs BOXY (recomendado)

O `.psd` BOXY **nunca desce** pro cliente:

1. **Preview (grátis, instantâneo):** cada mockup BOXY tem um *flat proxy* (JPEG da cena + máscara/quad da face). O app compõe a arte do usuário em cima localmente com canvas — preview em <1s, offline-friendly com cache.
2. **Render final (alta-res):** app envia arte + refId pra API → render-server **seu** (mesma engine de hoje, rodando num host) → devolve PNG.
3. Monetização natural: renders finais por crédito/assinatura; previews ilimitados.

Modelo validado de mercado (Placeit, Smartmockups, Artboard Studio).

### Pipeline de publicação BOXY (você → catálogo)
- `agent-cli`/script existente escaneia PSD → extrai faces, dims, flat proxy JPEG, quad da face → sobe metadados + proxy pro Atlas/Blob.
- O PSD original fica só no seu storage privado (disco do host de render ou bucket privado).

## Fases

### Fase 1 — Electron shell (1–2 dias)
- [ ] `electron/main.ts`: sobe Next (`output: standalone`) + render-server como child processes; mata no quit
- [ ] Single instance lock, tray, ícone, janela com estado persistido
- [ ] `dialog.showOpenDialog` no wizard "Adicionar pasta" (substitui digitação de caminho)
- [ ] Dev: `electron .` aponta pro `next dev` (hot reload mantido)

### Fase 2 — Storage local (2–3 dias)
- [ ] Migrar coleções do cliente (referências locais, psd_metadata, presets) Mongo → SQLite
- [ ] Camada `src/lib/db.ts` vira interface com driver duplo (sqlite local / mongo só no servidor da API)
- [ ] Tokens Visant + settings → `safeStorage` do Electron

### Fase 3 — API BOXY (3–4 dias)
- [ ] Endpoints: `GET /catalog` (busca/categorias/brand-aware suggest), `GET /catalog/:id/proxy` (flat JPEG + quad), `POST /render` (arte + refId → PNG)
- [ ] Auth: conta BOXY (e-mail + magic link ou OAuth Visant) + créditos de render
- [ ] Host do render-server: VPS/Fly.io com os PSDs em volume privado
- [ ] Preview local: compositor canvas (arte × quad do proxy) no cliente

### Fase 4 — Distribuição (1–2 dias + burocracia)
- [ ] electron-builder: NSIS (Win) + DMG (Mac universal)
- [ ] Assinatura: Azure Trusted Signing (~$10/mês, Win) + Apple Developer ($99/ano, notarização)
- [ ] Auto-update: electron-updater → GitHub Releases
- [ ] Landing "Download" no site BOXY

## Custos recorrentes

| Item | Custo |
|---|---|
| Apple Developer | $99/ano |
| Azure Trusted Signing | ~$120/ano |
| Host render-server (Fly/VPS 4GB) | ~$15–30/mês |
| Mongo Atlas (catálogo, M0/M2) | $0–9/mês |
| **Total** | **~$40–60/mês** |

## Riscos / pontos abertos
- **OOM no render hospedado**: murais multi-face já têm cap de 8 faces; dimensionar RAM do host (PSDs BOXY chegam a centenas de MB)
- **Fila de render**: 1 render por vez por worker; usar fila simples (BullMQ/Redis ou fila in-process) antes de escalar
- **Pirataria do proxy**: flat JPEG em alta poderia ser usado "como está" → servir proxy ≤1500px com watermark sutil fora da face
- **Conta/créditos**: definir pricing depois do MVP; Fase 3 pode lançar com renders ilimitados em beta
