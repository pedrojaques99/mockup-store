/**
 * material-fx — overlays procedurais de material/pós-edit para a superfície calibrada.
 *
 * Determinístico (sharp + math por pixel, sem IA, sem deps): gera uma camada RGBA
 * recortada ao quad que, sobreposta à cena com o blend certo, simula o material:
 *   - fabric  : trama + grão suave           (blend: overlay)
 *   - metal   : escovado anisotrópico + brilho (blend: soft-light)
 *   - glass   : faixas especulares diagonais   (blend: screen)
 *   - worn    : sujeira/granulado escuro       (blend: multiply)
 *   - shadow  : sombra projetada de uma borda  (blend: multiply)
 *
 * Para IA (transferir textura real de tecido/metal etc.) o hook é o pipeline de
 * inpaint já existente (FLUX/Visant em /api/photo-mockup/[id]/ai-edit) — fica como
 * caminho alternativo; aqui é o procedural barato.
 */
import sharp from "sharp";
import type { QuadCorners } from "./key-color-core";

export type MaterialKind = "none" | "fabric" | "metal" | "glass" | "worn" | "shadow";

export const MATERIAL_BLEND: Record<MaterialKind, string> = {
  none: "normal", fabric: "overlay", metal: "soft-light", glass: "screen", worn: "multiply", shadow: "multiply",
};

/** hash determinístico → [0,1) (sem Math.random, reprodutível p/ cache). */
function hash(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) >>> 0;
  h = (h ^ (h >>> 13)) * 1274126177 >>> 0;
  return (h >>> 0) / 4294967296;
}

/** Ponto dentro do quad convexo (mesmo sinal em todas as arestas). */
function inQuad(px: number, py: number, q: QuadCorners): boolean {
  const pts = [q.tl, q.tr, q.br, q.bl];
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = pts[i], b = pts[(i + 1) % 4];
    const d = (b.x - a.x) * (py - a.y) - (b.y - a.y) * (px - a.x);
    if (d !== 0) { const s = d > 0 ? 1 : -1; if (sign === 0) sign = s; else if (s !== sign) return false; }
  }
  return true;
}

const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v | 0);

export interface MaterialOpts {
  material: MaterialKind;
  /** 0..1 — força do efeito. */
  intensity?: number;
  /** graus — direção (escovado do metal, faixa do vidro, sombra projetada). */
  angle?: number;
  /** escala do padrão (px). */
  scale?: number;
}

/**
 * Gera o overlay RGBA (PNG) do material, recortado ao quad. Transparente fora.
 * Combine na UI/engine com MATERIAL_BLEND[material].
 */
export async function buildMaterialOverlay(
  width: number,
  height: number,
  quad: QuadCorners,
  opts: MaterialOpts,
): Promise<Buffer> {
  const { material, intensity = 0.5, angle = 35, scale = 6 } = opts;
  const out = Buffer.alloc(width * height * 4, 0);
  if (material === "none") return sharp(out, { raw: { width, height, channels: 4 } }).png().toBuffer();

  const rad = (angle * Math.PI) / 180;
  const ca = Math.cos(rad), sa = Math.sin(rad);
  // bbox do quad p/ normalizar a sombra projetada
  const xs = [quad.tl.x, quad.tr.x, quad.br.x, quad.bl.x];
  const ys = [quad.tl.y, quad.tr.y, quad.br.y, quad.bl.y];
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const projMin = minX * ca + minY * sa, projMax = maxX * ca + maxY * sa;
  const projRange = Math.max(1, projMax - projMin);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!inQuad(x, y, quad)) continue;
      const o = (y * width + x) * 4;
      let r = 128, g = 128, b = 128, a = 0;

      switch (material) {
        case "fabric": {
          const weave = Math.sin(x / scale) * Math.sin(y / scale) * 26;
          const grain = (hash(x, y) - 0.5) * 34;
          const v = clamp255(128 + (weave + grain) * intensity);
          r = g = b = v; a = 255;
          break;
        }
        case "metal": {
          // escovado: variação alta na direção transversal ao ângulo, baixa ao longo
          const along = x * ca + y * sa, across = -x * sa + y * ca;
          const streak = (hash(Math.round(across / 1.2), Math.round(along / 18)) - 0.5) * 70;
          const sheen = Math.sin((along / projRange) * Math.PI) * 22;
          const v = clamp255(128 + (streak + sheen) * intensity);
          r = g = b = v; a = 255;
          break;
        }
        case "glass": {
          const t = (x * ca + y * sa) / (scale * 14);
          const f = Math.abs(((t % 1) + 1) % 1 - 0.5);  // distância à faixa
          const band = Math.max(0, 1 - f * 6);          // pico fino e brilhante
          r = g = b = 255; a = clamp255(band * 200 * intensity);
          break;
        }
        case "worn": {
          const n = hash(x, y);
          const grime = n > 0.86 ? (n - 0.86) / 0.14 : 0;
          r = g = b = 30; a = clamp255(grime * 230 * intensity);
          break;
        }
        case "shadow": {
          const d = ((x * ca + y * sa) - projMin) / projRange; // 0..1 ao longo da direção
          const dark = Math.pow(Math.max(0, 1 - d), 1.4);      // mais forte na borda de origem
          r = g = b = 0; a = clamp255(dark * 200 * intensity);
          break;
        }
      }
      out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = a;
    }
  }

  return sharp(out, { raw: { width, height, channels: 4 } }).png().toBuffer();
}
