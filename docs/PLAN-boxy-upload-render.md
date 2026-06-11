# PLAN — "Upload PNG" no boxy.app (render via VPS visantlabs)

> Botão no produto: usuário sobe um PNG → render final server-side com o PSD do produto → PNG em alta via CDN.
> **Quota: 3 renders = 1 download** (consome da mesma quota diária de downloads).

## STATUS — CÓDIGO 100% IMPLEMENTADO (2026-06-11)

Tudo no repo `Z:\BOXY\@boxy-monkey\boxy-app`. `tsc` limpo, 16/16 testes de quota verdes.

| Camada | Arquivo | Feito |
|---|---|---|
| Schema | `prisma/schema.prisma` — `products.psd_file_name/psd_url/render_enabled` + model `renders` + relação em `users` | ✅ (prisma generate rodado) |
| Quota 3:1 | `src/lib/download-limits.ts` — modelo de créditos (`getDailyCredits` fonte única, `getDownloadQuota` pool-aware, `getRenderQuota` novo) | ✅ + testes |
| Cliente VPS | `src/lib/mockup-render.ts` — `renderMockup()` chama `POST {VISANT_RENDER_API_URL}/api/psd-render/render`, `arts:[{smartObject:'*', artBase64}]`, `hideLayers:['[BOXY]']`, lê `data.url` | ✅ |
| Proxy | `src/app/api/mockup-render/route.ts` — sessão→premium→`getRenderQuota`→produto→VPS→grava `renders` (só no sucesso) | ✅ |
| UI | `src/components/shop/mockup-render-button.tsx` (Dialog+Loader+sonner) + wire em `product-client.tsx` | ✅ |
| Segurança | `api/shop/[id]/route.ts` — strip `psd_file_name`/`psd_url` da resposta pública | ✅ |
| Env | `.env` — `VISANT_RENDER_API_URL`, `VISANT_RENDER_API_KEY` (placeholder) | ✅ |

### Falta (operacional, precisa do usuário — não é código):
1. **Gerar a API key de serviço** na Visant (`visant_sk_*`, scope `generate`) e pôr em `VISANT_RENDER_API_KEY` no `.env` da Vercel/boxy-app.
2. **`npx prisma db push`** no boxy-app (aplica os campos novos no Mongo — precisa de `DATABASE_URL`).
3. **Tier do service account na VPS**: para usar `psd_file_name`, basta os PSDs estarem em `GOOGLE_DRIVE_PUBLIC_FOLDER_IDS`. Para `psd_url` arbitrária, o user da key precisa estar em `PSD_RENDER_ALLOWED_USERS`/`team_members` (tier `all`).
4. **Curar produtos piloto**: setar `render_enabled=true` + `psd_file_name` em 3 produtos e validar 1 render real.

### Contrato VPS confirmado (lido do fonte, não chutado):
- Request: `{ psdFileName | psdUrl, arts:[{smartObject, artUrl|artBase64}], hideLayers, preview }` — máx 8 arts, `smartObject:"*"`/ausente = todas as faces.
- Response: `{ success:true, data:{ url, sizeBytes, durationMs, engine, replaced } }`.
- Auth: `Authorization: Bearer visant_sk_*` → popula `req.userId`; tier resolvido por admin/allowlist/team.

## O que já existe (não construir de novo)

| Peça | Onde | Status |
|---|---|---|
| Render server-side ag-psd (3–8s) | VPS Coolify · `POST api.visantlabs.com/api/psd-render/render` | ✅ pronto |
| PSDs via Google Drive (`psdFileName`, cache LRU 5GB) ou URL (`psdUrl`) | `server/services/driveService.ts` / `spacesService.ts` | ✅ pronto |
| Output DO Spaces `psd-renders/{userId}/{jobId}.png` + CDN | `spacesService.ts` | ✅ pronto |
| Auth service-to-service (`visant_sk_*`) | `server/middleware/apiKeyAuth.ts` | ✅ pronto |
| Esconder watermark (camadas `[BOXY]`) | `psd-render-worker-agpsd.ts` (auto) | ✅ pronto |
| Sessão + premium + quota diária no boxy-app | NextAuth + `download-limits.ts` | ✅ pronto |

## Gaps a implementar

### 1. Prisma — produto aponta pro PSD renderizável

`Z:\BOXY\@boxy-monkey\boxy-app\prisma\schema.prisma`:

