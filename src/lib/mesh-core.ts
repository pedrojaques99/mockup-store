/**
 * mesh-core — parte PURA da malha de warp (sem sharp/DOM), isomórfica.
 * Cliente (MeshEditor, /calibrate) e server (mesh-warp.ts) compartilham isto.
 */
import type { QuadCorners, Pt } from "./key-color-core";

/** Haste Bézier de um nó. `h`/`v` = tangente (offset px) na direção da linha/coluna,
 *  usada de forma SIMÉTRICA (mirror C1): saída = +h/+v, entrada = −h/−v.
 *  Os campos `*Out`/`*In` são overrides opcionais para quebrar a simetria (corner,
 *  estilo Alt-drag no pen): quando ausentes, derivam de `h`/`v` (mirror). Retrocompat:
 *  malhas salvas só com `h`/`v` continuam válidas. */
export interface Tangent {
  h: Pt; v: Pt;
  hOut?: Pt; hIn?: Pt;   // direção +u (direita) / −u (esquerda)
  vOut?: Pt; vIn?: Pt;   // direção +v (baixo)  / −v (cima)
}

export interface WarpMesh {
  rows: number;   // pontos por coluna (≥2)
  cols: number;   // pontos por linha (≥2)
  points: Pt[];   // row-major, rows*cols, em px da imagem
  /** Hastes Bézier por ponto (row-major, paralelo a `points`). Ausente = grade reta. */
  tangents?: Tangent[];
}

const lerp = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const ZERO = { x: 0, y: 0 };
const neg = (p: Pt): Pt => ({ x: -p.x, y: -p.y });

// Handles direcionais de um nó (mirror por default; override se *Out/*In presentes).
export const hOutOf = (t: Tangent): Pt => t.hOut ?? t.h;
export const hInOf = (t: Tangent): Pt => t.hIn ?? neg(t.h);
export const vOutOf = (t: Tangent): Pt => t.vOut ?? t.v;
export const vInOf = (t: Tangent): Pt => t.vIn ?? neg(t.v);

/** Bézier cúbica. */
function cubic(p0: Pt, c0: Pt, c1: Pt, p1: Pt, t: number): Pt {
  const u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return { x: a * p0.x + b * c0.x + c * c1.x + d * p1.x, y: a * p0.y + b * c0.y + c * c1.y + d * p1.y };
}

/**
 * Avalia a superfície da malha numa célula (ci,cj) no parâmetro local (lu,lv)∈[0,1]².
 * Com tangentes → patch de Coons (arestas Bézier cúbicas, estilo PS Warp). Sem → bilinear.
 */
export function evalCell(m: WarpMesh, ci: number, cj: number, lu: number, lv: number): Pt {
  const { cols, points, tangents } = m;
  const P = (i: number, j: number) => points[i * cols + j];
  const p00 = P(ci, cj), p01 = P(ci, cj + 1), p10 = P(ci + 1, cj), p11 = P(ci + 1, cj + 1);
  if (!tangents) {
    return lerp(lerp(p00, p01, lu), lerp(p10, p11, lu), lv); // bilinear
  }
  const T = (i: number, j: number): Tangent => tangents[i * cols + j] ?? { h: ZERO, v: ZERO };
  const t00 = T(ci, cj), t01 = T(ci, cj + 1), t10 = T(ci + 1, cj), t11 = T(ci + 1, cj + 1);
  const add = (p: Pt, d: Pt): Pt => ({ x: p.x + d.x, y: p.y + d.y });
  // arestas (Bézier): control de SAÍDA do nó inicial + control de ENTRADA do nó final.
  // topo/baixo = direção +u (handles h); esquerda/direita = direção +v (handles v).
  const top = cubic(p00, add(p00, hOutOf(t00)), add(p01, hInOf(t01)), p01, lu);
  const bot = cubic(p10, add(p10, hOutOf(t10)), add(p11, hInOf(t11)), p11, lu);
  const left = cubic(p00, add(p00, vOutOf(t00)), add(p10, vInOf(t10)), p10, lv);
  const right = cubic(p01, add(p01, vOutOf(t01)), add(p11, vInOf(t11)), p11, lv);
  // Coons: Lc + Ld − bilinear(cantos)
  const Lc = lerp(top, bot, lv);
  const Ld = lerp(left, right, lu);
  const B = lerp(lerp(p00, p01, lu), lerp(p10, p11, lu), lv);
  return { x: Lc.x + Ld.x - B.x, y: Lc.y + Ld.y - B.y };
}

