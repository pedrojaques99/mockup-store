/**
 * mesh-warp — malha de warp estilo Photoshop "Warp"/Envelope (grade Coons/bilinear).
 *
 * Não reinventa o warp: gera um DISPLACEMENT FIELD (R=X, G=Y, 128=neutro) que o
 * `@visant/psd-engine` já aplica nativamente (applyDisplacementFilter = Displace do PS).
 * A arte é warpada no quad-base (4 cantos = `face.quad`) e o campo desloca o interior
 * pra seguir os pontos de controle → superfície que abaula (ex.: placa sobre acolchoado),
 * impossível com 4 cantos.
 *
 * Contrato do engine (scene/render.js + compose.js) — o field é autorado NO ESPAÇO DO
 * faceCanvas (bbox do `face.quad`, dimensão outW×outH = ceil(maxX−minX)×ceil(maxY−minY)
 * dos 4 cantos do quad). O engine faz `applyDisplacementFilter(..., 'stretch to fit')`:
 * estica o PNG inteiro sobre o faceCanvas (offsetX/Y do field são IGNORADOS) e decodifica
 * com a constante 128: `d = ((canal−128)/128)*scale`, amostra `src(p+d)` bilinear,
 * edge=clamp. Portanto: dimensão = bbox do quad, decode/encode com **128**.
 *
 * Campo: para cada pixel de saída p (em coords do faceCanvas = doc − quadMin),
 * d = quad_pos(u,v) − mesh_pos(u,v), pois o Displace faz out(p) = src(p + d).
 * Rasterizado por célula (2 triângulos, baricêntrico) — grade regular, sem dep. externa.
 */
import sharp from "sharp";
import type { Pt, QuadCorners } from "./key-color-core";
import { bilinearQuad, meshCorners, evalCell, type WarpMesh } from "./mesh-core";
export {
  bilinearQuad, meshCorners, defaultMesh, meshIsWarped, evalCell, ensureTangents,
  clampMeshFolds, type WarpMesh,
} from "./mesh-core";

/** Constante de codificação byte↔px do Displace (DEVE casar com o decoder do engine). */
const NEUTRAL = 128;
const SPAN = 128; // (canal − 128) / 128 * scale   ⇒   encode: 128 + (off/scale)*128

/**
 * Gera o displacement field PNG (R=X,G=Y,128=neutro) que reproduz a malha no engine,
 * **no espaço do faceCanvas** (bbox do quad).
 * @param m     malha de warp (em px do doc, já na escala do render)
 * @param opts.quad  os 4 cantos do `face.quad` do engine (default = cantos da malha).
 *                   Define o bbox de saída E o "quad regular" do warp de perspectiva.
 * @param opts.maxRes  teto da maior dimensão do mapa (default adaptativo ao face).
 * Retorna { png, dispScale, width, height, offsetX, offsetY } — `dispScale` vai em face.dispScale.
 */
