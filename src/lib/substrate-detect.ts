/**
 * substrate-detect — heurística MULTI-SINAL local pra pontuar cada substrato
 * candidato a partir dos pixels da cena. Server-side, puro sharp+math.
 *
 * Não substitui um modelo de visão; complementa: roda sempre (zero rede, ~50ms)
 * e dá os top-N candidatos. UI mostra o ranking, AI vision pode entrar depois
 * sobrepondo a heurística (não no v1).
 *
 * Sinais extraídos da amostra 256px:
 *   • meanSat / meanV (saturação + brilho médio)
 *   • specularRatio   (pixels V>0.97 e S<0.15 — destaque especular)
 *   • edgeDensity     (gradiente Sobel-like médio)
 *   • coolBlueRatio   (h≈210, alta sat — telas/vidro)
 *   • warmBrownRatio  (h≈30, sat média — papel kraft/madeira)
 *   • grayRatio       (sat<0.1, V mid)
 *   • aspect          (do quad/placeholder fornecido) → cylinder hint
 */
import sharp from "sharp";
import type { SubstrateKind } from "./substrate-presets";

export interface SubstrateSignals {
  meanSat: number; meanV: number;
  specularRatio: number; edgeDensity: number;
  coolBlueRatio: number; warmBrownRatio: number;
  grayRatio: number;
  /** Aspect do alvo (placeholder): >1 = larga; <1 = alto. */
  aspect: number;
}

export interface SubstrateCandidate {
  kind: SubstrateKind;
  score: number; // [0,1]
  reasons: string[];
}

export interface SubstrateAnalysis {
  signals: SubstrateSignals;
  candidates: SubstrateCandidate[]; // ordenado desc por score, top-5 retornados
  top: SubstrateCandidate;          // candidates[0]
}

/**
 * Extrai os sinais de uma amostra 256px. Se `excludeMask` (256×256 alpha=1 onde
 * IGNORAR — ex.: região do placeholder magenta), os sinais são medidos só fora
 * dela (caracteriza o substrato pelo CONTEXTO, não pelo placeholder).
 */
export async function extractSignals(
  input: string | Buffer,
  opts: { aspect?: number; excludeMask?: Uint8Array | null } = {},
): Promise<SubstrateSignals> {
  const SAMPLE = 256;
  const { data, info } = await sharp(input)
    .resize(SAMPLE, SAMPLE, { fit: "inside" })
    .removeAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, N = W * H;
  const mask = opts.excludeMask && opts.excludeMask.length === N ? opts.excludeMask : null;
  const lum = new Float32Array(N);

  let sumSat = 0, sumV = 0, count = 0;
  let spec = 0, blueCool = 0, warmBrown = 0, gray = 0;
  for (let i = 0; i < N; i++) {
    if (mask && mask[i]) continue;
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
    sumSat += s; sumV += v; count++;
    if (v > 0.97 && s < 0.15) spec++;
    if (h >= 195 && h <= 230 && s > 0.25 && v > 0.30) blueCool++;
    if (h >= 18 && h <= 45 && s > 0.20 && s < 0.65 && v > 0.30 && v < 0.85) warmBrown++;
    if (s < 0.10 && v > 0.25 && v < 0.80) gray++;
    lum[i] = 0.299 * r + 0.587 * g + 0.114 * b;
  }
  const denom = Math.max(1, count);
  const meanSat = sumSat / denom, meanV = sumV / denom;

  // edge density — Sobel simplificado num grid 4×4 (suficiente p/ "tem textura?")
  const STEP = 4; let edgeSum = 0, edgeN = 0;
  for (let y = 1; y < H - 1; y += STEP) for (let x = 1; x < W - 1; x += STEP) {
    const i = y * W + x; if (mask && mask[i]) continue;
    const gx = lum[i + 1] - lum[i - 1];
    const gy = lum[i + W] - lum[i - W];
    edgeSum += Math.hypot(gx, gy); edgeN++;
  }
  const edgeDensity = edgeSum / Math.max(1, edgeN);

  return {
    meanSat, meanV,
    specularRatio: spec / denom,
    edgeDensity,
    coolBlueRatio: blueCool / denom,
    warmBrownRatio: warmBrown / denom,
    grayRatio: gray / denom,
    aspect: opts.aspect ?? 1,
  };
}

// Helper: score in [0,1] vinda de uma "regra triangular" (val ideal, com falloff).
function tri(val: number, lo: number, ideal: number, hi: number): number {
  if (val <= lo || val >= hi) return 0;
  return val < ideal ? (val - lo) / (ideal - lo) : (hi - val) / (hi - ideal);
}
// Bell curve simples em torno do ideal com width.
function bell(val: number, ideal: number, width: number): number {
  const d = (val - ideal) / width; return Math.exp(-d * d);
}

