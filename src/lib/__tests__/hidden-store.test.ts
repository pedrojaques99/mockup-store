import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { existsSync, mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// O store resolve o arquivo a partir de process.cwd() no import — cada teste roda
// num cwd temporário para não sujar o data/ do projeto.
const ROOT = mkdtempSync(join(tmpdir(), "hidden-store-"));
const FILE = join(ROOT, "data", "hidden-refs.json");
vi.spyOn(process, "cwd").mockReturnValue(ROOT);

async function freshStore() {
  vi.resetModules();
  return import("../hidden-store");
}

beforeEach(() => {
  rmSync(join(ROOT, "data"), { recursive: true, force: true });
});

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

describe("hidden-store", () => {
  it("começa vazio quando não há arquivo", async () => {
    const { getHidden } = await freshStore();
    expect([...(await getHidden()).ids]).toEqual([]);
  });

  it("esconde, persiste ordenado e relê do disco", async () => {
    const { setHidden } = await freshStore();
    expect(await setHidden(["zeta", "alfa"], true)).toEqual(["alfa", "zeta"]);
    expect(existsSync(FILE)).toBe(true);
    expect(JSON.parse(readFileSync(FILE, "utf8"))).toEqual(["alfa", "zeta"]);

    const outroProcesso = await freshStore();
    expect([...(await outroProcesso.getHidden()).ids].sort()).toEqual(["alfa", "zeta"]);
  });

  it("reexibir remove só o id pedido", async () => {
    const { setHidden } = await freshStore();
    await setHidden(["a", "b"], true);
    expect(await setHidden(["a"], false)).toEqual(["b"]);
  });

  it("a versão muda a cada escrita — é o que invalida o índice de busca", async () => {
    const { getHidden, setHidden } = await freshStore();
    const v0 = (await getHidden()).version;
    await setHidden(["x"], true);
    expect((await getHidden()).version).toBeGreaterThan(v0);
  });

  it("arquivo corrompido não derruba o grid", async () => {
    mkdirSync(join(ROOT, "data"), { recursive: true });
    writeFileSync(FILE, "{ isso não é json");
    const { getHidden } = await freshStore();
    expect([...(await getHidden()).ids]).toEqual([]);
  });

  it("ignora entrada que não é string", async () => {
    const { setHidden } = await freshStore();
    expect(await setHidden(["ok", "", null as unknown as string], true)).toEqual(["ok"]);
  });
});
