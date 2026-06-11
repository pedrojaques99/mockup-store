import { describe, it, expect, afterAll } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const TEST_DIR = join(tmpdir(), "psd-index-test-" + process.pid);

// Create files and set env BEFORE dynamic import
mkdirSync(TEST_DIR, { recursive: true });
writeFileSync(join(TEST_DIR, "Boxy Outdoor Scene.psd"), "");
writeFileSync(join(TEST_DIR, "MM_Caneca Média.psd"), "");
writeFileSync(join(TEST_DIR, "HM_Tshirt-preview.psd"), "");
writeFileSync(join(TEST_DIR, "simple-mockup.psd"), "");
writeFileSync(join(TEST_DIR, "A4-Paper-Front.psd"), "");
process.env.PSD_DIRS = TEST_DIR;

const { findPsdForRef, getAllPsds, addRuntimeDir } = await import("../psd-index");

afterAll(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  delete process.env.PSD_DIRS;
});

describe("getAllPsds", () => {
  it("finds all 5 PSDs", () => {
    const psds = getAllPsds(true);
    expect(psds).toHaveLength(5);
  });

  it("returns cached results on second call", () => {
    const first = getAllPsds(true);
    const second = getAllPsds();
    expect(first).toBe(second);
  });
});

describe("findPsdForRef", () => {
  it("exact match (case insensitive)", () => {
    getAllPsds(true);
    const result = findPsdForRef("simple-mockup");
    expect(result).not.toBeNull();
    expect(result!.name).toBe("simple-mockup");
  });

  it("exact match with different casing", () => {
    const result = findPsdForRef("Simple-Mockup");
    expect(result).not.toBeNull();
    expect(result!.name).toBe("simple-mockup");
  });

  it("Mockups Maison — strips Média suffix", () => {
    const result = findPsdForRef("MM_Caneca Média", "Mockups Maison");
    expect(result).not.toBeNull();
    expect(result!.name).toBe("MM_Caneca Média");
  });

  it("Hazard Mockups — strips -preview suffix", () => {
    const result = findPsdForRef("HM_Tshirt-preview", "Hazard Mockups");
    expect(result).not.toBeNull();
    expect(result!.name).toBe("HM_Tshirt-preview");
  });

  it("normalized match — ignores spaces/dashes/underscores", () => {
    const result = findPsdForRef("A4 Paper Front");
    expect(result).not.toBeNull();
    expect(result!.name).toBe("A4-Paper-Front");
  });

  it("substring match for long names", () => {
    const result = findPsdForRef("Boxy Outdoor Scene Full");
    expect(result).not.toBeNull();
    expect(result!.name).toBe("Boxy Outdoor Scene");
  });

  it("rejects generic names (too short)", () => {
    expect(findPsdForRef("AB")).toBeNull();
    expect(findPsdForRef("123")).toBeNull();
  });

  it("returns null for no match", () => {
    expect(findPsdForRef("Completely Unknown Mockup Name That Does Not Exist")).toBeNull();
  });
});

describe("addRuntimeDir", () => {
  it("invalidates cache so next call rescans", () => {
    const before = getAllPsds(true);
    addRuntimeDir(join(tmpdir(), "nonexistent-dir-" + process.pid));
    const after = getAllPsds();
    expect(after).not.toBe(before);
  });
});
