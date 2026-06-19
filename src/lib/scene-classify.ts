/**
 * scene-classify — auto-detecta o **placeholder** e o **substrato** de uma cena
 * de mockup. As duas dimensões são ortogonais (magenta numa camiseta, white num
 * cosmético, custom num billboard real…) — analisamos as duas e compomos o
 * preset final.
 *
 *  • `magenta`  — placeholder neon magenta (`#FF1493`-ish). Fluxo: detector
 *                 key-color HSL, surfaceType billboard/poster, sem relevo (a
 *                 área é flat por design).
 *  • `white`    — superfície branca / white-label (tote, camiseta, papel).
 *                 Fluxo: detector "branca", surfaceType fabric/paper, relevo
 *                 médio pra capturar dobra/tecido.
 *  • `custom`   — foto real sem placeholder (vidraça, billboard real, parede
 *                 colorida). Fluxo: manual, mais relevo pra superfícies
 *                 texturizadas.
 *
 * **100% server-side, puro sharp + math** (sem rede, sem modelo). Heurística:
 *  amostra a imagem em 256px, classifica cada pixel via HSV em "magenta" /
 *  "white", calcula a fração e a maior blob conectada por **scan flood-fill**
 *  iterativo (BFS). A blob filtra falso-positivos (céus brancos, paredes
 *  rosa) — só conta se for um quadrilátero/elipse contínua com >2% da imagem.
 *
 * Retorna scores [0,1] + confidence + preset recomendado (detector, surface,
 * material, disp), consumido pelo /calibrate pra **calibrar cada tipo de
 * input do jeito mais eficaz**.
 */
import sharp from "sharp";
import { extractSignals, rankSubstrates, type SubstrateAnalysis } from "./substrate-detect";
import { SUBSTRATES, type SubstrateKind } from "./substrate-presets";
import { analyzeSceneAI, type AIVisionResult } from "./ai-vision";
import { loadProfile } from "./engine-feedback";

export type SceneKind = "magenta" | "white" | "custom";

/** Bounding box do placeholder em px da imagem original. */
export interface PlaceholderBBox { x: number; y: number; w: number; h: number; aspect: number }

export interface SceneAnalysis {
  /** Placeholder: magenta / white / nenhum (custom). */
  placeholder: { kind: SceneKind; confidence: number; coverage: number; hint: string; bbox?: PlaceholderBBox };
  /** Substrato detectado + top-5 candidatos + sinais usados. */
  substrate: SubstrateAnalysis & { kind: SubstrateKind; confidence: number };
  /** Preset COMBINADO pra UI aplicar (detector vem do placeholder, resto do substrato). */
  preset: SmartPreset;
  /** MLLM opcional — quando `opts.ai=true` e há chave (Anthropic/OpenAI),
   *  descrição + atributos finos + sugestão de substrato boostada no ranking. */
  ai?: AIVisionResult | null;
}

export interface SmartPreset {
  /** Método do detector quad. */
  method: "key-color" | "white" | "manual";
  surfaceType: string;       // billboard | poster | card | fabric | wall | other
  /** Material procedural default. */
  material: "none" | "fabric" | "metal" | "glass" | "worn" | "shadow";
  materialIntensity: number;
  materialAngle: number;
  materialScale: number;
  /** Displacement (relevo) — micro. */
  dispScale: number;
  dispBlur: number;
}

export interface SceneClass {
  kind: SceneKind;
  /** [0,1] — quão certo está. <0.5 ⇒ tratado como "custom" mesmo se houver pista. */
  confidence: number;
  /** Frações brutas (cobertura) e maior blob (fração da imagem). */
  scores: { magentaFrac: number; whiteFrac: number; magentaBlob: number; whiteBlob: number };
  /** Hint humano pra UI. */
  hint: string;
  /** Preset recomendado pra esse tipo (detector + behaviour calibrado). */
  preset: SmartPreset;
}

const PRESETS: Record<SceneKind, SmartPreset> = {
  magenta: {
    method: "key-color", surfaceType: "billboard",
    material: "none", materialIntensity: 0.5, materialAngle: 35, materialScale: 6,
    dispScale: 0, dispBlur: 4, // flat por design — placeholder neon não tem relevo
  },
  white: {
    method: "white", surfaceType: "fabric",
    material: "fabric", materialIntensity: 0.55, materialAngle: 35, materialScale: 6,
    dispScale: 10, dispBlur: 10, // tecido/papel — relevo médio capta dobra
  },
  custom: {
    method: "manual", surfaceType: "other",
    material: "none", materialIntensity: 0.5, materialAngle: 35, materialScale: 6,
    dispScale: 4, dispBlur: 8,  // foto real — relevo leve respeita o que já existe
  },
};