export async function generateMeshDisplacement(
  m: WarpMesh,
  opts: { maxRes?: number; quad?: QuadCorners } = {},
): Promise<{ png: Buffer; dispScale: number; width: number; height: number; offsetX: number; offsetY: number } | null> {
  const { rows, cols, points } = m;
  if (rows < 2 || cols < 2 || points.length !== rows * cols) return null;

  // Quad do engine = base do perspectiveWarp. O field VIVE no bbox deste quad.
  const q = opts.quad ?? meshCorners(m);
  const qxs = [q.tl.x, q.tr.x, q.br.x, q.bl.x], qys = [q.tl.y, q.tr.y, q.br.y, q.bl.y];
  const minX = Math.min(...qxs), minY = Math.min(...qys);
  const outW = Math.max(1, Math.ceil(Math.max(...qxs) - minX));   // == render.js outW
  const outH = Math.max(1, Math.ceil(Math.max(...qys) - minY));

  // resolução do mapa: campo é suave → low-res + stretch bilinear do engine basta.
  // Adaptativo ao tamanho do face (mockups hi-res ganham nitidez no vinco).
  const longest = Math.max(outW, outH);
  const maxRes = opts.maxRes ?? Math.min(1024, Math.max(256, longest));
  const s = longest > maxRes ? maxRes / longest : 1;
  const MW = Math.max(2, Math.round(outW * s)), MH = Math.max(2, Math.round(outH * s));
  const sx = MW / outW, sy = MH / outH; // doc-local → map

  const Ox = new Float32Array(MW * MH), Oy = new Float32Array(MW * MH);
  const cov = new Uint8Array(MW * MH);

  // rasteriza um triângulo (vértices em map-space) interpolando (u,v) e mesh_pos(doc)
  const rasterTri = (
    A: Pt, B: Pt, C: Pt,                 // posições da malha em map-space (= saída)
    uvA: [number, number], uvB: [number, number], uvC: [number, number],
    docA: Pt, docB: Pt, docC: Pt,        // posições da malha em doc-space
  ) => {
    const minx = Math.max(0, Math.floor(Math.min(A.x, B.x, C.x)));
    const maxx = Math.min(MW - 1, Math.ceil(Math.max(A.x, B.x, C.x)));
    const miny = Math.max(0, Math.floor(Math.min(A.y, B.y, C.y)));
    const maxy = Math.min(MH - 1, Math.ceil(Math.max(A.y, B.y, C.y)));
    const d = (B.y - C.y) * (A.x - C.x) + (C.x - B.x) * (A.y - C.y);
    if (Math.abs(d) < 1e-9) return;
    for (let y = miny; y <= maxy; y++) {
      for (let x = minx; x <= maxx; x++) {
        const a = ((B.y - C.y) * (x - C.x) + (C.x - B.x) * (y - C.y)) / d;
        const b = ((C.y - A.y) * (x - C.x) + (A.x - C.x) * (y - C.y)) / d;
        const c = 1 - a - b;
        if (a < -0.001 || b < -0.001 || c < -0.001) continue;
        const u = a * uvA[0] + b * uvB[0] + c * uvC[0];
        const v = a * uvA[1] + b * uvB[1] + c * uvC[1];
        const qp = bilinearQuad(q, u, v);                 // posição no quad regular (doc)
        const mx = a * docA.x + b * docB.x + c * docC.x;  // posição na malha (doc) = saída
        const my = a * docA.y + b * docB.y + c * docC.y;
        const idx = y * MW + x;
        Ox[idx] = qp.x - mx;   // d = quad_pos − mesh_pos  → out(p)=src(p+d)
        Oy[idx] = qp.y - my;
        cov[idx] = 1;
      }
    }
  };

  // Subdivisão por célula: com hastes Bézier amostra o patch de Coons (SUB×SUB) → suave.
  // SUB adaptativo: mais subdivisões em malha curva (hastes) e maior res de mapa.
  const SUB = m.tangents ? Math.max(4, Math.min(10, Math.round(MW / Math.max(1, cols * 24)) + 4)) : 1;
  const toMap = (p: Pt): Pt => ({ x: (p.x - minX) * sx, y: (p.y - minY) * sy }); // mesh_pos − quadMin
  for (let i = 0; i < rows - 1; i++) {
    for (let j = 0; j < cols - 1; j++) {
      for (let a = 0; a < SUB; a++) {
        for (let b = 0; b < SUB; b++) {
          // 4 cantos do sub-quad em (lu,lv) local da célula
          const lu0 = a / SUB, lu1 = (a + 1) / SUB, lv0 = b / SUB, lv1 = (b + 1) / SUB;
          const gU = (lu: number) => (j + lu) / (cols - 1); // (u,v) global
          const gV = (lv: number) => (i + lv) / (rows - 1);
          const d00 = evalCell(m, i, j, lu0, lv0), d01 = evalCell(m, i, j, lu1, lv0);
          const d10 = evalCell(m, i, j, lu0, lv1), d11 = evalCell(m, i, j, lu1, lv1);
          const uv00: [number, number] = [gU(lu0), gV(lv0)], uv01: [number, number] = [gU(lu1), gV(lv0)];
          const uv10: [number, number] = [gU(lu0), gV(lv1)], uv11: [number, number] = [gU(lu1), gV(lv1)];
          const m00 = toMap(d00), m01 = toMap(d01), m10 = toMap(d10), m11 = toMap(d11);
          rasterTri(m00, m10, m11, uv00, uv10, uv11, d00, d10, d11);
          rasterTri(m00, m11, m01, uv00, uv11, uv01, d00, d11, d01);
        }
      }
    }
  }

  // Hole-fill: rachaduras/dobras deixam texels internos sem cobertura. Se virassem 128
  // (neutro) criariam um degrau = smear. Preenche SÓ buracos internos (cercados de malha)
  // pelos vizinhos cobertos; o exterior do quad fica neutro (arte é transparente lá).
  fillInteriorHoles(Ox, Oy, cov, MW, MH);

  // escala = maior offset (px) → resolução do byte (+5% de headroom anti-clip)
  let scale = 1;
  for (let i = 0; i < Ox.length; i++) { const a = Math.abs(Ox[i]), b = Math.abs(Oy[i]); if (a > scale) scale = a; if (b > scale) scale = b; }
  scale = Math.ceil(scale * 1.05);

  const buf = Buffer.alloc(MW * MH * 4);
  for (let i = 0; i < MW * MH; i++) {
    const o = i * 4;
    if (cov[i]) {
      buf[o] = clamp8(NEUTRAL + (Ox[i] / scale) * SPAN);
      buf[o + 1] = clamp8(NEUTRAL + (Oy[i] / scale) * SPAN);
    } else { buf[o] = NEUTRAL; buf[o + 1] = NEUTRAL; }
    buf[o + 2] = NEUTRAL; buf[o + 3] = 255;
  }

  const png = await sharp(buf, { raw: { width: MW, height: MH, channels: 4 } }).png().toBuffer();
  return { png, dispScale: scale, width: MW, height: MH, offsetX: minX, offsetY: minY };
}

