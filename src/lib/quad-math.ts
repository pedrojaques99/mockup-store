/**
 * Geometria do quad: conversão de espaço e geometria de aresta.
 *
 * Isto morava inline no `QuadEditor.tsx` — matemática de coordenada dentro de um
 * componente de canvas, sem um único teste. É o pior lugar possível para ela:
 * erro de sinal ou de escala aqui não quebra nada, não estoura exceção e não
 * aparece em `tsc`. Ele desalinha a arte renderizada em silêncio, e a descoberta
 * é alguém abrindo o PNG semanas depois e achando que "o mockup ficou torto".
 *
 * Aqui é função pura: entra número, sai número, e o teste vermelho chega antes do
 * PNG torto. Ver `src/lib/__tests__/quad-math.test.ts`.
 */
import type { Pt, QuadCorners } from "./key-color-core";

/**
 * Transformada afim entre o espaço da IMAGEM (pixels do arquivo) e o espaço do
 * CANVAS de desenho. `s` é escala por eixo, `o` é a origem da imagem dentro do
 * canvas — o canvas é maior que a imagem de propósito, para o quad poder vazar
 * das bordas sem ser cortado pelo buffer.
 */
export interface CanvasFit {
  sx: number;
  sy: number;
  ox: number;
  oy: number;
}

/** Fração de folga em cada lado do canvas, relativa ao tamanho da imagem. */
export interface CanvasBox extends CanvasFit {
  /** tamanho lógico do canvas, em CSS px */
  cw: number;
  ch: number;
  padX: number;
  padY: number;
}

/**
 * Calcula a caixa do canvas e a transformada, a partir do tamanho de LAYOUT da
 * imagem (`iw`/`ih`) e do tamanho natural do arquivo (`nw`/`nh`).
 *
 * O tamanho de layout é `offsetWidth`, nunca `getBoundingClientRect`: o segundo
 * já reflete o transform CSS do `ZoomPanViewer` e faria o canvas escalar duas
 * vezes. Medindo o layout, canvas e alças escalam JUNTO com o transform e ficam
 * sempre alinhados.
 */
export function fitCanvasToImage(iw: number, ih: number, nw: number, nh: number, pad: number): CanvasBox {
  const padX = Math.round(iw * pad);
  const padY = Math.round(ih * pad);
  return {
    sx: nw > 0 ? iw / nw : 1,
    sy: nh > 0 ? ih / nh : 1,
    ox: padX,
    oy: padY,
    padX,
    padY,
    cw: iw + padX * 2,
    ch: ih + padY * 2,
  };
}

/** Ponto do espaço da imagem para o espaço do canvas. */
export function imageToCanvas(p: Pt, f: CanvasFit): Pt {
  return { x: p.x * f.sx + f.ox, y: p.y * f.sy + f.oy };
}

/** Inversa de `imageToCanvas`. Escala zero devolve a origem em vez de `Infinity`. */
export function canvasToImage(p: Pt, f: CanvasFit): Pt {
  return {
    x: f.sx !== 0 ? (p.x - f.ox) / f.sx : 0,
    y: f.sy !== 0 ? (p.y - f.oy) / f.sy : 0,
  };
}

/** Retângulo do elemento na tela, no formato que o DOM devolve. */
export interface ScreenRect { left: number; top: number; width: number; height: number }

/**
 * Ponto de tela (clientX/clientY) para o espaço da imagem.
 *
 * Aqui o rect VIVO é o certo (ao contrário de `fitCanvasToImage`), porque o que
 * se quer é onde o cursor caiu na imagem como ela está desenhada agora, com zoom
 * e tudo. `sc` sai junto: é quantos pixels de imagem cabem num pixel de tela, e
 * serve para converter tolerância de clique — sem ele, a área de acerto de um
 * canto encolhe conforme se dá zoom.
 */
export function clientToImage(
  clientX: number,
  clientY: number,
  r: ScreenRect,
  nw: number,
  nh: number,
): Pt & { sc: number } {
  const sc = r.width > 0 ? nw / r.width : 1;
  return {
    x: r.width > 0 ? ((clientX - r.left) / r.width) * nw : 0,
    y: r.height > 0 ? ((clientY - r.top) / r.height) * nh : 0,
    sc,
  };
}

/** Distância euclidiana. */
export const dist = (p: Pt, q: Pt): number => Math.hypot(p.x - q.x, p.y - q.y);

/** Centro do quad (média dos quatro cantos). */
export function quadCenter(q: QuadCorners): Pt {
  return {
    x: (q.tl.x + q.tr.x + q.br.x + q.bl.x) / 4,
    y: (q.tl.y + q.tr.y + q.br.y + q.bl.y) / 4,
  };
}

/** Lados médios do quad: largura = média das duas horizontais, altura das verticais. */
export function quadDims(q: QuadCorners): { w: number; h: number } {
  return {
    w: (dist(q.tl, q.tr) + dist(q.bl, q.br)) / 2,
    h: (dist(q.tl, q.bl) + dist(q.tr, q.br)) / 2,
  };
}

export type BendKey = "top" | "bottom" | "left" | "right";

export interface EdgeGeometry {
  /** ponto médio da aresta */
  mx: number;
  my: number;
  /** normal unitária, apontando para FORA do quad */
  nx: number;
  ny: number;
  /** dimensão do quad perpendicular à aresta — a régua do abaulamento */
  dim: number;
  /** deslocamento do abaulamento, em pixels de imagem */
  bow: number;
  /** onde desenhar a alça de abaulamento */
  handle: Pt;
}

/**
 * Geometria de uma aresta do quad, em espaço de imagem.
 *
 * A normal é forçada a apontar para fora comparando com o centro: sem isso, a
 * aresta de baixo abaularia para dentro enquanto a de cima abaula para fora, e o
 * mesmo arrasto do mouse daria sentidos opostos dependendo da aresta.
 *
 * O abaulamento é relativo (`bend` × dimensão perpendicular), não absoluto, para
 * a curva ficar igual em qualquer tamanho de superfície.
 */
export function edgeGeometry(
  q: QuadCorners,
  edge: { a: keyof QuadCorners; b: keyof QuadCorners; key: BendKey },
  bend?: Partial<Record<BendKey, number>>,
): EdgeGeometry {
  const a = q[edge.a], b = q[edge.b];
  const c = quadCenter(q);
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;

  let nx = b.y - a.y;
  let ny = -(b.x - a.x);
  const len = Math.hypot(nx, ny) || 1;
  nx /= len;
  ny /= len;
  if ((mx - c.x) * nx + (my - c.y) * ny < 0) { nx = -nx; ny = -ny; }

  const { w, h } = quadDims(q);
  const dim = edge.key === "top" || edge.key === "bottom" ? h : w;
  const bow = (bend?.[edge.key] ?? 0) * dim;

  return { mx, my, nx, ny, dim, bow, handle: { x: mx + nx * bow, y: my + ny * bow } };
}
