import { describe, it, expect } from "vitest";
import { expandTerm, foldTerm, SYNONYM_TERM_COUNT, MIN_SYNONYM_LEN } from "../search-synonyms";

describe("foldTerm", () => {
  it("tira acento e caixa (o acervo é PT+EN misturado)", () => {
    expect(foldTerm("Prédio")).toBe("predio");
    expect(foldTerm("PÔSTER")).toBe("poster");
    expect(foldTerm("Soccer248")).toBe("soccer248");
  });

  it("apara pontuação de borda sem quebrar o miolo", () => {
    expect(foldTerm("(billboard)")).toBe("billboard");
    expect(foldTerm("t-shirt")).toBe("t-shirt");
  });

  it("não explode em string vazia ou só-pontuação", () => {
    expect(foldTerm("")).toBe("");
    expect(foldTerm("---")).toBe("");
  });
});

describe("expandTerm", () => {
  it("cruza PT↔EN nas duas direções", () => {
    expect(expandTerm("outdoor")).toContain("billboard");
    expect(expandTerm("billboard")).toContain("outdoor");
    expect(expandTerm("camiseta")).toContain("tshirt");
    expect(expandTerm("mug")).toContain("caneca");
  });

  it("expande mesmo com acento na query", () => {
    expect(expandTerm("prédio")).toContain("facade");
  });

  it("acumula quando o termo vive em mais de um grupo", () => {
    // "fachada" é prédio E letreiro — não pode um grupo sobrescrever o outro.
    const f = expandTerm("fachada");
    expect(f).toContain("building");
    expect(f).toContain("signage");
  });

  it("termo desconhecido volta ele mesmo, normalizado", () => {
    expect(expandTerm("Hockey")).toEqual(["hockey"]);
  });

  it("nunca emite token curto — regressão do 't-shirt'", () => {
    // "t-shirt" no dicionário era tokenizado em ["t","shirt"], e o "t" com prefix-match
    // trazia 1444 de 1620 itens. Nenhuma expansão pode conter caco de 1–2 letras.
    for (const seed of ["camiseta", "outdoor", "app", "celular", "cartao"]) {
      for (const t of expandTerm(seed)) {
        expect(t.length).toBeGreaterThanOrEqual(MIN_SYNONYM_LEN);
        expect(t).not.toMatch(/[\s\-_/.,]/);
      }
    }
  });

  it("não funde 'prédio' com 'parede' (quase todo mockup está numa parede)", () => {
    expect(expandTerm("predio")).not.toContain("wall");
    expect(expandTerm("parede")).not.toContain("building");
  });

  it("cobre um vocabulário não-trivial", () => {
    expect(SYNONYM_TERM_COUNT).toBeGreaterThan(200);
  });
});