/** Maior componente conexa 4-vizinha de uma máscara binária (sem recursão; fila iterativa). */
function largestBlob(mask: Uint8Array, W: number, H: number): number {
  const visited = new Uint8Array(mask.length);
  const stack = new Int32Array(mask.length);
  let best = 0;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || visited[i]) continue;
    let sp = 0; stack[sp++] = i; visited[i] = 1; let size = 0;
    while (sp > 0) {
      const p = stack[--sp]; size++;
      const x = p % W, y = (p / W) | 0;
      if (x > 0)     { const q = p - 1; if (mask[q] && !visited[q]) { visited[q] = 1; stack[sp++] = q; } }
      if (x < W - 1) { const q = p + 1; if (mask[q] && !visited[q]) { visited[q] = 1; stack[sp++] = q; } }
      if (y > 0)     { const q = p - W; if (mask[q] && !visited[q]) { visited[q] = 1; stack[sp++] = q; } }
      if (y < H - 1) { const q = p + W; if (mask[q] && !visited[q]) { visited[q] = 1; stack[sp++] = q; } }
    }
    if (size > best) best = size;
  }
  return best;
}

/**
 * Análise COMPLETA da cena: placeholder + substrato + preset combinado.
 * É o entrypoint preferido — `classifyScene` (legacy) é mantida pra compat.
 *
 * Pipeline:
 *  1. Amostra 256px, gera máscaras `magMask` / `whiteMask` (HSV) e calcula bbox
 *     + maior blob de cada → decide o `placeholder.kind`.
 *  2. Extrai sinais de substrato **fora da região do placeholder** (caracteriza
 *     o objeto pelo CONTEXTO, não pela cor da chapa neon).
 *  3. Ranking dos 16 substratos via `rankSubstrates` (multi-sinal).
 *  4. Compõe preset final: `method` vem do placeholder, todo o resto (surface,
 *     material, disp, form, density) vem do substrato top-1.
 */
export async function analyzeScene(
  input: string | Buffer,
  opts: { ai?: boolean; tenant?: string } = {},
): Promise<SceneAnalysis> {
  const SAMPLE = 256;
  const { data, info } = await sharp(input)
    .resize(SAMPLE, SAMPLE, { fit: "inside" })
    .removeAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, N = W * H;
  const magMask = new Uint8Array(N), whiteMask = new Uint8Array(N);
  let magCount = 0, whiteCount = 0;
  for (let i = 0; i < N; i++) {
    const r = data[i * 3] / 255, g = data[i * 3 + 1] / 255, b = data[i * 3 + 2] / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    const v = max, s = max === 0 ? 0 : d / max;
    let h = 0;
    if (d !== 0) {
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60; if (h < 0) h += 360;
    }
    if (h >= 285 && h <= 335 && s > 0.55 && v > 0.55) { magMask[i] = 1; magCount++; }
    if (v > 0.88 && s < 0.10 && Math.abs(r - g) < 0.05 && Math.abs(g - b) < 0.05) { whiteMask[i] = 1; whiteCount++; }
  }
  const magFrac = magCount / N, whiteFrac = whiteCount / N;
  const magBlob = magFrac > 0.005 ? largestBlob(magMask, W, H) / N : 0;
  const whiteBlob = whiteFrac > 0.02 ? largestBlob(whiteMask, W, H) / N : 0;

  // Decide placeholder + bbox/aspect (pra alimentar o substrato)
  let phKind: SceneKind = "custom", phConf = 0.55, phHint = "sem placeholder dominante";
  let chosenMask: Uint8Array | null = null;
  if (magBlob >= 0.015) { phKind = "magenta"; phConf = Math.min(1, 0.6 + magBlob * 8); phHint = `placeholder magenta (${(magBlob * 100).toFixed(1)}% da cena)`; chosenMask = magMask; }
  else if (whiteBlob >= 0.06) { phKind = "white"; phConf = Math.min(1, 0.55 + whiteBlob * 3); phHint = `superfície branca / white-label (${(whiteBlob * 100).toFixed(1)}% da cena)`; chosenMask = whiteMask; }

  // bbox do placeholder → aspect (alimenta substrato: cilindro/cartão/banner)
  let bbox: PlaceholderBBox | undefined;
  let aspect = info.width / info.height;
  if (chosenMask) {
    let minX = W, minY = H, maxX = 0, maxY = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (chosenMask[y * W + x]) {
        if (x < minX) minX = x; if (y < minY) minY = y;
        if (x > maxX) maxX = x; if (y > maxY) maxY = y;
      }
    }
    if (maxX > minX && maxY > minY) {
      const bw = maxX - minX + 1, bh = maxY - minY + 1;
      bbox = { x: minX, y: minY, w: bw, h: bh, aspect: bw / bh };
      aspect = bbox.aspect;
    }
  }

  // Sinais do substrato fora do placeholder (se houver) — caracteriza o objeto.
  const signals = await extractSignals(input, { aspect, excludeMask: chosenMask });
  // Learning loop: histórico de substratos confirmados vira prior boost.
  // **Engine pai SSoT**: profile mesclado (_global ⊕ tenant) — o classify usa o
  // sinal acumulado de TODOS + o que o tenant específico já corrigiu.
  const profile = await loadProfile(opts.tenant).catch(() => null);
  const prior = profile?.substrateCounts as Partial<Record<SubstrateKind, number>> | undefined;
  let sub = rankSubstrates(signals, { prior });

  // MLLM opcional: roda em paralelo com a heurística pra "boost" o candidato
  // sugerido (boost = 0.4 * confidence do modelo). Não substitui — apenas
  // re-rankeia. Falha do AI é silenciosa (heurística segue).
  let ai: AIVisionResult | null = null;
  if (opts.ai) {
    // amostra menor pra economizar token do MLLM
    let sample: Buffer | string = input;
    try { sample = await sharp(input).resize(768, 768, { fit: "inside" }).png().toBuffer(); } catch { /* */ }
    ai = await analyzeSceneAI(sample);
    if (ai?.substrate) {
      const boost = 0.4 * ai.confidence;
      const boosted = sub.candidates.map((c) => c.kind === ai!.substrate
        ? { ...c, score: Math.min(1, c.score + boost), reasons: [...c.reasons, `AI: ${ai!.provider}`] }
        : c);
      boosted.sort((a, b) => b.score - a.score);
      sub = { ...sub, candidates: boosted, top: boosted[0] };
    }
  }
  const substratePreset = SUBSTRATES[sub.top.kind];

  // Detector method vem do placeholder; surface/material/disp/form vêm do substrato.
  const phMethod = phKind === "magenta" ? "key-color" : phKind === "white" ? "white" : "manual";
  const preset: SmartPreset = {
    method: phMethod,
    surfaceType: substratePreset.surfaceType,
    material: substratePreset.material,
    materialIntensity: substratePreset.materialIntensity,
    materialAngle: substratePreset.materialAngle,
    materialScale: substratePreset.materialScale,
    dispScale: substratePreset.dispScale,
    dispBlur: substratePreset.dispBlur,
  };

  return {
    placeholder: { kind: phKind, confidence: phConf, coverage: phKind === "magenta" ? magBlob : phKind === "white" ? whiteBlob : 0, hint: phHint, bbox },
    substrate: { ...sub, kind: sub.top.kind, confidence: sub.top.score },
    preset,
    ai,
  };
}

