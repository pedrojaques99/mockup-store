/**
 * Guarda da geometria do quad.
 *
 * Cada caso aqui é um erro que NÃO estoura em runtime: ele sai como arte torta no
 * PNG e ninguém liga o defeito à causa. Por isso o teste checa sinal, ida e volta
 * e caso degenerado, e não só "roda sem lançar".
 */
import { describe, it, expect } from "vitest";
import {
  fitCanvasToImage,
  imageToCanvas,
  canvasToImage,
  clientToImage,
  quadCenter,
  quadDims,
  edgeGeometry,
  dist,
} from "../quad-math";
import type { QuadCorners } from "../key-color-core";

/** Quad retangular simples, 100×50 na origem (200,100). */
const RET: QuadCorners = {
  tl: { x: 200, y: 100 },
  tr: { x: 300, y: 100 },
  br: { x: 300, y: 150 },
  bl: { x: 200, y: 150 },
};

describe("fitCanvasToImage", () => {
  it("escala pelo tamanho natural e reserva folga dos dois lados", () => {
    const f = fitCanvasToImage(800, 400, 1600, 800, 0.1);
    expect(f.sx).toBe(0.5);
    expect(f.sy).toBe(0.5);
    expect(f.padX).toBe(80);
    expect(f.padY).toBe(40);
    // canvas = imagem + folga dos DOIS lados
    expect(f.cw).toBe(800 + 160);
    expect(f.ch).toBe(400 + 80);
    // a origem da imagem dentro do canvas é a própria folga
    expect(f.ox).toBe(f.padX);
    expect(f.oy).toBe(f.padY);
  });

  it("não divide por zero quando a imagem ainda não tem tamanho natural", () => {
    const f = fitCanvasToImage(800, 400, 0, 0, 0.1);
    expect(Number.isFinite(f.sx)).toBe(true);
    expect(Number.isFinite(f.sy)).toBe(true);
  });

  it("folga zero deixa o canvas do tamanho da imagem", () => {
    const f = fitCanvasToImage(640, 480, 640, 480, 0);
    expect(f.cw).toBe(640);
    expect(f.ch).toBe(480);
    expect(f.ox).toBe(0);
  });
});

describe("imageToCanvas / canvasToImage", () => {
  const f = fitCanvasToImage(800, 400, 1600, 800, 0.1);

  it("ida e volta devolve o ponto de origem", () => {
    for (const p of [{ x: 0, y: 0 }, { x: 1600, y: 800 }, { x: 733, y: 291 }]) {
      const volta = canvasToImage(imageToCanvas(p, f), f);
      expect(volta.x).toBeCloseTo(p.x, 9);
      expect(volta.y).toBeCloseTo(p.y, 9);
    }
  });

  it("a origem da imagem cai na folga, não no canto do canvas", () => {
    // Este é o erro clássico: esquecer o offset e desenhar o quad deslocado da
    // imagem pelo tamanho exato da folga.
    expect(imageToCanvas({ x: 0, y: 0 }, f)).toEqual({ x: 80, y: 40 });
  });

  it("aceita ponto FORA da imagem — o quad pode vazar, é o motivo da folga", () => {
    const c = imageToCanvas({ x: -100, y: -100 }, f);
    expect(c.x).toBe(30);
    expect(c.y).toBe(-10);
  });

  it("escala zero devolve a origem em vez de Infinity", () => {
    const r = canvasToImage({ x: 10, y: 10 }, { sx: 0, sy: 0, ox: 0, oy: 0 });
    expect(r).toEqual({ x: 0, y: 0 });
  });

  it("escala por eixo é independente (imagem não-uniforme não distorce o mapa)", () => {
    const f2 = { sx: 2, sy: 0.5, ox: 0, oy: 0 };
    expect(imageToCanvas({ x: 10, y: 10 }, f2)).toEqual({ x: 20, y: 5 });
  });
});

describe("clientToImage", () => {
  const rect = { left: 50, top: 20, width: 400, height: 200 };

  it("converte tela para imagem levando em conta o deslocamento do elemento", () => {
    const p = clientToImage(50, 20, rect, 1600, 800);
    expect(p.x).toBe(0);
    expect(p.y).toBe(0);
    const q = clientToImage(450, 220, rect, 1600, 800);
    expect(q.x).toBeCloseTo(1600);
    expect(q.y).toBeCloseTo(800);
  });

  it("sc é quantos pixels de imagem cabem num pixel de tela", () => {
    // 1600 px de imagem em 400 px de tela = 4 px de imagem por px de tela. Sem
    // isso, a área de acerto do canto encolhe conforme se dá zoom.
    expect(clientToImage(0, 0, rect, 1600, 800).sc).toBe(4);
  });

  it("elemento de largura zero não gera NaN", () => {
    const p = clientToImage(10, 10, { left: 0, top: 0, width: 0, height: 0 }, 1600, 800);
    expect(Number.isNaN(p.x)).toBe(false);
    expect(Number.isNaN(p.y)).toBe(false);
    expect(Number.isFinite(p.sc)).toBe(true);
  });
});

