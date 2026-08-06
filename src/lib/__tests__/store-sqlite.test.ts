import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { bancoLocal, fecharBanco, FiltroNaoSuportado } from "../store-sqlite";

process.env.LOCAL_DB_PATH = ":memory:";

function db() {
  return bancoLocal();
}

beforeEach(() => {
  fecharBanco();
});
afterAll(() => fecharBanco());

const REF = {
  id: "ref-1",
  name: "A5 Paper Mockup",
  studio: "BOXY",
  category: "reference",
  isAdminCurated: true,
  description: "papel a5 sobre mesa",
  tags: ["paper", "print"],
  dimensions: { mockup_type: ["poster", "print"] },
};

describe("insertOne + findOne", () => {
  it("grava e le de volta o documento inteiro", async () => {
    const col = db().collection("community_presets");
    await col.insertOne(REF);
    expect(await col.findOne({ id: "ref-1" })).toMatchObject({ name: "A5 Paper Mockup" });
  });

  it("findOne sem match devolve null, nao undefined", async () => {
    expect(await db().collection("community_presets").findOne({ id: "nao-existe" })).toBeNull();
  });
});

describe("find", () => {
  beforeEach(async () => {
    const col = db().collection("community_presets");
    await col.insertOne(REF);
    await col.insertOne({
      ...REF,
      id: "ref-2",
      name: "Billboard",
      isAdminCurated: false,
      dimensions: { mockup_type: ["outdoor"] },
    });
    await col.insertOne({ ...REF, id: "ref-3", name: "Mug", tags: ["mug"], dimensions: { mockup_type: ["device"] } });
  });

  /** O filtro exato que monta o catalogo (`fetchMongoDocs`). */
  it("casa igualdade em varios campos, inclusive booleano", async () => {
    const r = await db()
      .collection("community_presets")
      .find({ category: "reference", isAdminCurated: true })
      .toArray();
    expect(r.map((d) => d.id).sort()).toEqual(["ref-1", "ref-3"]);
  });

  /**
   * `dimensions.mockup_type` e um ARRAY no documento. O Mongo casa quando o
   * array CONTEM o valor, e o suggest-core depende disso — se aqui casasse so
   * escalar, toda sugestao por dimensao voltaria vazia.
   */
  it("caminho pontilhado casa elemento dentro de array", async () => {
    const r = await db()
      .collection("community_presets")
      .find({ "dimensions.mockup_type": "poster" })
      .toArray();
    expect(r.map((d) => d.id)).toEqual(["ref-1"]);
  });

  it("$or junta condicoes", async () => {
    const r = await db()
      .collection("community_presets")
      .find({ $or: [{ "dimensions.mockup_type": "poster" }, { "dimensions.mockup_type": "device" }] })
      .toArray();
    expect(r.map((d) => d.id).sort()).toEqual(["ref-1", "ref-3"]);
  });

  it("$text procura em nome, descricao e tags", async () => {
    const r = await db()
      .collection("community_presets")
      .find({ $text: { $search: "billboard" } })
      .toArray();
    expect(r.map((d) => d.id)).toEqual(["ref-2"]);
  });

  it("sort e limit valem", async () => {
    const r = await db().collection("community_presets").find({}).sort({ name: 1 }).limit(2).toArray();
    expect(r.map((d) => d.name)).toEqual(["A5 Paper Mockup", "Billboard"]);
  });

  it("projecao e aceita e ignorada — devolve o doc inteiro", async () => {
    const [d] = await db().collection("community_presets").find({ id: "ref-1" }, { projection: { id: 1 } }).toArray();
    expect(d.studio).toBe("BOXY");
  });
});

describe("updateOne", () => {
  it("upsert cria carregando os campos de igualdade do filtro", async () => {
    const col = db().collection("psd_metadata");
    await col.updateOne({ fileName: "x.psd" }, { $set: { faces: 3 } }, { upsert: true });
    expect(await col.findOne({ fileName: "x.psd" })).toMatchObject({ fileName: "x.psd", faces: 3 });
  });

  it("update funde no doc existente em vez de substituir", async () => {
    const col = db().collection("psd_metadata");
    await col.insertOne({ fileName: "y.psd", faces: 1, extra: "manter" });
    await col.updateOne({ fileName: "y.psd" }, { $set: { faces: 9 } });
    expect(await col.findOne({ fileName: "y.psd" })).toMatchObject({ faces: 9, extra: "manter" });
  });

  /** Regressao: localizar pela chave do doc NOVO perderia a linha em silencio. */
  it("$set que muda a propria chave ainda grava", async () => {
    const col = db().collection("community_presets");
    await col.insertOne({ id: "antigo", name: "n" });
    await col.updateOne({ id: "antigo" }, { $set: { id: "novo" } });
    expect(await col.findOne({ id: "novo" })).toMatchObject({ name: "n" });
  });

  it("sem upsert e sem match nao cria nada", async () => {
    const col = db().collection("psd_metadata");
    await col.updateOne({ fileName: "z.psd" }, { $set: { faces: 1 } });
    expect(await col.findOne({ fileName: "z.psd" })).toBeNull();
  });
});

/**
 * A propriedade que torna este adaptador seguro. Ignorar um filtro que nao se
 * entende devolveria a COLECAO INTEIRA onde o chamador esperava um recorte, e
 * ninguem descobriria olhando a tela — exatamente a classe de erro silencioso
 * que este projeto ja pagou caro.
 */
describe("cerca: o que nao e suportado estoura, nunca devolve errado", () => {
  // O `find` traduz o filtro na hora de montar o cursor, entao estoura
  // SINCRONO — antes de qualquer `await`. Melhor assim: falha no ponto da
  // chamada, com a stack apontando o filtro culpado.
  it("operador desconhecido em campo estoura", () => {
    expect(() => db().collection("community_presets").find({ name: { $regex: "a" } })).toThrow(
      FiltroNaoSuportado,
    );
  });

  it("operador de topo desconhecido estoura", () => {
    expect(() => db().collection("community_presets").find({ $nor: [{ id: "x" }] })).toThrow(
      FiltroNaoSuportado,
    );
  });

  it("colecao desconhecida estoura em vez de criar tabela nova", () => {
    expect(() => db().collection("inventada")).toThrow(/Coleção desconhecida/);
  });

  it("update sem $set estoura", async () => {
    await expect(
      db().collection("psd_metadata").updateOne({ fileName: "a" }, {} as never),
    ).rejects.toThrow(FiltroNaoSuportado);
  });
});

describe("$exists", () => {
  it("distingue campo presente de ausente", async () => {
    const col = db().collection("psd_metadata");
    await col.insertOne({ fileName: "com.psd", filePath: "Z:/a.psd" });
    await col.insertOne({ fileName: "sem.psd" });
    const com = await col.find({ filePath: { $exists: true } }).toArray();
    expect(com.map((d) => d.fileName)).toEqual(["com.psd"]);
  });
});
