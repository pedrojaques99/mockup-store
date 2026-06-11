import { describe, it, expect } from "vitest";
import { exportSize, coverCrop, containRect, isLowRes } from "../art-frame";

describe("exportSize", () => {
  it("keeps SO size when under the cap", () => {
    expect(exportSize(2000, 1500)).toEqual({ width: 2000, height: 1500 });
  });

  it("caps the longest edge preserving ratio", () => {
    expect(exportSize(8192, 4096)).toEqual({ width: 4096, height: 2048 });
  });

  it("never returns zero", () => {
    const { width, height } = exportSize(1, 10000);
    expect(width).toBeGreaterThanOrEqual(1);
    expect(height).toBeGreaterThanOrEqual(1);
  });
});

describe("coverCrop", () => {
  it("crops sides of a wide art for a square frame", () => {
    expect(coverCrop(2000, 1000, 500, 500)).toEqual({
      x: 500, y: 0, width: 1000, height: 1000,
    });
  });

  it("crops top/bottom of a tall art for a wide frame", () => {
    expect(coverCrop(1000, 2000, 1000, 500)).toEqual({
      x: 0, y: 750, width: 1000, height: 500,
    });
  });

  it("is identity when ratios match", () => {
    expect(coverCrop(1600, 900, 1920, 1080)).toEqual({
      x: 0, y: 0, width: 1600, height: 900,
    });
  });
});

describe("containRect", () => {
  it("letterboxes a wide art in a square frame", () => {
    expect(containRect(2000, 1000, 500, 500)).toEqual({
      x: 0, y: 125, width: 500, height: 250,
    });
  });

  it("pillarboxes a tall art in a wide frame", () => {
    expect(containRect(500, 1000, 1000, 500)).toEqual({
      x: 375, y: 0, width: 250, height: 500,
    });
  });
});

describe("isLowRes", () => {
  it("flags upscale beyond 1.5x", () => {
    expect(isLowRes(1000, 1000, 2000, 2000)).toBe(true);
  });

  it("accepts mild upscale", () => {
    expect(isLowRes(1500, 1500, 2000, 2000)).toBe(false);
  });

  it("flags when only one axis is starved", () => {
    expect(isLowRes(3000, 800, 2000, 2000)).toBe(true);
  });

  it("ignores zero-sized sources", () => {
    expect(isLowRes(0, 0, 2000, 2000)).toBe(false);
  });
});
