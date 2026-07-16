import { describe, it, expect } from "vitest";
import { assessDetection, componentSizes, DEFAULT_QA } from "../detect-qa";
import type { QuadCorners } from "../key-color-core";

/** Todos os pixels [x,y] de um retângulo cheio [x0,y0]..[x1,y1]. */
function rect(x0: number, y0: number, x1: number, y1: number): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) pts.push([x, y]);
  return pts;
}
/** Quad a partir do bbox de um retângulo. */
function quadOf(x0: number, y0: number, x1: number, y1: number): QuadCorners {
  return { tl: { x: x0, y: y0 }, tr: { x: x1, y: y0 }, br: { x: x1, y: y1 }, bl: { x: x0, y: y1 } };
}

const W = 400, H = 300;

describe("componentSizes", () => {
  it("um blob ⇒ um componente", () => {
    const s = componentSizes(rect(40, 40, 200, 180), W, H);
    expect(s.length).toBe(1);
  });

  it("dois blobs separados (gap > step) ⇒ dois componentes, ordem decrescente", () => {
    const pts = [...rect(40, 40, 200, 180), ...rect(240, 40, 360, 180)];
    const s = componentSizes(pts, W, H);
    expect(s.length).toBe(2);
    expect(s[0]).toBeGreaterThanOrEqual(s[1]);
  });
});

describe("assessDetection", () => {
  it("painel único, cheio e bem dimensionado ⇒ ok", () => {
    const q = quadOf(40, 40, 200, 180);
    const qa = assessDetection(rect(40, 40, 200, 180), q, W, H);
    expect(qa.verdict).toBe("ok");
    expect(qa.ambiguity).toBeLessThan(DEFAULT_QA.ambiguityReview);
    expect(qa.fillRatio).toBeGreaterThan(DEFAULT_QA.fillReview);
    expect(qa.componentCount).toBe(1);
    expect(qa.confidence).toBeGreaterThan(0.8);
  });

  it("dois painéis magenta comparáveis ⇒ reject por ambiguidade", () => {
    const pts = [...rect(40, 40, 200, 180), ...rect(240, 40, 360, 180)];
    const q = quadOf(40, 40, 200, 180); // detector pegou só o 1º
    const qa = assessDetection(pts, q, W, H);
    expect(qa.ambiguity).toBeGreaterThanOrEqual(DEFAULT_QA.ambiguityReject);
    expect(qa.verdict).toBe("reject");
    expect(qa.componentCount).toBe(2);
  });

  it("superfície ínfima ⇒ reject por área", () => {
    const q = quadOf(10, 10, 18, 18);
    const qa = assessDetection(rect(10, 10, 18, 18), q, W, H);
    expect(qa.areaFraction).toBeLessThan(DEFAULT_QA.areaMin);
    expect(qa.verdict).toBe("reject");
  });

  it("glow inflou o quad (blob preenche ~40%) ⇒ review", () => {
    // quad grande, mas os pixels-chave cobrem só a metade esquerda → fill baixo
    const q = quadOf(40, 40, 360, 260);
    const pts = rect(40, 40, 190, 260); // ~47% da largura do quad
    const qa = assessDetection(pts, q, W, H);
    expect(qa.fillRatio).toBeLessThan(DEFAULT_QA.fillReview);
    expect(qa.fillRatio).toBeGreaterThanOrEqual(DEFAULT_QA.fillReject);
    expect(qa.verdict).toBe("review");
  });

  it("sliver degenerado ⇒ reject por aspecto", () => {
    const q = quadOf(20, 140, 380, 148); // 360 × 8 = aspecto 45
    const qa = assessDetection(rect(20, 140, 380, 148), q, W, H);
    expect(qa.aspect).toBeGreaterThan(DEFAULT_QA.aspectMax);
    expect(qa.verdict).toBe("reject");
  });
});
