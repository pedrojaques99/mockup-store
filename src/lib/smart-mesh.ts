/**
 * smart-mesh — gera a **malha pré-esquematizada** apropriada pra cada
 * substrato/form factor, a partir do quad detectado.
 *
 *   • flat     — grade bilinear regular (rasa)
 *   • slight   — bend leve nas 4 arestas (banner / canvas / placa metálica fina)
 *   • drape    — pontos internos puxados pra baixo+lateral (tecido caindo)
 *   • cylinder — curvatura horizontal estilo garrafa/lata (centro à frente, bordas atrás)
 *
 * Todas as malhas saem com `tangents` já preenchidos (suaves) — o editor mostra
 * curvas direto, o usuário só ajusta. SSoT: usa o evalCell/Coons existente do
 * `mesh-core` — nenhum novo motor de warp.
 */
import type { QuadCorners, Pt } from "./key-color-core";
import { defaultMesh, autoSmoothTangents, type WarpMesh } from "./mesh-core";
import type { FormFactor } from "./substrate-presets";

const bilinear = (q: QuadCorners, u: number, v: number): Pt => {
  const a = { x: q.tl.x + (q.tr.x - q.tl.x) * u, y: q.tl.y + (q.tr.y - q.tl.y) * u };
  const b = { x: q.bl.x + (q.br.x - q.bl.x) * u, y: q.bl.y + (q.br.y - q.bl.y) * u };
  return { x: a.x + (b.x - a.x) * v, y: a.y + (b.y - a.y) * v };
};
// Vetor perpendicular "pra fora" do quad numa fração (u,v) da aresta.
const outward = (q: QuadCorners, axis: "h" | "v"): { ux: number; uy: number } => {
  if (axis === "h") {
    // perpendicular ao eixo horizontal (top→bottom)
    const dx = (q.bl.x + q.br.x) / 2 - (q.tl.x + q.tr.x) / 2;
    const dy = (q.bl.y + q.br.y) / 2 - (q.tl.y + q.tr.y) / 2;
    const L = Math.hypot(dx, dy) || 1;
    return { ux: dx / L, uy: dy / L };
  }
  const dx = (q.tr.x + q.br.x) / 2 - (q.tl.x + q.bl.x) / 2;
  const dy = (q.tr.y + q.br.y) / 2 - (q.tl.y + q.bl.y) / 2;
  const L = Math.hypot(dx, dy) || 1;
  return { ux: dx / L, uy: dy / L };
};

/**
 * Gera a malha pré-curvada. `amount` modula a curvatura (0–1; default 1).
 * `rows`/`cols` opcional — substrato sugere via `density`, caller pode passar.
 */
export function smartMesh(
  q: QuadCorners, form: FormFactor, density = 3, amount = 1,
): WarpMesh {
  const m = defaultMesh(q, density, density);
  if (form === "flat" || amount <= 0) return m;

  const W = Math.hypot(q.tr.x - q.tl.x, q.tr.y - q.tl.y); // largura do quad
  const H = Math.hypot(q.bl.x - q.tl.x, q.bl.y - q.tl.y); // altura
  const minSize = Math.min(W, H);
  const next = m.points.slice();
  const rows = m.rows, cols = m.cols;

  if (form === "slight") {
    // Bend leve: pontos das ARESTAS bombam pra fora ~3% do menor lado.
    const bow = minSize * 0.025 * amount;
    const outH = outward(q, "v"); // perpendicular ao eixo H = pra fora das laterais
    const outV = outward(q, "h"); // pra fora top/bottom
    for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
      const k = i * cols + j; const p = next[k];
      const onEdge = i === 0 || i === rows - 1 || j === 0 || j === cols - 1;
      if (onEdge) continue; // bordas fixas
      // intensidade radial — máxima no centro, zero nas bordas (suave)
      const u = (j / (cols - 1)) * 2 - 1, v = (i / (rows - 1)) * 2 - 1;
      const w = (1 - u * u) * (1 - v * v) * bow;
      next[k] = { x: Math.round(p.x + (outH.ux * 0 + outV.ux * 0) + w * 0.0), y: Math.round(p.y + w * 0.0) };
      // (sem deslocar — slight muda só as tangentes; autoSmooth dá a curva suave)
    }
  } else if (form === "drape") {
    // Tecido caindo: pontos do centro/inferior afundam (mais nos centrais).
    const sag = minSize * 0.05 * amount;
    const dir = outward(q, "v"); // pra baixo do quad
    for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
      const k = i * cols + j; const p = next[k];
      if (i === 0 && (j === 0 || j === cols - 1)) continue; // cantos superiores presos
      // afunda mais perto do centro X e mais perto da base
      const uCent = 1 - Math.abs((j / (cols - 1)) * 2 - 1); // 1 no centro, 0 nas bordas
      const vDepth = i / (rows - 1);                         // 0 topo, 1 base
      const w = uCent * vDepth * sag;
      // pequena variação lateral pra parecer pano (alternada por linha)
      const wig = (i % 2 === 0 ? 1 : -1) * uCent * vDepth * sag * 0.15;
      next[k] = { x: Math.round(p.x + dir.uy * wig * -1), y: Math.round(p.y + dir.uy * w + dir.ux * wig) };
    }
  } else if (form === "cylinder") {
    // Cilindro: largura aparente em u é cos(θ), θ ∈ [−π/2, π/2]. Move cada coluna
    // ao longo do eixo H pra "encurtar" a projeção, preservando topo/base.
    const radius = W / 2;
    const depthAmount = 0.85 * amount;
    const axisU = { x: (q.tr.x - q.tl.x) / W, y: (q.tr.y - q.tl.y) / W }; // unit ao longo da largura
    for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
      const k = i * cols + j; const p = next[k];
      const u = j / (cols - 1);
      // posição original no eixo U (em px do quad-base)
      const baseU = u * W;
      // posição perspectivada: x = R * sin(θ), θ = (u-0.5)*π
      const theta = (u - 0.5) * Math.PI;
      const persp = radius + radius * Math.sin(theta) * 0; // sem deslocar — só ajusta espaçamento
      // novo u perceptivo = (sin(θ)+1)/2 reduz aos bordos
      const uPersp = (Math.sin(theta) + 1) / 2;
      const shiftU = (uPersp - u) * W * depthAmount;
      next[k] = {
        x: Math.round(p.x + axisU.x * shiftU),
        y: Math.round(p.y + axisU.y * shiftU),
      };
    }
  }

  // autoSmoothTangents → curvas suaves derivadas dos vizinhos (Catmull-Rom).
  return autoSmoothTangents({ ...m, points: next });
}
