import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { walkDir, walkDirAsync, walkPsds, psdRoots } from "../fs-walk";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const TEST_DIR = join(tmpdir(), "mockup-store-test-" + process.pid);

beforeAll(() => {
  mkdirSync(join(TEST_DIR, "sub"), { recursive: true });
  writeFileSync(join(TEST_DIR, "a.psd"), "");
  writeFileSync(join(TEST_DIR, "b.jpg"), "");
  writeFileSync(join(TEST_DIR, "c.png"), "");
  writeFileSync(join(TEST_DIR, "d.txt"), "");
  writeFileSync(join(TEST_DIR, "sub", "e.psd"), "");
  writeFileSync(join(TEST_DIR, "sub", "f.webp"), "");
});

afterAll(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("walkDir", () => {
  it("finds all files when no filter", () => {
    const files = walkDir(TEST_DIR);
    expect(files.length).toBeGreaterThanOrEqual(6);
  });

  it("filters by extension set", () => {
    const psds = walkDir(TEST_DIR, new Set([".psd"]));
    expect(psds).toHaveLength(2);
    expect(psds.every((f) => f.ext === ".psd")).toBe(true);
  });

  it("finds images with multiple extensions", () => {
    const images = walkDir(TEST_DIR, new Set([".jpg", ".png", ".webp"]));
    expect(images).toHaveLength(3);
  });

  it("returns correct name (without extension)", () => {
    const psds = walkDir(TEST_DIR, new Set([".psd"]));
    const names = psds.map((f) => f.name).sort();
    expect(names).toEqual(["a", "e"]);
  });

  it("normalizes path separators to forward slashes", () => {
    const files = walkDir(TEST_DIR, new Set([".psd"]));
    for (const f of files) {
      expect(f.path).not.toContain("\\");
    }
  });

  it("returns empty for non-existent dir", () => {
    expect(walkDir("Z:/nonexistent/path/123")).toEqual([]);
  });
});

describe("psdRoots", () => {
  it("descarta a raiz que já está dentro de outra raiz", () => {
    // O caso real do .env.local: MOCKUPS MAISON é filha de ASSETS VISANT, e o
    // walk recursivo visitava cada arquivo duas vezes — cópia de si mesmo.
    const roots = psdRoots(
      "Z:/BOXY/Produtos,H:/Meu Drive/ASSETS VISANT/MOCKUPS MAISON,H:/Meu Drive/ASSETS VISANT",
    );
    expect(roots).toEqual(["Z:/BOXY/Produtos", "H:/Meu Drive/ASSETS VISANT"]);
  });

  it("normaliza barra invertida, barra final e casing repetido", () => {
    expect(psdRoots("Z:\\BOXY\\Produtos\\,z:/boxy/produtos")).toEqual(["Z:/BOXY/Produtos"]);
  });

  it("não confunde prefixo de nome com pasta aninhada", () => {
    expect(psdRoots("H:/Drive/Mockups,H:/Drive/Mockups Antigos")).toHaveLength(2);
  });

  it("aceita lista vazia", () => {
    expect(psdRoots("")).toEqual([]);
  });
});

describe("walkPsds", () => {
  it("only returns .psd files", () => {
    const psds = walkPsds(TEST_DIR);
    expect(psds).toHaveLength(2);
    expect(psds.every((f) => f.ext === ".psd")).toBe(true);
  });
});

describe("walkDirAsync", () => {
  it("acha o mesmo que a versão síncrona", async () => {
    const sync = walkDir(TEST_DIR, new Set([".psd"]));
    const async = await walkDirAsync(TEST_DIR, { filterExts: new Set([".psd"]) });
    expect(async.map((f) => f.path).sort()).toEqual(sync.map((f) => f.path).sort());
  });

  it("normaliza separador e ignora AppleDouble como a síncrona", async () => {
    const files = await walkDirAsync(TEST_DIR);
    expect(files.every((f) => !f.path.includes("\\"))).toBe(true);
    expect(files.every((f) => !f.name.startsWith("._"))).toBe(true);
  });

  it("reporta progresso durante a listagem, antes de existir total", async () => {
    const avisos: number[] = [];
    await walkDirAsync(TEST_DIR, { onProgress: (p) => avisos.push(p.found) });
    // O aviso final sempre sai; é o que tira a barra do limbo.
    expect(avisos.length).toBeGreaterThan(0);
    expect(avisos.at(-1)).toBeGreaterThan(0);
  });

  it("cancela quando o sinal aborta", async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(walkDirAsync(TEST_DIR, { signal: ac.signal })).rejects.toThrow();
  });

  it("pasta inexistente devolve vazio, sem estourar", async () => {
    const files = await walkDirAsync(join(TEST_DIR, "nao-existe-mesmo"));
    expect(files).toEqual([]);
  });
});
