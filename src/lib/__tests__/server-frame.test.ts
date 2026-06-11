import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { frameArt } from "../server-frame";

// Arte de teste: 100x50 vermelho opaco
async function testArt(): Promise<Buffer> {
  return sharp({
    create: { width: 100, height: 50, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } },
  })
    .png()
    .toBuffer();
}

describe("frameArt", () => {
  it("cover: sai exatamente no tamanho do SO", async () => {
    const out = await frameArt(await testArt(), 200, 200, { mode: "cover" });
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(200);
    expect(meta.height).toBe(200);
    expect(meta.format).toBe("png");
  });

  it("stretch: deforma para o tamanho do SO", async () => {
    const out = await frameArt(await testArt(), 300, 100, { mode: "stretch" });
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(300);
    expect(meta.height).toBe(100);
  });

  it("contain: centraliza com fundo transparente por padrão", async () => {
    const out = await frameArt(await testArt(), 200, 200, { mode: "contain" });
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(200);
    expect(meta.height).toBe(200);
    // Canto superior esquerdo deve ser transparente (letterbox)
    const raw = await sharp(out).raw().toBuffer();
    expect(raw[3]).toBe(0); // alpha do pixel (0,0)
  });

  it("contain com bg: preenche o letterbox com a cor", async () => {
    const out = await frameArt(await testArt(), 200, 200, { mode: "contain", bg: "#00ff00" });
    const raw = await sharp(out).raw().toBuffer();
    // Pixel (0,0) = verde opaco
    expect(raw[0]).toBe(0);
    expect(raw[1]).toBe(255);
    expect(raw[2]).toBe(0);
    expect(raw[3]).toBe(255);
  });

  it("contain com padding: arte fica menor que o frame", async () => {
    const out = await frameArt(await testArt(), 200, 100, { mode: "contain", padding: 0.2 });
    const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
    // Centro deve ser vermelho (arte), borda transparente (padding)
    const px = (x: number, y: number) => (y * info.width + x) * 4;
    expect(data[px(100, 50) + 0]).toBe(255); // centro: R
    expect(data[px(2, 50) + 3]).toBe(0); // borda esquerda: transparente
  });

  it("cap de 4096px no maior lado", async () => {
    const out = await frameArt(await testArt(), 8000, 4000, { mode: "cover" });
    const meta = await sharp(out).metadata();
    expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(4096);
  });
});
