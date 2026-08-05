/**
 * A coleção curada só vira kit se a tradução "id do catálogo → PSD no disco"
 * for honesta: mantém a ordem e não engole item.
 *
 * O regressor que importa é o silêncio. Um kit com 18 PNGs de uma coleção de 20
 * parece certo até alguém contar; por isso cada descarte tem que sair com motivo.
 */
import { describe, it, expect } from "vitest";
import { planCollectionRender, type CollectionRefDoc } from "../../../scripts/brand-kit";

const doc = (id: string, extra: Partial<CollectionRefDoc> = {}): CollectionRefDoc => ({
  id,
  name: id,
  psdPath: `Z:/psd/${id}.psd`,
  ...extra,
});

const allExist = () => true;

describe("planCollectionRender", () => {
  it("preserva a ordem curada, não a ordem em que o catálogo devolveu", () => {
    const ids = ["c", "a", "b"];
    const docs = [doc("a"), doc("b"), doc("c")];
    expect(planCollectionRender(ids, docs, allExist).psdPaths).toEqual([
      "Z:/psd/c.psd",
      "Z:/psd/a.psd",
      "Z:/psd/b.psd",
    ]);
  });

  it("pula id que sumiu do catálogo, com motivo", () => {
    const plan = planCollectionRender(["a", "fantasma"], [doc("a")], allExist);
    expect(plan.psdPaths).toEqual(["Z:/psd/a.psd"]);
    expect(plan.skipped).toHaveLength(1);
    expect(plan.skipped[0].id).toBe("fantasma");
    expect(plan.skipped[0].reason).toMatch(/catálogo/);
  });

  it("cena de foto não vira job de PSD — e o motivo aponta o outro pipeline", () => {
    const plan = planCollectionRender(
      ["foto"],
      [doc("foto", { psdPath: undefined, type: "photo", photoSceneId: "s1" })],
      allExist,
    );
    expect(plan.psdPaths).toEqual([]);
    expect(plan.skipped[0].reason).toMatch(/photo-agent/);
  });

  it("PSD que sumiu do disco é descartado citando o caminho", () => {
    const plan = planCollectionRender(["a", "b"], [doc("a"), doc("b")], (p) => p.endsWith("a.psd"));
    expect(plan.psdPaths).toEqual(["Z:/psd/a.psd"]);
    expect(plan.skipped[0].reason).toContain("Z:/psd/b.psd");
  });

  it("id repetido não renderiza duas vezes", () => {
    const plan = planCollectionRender(["a", "a"], [doc("a")], allExist);
    expect(plan.psdPaths).toEqual(["Z:/psd/a.psd"]);
    expect(plan.skipped).toHaveLength(1);
  });

  it("nada é descartado calado: todo id vira render OU vira motivo", () => {
    const ids = ["a", "foto", "sumido", "semPsd"];
    const docs = [doc("a"), doc("foto", { psdPath: undefined, type: "photo" }), doc("semPsd", { psdPath: undefined })];
    const plan = planCollectionRender(ids, docs, allExist);
    expect(plan.psdPaths.length + plan.skipped.length).toBe(ids.length);
    expect(plan.skipped.every((s) => !!s.reason)).toBe(true);
  });
});
