# UX end-to-end — feedback não intrusivo, minimalista e moderno

Princípio: **nunca bloquear a tela inteira**; o feedback acontece onde a ação acontece (na superfície, no botão, no cursor) ou num canto discreto (toast). Spinner genérico centralizado = banido.

## P0 — maior ganho, baixo esforço

1. **Toasts (sonner)** — lib validada, padrão de mercado. Hoje erros/sucessos viram texto vermelho escondido no painel e ops longas (upscale/ai-edit/publish) não têm retorno claro.
   - `toast.promise(...)` em upscale, ai-edit, crop/expand, publish, render-error.
   - Auto-dismiss, canto inferior, glass sutil. Mensagem curta ("Upscaling… Pruna" → "Pronto · 2048×1365").
   - Substitui os `*Err` espalhados (mantém um fallback inline curto).

2. **Botões assíncronos com estado próprio** (já parcial) — todo botão de ação mostra spinner + label no PRÓPRIO botão e desabilita só a si mesmo, nunca o painel todo.

3. **Undo/redo visível** — agora que é zundo, dois botões (↶ ↷) no header com `disabled` quando não há histórico (via `useTemporal`), + atalho já existe. Opcional: micro-toast "desfeito".

## P1 — polish de cursor/ferramenta (alguns já feitos)

4. **Anel do pincel** ✅ (tamanho real, cor por modo). 
5. **Caneta** — linha-guia tracejada do último anchor até o cursor (preview do próximo segmento) + cursor "ponta".
6. **Varinha** — anel de amostragem no cursor + swatch da cor sob o ponteiro ao vivo.
7. **SAM** — marcar cliques +/− coloridos no canvas.
8. **Cursor por ferramenta** — cada tool com cursor coerente (mover/crosshair/grab) em vez de default.

## P1 — parâmetros legíveis

9. **Slider: valor ao arrastar** em bolha flutuante + **duplo-clique = reset** ao default.
10. **Dot de "alterado"** — parâmetro fora do default ganha um pontinho `acc` (mostra o que você mexeu sem abrir tudo).
11. **Realismo / presets** — preview hover do efeito antes de aplicar.

## P1 — superfície / render

12. **Loading só na superfície** ✅ (shimmer clipado no quad + barra no topo). 
13. **Antes/depois** — slider de comparação no resultado (drag divider) além do toggle AI.
14. **Dimensões/aspect da superfície ao vivo** no Cantos (ex: "1535×1024 · 3:2").
15. **Mini-mapa de zoom** quando >150% (já tem zoom alto agora) — navegação sem se perder.

## P2 — descoberta / onboarding

16. **Tooltips com atalho** na tool rail (C/M/R/L/I/P/U/V) via Radix tooltip.
17. **Primeiro uso** — chips de dica efêmeros ("arraste os cantos", "solte a arte na superfície") que somem após a 1ª ação.
18. **Skeletons** nas thumbs da Biblioteca em vez de vazio.
19. **Empty-states** com 1 ação clara (já melhorado na drop zone).

## P2 — consistência

20. **Status line única** (rodapé discreto) narrando a op async atual, em vez de indicadores espalhados.
21. **Tokens de motion** — durações/eased padronizados (140–200ms) pra tudo respirar igual.

---
### Status — TODOS implementados ✅
- P0: 1 Toasts (sonner) ✅ · 2 Botões async ✅ · 3 Undo/redo no header ✅
- P1: 4 Anel do pincel ✅ · 5 Linha-guia caneta ✅ · 6 Anel da varinha ✅ · 7 SAM +/− ✅ · 8 Cursor por ferramenta ✅ · 9 Slider valor/reset ✅ · 10 Dot alterado ✅ · 11 Preview de look (hover) ✅
- P1 render: 12 Loading na superfície ✅ · 13 Antes/depois (divisor) ✅ · 14 Dims/aspect da superfície ✅ · 15 Mini-map zoom>150% ✅
- P2: 16 Tooltips com atalho ✅ · 17 Chips de 1º uso ✅ · 18 Skeletons (já existiam na Store) ✅ · 19 Empty-states ✅ · 20 Status line única ✅ · 21 Motion tokens ✅
