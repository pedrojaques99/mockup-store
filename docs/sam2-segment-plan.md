# Fase 1 — Click-to-Segment (SAM2) no Scene Maker

Objetivo: clicar na cena pra marcar **segmento true** (a superfície real) e **segmento false**
(dedos, plantas, oclusões). As máscaras alimentam o pipeline de extração já existente —
sem reinventar: `extractGrayscaleLayers` já aceita `surfaceMaskBuf`, e já existe `extractOccluder`.

## Decisões fechadas
- **Modelo:** SAM2 (hiera-tiny pra começar; swappable pra base-plus).
- **Runtime:** `onnxruntime-web` + WebGPU (fallback WASM). Encoder roda 1×/imagem, decoder por clique (instantâneo).
- **Peso/HD:** modelos carregados via **CDN do HuggingFace em runtime** → cache do browser (IndexedDB), **zero bloat no repo / HD permanente**. Nada de commitar .onnx.
- **Fase 1 = só segmentação.** Reflexo tool + brush + fix do magenta residual = Fase 2.

## Referências (portar, não reinventar)
- `geronimi73/next-sam` — SAM2 + onnxruntime-web em Next.js (template direto do nosso stack).
- `lucasgelfond/webgpu-sam2` — encode/decode WebGPU, nomes de tensores I/O.
- Modelos ONNX: `SharpAI/sam2-hiera-tiny-onnx` (encoder.onnx + decoder.onnx).

## Arquitetura

```
Scene photo ──(1 encode)──► image embedding (em memória)
                                  │
   cliques +/- ──(decode/clique)──► máscara binária
                                  │
              ┌───────────────────┴───────────────────┐
        "usar como SURFACE"                    "usar como OCCLUDER"
              │                                         │
   surface-mask.png ──► extractGrayscaleLayers      occluder.png ──► camada over
   (surfaceMaskBuf: lighting só da superfície real)  (dedos/planta na frente da arte)
```

## Passos

### 1. Dependência + loader
- `npm i onnxruntime-web` (versão com WebGPU).
- `src/lib/sam2/session.ts` — singleton que baixa encoder+decoder do CDN HF, cria
  `ort.InferenceSession` com `executionProviders: ['webgpu','wasm']`. Cacheia sessão.
- Tratar: WebGPU indisponível → cai pra wasm (mais lento, mas funciona).

### 2. Encode
- `src/lib/sam2/encode.ts` — recebe o `<img>`/canvas da cena, resize p/ 1024 (input do SAM2),
  normaliza, roda encoder → guarda `{ image_embed, high_res_feats_0/1 }` em memória (por uploadId).
- Disparar no **entrar do modo Segment** (não no upload, pra não pagar custo sempre). Mostra progresso.

### 3. Decode por clique
- `src/lib/sam2/decode.ts` — input: pontos `[{x,y,label}]` (label 1=true, 0=false) em coords da imagem
  original → escala pra 1024 → decoder → máscara low-res → upscale pro tamanho original → threshold.
- Retorna `ImageData`/Uint8 alpha da máscara.

### 4. UI — modo Segment (na fase Extract, antes de extrair)
- `src/components/SegmentCanvas.tsx` — overlay sobre o `QuadEditor`/foto:
  - clique esq = ponto **true** (verde), clique dir = ponto **false** (vermelho).
  - overlay da máscara ao vivo (verde translúcido = true / vermelho = false).
  - botões: **Limpar pontos**, **Usar como superfície**, **Usar como oclusão**, **Desfazer**.
  - estado de loading do encode (barra sutil, mesmo padrão do render).
- Reusa o lens/zoom? Não na Fase 1 — manter simples; segment opera na foto fit-to-width.

### 5. Plumbing servidor
- `process/route.ts` passa a aceitar `surfaceMaskBase64?` e `occluderMaskBase64?` no body.
  - se `surfaceMask` veio → decodifica, passa como `surfaceMaskBuf` pro `extractGrayscaleLayers`
    (recorta bbox do quad). Senão, comportamento atual.
  - se `occluderMask` veio → salva como `occluder.png` (sobrescreve o auto-detect do `extractOccluder`).
- Client: ao "Usar como…", guarda a máscara em estado; manda no `handleProcess`.

### 6. Persistência
- Salvar as máscaras junto da cena (`surface-mask.png`/`occluder.png` já vivem no dir da cena).
- No restore de cena (`?scene=`), se existirem, marcar como aplicadas.

## Fora de escopo (Fase 2)
- Reflexo tool (arte borrada + hue blend nas regiões magenta de baixa sat).
- Brush manual de refino.
- Fix do reflexo magenta residual via `neutralizeNeonPixels` (faixa 280–340°).

## Riscos / notas
- WebGPU é experimental no onnxruntime-web → testar fallback wasm.
- Primeiro encode baixa ~80–120MB (tiny) no cache do browser; mostrar isso ao usuário 1ª vez.
- Nomes de tensores I/O do SAM2 são específicos do export → **portar exatos do next-sam**, não chutar.
- Bundler: garantir que os `.wasm`/`.mjs` do onnxruntime sejam servidos (copiar pra `public/` ou config do webpack).
```
