/**
 * detect-qa — gate de qualidade PURO (sem sharp, sem DOM) para a detecção de quad.
 *
 * Problema que resolve: `detectKeyColorQuad` pega o MAIOR blob magenta e devolve um
 * quad — mas baka em silêncio mesmo quando a cena é ambígua (2 painéis magenta),
 * quando o glow inflou o hull (blob não preenche o quad) ou quando a geometria
 * degenerou (sliver / imagem inteira). Este módulo pontua esses três eixos e emite
 * um veredito `ok | review | reject` + confiança combinada, para o bake decidir
 * entre aceitar, cair na cascata SAM, ou marcar `needsReview` em vez de bakar lixo.
 *
 * É puro e isomórfico (opera sobre o array de pixels-chave + quad), espelhando o
 * `largestConnectedBlob` do photo-detect: a mesma BFS 8-conexa em grid subamostrado.
 * Consumido pelo servidor (photo-detect) e testável sem I/O.
 */
import type { Pt, QuadCorners } from "./key-color-core";
import { polygonArea } from "./key-color-core";

export interface DetectionQA {
  /** 0..1 — confiança combinada (fill × (1−ambiguity) × geometria). */
  confidence: number;
  /** 0..1 — fração da área do quad coberta pelo blob (glow inflado ⇒ baixo). */
  fillRatio: number;
  /** 0..1 — tamanho do 2º maior componente / maior. →1 = dois painéis iguais (ambíguo). */
  ambiguity: number;
  /** Nº de componentes magenta significativos (≥ minComponentFrac do maior). */
  componentCount: number;
  /** Área do quad / área da imagem. */
  areaFraction: number;
  /** Aspecto (w/h) do bbox do quad. */
  aspect: number;
  verdict: "ok" | "review" | "reject";
  reasons: string[];
}

export interface QaThresholds {
  /** Passo de subamostragem da grid de componentes (px). Default 4 (= largestConnectedBlob). */
  step: number;
  /** Componente só conta como "significativo" se ≥ esta fração do maior. Default 0.15. */
  minComponentFrac: number;
  /** ambiguity ≥ isto ⇒ reject (dois painéis comparáveis, indistinguíveis). Default 0.5. */
  ambiguityReject: number;
  /** ambiguity ≥ isto ⇒ review. Default 0.22. */
  ambiguityReview: number;
  /** fillRatio < isto ⇒ reject (blob não forma o quad — glow/ruído espalhado). Default 0.3. */
  fillReject: number;
  /** fillRatio < isto ⇒ review. Default 0.55. */
  fillReview: number;
  /** areaFraction fora de [min,max] ⇒ reject (nada / imagem inteira). Default 0.004 / 0.92. */
  areaMin: number;
  areaMax: number;
  /** aspect fora de [1/max, max] ⇒ reject (sliver degenerado). Default 18. */
  aspectMax: number;
}

export const DEFAULT_QA: QaThresholds = {
  step: 4,
  minComponentFrac: 0.15,
  ambiguityReject: 0.5,
  ambiguityReview: 0.22,
  fillReject: 0.3,
  fillReview: 0.55,
  areaMin: 0.004,
  areaMax: 0.92,
  aspectMax: 18,
};

/**
 * Tamanhos dos componentes 8-conexos dos pixels-chave, em ordem decrescente
 * (em células da grid subamostrada). Mesma BFS de `largestConnectedBlob`, mas
 * retorna TODOS os tamanhos — é o que destrava a medida de ambiguidade (o
 * `largestConnectedBlob` colapsa tudo no bbox do maior e perde o 2º painel).
 */
export function componentSizes(
  pts: Array<[number, number]>,
  width: number,
  height: number,
  step = 4,
): number[] {
  if (pts.length === 0) return [];
  const gw = Math.ceil(width / step);
  const gh = Math.ceil(height / step);
  const grid = new Uint8Array(gw * gh);
  for (const [x, y] of pts) grid[((y / step) | 0) * gw + ((x / step) | 0)] = 1;

  const visited = new Uint8Array(gw * gh);
  const sizes: number[] = [];
  const queue: number[] = [];

  for (let gi = 0; gi < gw * gh; gi++) {
    if (!grid[gi] || visited[gi]) continue;
    queue.length = 0;
    queue.push(gi);
    visited[gi] = 1;
    let size = 0;
    while (queue.length > 0) {
      const idx = queue.pop()!;
      const cx = idx % gw, cy = (idx / gw) | 0;
      size++;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || nx >= gw || ny < 0 || ny >= gh) continue;
          const ni = ny * gw + nx;
          if (!visited[ni] && grid[ni]) { visited[ni] = 1; queue.push(ni); }
        }
      }
    }
    sizes.push(size);
  }
  return sizes.sort((a, b) => b - a);
}

