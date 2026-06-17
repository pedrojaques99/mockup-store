# PLAN — Reusar features da visantlabs-os no photo-mockup

> Objetivo: trazer **crop, upscale, convert, export e edit-with-AI (laço)** pro editor
> `/photo-mockup` **sem reinventar** nada que já existe. Veredito após mapear os dois
> repos: só 2 das 5 features realmente puxam infra da visantlabs-os. As outras 3 já
> têm lib instalada aqui e build local é mais enxuto que importar de lá.

## Princípio de cada feature

| Feature | Onde roda | Reuso |
|---|---|---|
| **Crop** | 100% client (mockup-store) | `react-easy-crop` **já instalado** — zero backend |
| **Convert** | client (`canvas.toDataURL`) ou server (`sharp` já instalado) | build local trivial |
| **Export** | client (já existe "Salvar PNG") | estender com WebP/JPEG/qualidade via `sharp` |
| **Upscale** | **bicubic** = `sharp` local (grátis) · **IA** = `moodboard-upscale` Gemini | bicubic não precisa de backend; IA via `lib/visant.ts` |
| **AI edit (laço)** | seleção = local (SAM2/pen/brush/wand) · inpaint = **novo endpoint Visant prod** | ver `PLAN-visant-inpaint-deploy.md` |

**Insight central:** o "laço com IA" da visantlabs-os usa `perfect-freehand` (retângulo + brush
simples). O mockup-store **já tem seleção superior** (SAM2 + pen bezier + brush + magic wand →
PNG mask). Então NÃO portamos o `LassoTool.tsx` de lá. Reusamos a máscara que o editor já
produz e só plugamos o backend de inpaint.

---

## Arquitetura de integração (padrão já existente no editor)

Todo tool novo segue o mesmo encaixe que `corners/mask/reflect/render` já usam:

1. `src/components/photo-tools/registry.ts` → entrada no `PHOTO_TOOLS` + atalho de teclado
2. `src/components/<Tool>Canvas.tsx` → overlay de canvas + `apiRef` (quando precisa interação)
3. `src/components/photo-tools/panels/<Tool>Panel.tsx` → UI com `<Slider>` + `<Segmented>`
4. `page.tsx` → estado (`useState`), branch no render, filho do `<ToolRail>`
5. `src/app/api/photo-mockup/[id]/<tool>/route.ts` → só quando há processamento server

