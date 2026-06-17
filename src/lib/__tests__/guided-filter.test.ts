import { describe, it, expect } from "vitest";
import { boxFilter, refineAlphaGuided } from "../guided-filter";

describe("boxFilter", () => {
  it("leaves a constant field unchanged (mean of a constant = constant)", () => {
    const w = 8, h = 8;
    const src = new Float64Array(w * h).fill(0.5);
    const out = boxFilter(src, w, h, 2);
    for (const v of out) expect(v).toBeCloseTo(0.5, 10);
  });

  it("spreads an impulse into its neighbourhood", () => {
    const w = 5, h = 5;
    const src = new Float64Array(w * h);
    src[2 * w + 2] = 1; // center impulse
    const out = boxFilter(src, w, h, 1);
    // center window (3x3) averages the impulse → 1/9
    expect(out[2 * w + 2]).toBeCloseTo(1 / 9, 6);
    // a far corner outside the window stays 0
    expect(out[0]).toBe(0);
  });
});

describe("refineAlphaGuided", () => {
  const w = 4, h = 4, n = w * h;
  const guide = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) { const j = i * 4; guide[j] = guide[j + 1] = guide[j + 2] = 120; guide[j + 3] = 255; }

  it("keeps a fully-selected mask selected", () => {
    const alpha = new Uint8Array(n).fill(255);
    const out = refineAlphaGuided(alpha, guide, w, h, 1, 1e-3);
    for (const v of out) expect(v).toBeGreaterThan(250);
  });

  it("keeps an empty mask empty", () => {
    const alpha = new Uint8Array(n).fill(0);
    const out = refineAlphaGuided(alpha, guide, w, h, 1, 1e-3);
    for (const v of out) expect(v).toBeLessThan(5);
  });

  it("returns 0..255 values at full length", () => {
    const alpha = new Uint8Array(n);
    for (let i = 0; i < n; i++) alpha[i] = i < n / 2 ? 255 : 0;
    const out = refineAlphaGuided(alpha, guide, w, h, 1, 1e-3);
    expect(out.length).toBe(n);
    for (const v of out) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(255); }
  });
});
