import { describe, it, expect } from "vitest";
import { SO_TARGET, BRAND_HIDE } from "@visant/psd-engine";
import { IMAGE_EXTS } from "../psd-scan";

describe("SO_TARGET regex", () => {
  const shouldMatch = [
    "Double Click to Edit",
    "Your Design Here",
    "Place Here",
    "Smart Object Artwork",
    "Design Here",
    "Your Image",          // your.(design|image|art|logo) — placeholder de SO, é alvo editável
    "Edite aqui",
    "(Edite)",
    "(Editar)",
    "[Edit this layer]",
    "edit aqui sua arte",
    "double.click here",
    "place.here",
  ];

  const shouldNotMatch = [
    "Background",
    "Shadow",
    "Gradient Overlay",
    "[BOXY] Watermark",
    "Color Balance 1",
    "Layer 42",
  ];

  for (const name of shouldMatch) {
    it(`matches "${name}"`, () => {
      expect(SO_TARGET.test(name)).toBe(true);
    });
  }

  for (const name of shouldNotMatch) {
    it(`rejects "${name}"`, () => {
      expect(SO_TARGET.test(name)).toBe(false);
    });
  }
});

describe("BRAND_HIDE regex", () => {
  const shouldMatch = [
    "[BOXY] Logo",
    "[boxy] watermark",
    "DELETE ESSA CAMADA",
    "(DELETE ESSA CAMADA)",
    "delete this",
    "Remove Paper texture",
    "remove paper",
  ];

  const shouldNotMatch = [
    "Background",
    "Your Design Here",
    "Shadow Layer",
    "Smart Object",
    "Edite aqui",
  ];

  for (const name of shouldMatch) {
    it(`hides "${name}"`, () => {
      expect(BRAND_HIDE.test(name)).toBe(true);
    });
  }

  for (const name of shouldNotMatch) {
    it(`keeps "${name}"`, () => {
      expect(BRAND_HIDE.test(name)).toBe(false);
    });
  }
});

describe("IMAGE_EXTS", () => {
  it("includes jpg, jpeg, png, webp", () => {
    expect(IMAGE_EXTS.has(".jpg")).toBe(true);
    expect(IMAGE_EXTS.has(".jpeg")).toBe(true);
    expect(IMAGE_EXTS.has(".png")).toBe(true);
    expect(IMAGE_EXTS.has(".webp")).toBe(true);
  });

  it("excludes psd, gif, svg", () => {
    expect(IMAGE_EXTS.has(".psd")).toBe(false);
    expect(IMAGE_EXTS.has(".gif")).toBe(false);
    expect(IMAGE_EXTS.has(".svg")).toBe(false);
  });
});