/** Inicializa tangentes em zero (arestas retas) — pra começar a editar handles. */
export function ensureTangents(m: WarpMesh): WarpMesh {
  if (m.tangents && m.tangents.length === m.points.length) return m;
  return { ...m, tangents: m.points.map(() => ({ h: { x: 0, y: 0 }, v: { x: 0, y: 0 } })) };
}

/**
 * Deriva hastes Bézier suaves de cada nó a partir dos vizinhos (Catmull-Rom → Bézier:
 * tangente = (P_next − P_prev)/2, control = tangente/3 ⇒ offset = (P_next − P_prev)/6).
 * Bordas usam meia-haste. Resultado é mirror (sem overrides) — a malha vira spline
 * suave só de mover as âncoras. É o "Suavizar" do painel.
 */
export function autoSmoothTangents(m: WarpMesh): WarpMesh {
  const { rows, cols, points } = m;
  const P = (i: number, j: number) => points[i * cols + j];
  const tangents: Tangent[] = [];
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
    // tangente horizontal (ao longo da linha)
    let h: Pt;
    if (cols < 2) h = ZERO;
    else if (j === 0) h = { x: (P(i, 1).x - P(i, 0).x) / 3, y: (P(i, 1).y - P(i, 0).y) / 3 };
    else if (j === cols - 1) h = { x: (P(i, j).x - P(i, j - 1).x) / 3, y: (P(i, j).y - P(i, j - 1).y) / 3 };
    else h = { x: (P(i, j + 1).x - P(i, j - 1).x) / 6, y: (P(i, j + 1).y - P(i, j - 1).y) / 6 };
    // tangente vertical (ao longo da coluna)
    let v: Pt;
    if (rows < 2) v = ZERO;
    else if (i === 0) v = { x: (P(1, j).x - P(0, j).x) / 3, y: (P(1, j).y - P(0, j).y) / 3 };
    else if (i === rows - 1) v = { x: (P(i, j).x - P(i - 1, j).x) / 3, y: (P(i, j).y - P(i - 1, j).y) / 3 };
    else v = { x: (P(i + 1, j).x - P(i - 1, j).x) / 6, y: (P(i + 1, j).y - P(i - 1, j).y) / 6 };
    tangents.push({ h: { x: Math.round(h.x), y: Math.round(h.y) }, v: { x: Math.round(v.x), y: Math.round(v.y) } });
  }
  return { ...m, tangents };
}

/** Posição no quad (bilinear/perspectiva) para (u,v) ∈ [0,1]². */
export function bilinearQuad(q: QuadCorners, u: number, v: number): Pt {
  return lerp(lerp(q.tl, q.tr, u), lerp(q.bl, q.br, u), v);
}

/** Cantos do quad a partir da malha. */
export function meshCorners(m: WarpMesh): QuadCorners {
  const { rows, cols, points } = m;
  return { tl: points[0], tr: points[cols - 1], bl: points[(rows - 1) * cols], br: points[rows * cols - 1] };
}

/** Malha regular (grade bilinear dentro do quad). */
export function defaultMesh(q: QuadCorners, rows = 3, cols = 3): WarpMesh {
  const points: Pt[] = [];
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
    const p = bilinearQuad(q, j / (cols - 1), i / (rows - 1));
    points.push({ x: Math.round(p.x), y: Math.round(p.y) });
  }
  return { rows, cols, points };
}

/**
 * **Auto-curva**: amostra um displacement field (R=X,G=Y,128=neutro) nas posições
 * dos nós da malha e move cada nó INTERNO proporcionalmente ao offset lido. Bordas
 * ficam fixas (preservam o quad). Depois aplica `autoSmoothTangents` → spline suave.
 *
 * Argumentos:
 *  - sampler(x,y) retorna [dx, dy] em px (já desnormalizado: byte→px usando dispScale).
 *  - amount ∈ [0,1] = intensidade da influência (1 = aplica integral).
 *
 * É a feature "mexer no displacement mexe na malha" — o relevo da superfície vira
 * curvatura macro da malha de forma inteligente, sem o usuário tocar em haste.
 */
