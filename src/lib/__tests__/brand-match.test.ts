import { describe, it, expect } from "vitest";
import {
  scoreReference,
  buildHeuristicProfile,
  type BrandProfile,
} from "../brand-match";

const profile: BrandProfile = {
  dims: {
    niche: ["cosmetics", "beauty"],
    style: ["minimal"],
    material: ["glass"],
  },
  keywords: ["skincare", "frasco"],
  avoid: ["grunge"],
  source: "heuristic",
};

describe("scoreReference", () => {
  it("pontua matches de dimensão com pesos", () => {
    const { score, reasons } = scoreReference(
      {
        name: "Cosmetic Jar",
        dimensions: { niche: ["cosmetics"], style: ["minimal"] },
      },
      profile
    );
    // niche (3) + style (2)
    expect(score).toBe(5);
    expect(reasons).toContain("niche: cosmetics");
    expect(reasons).toContain("style: minimal");
  });

  it("ignora case nas comparações", () => {
    const { score } = scoreReference(
      { dimensions: { niche: ["Cosmetics"] } },
      profile
    );
    expect(score).toBe(3);
  });

  it("soma bônus de PSD disponível", () => {
    const base = scoreReference({ dimensions: { niche: ["cosmetics"] } }, profile);
    const withPsd = scoreReference(
      { dimensions: { niche: ["cosmetics"] }, psdPath: "Z:/x.psd" },
      profile
    );
    expect(withPsd.score).toBeGreaterThan(base.score);
  });

  it("pontua keywords no texto da referência", () => {
    const { score, reasons } = scoreReference(
      { name: "Frasco de skincare", description: "" },
      profile
    );
    expect(score).toBeCloseTo(1.5); // 2 keywords * 0.75
    expect(reasons.some((r) => r.startsWith("keywords"))).toBe(true);
  });

  it("penaliza tags na lista de avoid", () => {
    const clean = scoreReference({ dimensions: { niche: ["cosmetics"] } }, profile);
    const avoided = scoreReference(
      { dimensions: { niche: ["cosmetics"], style: ["grunge"] } },
      profile
    );
    expect(avoided.score).toBeLessThan(clean.score);
  });

  it("retorna zero sem nenhum match", () => {
    const { score, reasons } = scoreReference(
      { name: "Outdoor Billboard", dimensions: { niche: ["automotive"] } },
      profile
    );
    expect(score).toBe(0);
    expect(reasons).toHaveLength(0);
  });
});

describe("buildHeuristicProfile", () => {
  const taxonomy = {
    niche: ["cosmetics", "tech", "food"],
    style: ["minimal", "vintage"],
  };

  it("seleciona tags do vocabulário presentes no texto da marca", () => {
    const p = buildHeuristicProfile(
      "Marca de cosmetics com estética minimal e clean",
      taxonomy
    );
    expect(p.dims.niche).toEqual(["cosmetics"]);
    expect(p.dims.style).toEqual(["minimal"]);
    expect(p.source).toBe("heuristic");
  });

  it("não inventa tags fora do vocabulário", () => {
    const p = buildHeuristicProfile("Marca de moda esportiva radical", taxonomy);
    expect(p.dims.niche).toBeUndefined();
    expect(p.dims.style).toBeUndefined();
  });

  it("extrai keywords significativas do texto", () => {
    const p = buildHeuristicProfile("Skincare natural premium brasileira", taxonomy);
    expect(p.keywords).toContain("skincare");
    expect(p.keywords).toContain("premium");
  });
});
