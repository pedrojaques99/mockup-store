# Plano — Toolbar flutuante (tools, não views) + modularização

## Princípios
- **Não reinventar**: comportamento (posição/click-outside/ESC/a11y) vem do **Radix** (popover/tooltip). Visual 100% Boxy (tokens `zinc`/`acc2`/`ink`) em wrappers próprios `components/ui/`.
- **Tools ≠ views**: um canvas só (já feito) + rail de ícones que ativa overlays. Cada tool abre um **popover ancorado** com seu painel.
- **IA por contexto** (a sacada): "Caneta" não é view irmã — é um *método de definir superfície*. **Recorte + Caneta → uma tool "Máscara"** com sub-modo `Varinha · SAM · Caneta`.

## Rail final (vertical, esquerda, só-ícone)
`Cantos` · `Máscara` · `Reflexo`  ┊  `Render`
- Cantos (geometria do quad) — overlay QuadEditor
- Máscara (define superfície/oclusão) — sub-modo Varinha/SAM (SegmentCanvas) ou Caneta (PenMaskCanvas)
- Reflexo (pinta reflexo) — BrushCanvas
- Render (resultado + ajustes) — sem overlay

## Componentização
```
src/lib/utils.ts                     cn (clsx + tailwind-merge)
src/components/ui/Popover.tsx        Radix Popover, estilo Boxy
src/components/ui/Tooltip.tsx        Radix Tooltip, estilo Boxy
src/components/ui/Segmented.tsx      botão segmentado Boxy (reuso: modos)
src/components/photo-tools/ToolRail.tsx   rail + popover, data-driven (registry)
src/components/photo-tools/registry.tsx   ToolDef[] (id, icon, label, group)
src/components/photo-tools/panels/*.tsx   CantosPanel, MaskPanel, ReflexoPanel, RenderPanel
```
- `ToolDef`: `{ id, icon, label, group }`. Painel resolvido por `id` no page (recebe props tipadas).
- Estado: `tool: "corners"|"mask"|"reflect"|"render"` (pen sai do enum) + `maskMethod: "wand"|"sam"|"pen"`.

## Passos
1. ✅ deps Radix + cn
2. ✅ ui/ Popover, Tooltip, Segmented, Slider
3. ✅ registry + ToolRail
4. ✅ panels/* extraídos: CornersPanel, MaskPanel, ReflexoPanel, SceneInfo, RenderPanel + ArtDropZone + looks.ts
5. ✅ page: rail no lugar das abas; pen→mask (method); enum render/corners/mask/reflect
6. ✅ backend SSoT: getFullMask() (5 cópias → 1) no render route
7. ✅ sweep: todos os sliders de params → <Slider> shared
8. ✅ typecheck limpo · dev 200 · testes 97/98 (1 pré-existente não-relacionado: SO_TARGET regex)

## Status: COMPLETO
Erros de ESLint restantes no page.tsx (setState-in-effect / refs / access-before-declared) são
PRÉ-EXISTENTES em effects/handlers fora do escopo do refactor de UI — não bloqueiam o dev.

## Verificação
- Rail troca tool sem resetar zoom/pan, sem flash (canvas único já garante).
- Máscara: Varinha/SAM/Caneta trocam overlay no mesmo popover.
- ESC/click-fora fecha popover; trocar de ícone troca painel.
