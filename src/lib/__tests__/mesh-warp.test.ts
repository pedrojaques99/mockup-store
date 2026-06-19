import { describe, it, expect } from "vitest";
import sharp from "sharp";
import {
  generateMeshDisplacement, composeDispFields, defaultMesh, meshCorners,
  type WarpMesh,
} from "../mesh-warp";
import { applyDispToMesh, meshFromDepth, clampMeshFolds } from "../mesh-core";
import type { QuadCorners, Pt } from "../key-color-core";

const sq = (s: number): QuadCorners => ({ tl: { x: 0, y: 0 }, tr: { x: s, y: 0 }, br: { x: s, y: s }, bl: { x: 0, y: s } });
const signedTri = (a: Pt, b: Pt, c: Pt) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

async function decode(png: Buffer): Promise<{ w: number; h: number; data: Buffer }> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { w: info.width, h: info.height, data };
}
/** Decodifica (dx,dy) px no texel (x,y) com a MESMA fórmula do engine (constante 128). */
function sampleOffset(d: { w: number; data: Buffer }, scale: number, x: number, y: number): [number, number] {
  const o = (y * d.w + x) * 4;
  return [((d.data[o] - 128) / 128) * scale, ((d.data[o + 1] - 128) / 128) * scale];
}
/** PNG RGBA uniforme. */
async function uniform(w: number, h: number, r: number, g: number, b: number, a: number): Promise<Buffer> {
  const buf = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) { const o = i * 4; buf[o] = r; buf[o + 1] = g; buf[o + 2] = b; buf[o + 3] = a; }
  return sharp(buf, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
}

describe("generateMeshDisplacement — espaço do faceCanvas + encode 128", () => {
  it("malha regular ⇒ field neutro (≤0.5px) — identidade", async () => {
    const q = sq(120);
    const m = defaultMesh(q, 3, 3);
    const md = await generateMeshDisplacement(m, { maxRes: 4096 });
    expect(md).not.toBeNull();
    const d = await decode(md!.png);
    let maxOff = 0;
    for (let y = 0; y < d.h; y++) for (let x = 0; x < d.w; x++) {
      const [dx, dy] = sampleOffset(d, md!.dispScale, x, y);
      maxOff = Math.max(maxOff, Math.abs(dx), Math.abs(dy));
    }
    expect(maxOff).toBeLessThanOrEqual(0.5);
  });

  it("dimensão = bbox do QUAD, não da malha (nó interno abaulando pra fora não muda dim)", async () => {
    const q = sq(120);
    const m = defaultMesh(q, 3, 3);
    // empurra o nó central MUITO pra fora do quad (mesh bbox >> quad bbox)
    const warped: WarpMesh = { ...m, points: m.points.slice() };
    warped.points[4] = { x: 300, y: 60 };
    const md = await generateMeshDisplacement(warped, { maxRes: 4096, quad: q });
    expect(md!.width).toBe(120);   // == ceil(quad bbox), NÃO 300
    expect(md!.height).toBe(120);
    expect(md!.offsetX).toBe(0);
    expect(md!.offsetY).toBe(0);
  });

  it("cantos coincidem (quad==mesh corners) ⇒ deslocamento ~0 nos cantos do field", async () => {
    const q = sq(100);
    const m = defaultMesh(q, 3, 3);
    m.points[4] = { x: 60, y: 40 }; // bow interno
    const md = await generateMeshDisplacement(m, { maxRes: 4096, quad: q });
    const d = await decode(md!.png);
    for (const [x, y] of [[0, 0], [d.w - 1, 0], [0, d.h - 1], [d.w - 1, d.h - 1]] as const) {
      const [dx, dy] = sampleOffset(d, md!.dispScale, x, y);
      expect(Math.hypot(dx, dy)).toBeLessThanOrEqual(2);
    }
  });
});