Design system: reusar `ui/Slider`, `ui/Segmented`, `ui/Tooltip`, `ui/Popover`, helper `cn()`.
Tokens: `acc` (#22d3ee), `acc2` (#3df27e), `zinc-*`. Labels 10px. Botão ativo `bg-acc2 text-zinc-950`.

---

## Fase 1 — Crop (local, sem backend) · ~½ dia

- **Lib:** `react-easy-crop` (já em `package.json`). Não instalar nada.
- `registry.ts`: `{ id: "crop", label: "Cortar", icon: Crop, group: "edit" }`, atalho `p`.
- `CropCanvas.tsx`: usa `<Cropper>` do react-easy-crop sobre o `photoUrl`; emite box normalizado.
- `CropPanel.tsx`: `<Segmented>` aspect (livre / 1:1 / 16:9 / 4:5) + botão Aplicar.
- Aplicar → `canvas.drawImage` da região → novo `photoUrl` (data URL) → re-dispara analyze.
- **Sem rota de API.** Resultado fica client-side.

## Fase 2 — Convert + Export (local) · ~½ dia

- Estender o botão **"Salvar PNG"** do `RenderPanel.tsx` para um `<Segmented>` de formato:
  `PNG / JPEG / WebP` + `<Slider>` de qualidade (só habilita p/ JPEG/WebP).
- **Client puro** quando o source é canvas/blob: `canvas.toBlob(type, quality)` + download.
- **Quando precisa qualidade fina/AVIF:** rota `POST /api/photo-mockup/[id]/convert` usando
  `sharp` (já instalado) → `{ base64, mimeType }`. Padrão de rota igual ao `render/route.ts`.
- Export reaproveita o blob do render que já existe — não recomputa.

## Fase 3 — Upscale (2 modos) · ~1 dia

Existem **dois upscales** e eles atendem casos diferentes. O painel oferece os dois.

### 3a — Bicubic / algorítmico (LOCAL, grátis, sem créditos)

> A visantlabs-os faz isso via shader WebGL (`apply-shader { shaderType:'upscale' }`, bicubic/
> nearest). **Não precisamos do shader nem da API:** o `sharp` (já instalado) faz resample
> lanczos3/cubic de qualidade igual ou melhor, local e grátis.

- Rota `POST /api/photo-mockup/[id]/upscale-cv` (ou flag `mode` na rota única) →
  `sharp(buf).resize(w*scale, { kernel: "lanczos3" })`. Sem rede, sem crédito.
- Escala 2×/4× para suavizar pixelização — bom default antes do render.

### 3b — IA / Gemini (Visant prod, custa crédito)

- **Backend:** `moodboard-upscale` (Gemini, 1K/2K/4K) — já disponível na API que o
  `lib/visant.ts` autentica. Confirmar token com escopo `generate`.
- Gera detalhe novo (não só interpola) — para quando o bicubic não basta.
- **custa créditos** → mostrar custo no painel antes de disparar (padrão do RenderPanel).

### UI comum

- `registry.ts`: `{ id: "upscale", label: "Aumentar", icon: ZoomIn, group: "process" }`.
- `UpscalePanel.tsx`: `<Segmented>` **modo** (Bicubic grátis / IA crédito) + `<Segmented>`
  tamanho (2× / 4× para bicubic · 1K/2K/4K para IA) + preview do tamanho atual → botão "Aumentar".
- Rota única `POST /api/photo-mockup/[id]/upscale` com `{ base64, mode: "bicubic"|"ai", size }`:
  - `bicubic` → sharp local · `ai` → `lib/visant.ts` `upscale()`.
  - devolve `{ upscaledBase64, width, height }`.
- Aplica no `photoUrl` OU na arte (decidir target via `<Segmented>` "Foto / Arte").

## Fase 4 — AI edit / laço (seleção local + inpaint Visant prod) · ~1–2 dias

> Depende de `PLAN-visant-inpaint-deploy.md` (endpoint de inpaint em produção).
> Enquanto não deploya, dá pra validar contra `ai-change-object` (prompt-only) como stub.

- **Seleção: REUSO TOTAL do que já existe.** O tool `mask` já gera PNG mask via
  SAM2/pen/brush/wand. Não criar canvas novo.
- `registry.ts`: `{ id: "ai-lasso", label: "IA Laço", icon: Wand, group: "edit" }` —
  ou (melhor) adicionar um **modo "Editar com IA"** dentro do tool `mask` existente,
  reusando a máscara ativa em vez de um tool separado. (Decidir na implementação.)
- Painel: `<input>` de prompt + `<Segmented>` modo (`replace / remove / retouch`) + resolução.
- Rota `POST /api/photo-mockup/[id]/ai-edit`:
  - recebe `{ base64Image, base64Mask, prompt, mode, resolution }`
  - chama o endpoint de inpaint da Visant prod (ver companion plan) via `lib/visant.ts`
  - devolve a imagem editada → vira nova layer / novo `photoUrl`.
- Mostrar custo de créditos + estado de loading (já há padrão "AI · 8.0s" no canvas).

---

## Mudanças em `lib/visant.ts` (centralizar os 2 reusos)

Adicionar 2 métodos ao cliente existente (mesmo padrão de auth OAuth device flow já usado):

```ts
upscale(base64: string, size: "1K"|"2K"|"4K"): Promise<{ base64, width, height }>
inpaint(p: { base64Image, base64Mask, prompt, mode, resolution }): Promise<{ base64 }>
```

Crop/convert/export **não** tocam `lib/visant.ts` (são locais).

---

## Ordem sugerida / esforço

1. **Crop** (½ dia) — quick win, zero backend, valida o padrão de tool novo.
2. **Convert + Export** (½ dia) — estende UI que já existe.
3. **Upscale** (1 dia) — primeiro reuso real de infra Visant, valida `lib/visant.ts` estendido.
4. **AI edit** (1–2 dias) — depende do companion plan; maior valor.

Total ~3–4 dias, sem nenhuma feature reinventada.

## O que explicitamente NÃO fazer

- ❌ Portar `LassoTool.tsx` / `ImageEditorCanvas.tsx` da visantlabs-os — seleção daqui é melhor.
- ❌ Importar Zustand stores da visantlabs-os — o editor usa useState local, não misturar.
- ❌ Build de crop/convert custom — libs já instaladas resolvem.
- ❌ Depender do Express server local da visantlabs-os em runtime (decisão: inpaint vai pra prod).
