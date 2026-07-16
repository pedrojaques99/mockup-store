# Detection QA Gate — promover detecção de "baka cego" para "gate + cascata"

## Problema

`detectKeyColorQuad` pega o **maior blob magenta** e devolve um quad. `finalizeFolder`
bakava esse quad **em silêncio**, sem checar se prestava. Três modos de falha passavam direto:

1. **Ambiguidade** — dois painéis magenta na cena (ex.: fachada com placa + vitrine).
   O detector escolhe um arbitrariamente e o outro é ignorado sem aviso.
2. **Glow inflado** — o halo do neon infla o convex-hull → o quad fica maior que a
   superfície real; o blob preenche mal o quad.
3. **Geometria degenerada** — sliver de aspecto absurdo, ou o "quad" cobrindo a imagem toda.

Isso é o gap "nível vale do silício": um pipeline de produção **não baka artefato de baixa
confiança sem sinalizar**. A infra de recuperação (SAM/Grounded-DINO em `sam-mask.ts`)
já existia, mas ficava como refinamento opcional — nunca era acionada pela detecção.

## Solução (cirúrgica, sem reescrever a engine)

### 1. `src/lib/detect-qa.ts` (novo, puro/isomórfico)

Pontua uma detecção em três eixos e emite `verdict: ok | review | reject` + `confidence`:

| Eixo | Medida | Como |
|---|---|---|
| **Ambiguidade** | 2º maior componente / maior | `componentSizes` (mesma BFS 8-conexa do `largestConnectedBlob`, mas devolve TODOS os tamanhos) sobre os pixels-chave **completos** (antes do filtro de maior-blob) |
| **Fill ratio** | pixels-chave / área do quad | glow inflado ⇒ blob não preenche ⇒ baixo |
| **Geometria** | areaFraction, aspect | rejeita sliver / imagem-inteira / nada |

`confidence = fill × (1 − ambiguity) × geomOk`. Limiares em `DEFAULT_QA` (tunáveis).

### 2. `src/lib/photo-detect.ts`

`detectKeyColorQuad` passa a computar e devolver `qa: DetectionQA` (campo do `KeyColorResult`).
QA roda sobre `pts` (todos os pixels-chave), não sobre `filtered` — é o que enxerga o 2º painel.

### 3. `src/lib/agent-mockup.ts` — o gate em `finalizeFolder`

```
det = detectKeyColorQuad(...)
if (det.qa.verdict !== "ok") {
  sam = detectQuadSAM(...)          // cascata: promove SAM de opcional a recuperação
  if (sam)         → usa quad do SAM, method="sam", guarda o quad magenta em `auto`
  else if (strict && reject) → dropa a cena (não baka lixo)
  else             → baka com needsReview=true (lenient, default) — some da fila? não.
}
```

- **Quad corrigido à mão (`quads.json`) vence sempre** — pula o gate.
- **Default lenient**: preserva throughput (a cena ainda finaliza), mas grava
  `needsReview` + `qaReasons` no `analysis.json` → triável no `/calibrate`.
- **`strict: true`**: dropa `reject` sem SAM — para lotes onde qualidade > cobertura.

### 4. Propagação

- `QuadEntry` (quad-store): `needsReview?`, `qaReasons?`.
- `FinalizeResult`: `needsReview?`, `qaReasons?` (visível pro CLI/kit).
- `analysis.json`: `needsReview` + `qaReasons` quando reprovado.

## Validação

- **Unit** (`__tests__/detect-qa.test.ts`, 7 testes): painel limpo→ok, 2 painéis→reject,
  ínfimo→reject, fill 40%→review, sliver→reject, `componentSizes` conta certo.
- **Real** (probe em `Render/New Mockups`, 12 cenas): 9 limpas→OK, `07_restaurant_entrance`
  (2 painéis a 60%)→**REJECT**, `earth` (superfície redonda, fill 43%)→**REVIEW**,
  `05_busstop` (2 painéis a 20%, sub-limiar)→OK com conf 0.80. O gate discrimina no dado real.
- Suíte completa: 134/134. Typecheck: 0 erros.

## Tuning knobs (`DEFAULT_QA`)

- `ambiguityReview` (0.22) / `ambiguityReject` (0.5) — quão tolerante a 2º painel.
  Bus-shelters legítimos com 2 painéis passam sub-0.22; subir se falsos-positivos.
- `fillReview` (0.55) / `fillReject` (0.3) — sensibilidade a glow/superfície irregular.
- `areaMin/Max`, `aspectMax` — guarda-corpos de geometria.

## Follow-ups (fora deste PR)

- Surfacear `needsReview` no grid da home (badge) e priorizar na fila do `/calibrate`.
- Unificar `analysis.json` (photo-scenes) e Scene Packages (PSD) num schema de placement
  único → cascata de detectores plugável para qualquer superfície (o wedge on-brand).
- Erosão opcional do quad (comer franja de glow) como knob no `/calibrate`.
