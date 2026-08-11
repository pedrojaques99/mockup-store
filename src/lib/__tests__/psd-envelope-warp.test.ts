import { describe, it, expect } from "vitest";
import { parseEnvelopeWarp, evaluateMesh, meshDeviation } from "@visant/psd-engine";

/**
 * Warp de malha do Photoshop — a matemática que faz o pôster amassar.
 *
 * Testa aqui, e não no pacote, porque é aqui que o harness de teste mora. O que
 * se trava é o contrato de LEITURA (o que é malha válida e o que não é) e o de
 * AVALIAÇÃO (Bézier cúbica por patch), que são as duas partes onde um erro sai
 * como imagem levemente torta em vez de exceção — o tipo de defeito que ninguém
 * vê num PR.
 */

const W = 300;
const H = 600;

/** Malha N×N distribuída uniformemente = identidade. */
function malhaIdentidade(n = 13) {
  const points = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      points.push({ x: (i / (n - 1)) * W, y: (j / (n - 1)) * H });
    }
  }
  return points;
}

function placed(points: Array<{ x: number; y: number }>, n = 13, extra: Record<string, unknown> = {}) {
  return {
    warp: {
      style: "custom",
      deformNumCols: n,
      deformNumRows: n,
      bounds: { top: 0, left: 0, bottom: H, right: W },
      customEnvelopeWarp: { meshPoints: points },
      ...extra,
    },
  };
}

describe("parseEnvelopeWarp", () => {
  it("descarta malha identidade — deformar por ela é reamostrar pra não mudar nada", () => {
    expect(parseEnvelopeWarp(placed(malhaIdentidade()))).toBeNull();
  });

  it("lê uma malha 13x13 como 4x4 patches cúbicos", () => {
    const p = malhaIdentidade();
    p[7] = { x: p[7].x + 40, y: p[7].y - 25 };
    const m = parseEnvelopeWarp(placed(p));
    expect(m).not.toBeNull();
    expect(m!.cols).toBe(13);
    expect(m!.patchesU).toBe(4);
    expect(m!.patchesV).toBe(4);
    expect(m!.width).toBe(W);
    expect(m!.height).toBe(H);
  });

  it("lê a malha PADRÃO de 4x4 como um patch só", () => {
    const p = malhaIdentidade(4);
    p[1] = { x: p[1].x, y: p[1].y - 60 };
    const m = parseEnvelopeWarp(placed(p, 4));
    expect(m!.patchesU).toBe(1);
    expect(m!.patchesV).toBe(1);
  });

  it("recusa o que não sabe ler, em vez de inventar geometria", () => {
    const p = malhaIdentidade();
    p[7] = { x: 999, y: 999 };
    // estilo de fórmula (arc/flag/…), não malha
    expect(parseEnvelopeWarp(placed(p, 13, { style: "arc" }))).toBeNull();
    // contagem que não fecha com a grade declarada
    expect(parseEnvelopeWarp(placed(p.slice(0, 100)))).toBeNull();
    // grade que não forma patches cúbicos: (n-1) % 3 != 0
    expect(parseEnvelopeWarp(placed(malhaIdentidade(6), 6))).toBeNull();
    // sem warp nenhum
    expect(parseEnvelopeWarp({})).toBeNull();
    expect(parseEnvelopeWarp(null)).toBeNull();
  });

  it("aceita bounds no formato { value, units } do descritor do Photoshop", () => {
    const p = malhaIdentidade();
    p[7] = { x: p[7].x + 40, y: p[7].y };
    const m = parseEnvelopeWarp({
      warp: {
        style: "custom",
        deformNumCols: 13,
        deformNumRows: 13,
        bounds: {
          top: { value: 0, units: "Pixels" },
          left: { value: 0, units: "Pixels" },
          bottom: { value: H, units: "Pixels" },
          right: { value: W, units: "Pixels" },
        },
        customEnvelopeWarp: { meshPoints: p },
      },
    });
    expect(m!.width).toBe(W);
    expect(m!.height).toBe(H);
  });
});

describe("evaluateMesh", () => {
  const pontos = malhaIdentidade();
  // Levanta o canto superior direito: é o vinco que o teste persegue.
  pontos[12] = { x: W + 30, y: -20 };
  const m = parseEnvelopeWarp(placed(pontos))!;

  it("interpola os cantos — Bézier passa pelos pontos das pontas", () => {
    expect(evaluateMesh(m, 0, 0).x).toBeCloseTo(pontos[0].x, 4);
    expect(evaluateMesh(m, 0, 0).y).toBeCloseTo(pontos[0].y, 4);
    expect(evaluateMesh(m, 1, 0).x).toBeCloseTo(pontos[12].x, 4);
    expect(evaluateMesh(m, 1, 0).y).toBeCloseTo(pontos[12].y, 4);
    const ultimo = pontos[pontos.length - 1];
    expect(evaluateMesh(m, 1, 1).x).toBeCloseTo(ultimo.x, 4);
    expect(evaluateMesh(m, 1, 1).y).toBeCloseTo(ultimo.y, 4);
  });

  it("é contínua na costura entre patches", () => {
    // u = 0.25 é exatamente a borda entre o primeiro e o segundo patch.
    const antes = evaluateMesh(m, 0.25 - 1e-6, 0.5);
    const depois = evaluateMesh(m, 0.25 + 1e-6, 0.5);
    expect(Math.abs(antes.x - depois.x)).toBeLessThan(0.01);
    expect(Math.abs(antes.y - depois.y)).toBeLessThan(0.01);
  });

  it("de fato deforma perto do ponto mexido, e não longe dele", () => {
    const perto = evaluateMesh(m, 0.95, 0.02);
    const longe = evaluateMesh(m, 0.05, 0.95);
    const idealPerto = { x: 0.95 * W, y: 0.02 * H };
    const idealLonge = { x: 0.05 * W, y: 0.95 * H };
    expect(Math.hypot(perto.x - idealPerto.x, perto.y - idealPerto.y)).toBeGreaterThan(5);
    expect(Math.hypot(longe.x - idealLonge.x, longe.y - idealLonge.y)).toBeLessThan(1);
  });

  it("não estoura fora de [0,1] — u/v são grampeados", () => {
    expect(evaluateMesh(m, -3, 0)).toEqual(evaluateMesh(m, 0, 0));
    expect(evaluateMesh(m, 5, 1)).toEqual(evaluateMesh(m, 1, 1));
  });
});

describe("meshDeviation", () => {
  it("mede em px o quanto a malha foge do retângulo", () => {
    const p = malhaIdentidade();
    p[40] = { x: p[40].x + 17, y: p[40].y };
    const m = { points: p, cols: 13, rows: 13, patchesU: 4, patchesV: 4, width: W, height: H };
    expect(meshDeviation(m)).toBeCloseTo(17, 4);
  });
});
