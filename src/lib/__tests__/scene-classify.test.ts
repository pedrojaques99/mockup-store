import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { classifyScene, analyzeScene } from "../scene-classify";
import { SUBSTRATES } from "../substrate-presets";

// Gera um PNG sintético (W×H) com fundo + retângulo de cor — simula placeholders.
async function syntheticScene(opts: {
  bg: [number, number, number]; rect: [number, number, number]; coverage: number;
}): Promise<Buffer> {
  const W = 400, H = 300;
  const buf = Buffer.alloc(W * H * 3);
  for (let i = 0; i < W * H; i++) { buf[i * 3] = opts.bg[0]; buf[i * 3 + 1] = opts.bg[1]; buf[i * 3 + 2] = opts.bg[2]; }
  // retângulo central com cobertura % da imagem
  const rW = Math.round(Math.sqrt(opts.coverage) * W);
  const rH = Math.round(Math.sqrt(opts.coverage) * H);
  const x0 = (W - rW) >> 1, y0 = (H - rH) >> 1;
  for (let y = y0; y < y0 + rH; y++) for (let x = x0; x < x0 + rW; x++) {
    const i = (y * W + x) * 3; buf[i] = opts.rect[0]; buf[i + 1] = opts.rect[1]; buf[i + 2] = opts.rect[2];
  }
  return sharp(buf, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer();
}

describe("classifyScene", () => {
  it("detecta placeholder magenta (#FF1493) como kind=magenta", async () => {
    const png = await syntheticScene({ bg: [30, 30, 40], rect: [255, 20, 147], coverage: 0.25 });
    const cls = await classifyScene(png);
    expect(cls.kind).toBe("magenta");
    expect(cls.confidence).toBeGreaterThan(0.6);
    expect(cls.preset.method).toBe("key-color");
  });

  it("detecta superfície branca (white-label) como kind=white", async () => {
    const png = await syntheticScene({ bg: [40, 50, 70], rect: [248, 250, 250], coverage: 0.35 });
    const cls = await classifyScene(png);
    expect(cls.kind).toBe("white");
    expect(cls.preset.material).toBe("fabric");
  });

  it("foto colorida sem placeholder → kind=custom", async () => {
    const png = await syntheticScene({ bg: [80, 120, 60], rect: [140, 80, 40], coverage: 0.20 });
    const cls = await classifyScene(png);
    expect(cls.kind).toBe("custom");
    expect(cls.preset.method).toBe("manual");
  });

  it("magenta esparso (pouca cobertura) NÃO ativa magenta", async () => {
    const png = await syntheticScene({ bg: [200, 200, 200], rect: [255, 20, 147], coverage: 0.005 });
    const cls = await classifyScene(png);
    expect(cls.kind).not.toBe("magenta");
  });
});

describe("analyzeScene (placeholder + substrato)", () => {
  it("retorna placeholder magenta com bbox + ranking de substratos com top-5", async () => {
    const png = await syntheticScene({ bg: [40, 50, 70], rect: [255, 20, 147], coverage: 0.3 });
    const an = await analyzeScene(png);
    expect(an.placeholder.kind).toBe("magenta");
    expect(an.placeholder.bbox).toBeDefined();
    expect(an.substrate.candidates.length).toBeGreaterThanOrEqual(3);
    expect(an.substrate.candidates[0].score).toBeGreaterThanOrEqual(an.substrate.candidates[1].score);
  });

  it("preset combina method do placeholder (magenta→key-color) + surface do substrato", async () => {
    const png = await syntheticScene({ bg: [40, 50, 70], rect: [255, 20, 147], coverage: 0.3 });
    const an = await analyzeScene(png);
    expect(an.preset.method).toBe("key-color");
    // O surfaceType deve vir do substrato detectado (qualquer um da lib).
    const validSurfaces = Object.values(SUBSTRATES).map((s) => s.surfaceType);
    expect(validSurfaces).toContain(an.preset.surfaceType);
  });

  it("cena sem placeholder ainda devolve substrato + method manual", async () => {
    const png = await syntheticScene({ bg: [80, 120, 60], rect: [140, 80, 40], coverage: 0.2 });
    const an = await analyzeScene(png);
    expect(an.placeholder.kind).toBe("custom");
    expect(an.preset.method).toBe("manual");
    expect(an.substrate.kind).toBeDefined();
  });
});