export function applyDispToMesh(
  m: WarpMesh,
  sampler: (x: number, y: number) => readonly [number, number],
  amount = 1,
): WarpMesh {
  const { rows, cols } = m;
  const next = m.points.slice();
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
    if (i === 0 || j === 0 || i === rows - 1 || j === cols - 1) continue; // borda fixa
    const k = i * cols + j; const p = m.points[k];
    const [dx, dy] = sampler(p.x, p.y);
    next[k] = { x: Math.round(p.x + dx * amount), y: Math.round(p.y + dy * amount) };
  }
  return autoSmoothTangents({ ...m, points: next });
}

/**
 * **Depth-aware mesh**: amostra um depth map (gray 0–255, branco=perto) nas
 * posições dos nós internos e desloca cada nó na direção da normal estimada
 * pelo gradiente local do depth → curvatura 3D real do objeto. Ideal pra
 * camiseta amassada, garrafa, capa de livro — qualquer coisa com relevo real.
 *
 * `sampleDepth(x,y)` retorna o valor [0,1] do depth na posição. `amount` modula
 * (em px) o quanto a maior diferença de depth desloca um nó.
 */
export function meshFromDepth(
  m: WarpMesh,
  sampleDepth: (x: number, y: number) => number,
  amount = 20,
): WarpMesh {
  const { rows, cols } = m;
  const next = m.points.slice();
  // Calcula range de depth observado nos nós pra normalizar
  let dmin = 1, dmax = 0;
  for (const p of m.points) { const d = sampleDepth(p.x, p.y); if (d < dmin) dmin = d; if (d > dmax) dmax = d; }
  const range = Math.max(0.05, dmax - dmin);
  // Eixo da malha: aproxima por (TR-TL) e (BL-TL). Deslocamento dos nós é perpendicular ao plano.
  const TL = m.points[0], TR = m.points[cols - 1], BL = m.points[(rows - 1) * cols];
  const ax = { x: (TR.x - TL.x) / (cols - 1), y: (TR.y - TL.y) / (cols - 1) };
  const ay = { x: (BL.x - TL.x) / (rows - 1), y: (BL.y - TL.y) / (rows - 1) };
  // Normal ao plano do quad (no espaço 2D, perpendicular à diagonal média) — proxy do "eixo Z".
  const nx = -(ax.y + ay.y) / 2, ny = (ax.x + ay.x) / 2;
  const nLen = Math.hypot(nx, ny) || 1;
  const norm = { x: nx / nLen, y: ny / nLen };
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
    if (i === 0 || j === 0 || i === rows - 1 || j === cols - 1) continue; // borda fixa
    const k = i * cols + j; const p = m.points[k];
    const d = sampleDepth(p.x, p.y);
    const t = (d - dmin) / range - 0.5; // [-0.5,+0.5]
    next[k] = { x: Math.round(p.x + norm.x * t * amount), y: Math.round(p.y + norm.y * t * amount) };
  }
  return autoSmoothTangents({ ...m, points: next });
}

/** True se a malha desvia da grade regular do quad (pontos movidos OU hastes Bézier). */
export function meshIsWarped(m: WarpMesh, eps = 0.75): boolean {
  const q = meshCorners(m);
  for (let i = 0; i < m.rows; i++) for (let j = 0; j < m.cols; j++) {
    const reg = bilinearQuad(q, j / (m.cols - 1), i / (m.rows - 1));
    const p = m.points[i * m.cols + j];
    if (Math.abs(p.x - reg.x) > eps || Math.abs(p.y - reg.y) > eps) return true;
  }
  if (m.tangents) for (const t of m.tangents) {
    // considera tanto o handle mirror (h/v) quanto os overrides de break (*Out/*In)
    for (const d of [t.h, t.v, t.hOut, t.hIn, t.vOut, t.vIn]) {
      if (d && (Math.abs(d.x) > eps || Math.abs(d.y) > eps)) return true;
    }
  }
  return false;
}
