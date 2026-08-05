import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import sharp from "sharp";
import { derivado, extensaoValida, EXT_IMAGEM } from "../image-cache";

describe("image-cache", () => {
  it("só aceita extensão de imagem", () => {
    // A rota antiga devolvia QUALQUER arquivo como octet-stream — `?path=` era um
    // leitor de arquivo arbitrário. Este teste é o portão que impede a volta.
    expect(extensaoValida("C:/x/foto.jpg")).toBe(true);
    expect(extensaoValida("C:/x/FOTO.PNG")).toBe(true);
    expect(extensaoValida("C:/x/.env")).toBe(false);
    expect(extensaoValida("C:/x/segredo.txt")).toBe(false);
    expect(extensaoValida("C:/x/arquivo.psd")).toBe(false);
    expect(EXT_IMAGEM.has(".webp")).toBe(true);
  });

  it("reduz a fonte e reaproveita o derivado no segundo pedido", async () => {
    const dir = mkdtempSync(join(tmpdir(), "img-cache-"));
    const origem = join(dir, "grande.png");
    // PNG grande de propósito: é o formato que estava chegando com 13 MB no card.
    const png = await sharp({
      create: { width: 3000, height: 2000, channels: 3, background: { r: 200, g: 40, b: 90 } },
    }).png().toBuffer();
    writeFileSync(origem, png);

    const primeiro = await derivado(origem, 400);
    expect(primeiro.doCache).toBe(false);

    const segundo = await derivado(origem, 400);
    expect(segundo.doCache).toBe(true);
    expect(segundo.arquivo).toBe(primeiro.arquivo);
    expect(segundo.etag).toBe(primeiro.etag);

    const meta = await sharp(primeiro.arquivo).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.width).toBe(400);
  });

  it("largura diferente = derivado diferente", async () => {
    const dir = mkdtempSync(join(tmpdir(), "img-cache-"));
    const origem = join(dir, "a.png");
    writeFileSync(
      origem,
      await sharp({ create: { width: 800, height: 600, channels: 3, background: "#123456" } }).png().toBuffer()
    );
    const a = await derivado(origem, 64);
    const b = await derivado(origem, 256);
    expect(a.etag).not.toBe(b.etag);
    expect((await sharp(a.arquivo).metadata()).width).toBe(64);
    expect((await sharp(b.arquivo).metadata()).width).toBe(256);
  });

  it("não amplia imagem pequena", async () => {
    const dir = mkdtempSync(join(tmpdir(), "img-cache-"));
    const origem = join(dir, "pequena.png");
    writeFileSync(
      origem,
      await sharp({ create: { width: 120, height: 90, channels: 3, background: "#000000" } }).png().toBuffer()
    );
    // Pedir 1600 de uma imagem de 120 não pode inventar pixel.
    const d = await derivado(origem, 1600);
    expect((await sharp(d.arquivo).metadata()).width).toBe(120);
  });

  it("arquivo regravado invalida a chave (mtime entra no hash)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "img-cache-"));
    const origem = join(dir, "muda.png");
    writeFileSync(
      origem,
      await sharp({ create: { width: 300, height: 300, channels: 3, background: "#ff0000" } }).png().toBuffer()
    );
    const antes = await derivado(origem, 100);

    await new Promise((r) => setTimeout(r, 20)); // mtime tem que mudar de verdade
    writeFileSync(
      origem,
      await sharp({ create: { width: 300, height: 300, channels: 3, background: "#00ff00" } }).png().toBuffer()
    );
    const depois = await derivado(origem, 100);

    expect(depois.etag).not.toBe(antes.etag);
    expect(depois.doCache).toBe(false);
  });
});
