# Plano — Aba "Luz" (Shadow Overlay + Light Overlay)

> FX editáveis de luz e sombra sobre o canvas do `photo-mockup`, com galeria + upload de assets,
> e controles de **contraste, opacidade, escala, posição, rotação e blending mode**.
> Reaproveita 100% dos padrões já existentes (registry de tools, `Slider`, `Segmented`, `ArtDropZone`,
> `walkDir`, `/api/local-image`, engine `renderScene`). **Sem reinventar a roda.**

---

## 0. Decisões já fechadas

| Tema | Decisão |
|------|---------|
| Projeto | `Z:\BOXY\mockup-store` (Next.js 15 + React 19 + TS + Tailwind v4) |
| Assets | **Galeria + Upload** numa modal única |
| Fonte da galeria | `Z:\Recursos 2.0\Shadow Overlay` **e** `H:\Meu Drive\ASSETS VISANT\Texturefabrik\Shadow Overlay` (misturadas) |
| Light vs Shadow | Mesmas pastas — qualquer asset serve pra qualquer camada |
| Escopo | **Preview no canvas + export no render final** (server-side `@visant/psd-engine`) |

---

## 1. Arquitetura — princípios

1. **Estado único** no `page.tsx` (mesmo padrão SSoT atual): `luzLayers` com 2 camadas (`shadow`, `light`).
2. **Valores normalizados** (resolução-independente) pra preview e render baterem 1:1:
   - `position` em fração do canvas (`0..1`), `scale` relativo à largura do canvas, `rotation` em graus.
3. **Preview = CSS** (`<img>` com `transform` + `filter: contrast()` + `mix-blend-mode` + `opacity`), arrastável.
4. **Export = Sharp pré-transforma** (rotate/resize/contrast) → injeta como `layer.role:"over"` no `renderScene`.
   - **Não toca** o pacote `@visant/psd-engine` (drawLayer já faz blend+opacity+posição nativamente).
5. **Reuso de design system obrigatório**: `Slider`, `Segmented`, `ArtDropZone`, tokens `acc/acc2/zinc`.

---

## 2. Modelo de dados (novo `src/types/luz.ts`)

```ts
export type LuzBlend =
  | "normal" | "multiply" | "screen" | "overlay"
  | "soft-light" | "hard-light" | "darken" | "lighten";

export interface LuzLayer {
  id: "shadow" | "light";
  label: string;            // "Sombra" / "Luz"
  src: string | null;       // URL do asset (galeria via /api/local-image OU objectURL do upload)
  srcPath: string | null;   // caminho de disco (galeria) — usado no export; null se upload
  srcBase64: string | null; // upload — usado no export quando não há srcPath
  visible: boolean;
  opacity: number;          // 0..1
  contrast: number;         // 50..150 (%) — neutro 100
  scale: number;            // 0.2..3   (relativo à largura do canvas)
  rotation: number;         // -180..180 (graus)
  position: { x: number; y: number }; // 0..1 fração do centro no canvas
  blendMode: LuzBlend;
}

export const LUZ_DEFAULTS: LuzLayer[] = [
  { id: "shadow", label: "Sombra", src: null, srcPath: null, srcBase64: null,
    visible: true, opacity: 0.6, contrast: 100, scale: 1, rotation: 0,
    position: { x: 0.5, y: 0.5 }, blendMode: "multiply" },
  { id: "light", label: "Luz", src: null, srcPath: null, srcBase64: null,
    visible: true, opacity: 0.5, contrast: 100, scale: 1, rotation: 0,
    position: { x: 0.5, y: 0.5 }, blendMode: "screen" },
];
```

---

## 3. Fases de implementação

### Fase 1 — Registrar a aba "Luz" (UI shell)
**Arquivo:** `src/components/photo-tools/registry.ts`
- [ ] `PhotoTool` += `"luz"`
- [ ] `PHOTO_TOOLS` += `{ id: "luz", label: "Luz", icon: Sun, group: "edit" }` (ícone `Sun` do lucide)
- [ ] `PHOTO_TOOL_KEYS` += `{ l: "luz" }`

**Arquivo:** `src/app/photo-mockup/page.tsx`
- [ ] estado `const [luzLayers, setLuzLayers] = useState<LuzLayer[]>(LUZ_DEFAULTS)`
- [ ] estado `const [luzActive, setLuzActive] = useState<"shadow"|"light">("shadow")`
- [ ] estado `const [luzModalOpen, setLuzModalOpen] = useState(false)`
- [ ] helper `updateLuz(id, patch)` imutável
- [ ] render condicional `{tool === "luz" && <LuzPanel .../>}` no container de painel (≈ linhas 1261-1315)