/**
 * @deprecated Use `analyzeScene` — combina placeholder + substrato + preset.
 * Mantida pra retrocompat de chamadores antigos.
 */
export async function classifyScene(input: string | Buffer): Promise<SceneClass> {
  const SAMPLE = 256;
  const { data, info } = await sharp(input)
    .resize(SAMPLE, SAMPLE, { fit: "inside" })
    .removeAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, N = W * H;

  const magMask = new Uint8Array(N), whiteMask = new Uint8Array(N);
  let magCount = 0, whiteCount = 0;
  for (let i = 0; i < N; i++) {
    const r = data[i * 3] / 255, g = data[i * 3 + 1] / 255, b = data[i * 3 + 2] / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    const v = max, s = max === 0 ? 0 : d / max;
    // hue (HSV)
    let h = 0;
    if (d !== 0) {
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60; if (h < 0) h += 360;
    }
    // Magenta neon: H ∈ [285°,335°], alta saturação e brilho. Cobre #FF00FF,
    // #FF1493 (deeppink), #E91E63 — todos os placeholders comuns.
    if (h >= 285 && h <= 335 && s > 0.55 && v > 0.55) { magMask[i] = 1; magCount++; }
    // White-label: V alto, S baixíssima (neutro), R≈G≈B. Exclui creme/bege.
    if (v > 0.88 && s < 0.10 && Math.abs(r - g) < 0.05 && Math.abs(g - b) < 0.05) { whiteMask[i] = 1; whiteCount++; }
  }
  const magFrac = magCount / N, whiteFrac = whiteCount / N;
  // Blob test: filtra falso-positivos (céu/parede pintada — pontos espalhados).
  const magBlob = magFrac > 0.005 ? largestBlob(magMask, W, H) / N : 0;
  const whiteBlob = whiteFrac > 0.02 ? largestBlob(whiteMask, W, H) / N : 0;

  // Decisão. Magenta tem prioridade — quando existe, é placeholder por design.
  let kind: SceneKind = "custom";
  let confidence = 0.55;
  let hint = "foto real — sem placeholder dominante";
  if (magBlob >= 0.015) {
    kind = "magenta";
    confidence = Math.min(1, 0.6 + magBlob * 8);
    hint = `placeholder magenta (${(magBlob * 100).toFixed(1)}% da cena)`;
  } else if (whiteBlob >= 0.06) {
    kind = "white";
    confidence = Math.min(1, 0.55 + whiteBlob * 3);
    hint = `superfície branca / white-label (${(whiteBlob * 100).toFixed(1)}% da cena)`;
  } else if (magFrac > 0.005) {
    // pequenas manchas magenta — pode ser logo/detalhe, não placeholder. Conta como custom.
    hint = "vestígios de magenta — tratado como custom (use Manual)";
  }
  return {
    kind, confidence, hint,
    scores: { magentaFrac: magFrac, whiteFrac, magentaBlob: magBlob, whiteBlob },
    preset: PRESETS[kind],
  };
}

/** Acesso aos presets (UI pode mostrar/aplicar manualmente). */
export function presetFor(kind: SceneKind): SmartPreset {
  return PRESETS[kind];
}
