import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { walkDir, walkPsds } from "../fs-walk";
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

describe("walkPsds", () => {
  it("only returns .psd files", () => {
    const psds = walkPsds(TEST_DIR);
    expect(psds).toHaveLength(2);
    expect(psds.every((f) => f.ext === ".psd")).toBe(true);
  });
});
