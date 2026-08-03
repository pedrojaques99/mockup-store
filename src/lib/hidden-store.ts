/**
 * Itens escondidos do catálogo.
 *
 * "Esconder" NÃO toca no disco: o `.psd` continua onde estava, o card é que some
 * do grid. Era o que faltava para o painel de duplicatas ser útil sem ser
 * perigoso — dá pra tirar a cópia da frente sem apagar arquivo de ninguém.
 *
 * Antes disso a lista morava em `localStorage` (`mockup-store:hiddenIds`), ou
 * seja: por navegador. Esconder no desktop e reabrir no notebook trazia tudo de
 * volta. Aqui ela vira estado do servidor, com o mesmo formato da ignore-list da
 * calibração (`quad-store.ts`): array ordenado, escrita atômica.
 *
 * A chave é o `id` do catálogo (`SearchDoc.id`) — o mesmo que o card já usava.
 */
import { existsSync } from "fs";
import { readFile, writeFile, rename, mkdir } from "fs/promises";
import { join, dirname } from "path";

const HIDDEN_FILE = join(process.cwd(), "data", "hidden-refs.json");

let cache: { ids: Set<string>; version: number } | null = null;
let version = 0;

async function atomicWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, content);
  await rename(tmp, path);
}

/** Lista de ids escondidos + a versão (muda a cada escrita — invalida o índice). */
export async function getHidden(): Promise<{ ids: Set<string>; version: number }> {
  if (cache) return cache;
  let ids = new Set<string>();
  if (existsSync(HIDDEN_FILE)) {
    try {
      const parsed: unknown = JSON.parse(await readFile(HIDDEN_FILE, "utf8"));
      if (Array.isArray(parsed)) ids = new Set(parsed.filter((x): x is string => typeof x === "string"));
    } catch {
      // Arquivo corrompido não pode derrubar o grid: some com a lista, não com o app.
    }
  }
  cache = { ids, version };
  return cache;
}

/** Liga/desliga o esconder de vários ids de uma vez. Devolve a lista final. */
export async function setHidden(ids: string[], hidden: boolean): Promise<string[]> {
  const { ids: current } = await getHidden();
  const next = new Set(current);
  for (const id of ids) {
    if (!id || typeof id !== "string") continue;
    if (hidden) next.add(id);
    else next.delete(id);
  }
  const list = [...next].sort();
  await atomicWrite(HIDDEN_FILE, JSON.stringify(list, null, 2));
  version++;
  cache = { ids: next, version };
  return list;
}
