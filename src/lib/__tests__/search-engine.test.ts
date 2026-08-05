import { describe, it, expect } from "vitest";
import {
  buildIndex, runSearch, computeFacets, aspectBucket, matchesFacets,
  borrowSiblingThumbnails, mockupBaseName,
  type SearchDoc,
} from "../search-engine";

function doc(p: Partial<SearchDoc> & { id: string; name: string }): SearchDoc {
  return {
    studio: "Acme", description: "", tags: [], mockupType: [], source: "mongo",
    psdPath: "/x.psd", ...p,
  };
}

/** Catálogo sintético que reproduz as armadilhas reais do acervo (PT+EN, ruído, 1:1). */
const DOCS: SearchDoc[] = [
  doc({ id: "bb1", name: "MM_Billboard_BB-TKY-11", tags: ["billboard", "signage"], mockupType: ["outdoor advertising"], aspect: 1.8, studio: "Mockups Maison" }),
  doc({ id: "bb2", name: "BR Outdoor 02", tags: ["billboard"], mockupType: ["signage"], aspect: 1.9, studio: "Boxy Mockups" }),
  doc({ id: "ts1", name: "Holding T-Shirt", tags: ["apparel"], mockupType: ["t-shirt"], aspect: 0.75, studio: "Boxy Mockups" }),
  doc({ id: "mug1", name: "Soft Mug", tags: ["mug", "tableware"], mockupType: ["product display"], aspect: 1.0 }),
  doc({ id: "fac1", name: "HM_BANNER_044", tags: ["mural"], mockupType: ["building facade"], aspect: 1.5, studio: "Hazard Mockups" }),
  doc({ id: "tea1", name: "Teatro Municipal Poster", tags: ["poster"], mockupType: ["print"], aspect: 0.7 }),
  doc({ id: "sc1", name: "01_billboard_urbano", tags: ["photo", "publicada"], mockupType: ["billboard"], aspect: 1.77, type: "photo", psdPath: undefined, photoSceneId: "sc1", source: "fs", studio: "Hockey Direct" }),
];

const MINI = buildIndex(DOCS);
const search = (q: Parameters<typeof runSearch>[2]) => runSearch(DOCS, MINI, q);

describe("aspectBucket", () => {
  it("classifica os três formatos e rejeita lixo", () => {
    expect(aspectBucket(1.0)).toBe("square");
    expect(aspectBucket(0.5)).toBe("portrait");
    expect(aspectBucket(1.78)).toBe("landscape");
    expect(aspectBucket(undefined)).toBeUndefined();
    expect(aspectBucket(0)).toBeUndefined();
    expect(aspectBucket(NaN)).toBeUndefined();
  });
});

