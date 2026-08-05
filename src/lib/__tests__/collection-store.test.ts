/**
 * O store resolve o arquivo no import. Como `hidden-store.test.ts` faz com o
 * cwd, aqui cada teste roda contra um arquivo temporário — a diferença é que o
 * caminho vem de `BRAND_COLLECTIONS_FILE` (override documentado no store), o
 * que evita mockar `process.cwd()` global.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { existsSync, mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const ROOT = mkdtempSync(join(tmpdir(), "collection-store-"));
const FILE = join(ROOT, "data", "brand-collections.json");
process.env.BRAND_COLLECTIONS_FILE = FILE;

async function freshStore() {
  vi.resetModules();
  return import("../collection-store");
}

beforeEach(() => {
  rmSync(join(ROOT, "data"), { recursive: true, force: true });
});

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
  delete process.env.BRAND_COLLECTIONS_FILE;
});

const ids = (col: { items: { id: string }[] }) => col.items.map((i) => i.id);

describe("collection-store", () => {
  it("começa vazio quando não há arquivo", async () => {
    const { getCollections, getCollection, collectionCounts } = await freshStore();
    expect((await getCollections()).data.collections).toEqual({});
    expect(await getCollection("acme")).toBeNull();
    expect(await collectionCounts()).toEqual({});
  });

  it("adiciona no fim preservando a ordem e persiste no disco", async () => {
    const { setMembers } = await freshStore();
    expect(ids(await setMembers("acme", ["c", "a"], true))).toEqual(["c", "a"]);
    expect(ids(await setMembers("acme", ["b"], true))).toEqual(["c", "a", "b"]);
    expect(existsSync(FILE)).toBe(true);

    const outroProcesso = await freshStore();
    const col = await outroProcesso.getCollection("acme");
    expect(col && ids(col)).toEqual(["c", "a", "b"]);
    expect(col?.updatedAt).toBeGreaterThan(0);
  });

  it("adicionar de novo é idempotente e não reordena", async () => {
    const { setMembers } = await freshStore();
    await setMembers("acme", ["a", "b"], true);
    expect(ids(await setMembers("acme", ["b", "a"], true))).toEqual(["a", "b"]);
  });

  it("remover tira só o pedido e remover de novo não explode", async () => {
    const { setMembers } = await freshStore();
    await setMembers("acme", ["a", "b", "c"], true);
    expect(ids(await setMembers("acme", ["b"], false))).toEqual(["a", "c"]);
    expect(ids(await setMembers("acme", ["b"], false))).toEqual(["a", "c"]);
  });

  it("ignora id vazio ou que não é string", async () => {
    const { setMembers } = await freshStore();
    const col = await setMembers("acme", ["ok", "", null as unknown as string], true);
    expect(ids(col)).toEqual(["ok"]);
  });

  it("reorder respeita a lista e joga os ausentes no fim, sem sumir", async () => {
    const { setMembers, reorder } = await freshStore();
    await setMembers("acme", ["a", "b", "c", "d"], true);
    // 'b' e 'd' não foram citados: continuam lá, na ordem relativa original.
    expect(ids(await reorder("acme", ["c", "a"]))).toEqual(["c", "a", "b", "d"]);
    // id que não existe na coleção é ruído — ignorado.
    expect(ids(await reorder("acme", ["fantasma", "b"]))).toEqual(["b", "c", "a", "d"]);
  });

  it("renomeia; nome vazio volta ao default", async () => {
    const { setMembers, renameCollection, defaultCollectionName } = await freshStore();
    await setMembers("acme", ["a"], true);
    expect((await renameCollection("acme", "Campanha 2026")).name).toBe("Campanha 2026");
    expect((await renameCollection("acme", "   ")).name).toBe(defaultCollectionName());
  });

  it("note vazio remove o campo em vez de gravar string vazia", async () => {
    const { setMembers, setNote } = await freshStore();
    await setMembers("acme", ["a"], true);
    expect((await setNote("acme", "a", "hero da campanha")).items[0].note).toBe("hero da campanha");
    const col = await setNote("acme", "a", "  ");
    expect("note" in col.items[0]).toBe(false);
    expect(JSON.parse(readFileSync(FILE, "utf8")).collections.acme.items[0].note).toBeUndefined();
  });

  it("a versão muda a cada escrita — é o que invalida quem cacheia", async () => {
    const { getCollections, setMembers } = await freshStore();
    const v0 = (await getCollections()).version;
    await setMembers("acme", ["a"], true);
    expect((await getCollections()).version).toBeGreaterThan(v0);
  });

  it("conta por marca", async () => {
    const { setMembers, collectionCounts } = await freshStore();
    await setMembers("acme", ["a", "b"], true);
    await setMembers("globex", ["z"], true);
    expect(await collectionCounts()).toEqual({ acme: 2, globex: 1 });
  });

  it("arquivo corrompido não derruba o grid", async () => {
    mkdirSync(join(ROOT, "data"), { recursive: true });
    writeFileSync(FILE, "{ isso não é json");
    const { getCollections, getCollection } = await freshStore();
    expect((await getCollections()).data.collections).toEqual({});
    expect(await getCollection("acme")).toBeNull();
  });

  it("item torto no arquivo é descartado sem levar a coleção junto", async () => {
    mkdirSync(join(ROOT, "data"), { recursive: true });
    writeFileSync(
      FILE,
      JSON.stringify({
        version: 1,
        collections: {
          acme: { name: "Acme", items: [{ id: "a" }, { nope: 1 }, "lixo", { id: "a" }], updatedAt: 1 },
        },
      }),
    );
    const { getCollection } = await freshStore();
    const col = await getCollection("acme");
    expect(col?.name).toBe("Acme");
    expect(col && ids(col)).toEqual(["a"]);
  });

  it("nome legado com o id da marca conta como default, não como escolha do usuário", async () => {
    mkdirSync(join(ROOT, "data"), { recursive: true });
    writeFileSync(
      FILE,
      JSON.stringify({
        version: 1,
        collections: {
          "69e8e78b51a13978c9bc90d8": {
            name: "Coleção 69e8e78b51a13978c9bc90d8",
            items: [{ id: "a", addedAt: 1 }],
            updatedAt: 1,
          },
          globex: { name: "Campanha 2026", items: [], updatedAt: 2 },
        },
      }),
    );
    const { getCollection } = await freshStore();
    // O id de banco não pode vazar para a tela como se fosse nome.
    expect((await getCollection("69e8e78b51a13978c9bc90d8"))?.name).toBe("Coleção");
    // Nome de gente continua intacto.
    expect((await getCollection("globex"))?.name).toBe("Campanha 2026");
  });

  it("cria coleção avulsa (sem marca) e ela convive com as de marca", async () => {
    const { createCollection, setMembers, getCollection, listCollections } = await freshStore();
    await setMembers("acme", ["a"], true);
    const avulsa = await createCollection("Referências de tipografia");
    expect(avulsa.id.startsWith("col_")).toBe(true);
    expect(avulsa.brandId).toBeUndefined();

    // A chave que não é `col_…` é brandId — é assim que a lista sabe de quem é.
    expect((await getCollection("acme"))?.brandId).toBe("acme");
    expect((await getCollection(avulsa.id))?.brandId).toBeUndefined();

    const items = await setMembers(avulsa.id, ["x", "y"], true);
    expect(ids(items)).toEqual(["x", "y"]);
    expect((await listCollections()).map((c) => c.id).sort()).toEqual([avulsa.id, "acme"].sort());
  });

  it("apagar tira a coleção do arquivo; apagar o que não existe é false", async () => {
    const { createCollection, deleteCollection, getCollection } = await freshStore();
    const col = await createCollection("Temporária");
    expect(await deleteCollection(col.id)).toBe(true);
    expect(await getCollection(col.id)).toBeNull();
    expect(await deleteCollection(col.id)).toBe(false);
    expect(JSON.parse(readFileSync(FILE, "utf8")).collections[col.id]).toBeUndefined();
  });

  it("brandId inválido não escreve nada", async () => {
    const { setMembers } = await freshStore();
    await expect(setMembers("", ["a"], true)).rejects.toThrow(/brandId/);
    expect(existsSync(FILE)).toBe(false);
  });
});
