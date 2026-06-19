import { describe, it, expect } from "vitest";
import { smartMesh } from "../smart-mesh";
import { meshIsWarped, meshCorners } from "../mesh-core";

const Q = { tl: { x: 100, y: 100 }, tr: { x: 500, y: 100 }, br: { x: 500, y: 400 }, bl: { x: 100, y: 400 } };

describe("smartMesh", () => {
  it("flat → grade bilinear regular (não warpada)", () => {
    const m = smartMesh(Q, "flat", 3);
    expect(m.points).toHaveLength(9);
    expect(meshIsWarped(m, 1.0)).toBe(false);
  });

  it("cylinder → pontos interiores deslocados ao longo do eixo H", () => {
    const m = smartMesh(Q, "cylinder", 5);
    // Cantos preservados (a função desloca em U, e cantos têm sin(θ) preservado nas extremidades)
    const corners = meshCorners(m);
    expect(corners.tl.x).toBeCloseTo(Q.tl.x, 0);
    expect(corners.tr.x).toBeCloseTo(Q.tr.x, 0);
    expect(meshIsWarped(m)).toBe(true);
    // Tangentes presentes (autoSmoothTangents foi aplicado)
    expect(m.tangents).toBeDefined();
    expect(m.tangents!.length).toBe(m.points.length);
  });

  it("drape → tangentes presentes e malha warpada", () => {
    const m = smartMesh(Q, "drape", 5);
    expect(meshIsWarped(m)).toBe(true);
    expect(m.tangents).toBeDefined();
  });

  it("amount=0 retorna a grade default mesmo num form curvo", () => {
    const m = smartMesh(Q, "cylinder", 3, 0);
    expect(meshIsWarped(m, 1.0)).toBe(false);
  });
});
