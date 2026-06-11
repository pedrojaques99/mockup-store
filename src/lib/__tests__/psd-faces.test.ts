import { describe, it, expect } from "vitest";
import { computeFaces, type FaceSo } from "@visantlabs/psd-engine";

const so = (name: string, opts: Partial<FaceSo> = {}): FaceSo => ({
  name,
  path: opts.path ?? name,
  innerWidth: opts.innerWidth ?? 1000,
  innerHeight: opts.innerHeight ?? 1000,
  hidden: opts.hidden ?? false,
  linkId: opts.linkId,
});

describe("computeFaces", () => {
  it("A5: face única — Mockup visível + (!) Edite Aqui hidden vinculados; FX descartados", () => {
    const faces = computeFaces([
      so("Sombra", { linkId: "bg-fx", path: "BG Texture > Sombra" }),
      so("Luz", { linkId: "bg-fx", path: "BG Texture > Luz" }),
      so("Base", { linkId: "paper-fx", path: "A5 > Base > Base" }),
      so("Mockup", { linkId: "art", path: "A5 > Mockup", innerWidth: 1078, innerHeight: 1529 }),
      so("Luz", { linkId: "paper-fx", path: "A5 > FX > Luz" }),
      so("Sombra", { linkId: "paper-fx", path: "A5 > FX > Sombra" }),
      so("(!) Edite Aqui", { linkId: "art", hidden: true, innerWidth: 1078, innerHeight: 1529 }),
    ]);
    expect(faces).toHaveLength(1);
    expect(faces[0].smartObject).toBe("(!) Edite Aqui");
    expect(faces[0].innerWidth).toBe(1078);
    expect(faces[0].linkedCount).toBe(2);
  });

  it("Outdoor: face única — Design Here + Edite Aqui hidden; Grain descartado", () => {
    const faces = computeFaces([
      so("Design Here", { linkId: "art", path: "Mock > Art Mock > Design Here" }),
      so("Grain", { linkId: "grain" }),
      so("Edite Aqui", { linkId: "art", hidden: true }),
    ]);
    expect(faces).toHaveLength(1);
    expect(faces[0].linkedCount).toBe(2);
  });

  it("Cubo: 3 faces L/T/R; BOX hidden e Shadow/Light/Grain descartados", () => {
    const faces = computeFaces([
      so("BOX", { linkId: "box", hidden: true, path: "Mockup > BOX" }),
      so("L", { linkId: "face-l", path: "Mockup > Arte > L", innerWidth: 1641, innerHeight: 1641 }),
      so("T", { linkId: "face-t", path: "Mockup > Arte > T", innerWidth: 1641, innerHeight: 1641 }),
      so("R", { linkId: "face-r", path: "Mockup > Arte > R", innerWidth: 1641, innerHeight: 1641 }),
      so("Shadow", { linkId: "shadow" }),
      so("Light", { linkId: "light" }),
      so("Grain", { linkId: "grain" }),
      so("L (Edite Aqui)*", { linkId: "face-l" }),
      so("T (Edite Aqui)*", { linkId: "face-t" }),
      so("R (Edite Aqui)*", { linkId: "face-r" }),
    ]);
    expect(faces).toHaveLength(3);
    expect(faces.map((f) => f.name).sort()).toEqual(["L", "R", "T"]);
    // smartObject aponta pro representante editável (bate SO_TARGET)
    expect(faces.find((f) => f.name === "L")?.smartObject).toBe("L (Edite Aqui)*");
    expect(faces.every((f) => f.linkedCount === 2)).toBe(true);
  });

  it("HM banner: face única [DOUBLE CLICK TO EDIT]; Mesh/Light Effects descartados", () => {
    const faces = computeFaces([
      so("[DOUBLE CLICK TO EDIT]", { linkId: "a", innerWidth: 2904, innerHeight: 2299 }),
      so("Mesh Texture", { linkId: "b" }),
      so("Light Effects", { linkId: "c" }),
    ]);
    expect(faces).toHaveLength(1);
    expect(faces[0].smartObject).toBe("[DOUBLE CLICK TO EDIT]");
  });

  it("sem linkId (DB antigo): cada SO não-decorativo vira grupo próprio por path", () => {
    const faces = computeFaces([
      so("Design Here"),
      so("Grain"),
    ]);
    expect(faces).toHaveLength(1);
    expect(faces[0].smartObject).toBe("Design Here");
  });

  it("só decorativos: cai no fallback do maior SO", () => {
    const faces = computeFaces([
      so("Sombra", { linkId: "a", innerWidth: 500, innerHeight: 500 }),
      so("Luz", { linkId: "b", innerWidth: 800, innerHeight: 800 }),
    ]);
    expect(faces).toHaveLength(1);
    expect(faces[0].innerWidth).toBe(800);
  });

  it("nomes que viram vazio após limpeza recebem fallback e sufixo", () => {
    const faces = computeFaces([
      so("(!) Edite Aqui", { linkId: "a", path: "G1 > (!) Edite Aqui" }),
      so("Edite Aqui", { linkId: "b", path: "G2 > Edite Aqui" }),
    ]);
    expect(faces).toHaveLength(2);
    expect(faces.map((f) => f.name)).toEqual(["Arte 1", "Arte 2"]);
  });

  it("lista vazia retorna vazio", () => {
    expect(computeFaces([])).toEqual([]);
  });
});
