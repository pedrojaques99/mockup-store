# Photo → Mockup · UX Redesign Plan
> "Como Apple ou Anthropic fariam" — minimalismo radical, resultado como protagonista

---

## Diagnóstico da UI atual

| Problema | Impacto |
|---|---|
| Foto + controles + resultado em coluna linear | Usuário scrollar muito pra ver o resultado |
| 5 sliders FX visíveis sempre | Cognitive overload — a maioria está em default |
| "Re-analyze", "Re-extract lighting" — linguagem técnica | Não faz sentido pro usuário não-dev |
| Shadow map exposto na sidebar | É debug info, não feature de produto |
| Render Mockup (botão verde) + resultado aparecem abaixo | Sem spatial continuity |
| Steps 1-2-3-4 como breadcrumb | Cria ansiedade de progresso, não delicia |
| Dark pitch-black (#0a0a0a) em tudo | Pesado, sem profundidade |

---

## Princípios Apple/Anthropic aplicados

1. **Resultado como protagonista** — o mockup fica acima da dobra sempre
2. **Progressive disclosure** — mostra só o que o usuário precisa *agora*
3. **Linguagem humana** — "Adjust placement" não "Re-extract lighting"
4. **Real-time** — FX muda preview sem clicar "Render"
5. **Estado zero beautiful** — tela vazia tem apelo visual, não é um formulário
6. **Invisible chrome** — controles aparecem contextualmente, não em painel fixo

---

## Layout proposto

```
┌──────────────────────────────────────────────────────────────┐
│  ← Photo Mockup                              [Save to library]│
├──────────────────────────────────────────────────────────────┤
│                                                              │
│   ┌──────────────────────────────────────────────────────┐  │
│   │                                                      │  │
│   │            MOCKUP PREVIEW (full width)               │  │
│   │            dominates 60vh                            │  │
│   │                                                      │  │
│   └──────────────────────────────────────────────────────┘  │
│                                                              │
│   ┌──────────────────┐  ┌──────────────────────────────┐   │
│   │  📷 Photo        │  │  🖼 Artwork                  │   │
│   │  [thumbnail]     │  │  [thumbnail or drop target]  │   │
│   │  Adjust corners ↗│  │  Change artwork ↗            │   │
│   └──────────────────┘  └──────────────────────────────┘   │
│                                                              │
│   Adjustments ─────────────────── [Advanced ▾]             │
│   Shadow  ●────────────────  90%                            │
│   Look    [Natural] [Warm] [Matte] [Vivid]    ← presets    │
│                                                              │
│   [↓ PNG]   [Re-render]                                     │
└──────────────────────────────────────────────────────────────┘
```

### Variante mobile (stack vertical)
```
[Mockup preview — 50vw]
[Photo thumb | Artwork thumb]
[Shadow slider]
[Look presets: Natural / Warm / Matte / Vivid]
[Download PNG]
```

---

## Fluxo completo end-to-end

### Step 1 · Upload photo (zero estado)
- Área de drop grande, ocupando 50% da tela
- Ilustração vetorial simples (linha fina, estilo SF Symbols)
- Copy: "Drop a photo with a flat surface — billboard, poster, book, wall…"
- Não mostra steps, não mostra progress bar — só o invite visual

### Step 2 · Analyzing (< 3s)
- Photo aparece imediatamente com shimmer sobre ela
- Texto: "Finding the surface…" — não "AI is analyzing"
- Detecção de quad acontece em paralelo ao upload (não sequencial)

### Step 3 · Quad ready
- Photo shrinks para thumbnail no canto inferior esquerdo
- Quad overlay fino, handles minimalistas (• pontos brancos, 8px, sem label)
- Toque/drag em mobile: handle expande no toque
- Botão ghost: "Adjust placement" (não "Re-extract")

### Step 4 · Artwork drop
- Drop target fica ao lado da photo thumbnail
- Preview imediato do artwork no slot
- Render automático dispara em bg assim que ambos (photo + art) existem

### Step 5 · Render loop (auto)
- Resultado aparece no centro
- FX controls aparecem abaixo com transição suave
- Mudança em qualquer slider → re-render automático com debounce 400ms
- Preview blurry (low-res) enquanto renderiza → substitui pelo full-res

### Step 6 · Export
- Botão único "Save PNG" — primário, sem hierarquia confusa
- "Save to Library" como ação secundária (outline ou text button)
- AI Blend: oculto por padrão, disponível ao clicar "✦ Enhance with AI"

---

## Componentes a refatorar

### FX Controls
**Agora**: 5 sliders sempre visíveis (Grain, Warmth, Saturation, Brightness + Shadow)

**Proposta Apple**:
- Look presets: Natural · Warm · Matte · Vivid · B&W (chips horizontais)
- Shadow: único slider (sem grupo FX)
- "Customize…" abre um popover fino com os 4 sliders individuais

```
Look  [Natural] [Warm] [Matte] [Vivid]
Shadow  ●──────────  90%
        [Customize…]
```

### Photo/Art thumbnails
- 72×72px, rounded-lg, border 1px zinc-700
- Hover: "Change" text overlay com fundo semi-transparente
- Drag para qualquer lugar da tela re-aciona o upload

### Status
**Agora**: `✓ Done — 1.5s` (ok mas sem charme)
**Proposta**: Badge pill `1.5s` aparece no canto do preview, desaparece em 3s

### Shadow Map
- Não remove — mantém como "dev view" colapsável
- Por padrão: fechado, label `⬡ Shadow map` clicável
- Quando aberto: imagem full-width com border dashed zinc-700 + badge `dev` no canto
- Estilo: monocromático, `opacity-60`, `rounded-lg`, sem destaque visual
- Fica na sidebar/coluna esquerda abaixo do thumbnail da foto

---

## Tokens de cor (Anthropic-style)
```
bg-canvas:   #F5F4F0  (warm off-white, não pitch black)
bg-surface:  #FFFFFF
border:      #E5E3DD
text-primary:#1A1917
text-muted:  #6B6862
accent:      #D97706  (amber — warmth)
success:     #15803D
```

**Ou** manter dark mas com zinc-900 como base (não zinc-950), usar zinc-800 para cards.

---

## Implementação — prioridades

| Prioridade | Item | Esforço |
|---|---|---|
| P0 | FX clipped to mask (bug fix — já feito) | ✅ done |
| P1 | Layout: preview full-width acima dos controles | M |
| P1 | Photo + Art como thumbnails side-by-side abaixo do preview | S |
| P1 | Look presets (Natural/Warm/Matte/Vivid) → mapeiam para fx presets | S |
| P2 | Shadow Map removido do UI principal | XS |
| P2 | Handles do quad minimalistas (sem label TL/TR/BL/BR) | XS |
| P2 | Auto-render ao trocar artwork (sem clicar Render) | S |
| P3 | "Customize…" popover para FX avançado | M |
| P3 | AI Blend como feature secundária ("✦ Enhance") | M |
| P3 | Status badge no canto do preview | XS |

---

## Próximos passos

1. Aprovar direção visual (dark vs light, color tokens)
2. Implementar P1s no `photo-mockup/page.tsx`
3. Criar Look presets como named FX combos
4. Testar mobile (hoje o layout não está responsivo)