```prisma
model products {
  // ... existentes
  psd_file_name   String?   // nome do PSD no Drive (GOOGLE_DRIVE_PUBLIC_FOLDER_IDS) — preferido
  psd_url         String?   // alternativa: URL direta (DO Spaces privado/presigned)
  render_enabled  Boolean   @default(false)  // só produtos curados mostram o botão
}

model renders {
  id          String   @id @default(auto()) @map("_id") @db.ObjectId
  user_id     String   @db.ObjectId
  product_id  String   @db.ObjectId
  job_url     String   // URL do PNG no CDN do Spaces
  created_at  DateTime @default(now())
  @@index([user_id, created_at])
}
```

Backfill: começar com subconjunto curado (ex.: 20–50 best-sellers), não os 694.

### 2. Quota — 3 renders = 1 download

`download-limits.ts` ganha:

```
uso_efetivo = downloads_hoje + ceil(renders_hoje / 3)
permitir render se: uso_efetivo_com_este_render <= limite_diario
```

- `renders_hoje` = count em `renders` no dia (UTC ou TZ do site, igual aos downloads).
- `ceil`: o 1º render do dia já "abre" um bloco de 1 download; o 2º e 3º são grátis dentro do bloco.
- Plano anual (∞ downloads) → renders ilimitados (rate limit da VPS segura abuso: 5/min).

### 3. Proxy no boxy-app — `POST /api/mockup-render`

`src/app/api/mockup-render/route.ts`:

```
Request (multipart ou JSON):
  { productId: string, artBase64: string }   // PNG/JPG ≤ 10MB

Fluxo:
  1. getServerSession → 401 se não logado
  2. subscription_type === 'premium' → 403 senão (mesma regra do download)
  3. checa quota (item 2) → 429 com { reason: 'quota' }
  4. busca product → 404 se !render_enabled
  5. POST https://api.visantlabs.com/api/psd-render/render
       Authorization: Bearer ${VISANT_RENDER_API_KEY}        // visant_sk_*, só server-side
       body: {
         psdFileName: product.psd_file_name,                  // ou psdUrl
         arts: [{ smartObject: "*", artBase64 }],             // todas as faces
         hideLayers: ["[BOXY]"]
       }
  6. grava em renders { user_id, product_id, job_url }
  7. → 200 { url, durationMs }

Response: { success, url }   // url = CDN do DO Spaces
```

Env novo no boxy-app: `VISANT_RENDER_API_KEY` (criar via `POST /api/apikeys/create` na Visant com scope `generate`, conta de serviço BOXY).

Na VPS: garantir que a conta de serviço está no tier `all` (`PSD_RENDER_ALLOWED_USERS`) **ou** que os PSDs estão em `GOOGLE_DRIVE_PUBLIC_FOLDER_IDS`.

### 4. UI — botão no produto

`src/components/shop/product-client.tsx` (junto do Download, linha ~240):

```
[Upload PNG e visualizar]  ← visível se product.render_enabled && premium
   → <input type=file accept=image/png,image/jpeg>
   → valida ≤10MB, converte base64
   → POST /api/mockup-render  (spinner "Renderizando… ~5s")
   → sucesso: modal com <img src={url}> + [Baixar PNG] + [Tentar outra arte]
   → 429 quota: toast "Você usou seus renders de hoje (3 renders = 1 download)"
   → free user: botão vira "Upgrade para testar sua arte" → /price
```

Radix Dialog + Tailwind (padrão existente do site). Contador opcional no botão: "2/3 renders neste bloco".

### 5. Curadoria de PSDs (contínuo)

- Subir/verificar PSDs na pasta Drive pública da VPS (ou bucket `boxy` do Spaces)
- Naming consistente; watermark em camada `[BOXY]`; faces editáveis detectáveis
- Validar cada um com 1 render de teste via API antes de `render_enabled = true`
- O `agent-cli faces <psd>` do mockup-store serve pra auditar faces antes de subir

## Ordem de execução

1. [ ] Criar API key de serviço na Visant + testar `POST /psd-render/render` com 1 PSD via curl
2. [ ] Prisma migration (campos + tabela `renders`) + marcar 3 produtos piloto
3. [ ] Rota proxy `/api/mockup-render` com quota 3:1
4. [ ] Botão + modal no `product-client.tsx`
5. [ ] Teste e2e com os 3 pilotos → expandir curadoria

## Riscos

- **Concorrência VPS = 2 renders globais** — ok pro início; se virar gargalo, subir `PSD_RENDER_MAX_CONCURRENT` ou adicionar fila com polling
- **Spaces público**: renders ficam em URL pública adivinhável por jobId — ok (contém a arte do próprio user), mas não indexar
- **PSDs gigantes** (centenas de MB) estouram o tempo do primeiro render (download Drive) — cache LRU resolve do 2º em diante; pré-aquecer os pilotos
- **Abuso de upload**: limitar 10MB + mime check no proxy; rate limit Upstash já existe no boxy-app