> ✅ Critério: aba aparece, atalho `L`, painel abre vazio sem quebrar nada.

---

### Fase 2 — Painel de controles (`LuzPanel.tsx`)
**Novo:** `src/components/photo-tools/panels/LuzPanel.tsx` — **só reusa primitivos existentes.**

Estrutura:
- [ ] `Segmented` pra escolher camada ativa: `Sombra | Luz`
- [ ] Bloco da camada ativa (wrapper `bg-zinc-800/40 rounded-xl border ...`):
  - [ ] Thumbnail do asset + botão **"Importar"** → `setLuzModalOpen(true)` (abre modal Fase 4)
  - [ ] `ArtDropZone` (size `panel`) como drop rápido alternativo
  - [ ] `Slider` Opacidade `0..1` step `0.05` → `display %`
  - [ ] `Slider` Contraste `50..150` step `1` → `display %`
  - [ ] `Slider` Escala `0.2..3` step `0.05`
  - [ ] `Slider` Rotação `-180..180` step `1` → `display °`
  - [ ] `Segmented` Blend: `Normal | Multiply | Screen | Overlay | Soft | Hard | Darken | Lighten`
  - [ ] Botão **"Resetar camada"** (volta ao default)
- [ ] Bloco **Camadas** (reusa padrão de olho das linhas 1316-1340): toggle `visible` das 2 camadas

> ✅ Critério: mexer nos sliders atualiza `luzLayers` no `page.tsx` (verificável via React DevTools).

---

### Fase 3 — Overlay no canvas (preview) `LuzOverlay.tsx`
**Novo:** `src/components/LuzOverlay.tsx` — render dentro do stack do `ZoomPanViewer` (≈ linhas 1101-1182).

- [ ] Para cada camada `visible && src`, renderiza um `<img>` absoluto centralizado:
  ```tsx
  style={{
    left: `${position.x * 100}%`, top: `${position.y * 100}%`,
    width: `${scale * 100}%`,
    transform: `translate(-50%,-50%) rotate(${rotation}deg)`,
    transformOrigin: "center",
    opacity,
    filter: `contrast(${contrast}%)`,
    mixBlendMode: blendMode,
    pointerEvents: tool === "luz" ? "auto" : "none",
  }}
  ```
- [ ] Drag de posição com **`react-draggable`** (já é dependência) — só ativo quando `tool==="luz"` e camada ativa; converte delta px → fração do canvas.
- [ ] Só a **camada ativa** é arrastável; a outra fica `pointer-events:none`.

> ✅ Critério: importar um PNG mostra o overlay sobre a foto, arrastável, com blend/contraste/opacidade reativos. Persiste em zoom/pan (já herdado do viewer).

---

### Fase 4 — Modal galeria + upload `LuzAssetModal.tsx`
**Novo:** `src/components/photo-tools/LuzAssetModal.tsx`
**Novo API:** `src/app/api/overlays/list/route.ts`

Backend (reusa `walkDir` de `src/lib/fs-walk.ts`):
- [ ] `GET /api/overlays/list` → `walkDir` nas 2 pastas (constantes no topo), filtra `IMAGE_EXTS`,
      retorna `[{ name, path, folder, sizeBytes }]`. Cache simples em memória (TTL ~60s) pra não re-escanear disco a cada abertura.
- [ ] Pastas em `const OVERLAY_DIRS = [...]` (fácil editar/expandir depois).

Modal (reusa Radix `Popover`/dialog já no projeto + tokens):
- [ ] Duas seções: **Galeria** (grid de thumbs via `/api/local-image?path=...`) e **Upload** (`ArtDropZone` size `hero`).
- [ ] Busca por nome (input simples) + lazy/scroll. Thumbs com `loading="lazy"`.
- [ ] Clique na thumb → seta `src`+`srcPath` da camada ativa, fecha modal.
- [ ] Upload → `URL.createObjectURL` em `src` + base64 em `srcBase64` (pro export), fecha modal.

> ✅ Critério: modal lista assets reais das pastas, clique aplica na camada; upload avulso funciona.

---

### Fase 5 — Export no render final (server-side)
**Arquivo:** `src/app/api/photo-mockup/[id]/render/route.ts`

1. [ ] Estender body com `overlays?: LuzRenderLayer[]` (subset: `srcPath|srcBase64, blendMode, opacity, contrast, scale, rotation, position`).
2. [ ] **Pré-transformar cada overlay com Sharp** (sem mexer no engine):
   - carregar buffer (`readFile(srcPath)` **com guard `!path.includes("..")`** ou base64);
   - `sharp(buf).rotate(rotation, {background:transparent}).resize(targetW)` onde `targetW = round(scale * doc.width)`;
   - contraste via `.linear(a, b)` (`a = contrast/100`, `b = 128*(1-a)`);
   - `.png().toBuffer()` → `loadImage(buf)`.
