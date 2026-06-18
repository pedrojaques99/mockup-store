/**
 * key-color-core — núcleo PURO e ISOMÓRFICO (sem sharp, sem DOM) da detecção de
 * "key color" (placeholder magenta/neon) e do ajuste de quad.
 *
 * SSoT do "melhor dos dois mundos":
 *  - predicado `isKeyColor`: RGB channel-diff (robusto a sombra, de magenta-mask.ts)
 *    OR HSL adaptativo (tom-adaptativo, de findNeonQuad) → união pega os dois casos.
 *  - cantos via convex-hull (monotone chain) + simplificação por menor-perda-de-área
 *    a 4 vértices (o que o cv2.approxPolyDP faz) → preciso em trapézio/perspectiva,
 *    substituindo o frágil min/max(x±y) que gera quads degenerados com glow.
 *
 * Consumido pelo servidor (photo-detect.ts via sharp) e, futuramente, pelo cliente
 * (magenta-mask.ts via canvas) — o predicado e a geometria nunca divergem.
 */

export interface Pt { x: number; y: number }
export interface QuadCorners { tl: Pt; tr: Pt; br: Pt; bl: Pt }

/** Bump quando a lógica de detecção mudar — grava no golden p/ re-detecção seletiva. */
export const DETECTOR_VERSION = 1;

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return [h / 6, s, l];
}

/**
 * Pixel é "key color" se:
 *  - RGB channel-diff: G claramente menor, R/B bem maiores → magenta brilhante OU
 *    sombreado, exclui pele/vermelho (B baixo). Independe de hue absoluto.
 *  OU
 *  - HSL: hue dentro de [hLo,hHi] normalizado (0..1, com wrap) e saturação ≥ minSat.
 *    Adapta ao tom que o gerador cuspiu. Passe hLo = NaN para desligar este ramo.
 */
export function isKeyColor(
  r: number, g: number, b: number,
  hLo: number, hHi: number, minSat: number,
): boolean {
  if (r - g > 40 && b - g > 18 && r > 80 && b > 50) return true; // RGB-diff (sombra-tolerante)
  if (Number.isNaN(hLo)) return false;
  const [h, s] = rgbToHsl(r, g, b);
  if (s < minSat) return false;
  return hLo <= hHi ? (h >= hLo && h <= hHi) : (h >= hLo || h <= hHi); // wrap 0/1
}

// ── Geometria ──────────────────────────────────────────────────────────────

function cross(o: [number, number], a: [number, number], b: [number, number]): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

/** Convex hull (Andrew's monotone chain). Retorna vértices em ordem CCW, sem o ponto repetido. */
export function convexHull(points: Array<[number, number]>): Array<[number, number]> {
  const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length <= 2) return pts;
  const lower: Array<[number, number]> = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Array<[number, number]> = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop(); upper.pop();
  return lower.concat(upper);
}

function triArea(a: [number, number], b: [number, number], c: [number, number]): number {
  return Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
}

/**
 * Reduz um polígono convexo a exatamente 4 vértices removendo, a cada passo, o
 * vértice cuja remoção perde menos área (triângulo com os vizinhos). Preserva os
 * cantos verdadeiros (alta contribuição de área) → trapézio/perspectiva intactos.
 * Retorna null se não houver ≥4 vértices.
 */
export function simplifyToQuad(hull: Array<[number, number]>): Array<[number, number]> | null {
  const poly = hull.slice();
  if (poly.length < 4) return null;
  while (poly.length > 4) {
    let minLoss = Infinity, minIdx = -1;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[(i - 1 + poly.length) % poly.length];
      const c = poly[(i + 1) % poly.length];
      const loss = triArea(a, poly[i], c);
      if (loss < minLoss) { minLoss = loss; minIdx = i; }
    }
    poly.splice(minIdx, 1);
  }
  return poly;
}