/** bbox (w,h) dos 4 cantos de um quad. */
function quadBBox(q: QuadCorners): { w: number; h: number } {
  const xs = [q.tl.x, q.tr.x, q.br.x, q.bl.x];
  const ys = [q.tl.y, q.tr.y, q.br.y, q.bl.y];
  return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

/**
 * Avalia a saúde de uma detecção de key color.
 *
 * @param pts    TODOS os pixels-chave (antes do filtro de maior-blob) — para ambiguidade.
 * @param quad   quad ajustado (hull+DP) que o detector devolveu.
 * @param width  largura da imagem.
 * @param height altura da imagem.
 */
export function assessDetection(
  pts: Array<[number, number]>,
  quad: QuadCorners,
  width: number,
  height: number,
  thr: QaThresholds = DEFAULT_QA,
): DetectionQA {
  const reasons: string[] = [];

  // ── Geometria do quad ──
  const quadArea = polygonArea([quad.tl, quad.tr, quad.br, quad.bl]);
  const areaFraction = width && height ? quadArea / (width * height) : 0;
  const { w, h } = quadBBox(quad);
  const aspect = h > 0 ? w / h : Infinity;

  // ── Fill ratio: quão "cheio" o blob deixa o quad (glow inflado ⇒ baixo) ──
  const fillRatio = quadArea > 0 ? Math.min(1, pts.length / quadArea) : 0;

  // ── Ambiguidade: 2º maior componente / maior ──
  const sizes = componentSizes(pts, width, height, thr.step);
  const largest = sizes[0] ?? 0;
  const second = sizes[1] ?? 0;
  const ambiguity = largest > 0 ? second / largest : 0;
  const componentCount = sizes.filter((s) => largest > 0 && s >= largest * thr.minComponentFrac).length;

  // ── Vereditos (reject vence review) ──
  let verdict: DetectionQA["verdict"] = "ok";
  const demote = (to: "review" | "reject", why: string) => {
    reasons.push(why);
    if (to === "reject" || verdict === "ok") verdict = to === "reject" ? "reject" : (verdict === "ok" ? "review" : verdict);
  };

  if (areaFraction < thr.areaMin) demote("reject", `área ínfima (${(areaFraction * 100).toFixed(2)}%)`);
  else if (areaFraction > thr.areaMax) demote("reject", `quad cobre a imagem toda (${(areaFraction * 100).toFixed(0)}%)`);

  if (aspect > thr.aspectMax || aspect < 1 / thr.aspectMax) demote("reject", `aspecto degenerado (${aspect.toFixed(1)})`);

  if (ambiguity >= thr.ambiguityReject) demote("reject", `ambíguo: 2º painel a ${(ambiguity * 100).toFixed(0)}% do maior`);
  else if (ambiguity >= thr.ambiguityReview) demote("review", `possível 2º painel (${(ambiguity * 100).toFixed(0)}%)`);

  if (fillRatio < thr.fillReject) demote("reject", `blob não preenche o quad (${(fillRatio * 100).toFixed(0)}%) — glow/ruído`);
  else if (fillRatio < thr.fillReview) demote("review", `preenchimento baixo (${(fillRatio * 100).toFixed(0)}%)`);

  // ── Confiança combinada ──
  const geomOk = areaFraction >= thr.areaMin && areaFraction <= thr.areaMax
    && aspect <= thr.aspectMax && aspect >= 1 / thr.aspectMax ? 1 : 0;
  const confidence = Math.max(0, Math.min(1, fillRatio * (1 - ambiguity) * geomOk));

  return { confidence, fillRatio, ambiguity, componentCount, areaFraction, aspect, verdict, reasons };
}
