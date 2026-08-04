import { describe, it, expect } from "vitest";
import { expandTerm, foldTerm, MIN_SYNONYM_LEN, VIBE_TERM_COUNT } from "../search-synonyms";

/**
 * O que está sob teste é a ponte entre a cabeça do usuário e o vocabulário do acervo:
 * "engenharia" não aparece em nenhuma tag, mas `construction` aparece em 354 docs.
 * Sem esses clusters a query devolve zero — e zero, aqui, é o modo mais silencioso
 * de o produto parecer vazio.
 */
describe("clusters de vibe/setor", () => {
  const SETORES: [string, string[]][] = [
    ["engenharia", ["construction", "industrial", "hoarding", "safety"]],
    ["saude", ["medical", "clinical", "healthcare"]],
    ["moda", ["fashion", "apparel", "streetwear"]],
    ["gastronomia", ["food", "restaurant", "bakery", "coffee"]],
    ["tecnologia", ["tech", "software", "electronics"]],
    ["educacao", ["education", "academic", "university"]],
    ["esporte", ["sports", "fitness", "athletic"]],
    ["imobiliario", ["estate", "residential", "architectural"]],
    ["automotivo", ["automotive", "vehicle", "truck"]],
    ["beleza", ["beauty", "cosmetics", "skincare", "barbershop"]],
    ["juridico", ["legal", "corporate", "insurance"]],
    ["musica", ["music", "festival", "venue"]],
    ["varejo", ["retail", "storefront", "shopping"]],
    ["turismo", ["travel", "tourism", "hotel"]],
    ["agro", ["agriculture", "farm", "greenery"]],
  ];

  it.each(SETORES)("%s alcança o vocabulário real do acervo", (termo, esperados) => {
    const got = expandTerm(termo);
    for (const e of esperados) expect(got).toContain(e);
  });

  it("o apelido em inglês chega no mesmo cluster que o em português", () => {
    // Só o DESTINO precisa coincidir: um termo em inglês costuma estar também num
    // GROUPS ("retail" mora no grupo de loja), e aí carrega bagagem extra — o que
    // não pode acontecer é um dos dois idiomas ficar sem o cluster do setor.
    for (const [pt, en, alvos] of [
      ["engenharia", "engineering", ["construction", "industrial", "safety"]],
      ["saude", "healthcare", ["medical", "clinical", "wellness"]],
      ["moda", "fashion", ["apparel", "streetwear", "textile"]],
      ["varejo", "retail", ["storefront", "merchandising", "commerce"]],
      ["turismo", "tourism", ["hotel", "resort", "hospitality"]],
    ] as const) {
      for (const alvo of alvos) {
        expect(expandTerm(pt)).toContain(alvo);
        expect(expandTerm(en)).toContain(alvo);
      }
    }
  });

  it("acento na query não muda nada (o acervo é PT+EN sem padrão)", () => {
    expect(foldTerm("saúde")).toBe("saude");
    expect(foldTerm("Engenharia")).toBe("engenharia");
    expect(foldTerm("JURÍDICO")).toBe("juridico");
    expect(expandTerm("saúde")).toEqual(expandTerm("saude"));
    expect(expandTerm("Automotivo")).toEqual(expandTerm("automotivo"));
  });
});

describe("um setor não vaza no outro", () => {
  const ALHEIOS: [string, string[]][] = [
    ["engenharia", ["cosmetics", "bakery", "fashion", "tourism", "music"]],
    ["beleza", ["construction", "industrial", "automotive", "agriculture"]],
    ["gastronomia", ["legal", "healthcare", "estate", "sports"]],
    ["agro", ["software", "cosmetics", "nightlife", "insurance"]],
    ["juridico", ["bakery", "streetwear", "festival", "farm"]],
  ];

  it.each(ALHEIOS)("%s não traz termo de outro setor", (termo, proibidos) => {
    const got = expandTerm(termo);
    for (const p of proibidos) expect(got).not.toContain(p);
  });

  it("o cluster é de mão única — o objeto não puxa o setor inteiro", () => {
    // Quem digita "helmet" quer capacete, não a obra toda. Se os clusters fossem
    // classe de equivalência (como GROUPS), "coffee" traria padaria, vinho e
    // restaurante junto, e quem sabia o que queria pagaria o ruído.
    expect(expandTerm("helmet")).toEqual(["helmet"]);
    expect(expandTerm("barbershop")).toEqual(["barbershop"]);
    expect(expandTerm("bakery")).toEqual(["bakery"]);
    expect(expandTerm("coffee")).not.toContain("bakery");
  });

  it("termo de setor não deleta a expansão de grupo que já existia", () => {
    // "retail" e "hotel"/"restaurant" vivem nos dois mundos: o grupo de lugares e o
    // cluster de setor. Um não pode sobrescrever o outro.
    const retail = expandTerm("retail");
    expect(retail).toContain("loja"); // vem do GROUPS
    expect(retail).toContain("merchandising"); // vem do cluster
  });
});

describe("higiene dos tokens (regressão do 't-shirt' e do 'car')", () => {
  const SEEDS = [
    "engenharia", "saude", "moda", "gastronomia", "tecnologia", "educacao", "esporte",
    "imobiliario", "automotivo", "beleza", "juridico", "musica", "varejo", "turismo", "agro",
  ];

  it("nenhuma expansão emite caco curto ou termo com separador", () => {
    for (const seed of SEEDS) {
      for (const t of expandTerm(seed)) {
        expect(t.length).toBeGreaterThanOrEqual(MIN_SYNONYM_LEN);
        expect(t).not.toMatch(/[\s\-_/.,]/);
      }
    }
  });

  it("'car' fica fora do cluster automotivo (prefix-match casaria card/cardboard)", () => {
    // O acervo é feito de cartão: "car" com prefixo traria cards, cardboard e cardstock.
    expect(expandTerm("automotivo")).not.toContain("car");
    expect(expandTerm("carro")).not.toContain("car");
  });

  it("é idempotente e estável — mesma query, mesma expansão", () => {
    for (const seed of SEEDS) {
      const a = expandTerm(seed);
      const b = expandTerm(seed);
      expect(b).toEqual(a);
      expect(new Set(a).size).toBe(a.length); // sem repetido
      expect(a).toContain(foldTerm(seed)); // o termo digitado nunca some
    }
  });

  it("cobre os 15 setores com apelidos suficientes pra query real", () => {
    expect(VIBE_TERM_COUNT).toBeGreaterThan(100);
  });
});