/** Ordena 4 pontos em tl/tr/br/bl (top-two por y, depois left/right por x). */
export function orderCorners(four: Array<[number, number]>): QuadCorners {
  const s = four.slice().sort((a, b) => a[1] - b[1]);
  const top = s.slice(0, 2).sort((a, b) => a[0] - b[0]);
  const bot = s.slice(2, 4).sort((a, b) => a[0] - b[0]);
  return {
    tl: { x: top[0][0], y: top[0][1] }, tr: { x: top[1][0], y: top[1][1] },
    bl: { x: bot[0][0], y: bot[0][1] }, br: { x: bot[1][0], y: bot[1][1] },
  };
}

/**
 * Blob de pixels [x,y] → 4 cantos ordenados via hull + simplificação.
 * Retorna null se o blob não formar um quad (caller cai no fallback extremal).
 */
export function fitQuadFromBlob(points: Array<[number, number]>): QuadCorners | null {
  const hull = convexHull(points);
  const four = simplifyToQuad(hull);
  if (!four) return null;
  return orderCorners(four);
}

/** Fração [0..1] da área do quad coberta pelo blob (mede o quão "retangular cheio" é). */
export function blobFillRatio(points: Array<[number, number]>, quad: QuadCorners): number {
  const area = polygonArea([quad.tl, quad.tr, quad.br, quad.bl]);
  if (area <= 0) return 0;
  return Math.min(1, points.length / area);
}

// ── IoU (quads convexos) via Sutherland–Hodgman — sem dependência externa ────

export function polygonArea(poly: Pt[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    a += poly[i].x * poly[j].y - poly[j].x * poly[i].y;
  }
  return Math.abs(a) / 2;
}

/** Garante orientação CCW (para o clip ser consistente). */
function ensureCCW(poly: Pt[]): Pt[] {
  let signed = 0;
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    signed += poly[i].x * poly[j].y - poly[j].x * poly[i].y;
  }
  return signed < 0 ? poly.slice().reverse() : poly;
}

/** Interseção de polígono convexo `subject` pelo convexo `clip` (Sutherland–Hodgman). */
function convexClip(subject: Pt[], clip: Pt[]): Pt[] {
  let output = subject;
  const n = clip.length;
  for (let i = 0; i < n; i++) {
    const A = clip[i], B = clip[(i + 1) % n];
    const input = output;
    output = [];
    const edge = (p: Pt) => (B.x - A.x) * (p.y - A.y) - (B.y - A.y) * (p.x - A.x); // >=0 = dentro (CCW)
    for (let k = 0; k < input.length; k++) {
      const cur = input[k], prev = input[(k - 1 + input.length) % input.length];
      const dCur = edge(cur), dPrev = edge(prev);
      if (dCur >= 0) {
        if (dPrev < 0) output.push(intersect(prev, cur, A, B));
        output.push(cur);
      } else if (dPrev >= 0) {
        output.push(intersect(prev, cur, A, B));
      }
    }
    if (output.length === 0) return [];
  }
  return output;
}

function intersect(p1: Pt, p2: Pt, a: Pt, b: Pt): Pt {
  const A1 = p2.y - p1.y, B1 = p1.x - p2.x, C1 = A1 * p1.x + B1 * p1.y;
  const A2 = b.y - a.y, B2 = a.x - b.x, C2 = A2 * a.x + B2 * a.y;
  const det = A1 * B2 - A2 * B1;
  if (det === 0) return p1;
  return { x: (B2 * C1 - B1 * C2) / det, y: (A1 * C2 - A2 * C1) / det };
}

/** IoU entre dois quads (interseção / união). 1 = idênticos, 0 = disjuntos. */
export function quadIoU(a: QuadCorners, b: QuadCorners): number {
  const pa = ensureCCW([a.tl, a.tr, a.br, a.bl]);
  const pb = ensureCCW([b.tl, b.tr, b.br, b.bl]);
  const inter = polygonArea(convexClip(pa, pb));
  const union = polygonArea(pa) + polygonArea(pb) - inter;
  return union <= 0 ? 0 : inter / union;
}
