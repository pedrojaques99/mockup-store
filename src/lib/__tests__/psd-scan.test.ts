import { describe, it, expect } from "vitest";
import { flattenLayers } from "../psd-scan";

describe("flattenLayers", () => {
  it("returns empty for empty input", () => {
    expect(flattenLayers([])).toEqual([]);
  });

  it("flattens nested children", () => {
    const tree = [
      {
        name: "Group 1",
        children: [
          { name: "Layer A" },
          {
            name: "Group 2",
            children: [{ name: "Layer B" }],
          },
        ],
      },
      { name: "Layer C" },
    ];
    const flat = flattenLayers(tree);
    const names = flat.map((l) => l.name);
    expect(names).toEqual(["Group 1", "Layer A", "Group 2", "Layer B", "Layer C"]);
  });

  it("handles layers without children", () => {
    const layers = [{ name: "A" }, { name: "B" }];
    expect(flattenLayers(layers)).toHaveLength(2);
  });

  it("handles deeply nested groups", () => {
    const deep = {
      name: "L1",
      children: [{
        name: "L2",
        children: [{
          name: "L3",
          children: [{ name: "L4" }],
        }],
      }],
    };
    const flat = flattenLayers([deep]);
    expect(flat).toHaveLength(4);
    expect(flat[3].name).toBe("L4");
  });
});
