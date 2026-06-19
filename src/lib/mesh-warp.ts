/**
 * mesh-warp — malha de warp estilo Photoshop "Warp"/Envelope (grade Coons/bilinear).
 *
 * Não reinventa o warp: gera um DISPLACEMENT FIELD (R=X, G=Y, 128=neutro) que o
 * `@visant/psd-engine` já aplica nativamente (applyDisplacementFilter = Displace do PS).
 * A arte é warpada no quad-base (4 cantos = cantos da malha) e o campo desloca o
 * interior pra seguir os pontos de controle → superfície que abaula (ex.: placa sobre
 * acolchoado), impossível com 4 cantos.
 *
 * Campo: para cada pixel de saída na posição da malha, d = quad_pos(u,v) − mesh_pos(u,v),
 * pois o Displace faz out(p) = src(p + d). Rasterizado por célula (2 triângulos,
 * baricêntrico) — grade regular, sem dependência externa.
 */
import sharp from "sharp";
import type { Pt } from "./key-color-core";
import { bilinearQuad, meshCorners, evalCell, type WarpMesh } from "./mesh-core";
export { bilinearQuad, meshCorners, defaultMesh, meshIsWarped, evalCell, ensureTangents, type WarpMesh } from "./mesh-core";

/**
 * Gera o displacement field PNG (R=X,G=Y,128=neutro) que reproduz a malha no engine.
 * Retorna { png, dispScale } — passe dispScale como face.dispScale.
 */
export async function generateMeshDisplacement(
  m: WarpMesh,
  opts: { maxRes?: number } = {},
): Promise<{ png: Buffer; dispScale: number; width: number; height: number; offsetX: number; offsetY: number } | null> {
  const { rows, cols, points } = m;
  if (rows < 2 || cols < 2 || points.length !== rows * cols) return null;
  const q = meshCorners(m);

  // bbox do quad (= região do faceCanvas no engine)
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  const outW = Math.max(1, Math.ceil(Math.max(...xs) - minX));
  const outH = Math.max(1, Math.ceil(Math.max(...ys) - minY));

  // resolução do mapa (campo é suave → baixa-res + stretch bilinear do engine basta)
  const maxRes = opts.maxRes ?? 256;
  const longest = Math.max(outW, outH);
  const s = longest > maxRes ? maxRes / longest : 1;
  const MW = Math.max(2, Math.round(outW * s)), MH = Math.max(2, Math.round(outH * s));
  const sx = MW / outW, sy = MH / outH; // doc-local → map

  const Ox = new Float32Array(MW * MH), Oy = new Float32Array(MW * MH);
  const cov = new Uint8Array(MW * MH);

  // ponto de controle k → (u,v) na grade + posição no quad regular
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
  const SUB = m.tangents ? 6 : 1;
  const toMap = (p: Pt): Pt => ({ x: (p.x - minX) * sx, y: (p.y - minY) * sy });
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

  // escala = maior offset (px) → resolução do byte
  let scale = 1;
  for (let i = 0; i < Ox.length; i++) { const a = Math.abs(Ox[i]), b = Math.abs(Oy[i]); if (a > scale) scale = a; if (b > scale) scale = b; }
  scale = Math.ceil(scale * 1.05);

  const buf = Buffer.alloc(MW * MH * 4);
  for (let i = 0; i < MW * MH; i++) {
    const o = i * 4;
    if (cov[i]) {
      buf[o] = Math.max(0, Math.min(255, Math.round(128 + (Ox[i] / scale) * 127)));
      buf[o + 1] = Math.max(0, Math.min(255, Math.round(128 + (Oy[i] / scale) * 127)));
    } else { buf[o] = 128; buf[o + 1] = 128; }
    buf[o + 2] = 128; buf[o + 3] = 255;
  }

  const png = await sharp(buf, { raw: { width: MW, height: MH, channels: 4 } }).png().toBuffer();
  return { png, dispScale: scale, width: MW, height: MH, offsetX: minX, offsetY: minY };
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
 */
export async function composeDispFields(
  fields: DispField[], W: number, H: number,
): Promise<DispField> {
  const fx = new Float32Array(W * H), fy = new Float32Array(W * H);
  for (const f of fields) {
    if (f.scale <= 0) continue;
    const ox = Math.round(f.offsetX ?? 0), oy = Math.round(f.offsetY ?? 0);
    // resample do field pro tamanho declarado (caso o PNG venha em outra res)
    const { data, info } = await sharp(f.png).removeAlpha().resize(f.w, f.h, { kernel: "lanczos3" }).raw().toBuffer({ resolveWithObject: true });
    const ch = info.channels;
    for (let y = 0; y < f.h; y++) {
      const ty = y + oy; if (ty < 0 || ty >= H) continue;
      for (let x = 0; x < f.w; x++) {
        const tx = x + ox; if (tx < 0 || tx >= W) continue;
        const o = (y * f.w + x) * ch;
        const dx = ((data[o] - 128) / 127) * f.scale;
        const dy = ((data[o + 1] - 128) / 127) * f.scale;
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
    out[o] = Math.max(0, Math.min(255, Math.round(128 + (fx[i] / scale) * 127)));
    out[o + 1] = Math.max(0, Math.min(255, Math.round(128 + (fy[i] / scale) * 127)));
    out[o + 2] = 128; out[o + 3] = 255;
  }
  const png = await sharp(out, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
  return { png, w: W, h: H, scale, offsetX: 0, offsetY: 0 };
}