describe("busca", () => {
  it("acha em EN escrevendo em PT (sinônimo)", () => {
    const ids = search({ search: "outdoor" }).references.map((r) => r.id);
    expect(ids).toContain("bb1");
    expect(ids).toContain("bb2");
  });

  it("acha t-shirt escrevendo camiseta", () => {
    expect(search({ search: "camiseta" }).references.map((r) => r.id)).toContain("ts1");
  });

  it("tolera typo de 2 edições — regressão do 'bilbord'", () => {
    const r = search({ search: "bilbord" });
    expect(r.total).toBeGreaterThan(0);
    expect(r.references.map((d) => d.id)).toContain("bb1");
    // Precisou afrouxar: prova que a cascata entrou em ação em vez de devolver zero.
    expect(r.pass).toBeGreaterThan(1);
  });

  it("query exata resolve no primeiro passe (sem pagar o ruído do fuzzy)", () => {
    expect(search({ search: "billboard" }).pass).toBe(1);
  });

  it("passe frouxo só ACRESCENTA na cauda — nunca desloca o acerto exato do topo", () => {
    // Regressão: a cascata SUBSTITUÍA o resultado do passe exato quando vinham poucos
    // hits, então 3 acertos perfeitos afundavam no meio do ruído do fuzzy+OR.
    const r = search({ search: "billboard" });
    const exatos = ["bb1", "bb2", "sc1"];
    const topo = r.references.slice(0, exatos.length).map((d) => d.id);
    expect(topo.sort()).toEqual([...exatos].sort());
  });

  it("não confunde prédio com parede", () => {
    expect(search({ search: "predio" }).references.map((r) => r.id)).toContain("fac1");
  });

  it("ignora acento e caixa", () => {
    expect(search({ search: "PRÉDIO" }).references.map((r) => r.id)).toContain("fac1");
  });

  it("multi-token combina com AND, não com OR", () => {
    // "mug" sozinho acha a caneca; "mug teatro" não pode achar nada relevante no passe 1.
    expect(search({ search: "mug" }).references.map((r) => r.id)).toContain("mug1");
  });

  it("termo sem nenhum match devolve zero — e não inventa resultado", () => {
    expect(search({ search: "xyzzyplugh" }).total).toBe(0);
  });

  it("busca vazia lista tudo em ordem alfabética estável", () => {
    const r = search({});
    expect(r.total).toBe(DOCS.length);
    const names = r.references.map((d) => d.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });
});

describe("facetas", () => {
  it("filtra por estúdio", () => {
    const r = search({ studio: "Hockey Direct" });
    expect(r.total).toBe(1);
    expect(r.references[0].id).toBe("sc1");
  });

  it("filtra por aspecto", () => {
    expect(search({ aspect: "square" }).references.map((r) => r.id)).toEqual(["mug1"]);
    expect(search({ aspect: "portrait" }).total).toBe(2);
  });

  it("combina busca + faceta (a faceta corta antes do rank)", () => {
    const r = search({ search: "billboard", aspect: "landscape" });
    expect(r.total).toBeGreaterThan(0);
    expect(r.references.every((d) => aspectBucket(d.aspect) === "landscape")).toBe(true);
  });

  it("requirePsd deixa passar cena photo sem PSD", () => {
    const ids = search({ requirePsd: true }).references.map((r) => r.id);
    expect(ids).toContain("sc1");
    expect(ids.length).toBe(DOCS.length);
  });

  it("tag casa em tags, mockupType ou estúdio, com AND/OR", () => {
    expect(matchesFacets(DOCS[0], { tags: ["billboard"] })).toBe(true);
    expect(matchesFacets(DOCS[0], { tags: ["billboard", "signage"], tagMode: "AND" })).toBe(true);
    expect(matchesFacets(DOCS[0], { tags: ["billboard", "inexistente"], tagMode: "AND" })).toBe(false);
    expect(matchesFacets(DOCS[0], { tags: ["billboard", "inexistente"], tagMode: "OR" })).toBe(true);
    // estúdio conta como tag (o grid agrupa por estúdio)
    expect(matchesFacets(DOCS[0], { tags: ["Mockups Maison"] })).toBe(true);
  });

  it("sem tagMode o padrão é OR: tag a mais AMPLIA o recorte", () => {
    // Era AND, e por isso o segundo clique na taxonomia quase sempre esvaziava
    // o grid. Se este teste voltar a falhar, o padrão foi revertido — e o
    // sintoma na tela é o acervo encolhendo a cada faceta ligada.
    expect(matchesFacets(DOCS[0], { tags: ["billboard", "inexistente"] })).toBe(true);
    const um = search({ tags: ["billboard"] }).total;
    const dois = search({ tags: ["billboard", "poster"] }).total;
    expect(dois).toBeGreaterThanOrEqual(um);
  });

  it("conta facetas sem deixar um chip zerar os outros", () => {
    // Contando COM studio aplicado, os outros estúdios ainda precisam aparecer — senão
    // o usuário entra num filtro e não consegue mais trocar de estúdio.
    const f = computeFacets(DOCS, { studio: "Hockey Direct" });
    expect(f.studios.length).toBeGreaterThan(1);
    expect(f.aspects.find((a) => a.name === "square")?.count).toBe(1);
  });
});

describe("paginação", () => {
  it("pagina sem perder nem repetir item", () => {
    const p1 = runSearch(DOCS, MINI, { limit: 3, page: 1 });
    const p2 = runSearch(DOCS, MINI, { limit: 3, page: 2 });
    expect(p1.references).toHaveLength(3);
    expect(p1.pages).toBe(Math.ceil(DOCS.length / 3));
    const ids = new Set([...p1.references, ...p2.references].map((d) => d.id));
    expect(ids.size).toBe(6);
  });

  it("página além do fim devolve vazio, não estoura", () => {
    expect(runSearch(DOCS, MINI, { limit: 3, page: 99 }).references).toEqual([]);
  });
});

describe("ranking aprendido (boostDocument)", () => {
  it("popularidade desempata sem sequestrar a relevância", () => {
    const semBoost = runSearch(DOCS, MINI, { search: "billboard" }).references.map((d) => d.id);
    // bb2 é o menos relevante textualmente entre os billboards; com sinal forte ele sobe...
    const comBoost = runSearch(DOCS, MINI, { search: "billboard" }, (id) => (id === "bb2" ? 1 : 0)).references.map((d) => d.id);
    expect(comBoost.indexOf("bb2")).toBeLessThanOrEqual(semBoost.indexOf("bb2"));
    // ...mas o conjunto de resultados não muda: popularidade reordena, não inventa match.
    expect([...comBoost].sort()).toEqual([...semBoost].sort());
  });

  it("boost não traz doc que não casa com o texto", () => {
    const ids = runSearch(DOCS, MINI, { search: "billboard" }, (id) => (id === "mug1" ? 1 : 0)).references.map((d) => d.id);
    expect(ids).not.toContain("mug1");
  });
});

describe("ordenação da listagem (sem query)", () => {
  // O acervo real abria com `01`, `01 Displacement`, `01 Displacement Pequena`,
  // `01 Form Displacer`… — cinco variações do mesmo bundle nas cinco primeiras
  // posições, porque a listagem era `localeCompare` do nome e nome de arquivo não
  // é critério de escolha de mockup.
  const pop = (id: string) => (id === "mug1" ? 1 : id === "tea1" ? 0.5 : 0);

  it("default é popularidade — o mais aberto vem primeiro", () => {
    const ids = runSearch(DOCS, MINI, {}, pop).references.map((d) => d.id);
    expect(ids[0]).toBe("mug1");
    expect(ids[1]).toBe("tea1");
  });

  it("empate cai no alfabético — acervo novo (zero clique) não muda de comportamento", () => {
    const zerado = runSearch(DOCS, MINI, {}, () => 0).references.map((d) => d.name);
    const alfabetico = runSearch(DOCS, MINI, { sort: "name" }).references.map((d) => d.name);
    expect(zerado).toEqual(alfabetico);
    expect(alfabetico).toEqual([...alfabetico].sort((a, b) => a.localeCompare(b)));
  });

  it("sort=name ignora a popularidade (a escolha do usuário manda)", () => {
    const ids = runSearch(DOCS, MINI, { sort: "name" }, pop).references.map((d) => d.id);
    expect(ids[0]).not.toBe("mug1");
  });

  it("com texto, quem ordena é a relevância — sort não sequestra a busca", () => {
    const a = runSearch(DOCS, MINI, { search: "billboard" }, pop).references.map((d) => d.id);
    const b = runSearch(DOCS, MINI, { search: "billboard", sort: "name" }, pop).references.map((d) => d.id);
    expect(a).toEqual(b);
    expect(a).not.toContain("mug1");
  });

  it("ordenar não muda o conjunto nem a contagem", () => {
    const p = runSearch(DOCS, MINI, {}, pop);
    const n = runSearch(DOCS, MINI, { sort: "name" });
    expect(p.total).toBe(n.total);
    expect(p.references.map((d) => d.id).sort()).toEqual(n.references.map((d) => d.id).sort());
  });
});

describe("thumbnails órfãs (empréstimo entre irmãos)", () => {
  // Medido no acervo real: 55 de 200 itens da primeira página sem imagem, 39 deles
  // com um irmão que TINHA — `01 Displacement` cego e `01 Displacement Pequena`,
  // o mesmo mockup, exibindo a foto.
  const D = (name: string, studio: string, url?: string) => ({ name, studio, referenceImageUrl: url });

  it("o PSD herda a imagem do preview de mesmo nome-base", () => {
    const { docs, borrowed } = borrowSiblingThumbnails([
      D("01 Displacement", "MOCKUPS 1.0"),
      D("01 Displacement Pequena", "MOCKUPS 1.0", "/img/a.jpg"),
    ]);
    expect(borrowed).toBe(1);
    expect(docs[0].referenceImageUrl).toBe("/img/a.jpg");
  });

  it("não cruza estúdios — homônimos de acervos diferentes não são o mesmo mockup", () => {
    const { docs, borrowed } = borrowSiblingThumbnails([
      D("Poster A", "Estúdio X"),
      D("Poster A Média", "Estúdio Y", "/img/b.jpg"),
    ]);
    expect(borrowed).toBe(0);
    expect(docs[0].referenceImageUrl).toBeUndefined();
  });

  it("sem irmão continua sem imagem — o vazio é informação, não buraco a tapar", () => {
    const { docs, borrowed } = borrowSiblingThumbnails([D("Sozinho", "X")]);
    expect(borrowed).toBe(0);
    expect(docs[0].referenceImageUrl).toBeUndefined();
  });

  it("nunca sobrescreve uma imagem que já existe", () => {
    const { docs } = borrowSiblingThumbnails([
      D("Y", "X", "/img/proprio.jpg"),
      D("Y Pequena", "X", "/img/irmao.jpg"),
    ]);
    expect(docs[0].referenceImageUrl).toBe("/img/proprio.jpg");
  });

  it("nome-base ignora extensão e sufixo de tamanho", () => {
    expect(mockupBaseName("01 Form Displacer Pequena.jpeg")).toBe(mockupBaseName("01_Form-Displacer.psd"));
    expect(mockupBaseName("HM_POSTER_022preview")).toBe("hm poster 022preview");
  });
});
