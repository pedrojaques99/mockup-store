/**
 * Fusão densa (busca por vibe) e embaralhamento semeado (home que muda).
 *
 * As duas features vivem no motor PURO, então dá pra provar as propriedades que importam
 * sem rede, sem chave de embeddings e sem banco — que é exatamente o ponto: a camada densa
 * é aditiva, e o "aleatório" da home é determinístico por semente.
 */
import { describe, it, expect } from "vitest";
import {
  buildIndex, runSearch, fuseRRF, shuffleOrder, mockupKey,
  type SearchDoc,
} from "../search-engine";

function doc(p: Partial<SearchDoc> & { id: string; name: string }): SearchDoc {
  return {
    studio: "Acme", description: "", tags: [], mockupType: [], source: "mongo",
    psdPath: "/x.psd", ...p,
  };
}

const DOCS: SearchDoc[] = [
  doc({ id: "bb1", name: "MM_Billboard_BB-TKY-11", tags: ["billboard"], aspect: 1.8, studio: "Mockups Maison" }),
  doc({ id: "bb2", name: "BR Outdoor 02", tags: ["billboard"], aspect: 1.9, studio: "Boxy Mockups" }),
  doc({ id: "obra", name: "Tapume de Obra", tags: ["canteiro", "construcao"], aspect: 1.6, studio: "Boxy Mockups" }),
  doc({ id: "mug1", name: "Soft Mug", tags: ["mug"], aspect: 1.0 }),
  doc({ id: "ts1", name: "Holding T-Shirt", tags: ["apparel"], aspect: 0.75 }),
];
const MINI = buildIndex(DOCS);

describe("fuseRRF", () => {
  it("sem lista densa, devolve a léxica intacta", () => {
    expect(fuseRRF(["a", "b", "c"], [])).toEqual(["a", "b", "c"]);
  });

  it("sem lista léxica, devolve a densa intacta", () => {
    expect(fuseRRF([], ["x", "y"])).toEqual(["x", "y"]);
  });

  it("o que as duas listas concordam sobe acima de um 1º lugar isolado", () => {
    // "b" é 2º nos dois motores; "a" é 1º só no léxico. Concordância vence pico solitário.
    expect(fuseRRF(["a", "b"], ["z", "b"])[0]).toBe("b");
  });

  it("o léxico tem mais peso — quem digitou o nome exato ganha o desempate", () => {
    // Mesma posição nos dois lados: só o peso decide.
    expect(fuseRRF(["lex"], ["dense"])[0]).toBe("lex");
  });

  it("traz o que só a camada densa achou, mas atrás", () => {
    const out = fuseRRF(["a"], ["novo"]);
    expect(out).toContain("novo");
    expect(out.indexOf("a")).toBeLessThan(out.indexOf("novo"));
  });

  it("é estável: mesmas entradas, mesma ordem", () => {
    const a = fuseRRF(["a", "b", "c"], ["c", "d", "a"]);
    const b = fuseRRF(["a", "b", "c"], ["c", "d", "a"]);
    expect(a).toEqual(b);
  });
});

describe("runSearch com camada densa", () => {
  it("sem semanticIds o resultado é byte-a-byte o de antes", () => {
    const sem = runSearch(DOCS, MINI, { search: "billboard" }, undefined, []);
    const base = runSearch(DOCS, MINI, { search: "billboard" });
    expect(sem.references.map((d) => d.id)).toEqual(base.references.map((d) => d.id));
    expect(sem.pass).toBe(base.pass);
  });

  it("'engenharia' já chega no tapume de obra pelo vocabulário de vibe, sem rede", () => {
    // Os clusters de setor em `search-synonyms` cobrem o caso comum offline. A camada
    // densa existe para o que NENHUM cluster previu — é a divisão de trabalho entre as duas.
    expect(runSearch(DOCS, MINI, { search: "engenharia" }).references.map((d) => d.id)).toContain("obra");
  });

  it("resgata o que nenhum sinônimo previu — query sem acerto léxico nenhum", () => {
    const base = runSearch(DOCS, MINI, { search: "zzqx" });
    expect(base.total).toBe(0);
    const vibe = runSearch(DOCS, MINI, { search: "zzqx" }, undefined, ["obra"]);
    expect(vibe.references.map((d) => d.id)).toContain("obra");
    // pass 4 = nenhum passe léxico achou nada; quem salvou foi a densa.
    expect(vibe.pass).toBe(4);
  });

  it("a camada densa obedece às facetas — não fura filtro", () => {
    const r = runSearch(DOCS, MINI, { search: "engenharia", studio: "Mockups Maison" }, undefined, ["obra"]);
    expect(r.references.map((d) => d.id)).not.toContain("obra");
  });

  it("não sequestra a query exata: o acerto léxico continua no topo", () => {
    const r = runSearch(DOCS, MINI, { search: "billboard" }, undefined, ["mug1", "ts1"]);
    expect(["bb1", "bb2"]).toContain(r.references[0].id);
  });
});

