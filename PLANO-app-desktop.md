# PLANO — Mockup Store como app de desktop

O usuário pluga os PSDs dele. O app é **interface + engine**, roda local. Nuvem só pro
que é compartilhado. Chaves de IA **sempre BYOK**.

Base: skill `visant-app` + `supervisor.js` do `jaques-os`. Instalador estimado ~150–200 MB,
sem nenhum asset.

## Arquitetura

```
Electron (casca, supervisor, ajustes, BYOK)
   ├── filho: Next standalone (porta efêmera)      ← UI + engine
   ├── filho: render server (@visant/psd-engine)   ← lê as pastas do usuário
   └── nuvem: API Visant (brand guidelines, produtos Boxy, presets)
```

`output: 'standalone'` no `next.config.ts`. Nativos (`sharp`, `canvas`) ficam nos filhos, no
Node empacotado — nunca dentro do Electron (ABI). `npmRebuild: false`.

## Onde cada dado passa a morar

| coleção Mongo hoje | vai para |
|---|---|
| `psd_metadata` | **local** — manifesto por pasta + `minisearch` (já está nas deps) |
| `engine_events` | **local**; envio opt-in |
| `brand_profiles`, `brand_guidelines_cache` | **API Visant**, autenticado |
| `community_presets` | **API Visant** |

Nada de Atlas no cliente. Índice reconstrói do disco — a verdade são os arquivos do usuário.

## BYOK

Chaves do usuário via **`safeStorage`** (DPAPI / Keychain). Nunca `.env`, nunca
`localStorage`. Chave ausente desabilita o recurso com caminho pra resolver — não falha
calado no meio de um render. Testa a chave ao salvar.

## Ordem

| # | frente | bloqueia? |
|---|---|---|
| 1 | `output: standalone` + Electron mínimo subindo como filho | não — prova o caminho, 1 dia |
| 2 | `puppeteer` → devDependencies (−150/300 MB de Chromium) | não |
| 3 | pastas do usuário na UI (substitui `PSD_DIRS`) + estado vazio que pede pasta | não |
| 4 | `psd_metadata`/`engine_events` → índice local | **sim** |
| 5 | `brand_*`/`community_presets` → API Visant | **sim** |
| 6 | BYOK com `safeStorage` | sim, pra IA |
| 7 | ícones + instalador via `npm run icons` | não |
| 8 | assinatura + `electron-updater` + canal no R2 | define o "profissional" |

## Distribuição

`electron-builder` emite `latest.yml` + `.blockmap`; `electron-updater` baixa só os blocos
mudados. Hospedar no R2 (sem egress). `stagingPercentage` entrega pra uma fatia antes de
todo mundo. `version` sobe a cada build ou o updater não vê nada.

Assinar é o que evita o "O Windows protegeu o seu PC": Azure Artifact Signing (~US$ 9,99/mês,
**confirmar disponibilidade no Brasil**) ou OV (~US$ 200–400/ano). EV não pula mais o
SmartScreen. macOS: assinar + notarizar é obrigatório pro auto-update funcionar.

## Armadilhas

- `asar` não é criptografia — `npx @electron/asar extract` lê tudo. Por isso BYOK é
  arquitetura, não conveniência.
- Não empacotar `public/photo-previews` (513 MB) nem `Render/` (331 MB) — é seu material,
  não do produto. Thumbs se geram local em `userData`.
- `next export` não sobrevive: as rotas em `src/app/api/**` precisam de servidor.
- `allowToChangeInstallationDirectory: true` com auto-update quebra o pin da taskbar (#926).
- Não instalar Mongo na máquina do usuário pra indexar arquivo local.
