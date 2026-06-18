# Dogfood Audit — Photo-Mockup (end-to-end)

Auditoria multi-agente (jornada, conflitos-de-estado/bugs, overwhelm, async/erros) + scan. Veredito: capaz e com bom feedback async, mas tinha perda-de-trabalho silenciosa, races de arquivo e overwhelm. Abaixo: o que foi CORRIGIDO e o que FALTA (estrutural).

## ✅ Corrigido e validado (tsc limpo, 200)
- **P0 race de arquivos:** escritas atômicas (tmp+rename) no `/process`; auto-render não dispara durante process (`processingRef`); clean entra no mesmo guard. `process/route.ts`, `page.tsx`.
- **P0 prepare-magenta sem res.ok** → agora lança erro (handleProcess + clean). `page.tsx`.
- **P0 "Trocar foto" destrói tudo** → `window.confirm` só quando há trabalho. `page.tsx:resetPhoto`.
- **P1 clean IA sucesso falso** → route retorna `aiCleaned`/`aiCleanError`, fallback honesto pro cru, cliente baixa pra `toast.warning`. `process/route.ts`, `page.tsx`.
- **P1 window.prompt do publish** → modal do design system (Enter/Esc, Salvar/Cancelar). `page.tsx`.
- **P1 pedágio Cantos box errado** → quad default INTELIGENTE: detecta a região magenta (`findMagentaQuad`) e cai com os cantos certos. `magenta-mask.ts`, `page.tsx`.
- **P1 idiomas misturados** (upload em inglês → PT). **P1 badge "dev"** gated em dev. **P1 SceneInfo re-analyze** spinner + toast no erro. **handleAnalyze** toast.

## ✅ Migração Zustand/zundo concluída
- **DocState → store único** (`src/stores/editorDoc.ts`): undo/redo do objeto inteiro via `temporal`, adaptador `useDocField` (mesma assinatura do `useState`), throttle leading p/ 1 passo por gesto. Keydown + botões do header + `resetPhoto` em `editorHistory`/`useTemporal`. `snapRef`/`applySnap`/`histRef` removidos.
- **B1 RESOLVIDO** — pilha `maskHistory` (ref paralela) removida; as 4 máscaras vivem no DocState, então apply/invert/clear já são passos versionados pelo zundo. `undoMaskTarget` delega ao histórico global → fim do undo-duplo/máscara stale.

## ✅ Engenharia + UX (rodada SV/Anthropic)
- **CI gate** (`.github/workflows/ci.yml`): todo push/PR passa por `tsc + lint + test + build`. Teste vermelho `SO_TARGET` corrigido (contrato real do engine: "Your Image" é alvo). Política de lint **0 erros** (`tsc` é o gate de type-safety; ruído pragmático/heurístico vira `warn`).
- **C2/C5 jargão/vendor — escondido**: UpscalePanel `Pruna/Google/Gemini/Replicate → Rápido/Turbo/Nítido/Visant`; AIEditPanel `FLUX Fill/Inpaint/change-object → linguagem plana`; ilhas de inglês (`Light wrap → Luz nas bordas`, `Texture → Textura`, `Blend → Mistura`, `Apply/Blending AI Blend → Aplicar/Aplicando`); `afim → normal`; tally `detect/blend → detecção/IA`. "SAM" já era "IA", tool rail já limpa.
- **A7/C1 overwhelm — já domado**: os 12 sliders avançados ficam atrás do disclosure "Ajustes avançados" (colapsado) e o Realismo dirige os derivados (`applyRealism`). Estrutura de progressive disclosure já existe.
- **Autosave / restore de sessão** (`src/stores/photoSession.ts`): ponteiro da última cena (uploadId — foto vive no servidor) + doc (sliders/máscaras/quad/aba) em **IndexedDB** (idb-keyval). Lazy (debounce 1.2s), resiliente (try/catch), restore valida que a foto ainda existe no servidor antes de rehidratar (senão limpa órfã); mutuamente exclusivo com `?scene=`; `clearSession` ao trocar foto. Testado (5 testes, mock idb + fake timers).
- **D3 timeout/cancel/ETA nas ops de IA** (`src/lib/ai-op.ts` — `runAiOp`): toda op longa (upscale, edição IA, limpar superfície, melhorar com IA, expandir cena) ganha **AbortController** (Cancelar no próprio toast), **timeout** (default 120s, 150s nas pesadas, 30s no upscale local) e **ETA** (EWMA por label, persistido → "12s · ~30s"). Dedupa o boilerplate de toast dos 5 handlers. Testado (5 testes: sucesso/cancel/timeout/erro/EWMA).

- **B3 dupla-aplicação da máscara — RESOLVIDO** (em `page.tsx` + `hooks/useMaskEditor.ts`): (1) `applyActiveInstrument` agora commita **e limpa** o instrumento (pen/wand/sam) — `apply()` é síncrono (patch já capturado), então `clear()` logo após zera a seleção; sem isso, re-aplicar somava a mesma seleção e o overlay ficava grudado. O brush já se auto-limpa (patchMode). (2) Removido o effect de seg-reapply (estava **morto** — `segApplied` nunca era setado — e somaria ADD em cima do commitado). Modelo correto: refine molda a seleção ao vivo (props do SegmentCanvas) **antes** do commit; re-tunar pós-commit = Ctrl+Z. `segApplied` removido.

## ⏳ Falta (estrutural — precisa decisão de design)
- **C4 rail 8 tools → 5-6** (fundir Reflexo→Máscara, Cortar+Aumentar, Cantos→setup).
- **page.tsx (~2100 linhas)** → extrair hooks (`useRenderPipeline`, `useMaskEditor`, `useAiActions`) — refactor sênior, melhor em PR isolado.
- **B2 trocar instrumento/alvo descarta seleção não-aplicada** (avisar/auto-aplicar).
- **C2 dedup**: brush size (3×), feather (4×), limpar-borda (2×) → primitivos compartilhados.
- **Autosave** (refresh perde tudo) — persistir o doc do editor.