describe("composeDispFields — face-space + alpha-aware", () => {
  it("texel com alpha 0 = sem dado ⇒ não injeta offset falso", async () => {
    const A = await uniform(8, 8, 200, 128, 128, 255); // dx>0 uniforme
    const B = await uniform(8, 8, 0, 0, 0, 0);          // alpha 0 → deve ser ignorado
    const out = await composeDispFields([
      { png: A, w: 8, h: 8, scale: 10, offsetX: 0, offsetY: 0 },
      { png: B, w: 8, h: 8, scale: 10, offsetX: 0, offsetY: 0 },
    ], 8, 8);
    const d = await decode(out.png);
    const [dx] = sampleOffset(d, out.scale, 4, 4);
    // só A contribui: ~ ((200-128)/128)*10 = 5.625 (positivo). Se B entrasse seria negativo.
    expect(dx).toBeGreaterThan(3);
  });

  it("soma os offsets de dois fields (px reais)", async () => {
    const A = await uniform(8, 8, 160, 128, 128, 255); // (160-128)/128*10 = 2.5
    const B = await uniform(8, 8, 160, 128, 128, 255); // idem
    const out = await composeDispFields([
      { png: A, w: 8, h: 8, scale: 10, offsetX: 0, offsetY: 0 },
      { png: B, w: 8, h: 8, scale: 10, offsetX: 0, offsetY: 0 },
    ], 8, 8);
    const d = await decode(out.png);
    const [dx] = sampleOffset(d, out.scale, 4, 4);
    expect(dx).toBeCloseTo(5, 0); // 2.5 + 2.5
  });
});

describe("mesh-core — clamp por-nó, anti-fold, depth robusto", () => {
  const allCellsConsistent = (m: WarpMesh): boolean => {
    const { rows, cols } = m; const P = (i: number, j: number) => m.points[i * cols + j];
    const q = meshCorners(m); const expSign = Math.sign(signedTri(q.tl, q.tr, q.br));
    for (let i = 0; i < rows - 1; i++) for (let j = 0; j < cols - 1; j++) {
      const p00 = P(i, j), p01 = P(i, j + 1), p10 = P(i + 1, j), p11 = P(i + 1, j + 1);
      for (const [a, b, c] of [[p00, p01, p11], [p00, p11, p10], [p00, p01, p10], [p01, p11, p10]] as const) {
        const s = signedTri(a, b, c);
        if (s === 0 || Math.sign(s) !== expSign) return false;
      }
    }
    return true;
  };

  it("clampMeshFolds desfaz dobra (nó interno empurrado além do vizinho)", () => {
    const m = defaultMesh(sq(100), 3, 3);
    m.points[4] = { x: -40, y: 50 }; // centro à ESQUERDA da coluna esquerda → bowtie
    expect(allCellsConsistent(m)).toBe(false);
    const fixed = clampMeshFolds(m);
    expect(allCellsConsistent(fixed)).toBe(true);
  });

  it("applyDispToMesh limita o movimento do nó (~0.45 da célula) mesmo com sampler-outlier", () => {
    const m = defaultMesh(sq(100), 3, 3); // célula central ≈ 50px → cap ≈ 22.5
    const out = applyDispToMesh(m, () => [1000, 0], 1); // outlier gigante
    const c = out.points[4];
    expect(c.x).toBeGreaterThan(60);
    expect(c.x).toBeLessThanOrEqual(74); // 50 + ~22.5, nunca voa pra 1050
    expect(allCellsConsistent(out)).toBe(true);
  });

  it("meshFromDepth: outlier de 1 pixel não voa nó; sem fold", () => {
    const m = defaultMesh(sq(200), 5, 5);
    // depth 0.5 em tudo, exceto um spike 1.0 perto de um nó interno
    const sampler = (x: number, y: number) => (Math.abs(x - 100) < 6 && Math.abs(y - 100) < 6 ? 1.0 : 0.5);
    const out = meshFromDepth(m, sampler, 40);
    for (let k = 0; k < out.points.length; k++) {
      const moved = Math.hypot(out.points[k].x - m.points[k].x, out.points[k].y - m.points[k].y);
      expect(moved).toBeLessThanOrEqual(40); // cap por-nó (célula 50px → ~22.5) com folga
    }
    expect(allCellsConsistent(out)).toBe(true);
  });
});