const clamp8 = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

/**
 * Preenche buracos INTERNOS de cobertura (cov==0 não conectados à borda do mapa) com a
 * média dos vizinhos cobertos, iterando até fechar. Texels externos (conectados à borda)
 * ficam intactos → continuam neutros no encode. Custo: O(MW·MH) + poucas passadas (buracos
 * internos são pequenos). Evita degraus de displacement em rachaduras de triângulo / dobras.
 */
function fillInteriorHoles(Ox: Float32Array, Oy: Float32Array, cov: Uint8Array, W: number, H: number): void {
  // 1) marca exterior por flood-fill de cov==0 a partir das bordas
  const ext = new Uint8Array(W * H);
  const stack: number[] = [];
  const pushIfHole = (x: number, y: number) => {
    const i = y * W + x;
    if (!cov[i] && !ext[i]) { ext[i] = 1; stack.push(i); }
  };
  for (let x = 0; x < W; x++) { pushIfHole(x, 0); pushIfHole(x, H - 1); }
  for (let y = 0; y < H; y++) { pushIfHole(0, y); pushIfHole(W - 1, y); }
  while (stack.length) {
    const i = stack.pop() as number; const x = i % W, y = (i - x) / W;
    if (x > 0) pushIfHole(x - 1, y);
    if (x < W - 1) pushIfHole(x + 1, y);
    if (y > 0) pushIfHole(x, y - 1);
    if (y < H - 1) pushIfHole(x, y + 1);
  }
  // 2) dilata cobertura nos buracos internos (cov==0 && !ext) até fechar
  const work = new Uint8Array(cov); // cobertura "móvel"
  let remaining = 0;
  for (let i = 0; i < W * H; i++) if (!cov[i] && !ext[i]) remaining++;
  let guard = W + H + 4;
  while (remaining > 0 && guard-- > 0) {
    let filledThisPass = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (work[i] || ext[i]) continue; // já coberto ou exterior
        let sx = 0, sy = 0, n = 0;
        if (x > 0 && work[i - 1]) { sx += Ox[i - 1]; sy += Oy[i - 1]; n++; }
        if (x < W - 1 && work[i + 1]) { sx += Ox[i + 1]; sy += Oy[i + 1]; n++; }
        if (y > 0 && work[i - W]) { sx += Ox[i - W]; sy += Oy[i - W]; n++; }
        if (y < H - 1 && work[i + W]) { sx += Ox[i + W]; sy += Oy[i + W]; n++; }
        if (n > 0) { Ox[i] = sx / n; Oy[i] = sy / n; cov[i] = 1; filledThisPass++; }
      }
    }
    if (!filledThisPass) break;
    work.set(cov);
    remaining -= filledThisPass;
  }
}