/**
 * Pontua TODOS os substratos pra um conjunto de sinais. Cada `score()` retorna
 * [0,1] e os top-N são devolvidos. Heurísticas escolhidas para serem ROBUSTAS
 * (não exigem fitting), nunca dão 0 sem motivo, e justificáveis (`reasons`).
 *
 * `opts.prior` (do `engine-profile.substrateCounts`) fecha o **learning loop**:
 * boosta candidatos consistentes com o histórico de aceite do usuário (log scaling
 * pra não dominar; tags adicionadas como reason "hist:N").
 */
export function rankSubstrates(
  s: SubstrateSignals,
  opts: { prior?: Partial<Record<SubstrateKind, number>> } = {},
): SubstrateAnalysis {
  type R = { kind: SubstrateKind; score: number; reasons: string[] };
  const cs: R[] = [];
  const aspect = s.aspect;

  // PAPEL — sat baixa, brilho alto, edge média, sem highlight forte.
  {
    const r: string[] = [];
    let sc = bell(s.meanV, 0.85, 0.18) * 0.4 + (s.meanSat < 0.2 ? 0.25 : 0.05) + tri(s.edgeDensity, 0.005, 0.025, 0.06) * 0.2 + (s.specularRatio < 0.01 ? 0.15 : 0);
    if (s.warmBrownRatio > 0.15) { sc += 0.15; r.push("tom kraft"); }
    if (s.meanSat < 0.15) r.push("baixa saturação");
    cs.push({ kind: "paper", score: sc, reasons: r });
  }
  // CARD — paper-like + aspect compacto.
  {
    const r: string[] = [];
    let sc = (s.meanV > 0.6 ? 0.3 : 0.15) + (s.meanSat < 0.25 ? 0.25 : 0.1) + (s.edgeDensity < 0.02 ? 0.2 : 0.05);
    if (aspect > 1.3 && aspect < 1.7) { sc += 0.2; r.push("aspect ~3:2 (cartão)"); }
    if (aspect > 1.5 && aspect < 1.65) { sc += 0.05; r.push("golden card"); }
    cs.push({ kind: "card", score: sc, reasons: r });
  }
  // FABRIC TSHIRT — alta edge, sat média, sem specular.
  {
    const r: string[] = [];
    let sc = tri(s.edgeDensity, 0.02, 0.06, 0.2) * 0.45 + (s.specularRatio < 0.005 ? 0.2 : 0) + (s.meanSat > 0.15 ? 0.15 : 0.05);
    if (aspect < 1.2 && aspect > 0.7) { sc += 0.15; r.push("forma compacta"); }
    if (s.edgeDensity > 0.04) r.push("textura de malha");
    cs.push({ kind: "fabric_tshirt", score: sc, reasons: r });
  }
  // FABRIC BAG — parecido com tshirt mas + escuro, edge alta, aspect quadrado.
  {
    const r: string[] = [];
    let sc = tri(s.edgeDensity, 0.025, 0.07, 0.2) * 0.4 + (s.meanV < 0.7 ? 0.15 : 0.05) + (s.specularRatio < 0.005 ? 0.15 : 0);
    if (aspect > 0.85 && aspect < 1.2) { sc += 0.2; r.push("aspect quadrado"); }
    cs.push({ kind: "fabric_bag", score: sc, reasons: r });
  }
  // CANVAS — alta edge, sat baixa.
  {
    const r: string[] = [];
    const sc = tri(s.edgeDensity, 0.02, 0.05, 0.1) * 0.4 + (s.meanSat < 0.3 ? 0.2 : 0.05) + (s.warmBrownRatio > 0.05 ? 0.15 : 0);
    cs.push({ kind: "canvas", score: sc, reasons: r });
  }
  // BANNER — aspect largo, edge baixa, V mid-alto.
  {
    const r: string[] = [];
    let sc = (s.edgeDensity < 0.03 ? 0.25 : 0.1) + (s.meanV > 0.4 ? 0.15 : 0.05);
    if (aspect > 2.2) { sc += 0.4; r.push(`aspect ${aspect.toFixed(1)}:1 (banner)`); }
    else if (aspect > 1.8) { sc += 0.2; r.push("aspect alongado"); }
    cs.push({ kind: "banner", score: sc, reasons: r });
  }
  // BILLBOARD — aspect 16:9 ou 4:3, edge muito baixa (liso), sem specular.
  {
    const r: string[] = [];
    let sc = (s.edgeDensity < 0.025 ? 0.25 : 0.1) + (s.specularRatio < 0.01 ? 0.15 : 0);
    if (aspect > 1.4 && aspect < 2.0) { sc += 0.3; r.push("aspect 16:9-ish"); }
    if (aspect > 1.2 && aspect < 1.5) { sc += 0.15; r.push("aspect 4:3-ish"); }
    cs.push({ kind: "billboard", score: sc, reasons: r });
  }
  // SCREEN — cool blue, V alto, specular leve, aspect 16:9.
  {
    const r: string[] = [];
    let sc = (s.coolBlueRatio > 0.05 ? 0.3 : 0.05) + (s.meanV > 0.4 ? 0.2 : 0.05) + (s.specularRatio > 0.005 && s.specularRatio < 0.05 ? 0.2 : 0.05);
    if (aspect > 1.5 && aspect < 1.9) { sc += 0.15; r.push("aspect de tela"); }
    if (s.coolBlueRatio > 0.1) r.push("tom azulado");
    cs.push({ kind: "screen", score: sc, reasons: r });
  }
  // GLASS — alto specular pontual, V alto.
  {
    const r: string[] = [];
    const sc = tri(s.specularRatio, 0.005, 0.04, 0.15) * 0.45 + (s.meanSat < 0.25 ? 0.2 : 0.05) + (s.meanV > 0.5 ? 0.15 : 0);
    if (s.specularRatio > 0.02) r.push("brilho forte");
    cs.push({ kind: "glass", score: sc, reasons: r });
  }
  // METAL — gray dominante, specular médio.
  {
    const r: string[] = [];
    const sc = (s.grayRatio > 0.2 ? 0.3 : 0.1) + tri(s.specularRatio, 0.005, 0.025, 0.1) * 0.3 + (s.meanSat < 0.15 ? 0.2 : 0.05);
    if (s.grayRatio > 0.25) r.push("tom metálico/cinza");
    cs.push({ kind: "metal", score: sc, reasons: r });
  }
  // CONCRETE — gray, edge alta (textura), V mid, sem specular.
  {
    const r: string[] = [];
    const sc = (s.grayRatio > 0.15 ? 0.25 : 0.1) + tri(s.edgeDensity, 0.04, 0.09, 0.2) * 0.4 + (s.specularRatio < 0.005 ? 0.15 : 0);
    if (s.edgeDensity > 0.05 && s.grayRatio > 0.15) r.push("textura rugosa cinza");
    cs.push({ kind: "concrete", score: sc, reasons: r });
  }
  // WOOD — warm brown alto, edge média.
  {
    const r: string[] = [];
    const sc = (s.warmBrownRatio > 0.15 ? 0.4 : 0.1) + tri(s.edgeDensity, 0.02, 0.06, 0.15) * 0.3 + (s.meanSat > 0.15 && s.meanSat < 0.5 ? 0.15 : 0);
    if (s.warmBrownRatio > 0.2) r.push("tom de madeira");
    cs.push({ kind: "wood", score: sc, reasons: r });
  }
  // BOTTLE — aspect alto (vertical), specular forte concentrado, gray/glass.
  {
    const r: string[] = [];
    const sc = (aspect < 0.6 ? 0.4 : aspect < 0.85 ? 0.2 : 0) + tri(s.specularRatio, 0.01, 0.04, 0.15) * 0.3 + (s.meanSat < 0.3 ? 0.15 : 0.05);
    if (aspect < 0.6) r.push("aspect vertical (cilindro)");
    cs.push({ kind: "bottle", score: sc, reasons: r });
  }
  // TUBE/BISNAGA — aspect alto, sat média, edge média, sem specular tão forte.
  {
    const r: string[] = [];
    const sc = (aspect < 0.55 ? 0.35 : aspect < 0.75 ? 0.2 : 0) + (s.specularRatio < 0.02 ? 0.15 : 0.05) + (s.meanSat > 0.2 ? 0.15 : 0.05) + tri(s.edgeDensity, 0.015, 0.04, 0.1) * 0.2;
    if (aspect < 0.55) r.push("formato de bisnaga");
    cs.push({ kind: "tube", score: sc, reasons: r });
  }
  // MUG — aspect quadrado/curto, edge baixa, sat baixa.
  {
    const r: string[] = [];
    const sc = (aspect > 0.8 && aspect < 1.3 ? 0.25 : 0.1) + (s.edgeDensity < 0.03 ? 0.2 : 0.05) + (s.meanSat < 0.25 ? 0.15 : 0.05);
    if (aspect > 0.9 && aspect < 1.15) r.push("aspect ~1:1");
    cs.push({ kind: "mug", score: sc, reasons: r });
  }
  // WET — specular muito alto, V alto, sat média-alta.
  {
    const r: string[] = [];
    const sc = tri(s.specularRatio, 0.02, 0.07, 0.2) * 0.5 + (s.meanV > 0.55 ? 0.2 : 0.05);
    if (s.specularRatio > 0.04) r.push("muito brilho difuso");
    cs.push({ kind: "wet", score: sc, reasons: r });
  }

  // Prior boost (learning loop): log(1+count)/10, máx ~0.3 com 20 amostras.
  if (opts.prior) {
    for (const c of cs) {
      const n = opts.prior[c.kind] ?? 0;
      if (n > 0) { c.score += Math.log(1 + n) / 10; c.reasons.push(`hist:${n}`); }
    }
  }
  cs.sort((a, b) => b.score - a.score);
  const topRaw = cs[0]?.score || 1;
  const norm = topRaw > 0 ? 1 / topRaw : 1;
  const candidates = cs.slice(0, 5).map((c) => ({ ...c, score: Math.min(1, c.score * norm) }));
  return { signals: s, candidates, top: candidates[0] };
}