describe("quadCenter / quadDims", () => {
  it("centro é a média dos quatro cantos", () => {
    expect(quadCenter(RET)).toEqual({ x: 250, y: 125 });
  });

  it("dimensões são a média dos lados opostos", () => {
    const d = quadDims(RET);
    expect(d.w).toBe(100);
    expect(d.h).toBe(50);
  });

  it("quad em perspectiva usa a MÉDIA, não o maior lado", () => {
    // Topo mais estreito que a base: a largura útil é a média, senão a arte é
    // enquadrada por um lado só e sobra ou falta no outro.
    const persp: QuadCorners = {
      tl: { x: 100, y: 0 }, tr: { x: 200, y: 0 },
      bl: { x: 0, y: 100 }, br: { x: 300, y: 100 },
    };
    expect(quadDims(persp).w).toBe(200); // (100 + 300) / 2
  });

  it("quad degenerado (todos os cantos no mesmo ponto) dá dimensão zero, sem NaN", () => {
    const p = { x: 5, y: 5 };
    const d = quadDims({ tl: p, tr: p, br: p, bl: p });
    expect(d.w).toBe(0);
    expect(d.h).toBe(0);
  });
});

describe("edgeGeometry", () => {
  const TOPO = { a: "tl", b: "tr", key: "top" } as const;
  const BASE = { a: "bl", b: "br", key: "bottom" } as const;
  const ESQ = { a: "tl", b: "bl", key: "left" } as const;

  it("a normal aponta para FORA em toda aresta", () => {
    // O bug que isto trava: sem forçar o sentido, a aresta de baixo abaula para
    // DENTRO enquanto a de cima abaula para fora, e o mesmo arrasto do mouse dá
    // sentidos opostos dependendo de qual alça o usuário pegou.
    const c = quadCenter(RET);
    for (const e of [TOPO, BASE, ESQ]) {
      const g = edgeGeometry(RET, e);
      const paraFora = (g.mx - c.x) * g.nx + (g.my - c.y) * g.ny;
      expect(paraFora).toBeGreaterThan(0);
    }
  });

  it("a normal é unitária", () => {
    const g = edgeGeometry(RET, TOPO);
    expect(Math.hypot(g.nx, g.ny)).toBeCloseTo(1, 9);
  });

  it("topo e base têm normais opostas", () => {
    const t = edgeGeometry(RET, TOPO);
    const b = edgeGeometry(RET, BASE);
    expect(t.ny).toBeCloseTo(-b.ny, 9);
  });

  it("a régua do abaulamento é a dimensão PERPENDICULAR à aresta", () => {
    // topo/base curvam ao longo da altura; esquerda/direita ao longo da largura
    expect(edgeGeometry(RET, TOPO).dim).toBe(50);
    expect(edgeGeometry(RET, ESQ).dim).toBe(100);
  });

  it("abaulamento é relativo à dimensão, não absoluto", () => {
    // Mesma curva relativa tem que dar a mesma aparência em qualquer tamanho.
    const g = edgeGeometry(RET, TOPO, { top: 0.2 });
    expect(g.bow).toBeCloseTo(0.2 * 50, 9);
  });

  it("sem abaulamento a alça fica no ponto médio da aresta", () => {
    const g = edgeGeometry(RET, TOPO);
    expect(g.bow).toBe(0);
    expect(g.handle).toEqual({ x: g.mx, y: g.my });
  });

  it("abaulamento positivo empurra a alça para fora do quad", () => {
    const c = quadCenter(RET);
    const g = edgeGeometry(RET, TOPO, { top: 0.3 });
    expect(dist(g.handle, c)).toBeGreaterThan(dist({ x: g.mx, y: g.my }, c));
  });

  it("aresta de comprimento zero não gera NaN na normal", () => {
    const degen: QuadCorners = {
      tl: { x: 10, y: 10 }, tr: { x: 10, y: 10 },
      br: { x: 50, y: 50 }, bl: { x: 10, y: 50 },
    };
    const g = edgeGeometry(degen, TOPO);
    expect(Number.isNaN(g.nx)).toBe(false);
    expect(Number.isNaN(g.ny)).toBe(false);
  });
});
