# PLAN (companion) — Deployar inpaint por máscara na API Visant de produção

> Objetivo: expor o **inpaint por máscara** (OpenAI `images.edit`) que hoje só existe no
> servidor Express local da visantlabs-os em **api.visantlabs.com**, para que o mockup-store
> (e qualquer cliente MCP) consuma igual ao `moodboard-upscale` — sem rodar 2º servidor.
>
> Este plano mexe no repo **`Z:\Cursor\visantlabs-os`**, não no mockup-store.

## De onde sai (já existe, local)

- `server/services/inpaintingService.ts` — orquestra OpenAI `images.edit` (replace/remove/retouch),
  cria máscara retangular se só vier região, sistema de crédito (2/op, refund on fail), jobs async.
- `server/routes/imagelab.ts` → `POST /api/imagelab/inpaint` (mask base64 + prompt + mode).
- `mcp-server/shared.ts` → tool `imagelab_inpaint` (já mostra o shape de chamada).

## Para onde vai (produção)

A API que o `lib/visant.ts` do mockup-store já fala (`https://api.visantlabs.com/api`) e que o
MCP Visant expõe. Hoje ela tem `moodboard-upscale`, `ai-change-object` etc., mas **não** inpaint
por máscara precisa.

## Passos

1. **Verificar a topologia de prod** (1ª coisa, antes de codar):
   - O `imagelab.ts` local já roda no mesmo deploy de produção, ou produção é um serviço
     separado? Descobrir se é só "expor a rota" ou "portar o service".
   - Conferir se OpenAI key + R2 já estão configurados no ambiente de prod.

2. **Expor o endpoint em produção** `POST /api/imagelab/inpaint` (ou nome alinhado ao padrão
   da API pública), reusando `inpaintingService.ts` as-is.
   - Body: `{ imageUrl|base64, maskBase64, prompt, mode: replace|remove|retouch, resolution }`.
   - Auth: middleware de API key / OAuth scope `generate` (mesmo dos outros endpoints pagos).
   - Crédito: manter cobrança + refund-on-fail que o service já tem.

3. **Registrar como MCP tool** `inpaint` (ou `ai-inpaint-mask`) no MCP server da Visant,
   espelhando `imagelab_inpaint`, pra ficar consistente com `moodboard-upscale`/`ai-change-object`.
   - Descrição clara: "edita região da máscara via OpenAI images.edit; respeita máscara
     pixel-a-pixel (diferente de `ai-change-object` que edita por descrição)".

4. **Documentar no schema** que mask transparente = editar, opaco = preservar (convenção atual
   do service).

5. **Smoke test** end-to-end: base64 + mask + prompt → imagem editada + URL R2.

## Consumo no mockup-store (fecha o loop com o plano principal)

- `lib/visant.ts` ganha `inpaint(...)` apontando pro novo endpoint.
- Fase 4 do `PLAN-visantlabs-reuse.md` chama esse método com a máscara que o tool `mask`
  já produz (SAM2/pen/brush/wand).

## Riscos / pontos a confirmar

- **Produção pode estar isolada do código `server/`** — se for outro repo/serviço, o "deploy"
  vira "portar o service", aumentando o esforço. Verificar no passo 1 antes de estimar.
- **Custo OpenAI** por op em prod (vs. o ambiente dev). Alinhar com o sistema de créditos.
- **Tamanho de payload**: máscaras grandes em base64 — confirmar limite (upload-image aceita 20MB).

## Fallback temporário (sem bloquear a Fase 4)

Enquanto o endpoint não está em prod, a Fase 4 pode rodar contra `ai-change-object`
(prompt-only, já disponível) mandando o **bbox recortado da máscara** + prompt. Menos preciso,
mas valida a UI e o fluxo. Trocar pelo inpaint real quando deployado.