describe("shuffleOrder", () => {
  it("mesma semente, mesma ordem — é o que sustenta a paginação", () => {
    const a = shuffleOrder(DOCS, 42).map((d) => d.id);
    const b = shuffleOrder(DOCS, 42).map((d) => d.id);
    expect(a).toEqual(b);
  });

  it("a ordem não depende da ordem de ENTRADA (página 2 vem com outro array)", () => {
    const a = shuffleOrder(DOCS, 7).map((d) => d.id);
    const b = shuffleOrder([...DOCS].reverse(), 7).map((d) => d.id);
    expect(a).toEqual(b);
  });

  it("sementes diferentes dão home diferente", () => {
    const a = shuffleOrder(DOCS, 1).map((d) => d.id);
    const b = shuffleOrder(DOCS, 999).map((d) => d.id);
    expect(a).not.toEqual(b);
  });

  it("não perde nem duplica nada do acervo", () => {
    const out = shuffleOrder(DOCS, 5).map((d) => d.id).sort();
    expect(out).toEqual(DOCS.map((d) => d.id).sort());
  });

  it("o viés da marca puxa para a frente sem virar filtro", () => {
    const out = shuffleOrder(DOCS, 3, ["mug1", "ts1"]).map((d) => d.id);
    expect(out.slice(0, 2).sort()).toEqual(["mug1", "ts1"]);
    expect(out).toHaveLength(DOCS.length); // o resto continua lá
  });

  it("card sem prévia afunda, mas não some", () => {
    const semPreview = doc({ id: "cego", name: "Sem Foto" });
    const comPreview = DOCS.map((d) => ({ ...d, referenceImageUrl: "/p.webp" }));
    const pool = [...comPreview, semPreview];
    // Em qualquer semente, o cego não abre a lista — e continua presente nela.
    for (const s of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const out = shuffleOrder(pool, s).map((d) => d.id);
      expect(out[0]).not.toBe("cego");
      expect(out).toContain("cego");
    }
  });

  it("popularidade desempata, não manda: o sorteio ainda mistura", () => {
    const pop = (id: string) => (id === "mug1" ? 1 : 0);
    const seeds = [1, 2, 3, 4, 5, 6, 7, 8];
    const first = seeds.map((s) => shuffleOrder(DOCS, s, undefined, pop)[0].id);
    expect(new Set(first).size).toBeGreaterThan(1);
  });

  it("runSearch expõe o shuffle pelo sort, respeitando facetas", () => {
    const r = runSearch(DOCS, MINI, { sort: "shuffle", seed: 11, studio: "Boxy Mockups" });
    expect(r.references.map((d) => d.id).sort()).toEqual(["bb2", "obra"]);
  });
});

describe("contagem do acervo", () => {
  // Medido no acervo real: 4.480 registros com PSD eram 3.520 arquivos distintos. O badge
  // contava linha e chamava de "no acervo" — 18% a mais do que existe no disco.
  const MESMO = "/lib/Billboard.psd";
  const POOL: SearchDoc[] = [
    doc({ id: "a", name: "Billboard", psdPath: MESMO }),
    doc({ id: "b", name: "Billboard Pequena", psdPath: MESMO }),
    doc({ id: "c", name: "Billboard Media", psdPath: MESMO.toUpperCase().replace("/LIB", "/lib") }),
    doc({ id: "d", name: "Outro", psdPath: "/lib/Poster.psd" }),
  ];
  const IDX = buildIndex(POOL);

  it("dois registros do mesmo arquivo são UM mockup", () => {
    const r = runSearch(POOL, IDX, { limit: 50 });
    expect(r.total).toBe(4);
    expect(r.totalDistinct).toBe(2);
  });

  it("a chave ignora barra e caixa do caminho — o mesmo arquivo em Windows e POSIX", () => {
    expect(mockupKey(doc({ id: "x", name: "n", psdPath: "C:\\Lib\\A.psd" })))
      .toBe(mockupKey(doc({ id: "y", name: "n", psdPath: "c:/lib/a.psd" })));
  });

  it("cena-foto conta pela cena, e item sem arquivo conta por si", () => {
    const cena = doc({ id: "s1", name: "Cena", psdPath: undefined, photoSceneId: "sc", type: "photo" });
    const cena2 = doc({ id: "s2", name: "Cena de novo", psdPath: undefined, photoSceneId: "sc", type: "photo" });
    const solto = doc({ id: "z", name: "Solto", psdPath: undefined });
    const pool = [cena, cena2, solto];
    const r = runSearch(pool, buildIndex(pool), { limit: 50 });
    expect(r.total).toBe(3);
    expect(r.totalDistinct).toBe(2);
  });
});