3. [ ] Calcular `left/top` a partir de `position` normalizada + tamanho final do overlay (centralizado), em coords do canvas **já considerando o upscale SSAA** (multiplicar pelo fator usado nas linhas 122-127).
4. [ ] Inserir como `doc.layers.push({ role:"over", src:"luz_<id>", blendMode, opacity, left, top })`
      **antes** do `renderScene` (≈ linha 193). Mapear nomes de blend via `BLEND_MAP` do engine.
5. [ ] Frontend (`page.tsx` handler de render): incluir `overlays` no POST montado a partir de `luzLayers` visíveis com `src`.

> ✅ Critério: PNG exportado contém os overlays **idênticos ao preview** (posição/escala/rotação/blend/contraste).

---

### Fase 6 — Polimento
- [ ] Persistir `luzLayers` junto do estado da cena (se houver save/load de cena hoje) — investigar antes.
- [ ] Empty states e disabled (`disabled:opacity-40`) quando sem asset.
- [ ] Tooltips (`Tooltip` existente) nos controles.
- [ ] Teste manual com asset real de cada pasta + 1 upload; conferir export.

---

## 4. Arquivos — resumo

| Ação | Caminho |
|------|---------|
| ✏️ editar | `src/components/photo-tools/registry.ts` |
| ✏️ editar | `src/app/photo-mockup/page.tsx` (estado, painel, overlay no stack, POST de render) |
| ✏️ editar | `src/app/api/photo-mockup/[id]/render/route.ts` (body + Sharp + layers) |
| ➕ novo | `src/types/luz.ts` |
| ➕ novo | `src/components/photo-tools/panels/LuzPanel.tsx` |
| ➕ novo | `src/components/LuzOverlay.tsx` |
| ➕ novo | `src/components/photo-tools/LuzAssetModal.tsx` |
| ➕ novo | `src/app/api/overlays/list/route.ts` |
| ♻️ reuso | `Slider`, `Segmented`, `ArtDropZone`, `Tooltip`, `walkDir`, `/api/local-image`, `BLEND_MAP`/`renderScene` |

---

## 5. Riscos / pontos de atenção

- **Paridade preview↔render**: CSS `mix-blend-mode` vs node-canvas `globalCompositeOperation` têm os mesmos nomes (multiply/screen/overlay/...), mas conferir matiz em soft/hard-light. Validar visualmente na Fase 5.
- **SSAA upscale**: posição/escala precisam multiplicar pelo fator de supersampling do render (linhas 122-127) — fácil de errar.
- **Segurança path traversal**: `/api/overlays/list` e leitura no render só dentro de `OVERLAY_DIRS` + guard `..` (igual `/api/local-image`).
- **Performance disco**: cache do listing (TTL) pra não varrer rede (`Z:`, `H:` Drive) a cada abertura.
- **`contrast` no Sharp**: `.linear()` é aproximação do CSS `contrast()`; suficiente, ajustar `b` se ficar claro/escuro demais.

---

## 5b. Notas de implementação (o que mudou vs. plano) — ✅ ENTREGUE

- **Export NÃO injeta no `renderScene`.** Decisão melhor: o Sharp (libvips 8.15 no
  `sharp ^0.34`) suporta todos os blends necessários, então os overlays são compostos
  direto no PNG final em resolução nativa, **sem tocar `@visant/psd-engine` nem lidar
  com o fator SSAA**. Mesma fórmula de contraste/opacidade/blend do preview → paridade exata.
- **Drag manual** (pointer capture) em vez de `react-draggable`, pra não conflitar com o
  `transform` composto (`translate(-50%,-50%) rotate scale`) do overlay.
- **Blend picker** = grid 4×2 manual (o `Segmented` fixa colunas por `options.length`).
- Verificado: página 200, `/api/overlays/list` lê 40 assets reais, upscale bicubic OK.
- **Calibração pendente (IA):** polaridade da máscara enviada ao inpaint (white=edita) a
  conferir contra a conversão do `inpaintingService` quando o endpoint estiver em prod.

## 6. Ordem sugerida de execução

`Fase 1 → 2 → 3 → 4` entrega a feature **funcional no preview** (entregável independente).
`Fase 5` adiciona o **export**. `Fase 6` poli. Cada fase é commitável e testável isolada.
