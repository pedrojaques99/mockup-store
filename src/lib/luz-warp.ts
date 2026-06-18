/**
 * luz-warp — homografia projetiva (DLT) pro PREVIEW da Luz com warp de perspectiva.
 * Espelha 1:1 a matemática do `perspectiveWarp` do @visant/psd-engine (que roda no
 * render server-side): mesmos 4 cantos → mesma deformação. Aqui produzimos a string
 * CSS `matrix3d` que mapeia o retângulo do elemento (0,0)-(w,h) pro quad de destino.
 */
export interface Pt { x: number; y: number }

/** Homografia 3×3 (DLT) que leva src[i] → dst[i]. Retorna [a,b,c,d,e,f,g,h,i] (i=1). */
function homography(src: Pt[], dst: Pt[]): number[] {
  const M: number[][] = [];
  for (let k = 0; k < 4; k++) {
    const { x, y } = src[k];
    const { x: xp, y: yp } = dst[k];
    M.push([x, y, 1, 0, 0, 0, -xp * x, -xp * y, xp]);
    M.push([0, 0, 0, x, y, 1, -yp * x, -yp * y, yp]);
  }
  const n = 8;
  for (let col = 0; col < n; col++) {
    let maxRow = col, maxVal = Math.abs(M[col][col]);
    for (let row = col + 1; row < n; row++) {
      const v = Math.abs(M[row][col]);
      if (v > maxVal) { maxVal = v; maxRow = row; }
    }
    [M[col], M[maxRow]] = [M[maxRow], M[col]];
    const pivot = M[col][col];
    if (Math.abs(pivot) < 1e-12) continue;
    for (let row = col + 1; row < n; row++) {
      const f = M[row][col] / pivot;
      for (let kk = col; kk <= n; kk++) M[row][kk] -= f * M[col][kk];
    }
  }
  const h = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    h[i] = M[i][n];
    for (let j = i + 1; j < n; j++) h[i] -= M[i][j] * h[j];
    h[i] /= M[i][i];
  }
  return [...h, 1]; // [a,b,c, d,e,f, g,h, i=1]
}

/** CSS `matrix3d` (column-major) que warpa o retângulo (0,0)-(w,h) nos 4 cantos dst (TL,TR,BR,BL). */
export function quadToMatrix3d(w: number, h: number, dst: [Pt, Pt, Pt, Pt]): string {
  const H = homography(
    [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }],
    dst,
  );
  const [a, b, c, d, e, f, g, hh, i] = H;
  // matrix3d col-major: (m11,m12,m13,m14, m21,...). z é identidade.
  return `matrix3d(${a},${d},0,${g}, ${b},${e},0,${hh}, 0,0,1,0, ${c},${f},0,${i})`;
}
