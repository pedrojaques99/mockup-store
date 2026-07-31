import { describe, it, expect } from "vitest";
import {
  decideFraming,
  TRANSPARENT_LOGO_RATIO,
  FLAT_EDGE_RATIO,
  LOGO_MAX_INK,
  type ArtStats,
} from "../art-classify";

const stats = (o: Partial<ArtStats> = {}): ArtStats => ({
  width: 1920,
  height: 1080,
  transparentRatio: 0,
  edgeUniformity: 0.2,
  edgeColorHex: "#123456",
  inkRatio: 0.9,
  isVector: false,
  ...o,
});

describe("decideFraming", () => {
  it("vetor é sempre marca — encaixa inteiro", () => {
    const d = decideFraming(stats({ isVector: true }));
    expect(d.kind).toBe("logo");
    expect(d.mode).toBe("contain");
  });

  it("fundo transparente vira contain", () => {
    const d = decideFraming(stats({ transparentRatio: TRANSPARENT_LOGO_RATIO + 0.01 }));
    expect(d.kind).toBe("logo");
    expect(d.mode).toBe("contain");
  });

  it("usa a cor da marca como fundo quando há marca", () => {
    const d = decideFraming(stats({ isVector: true }), { brandColor: "#16271a" });
    expect(d.bg).toBe("#16271a");
    expect(d.reason).toMatch(/marca|vetor/i);
  });

  it("sem marca, o logo sobre fundo chapado herda a cor do próprio fundo", () => {
    const d = decideFraming(
      stats({ edgeUniformity: 0.97, inkRatio: 0.2, edgeColorHex: "#f5f4f0" }),
    );
    expect(d.mode).toBe("contain");
    expect(d.bg).toBe("#f5f4f0");
  });

  it("composição fotográfica preenche a superfície", () => {
    const d = decideFraming(stats({ edgeUniformity: 0.15, inkRatio: 0.95 }));
    expect(d.kind).toBe("layout");
    expect(d.mode).toBe("cover");
    expect(d.bg).toBeNull();
  });

  it("proporção casando com a superfície vence o teste de fundo chapado", () => {
    // Layout full-bleed de fundo sólido: borda uniforme e pouca tinta, mas foi
    // desenhado PARA esta superfície — tarjar as laterais seria um erro.
    const d = decideFraming(
      stats({ width: 1920, height: 1080, edgeUniformity: 0.98, inkRatio: 0.2 }),
      { soAspect: 1920 / 1080 },
    );
    expect(d.kind).toBe("layout");
    expect(d.mode).toBe("cover");
  });

  it("…mas transparência ainda vence a proporção — cortar logo é pior", () => {
    const d = decideFraming(
      stats({ width: 1920, height: 1080, transparentRatio: 0.6 }),
      { soAspect: 1920 / 1080 },
    );
    expect(d.mode).toBe("contain");
  });

  it("proporção MUITO diferente da superfície não dispara o atalho de cover", () => {
    const d = decideFraming(
      stats({ width: 1000, height: 1000, edgeUniformity: 0.98, inkRatio: 0.1 }),
      { soAspect: 3.0 },
    );
    expect(d.kind).toBe("logo");
    expect(d.mode).toBe("contain");
  });

  it("fundo chapado COM muita tinta é composição, não marca", () => {
    const d = decideFraming(
      stats({ edgeUniformity: FLAT_EDGE_RATIO + 0.05, inkRatio: LOGO_MAX_INK + 0.1 }),
    );
    expect(d.kind).toBe("layout");
    expect(d.mode).toBe("cover");
  });

  it("toda decisão vem com um motivo legível", () => {
    for (const s of [
      stats({ isVector: true }),
      stats({ transparentRatio: 0.5 }),
      stats({ edgeUniformity: 0.95, inkRatio: 0.1 }),
      stats(),
    ]) {
      expect(decideFraming(s).reason.length).toBeGreaterThan(10);
    }
  });
});