/**
 * Field de displacement (PNG R=X,G=Y,128=neutro) com bbox no canvas-pai.
 * `offsetX/Y` = origem do field em coords do canvas; `w/h` = dimensões do field.
 */
export interface DispField {
  png: Buffer; w: number; h: number; scale: number;
  offsetX?: number; offsetY?: number;
}

/**
 * **Composição inteligente** de N fields de displacement num canvas (W×H): soma os
 * offsets (em px reais) de cada field na sua posição (offsetX/Y) e renormaliza. É o
 * que permite **malha (macro) + relevo do material (micro) trabalharem juntos** —
 * sem um sobrescrever o outro. Skipa pixels fora do bbox de cada field.
 *
 * IMPORTANTE: para o engine, W×H DEVE ser o espaço do faceCanvas (bbox do quad) e os
 * fields devem viver nesse mesmo espaço (offset 0). Compor em canvas-inteiro e deixar o
 * engine esticar = o bug do smear. Ver docs/PLAN-displacement-pixel-perfect.md.
 */
export async function composeDispFields(
  fields: DispField[], W: number, H: number,
): Promise<DispField> {
  const fx = new Float32Array(W * H), fy = new Float32Array(W * H);
  for (const f of fields) {
    if (f.scale <= 0) continue;
    const ox = Math.round(f.offsetX ?? 0), oy = Math.round(f.offsetY ?? 0);
    // resample do field pro tamanho declarado (caso o PNG venha em outra res). Mantém o
    // alpha: texel com alpha 0 = "sem dado" (ex.: fora do quad no mapa de relevo da foto)
    // → não soma offset, em vez de injetar o preto (0,0) = −scale como deslocamento falso.
    const { data, info } = await sharp(f.png).ensureAlpha().resize(f.w, f.h, { kernel: "lanczos3" }).raw().toBuffer({ resolveWithObject: true });
    const ch = info.channels; // 4 (RGBA)
    for (let y = 0; y < f.h; y++) {
      const ty = y + oy; if (ty < 0 || ty >= H) continue;
      for (let x = 0; x < f.w; x++) {
        const tx = x + ox; if (tx < 0 || tx >= W) continue;
        const o = (y * f.w + x) * ch;
        if (data[o + 3] < 128) continue; // sem dado → neutro
        const dx = ((data[o] - NEUTRAL) / SPAN) * f.scale;
        const dy = ((data[o + 1] - NEUTRAL) / SPAN) * f.scale;
        const idx = ty * W + tx; fx[idx] += dx; fy[idx] += dy;
      }
    }
  }
  let max = 1;
  for (let i = 0; i < W * H; i++) { const m = Math.max(Math.abs(fx[i]), Math.abs(fy[i])); if (m > max) max = m; }
  const scale = Math.ceil(max * 1.05);
  const out = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const o = i * 4;
    out[o] = clamp8(NEUTRAL + (fx[i] / scale) * SPAN);
    out[o + 1] = clamp8(NEUTRAL + (fy[i] / scale) * SPAN);
    out[o + 2] = NEUTRAL; out[o + 3] = 255;
  }
  const png = await sharp(out, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
  return { png, w: W, h: H, scale, offsetX: 0, offsetY: 0 };
}
