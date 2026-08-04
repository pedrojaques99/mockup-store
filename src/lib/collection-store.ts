/**
 * Coleção curada por marca.
 *
 * Espelho fiel do `hidden-store.ts` — mesma mecânica de escrita atômica
 * (tmp + rename), mesmo cache em memória com contador `version` que invalida
 * quem depende, mesma tolerância a arquivo corrompido. A diferença é o formato:
 * aqui a lista é **ordenada de propósito**, porque a ordem É a curadoria.
 *
 * Por que arquivo e não Mongo: a home é garantida offline hoje (Atlas fora ⇒
 * catálogo só do filesystem, sem quebrar). Curadoria manual é trabalho humano —
 * não pode evaporar porque o banco caiu.
 *
 * Uma coleção por marca, não N: "coleção da marca" é o conceito pedido; pastas
 * dentro dela seriam invenção.
 *
 * A chave dos itens é o `id` do catálogo (`SearchDoc.id`) — o mesmo que o card
 * já usa, e o mesmo que `refsByIds()` sabe hidratar preservando a ordem.
 *
 * O caminho do arquivo sai de `process.cwd()/data/brand-collections.json`, mas
 * pode ser sobrescrito por `BRAND_COLLECTIONS_FILE` — é assim que o teste isola
 * o filesystem sem depender do cwd do processo.
 */
import { existsSync } from "fs";
import { readFile, writeFile, rename, mkdir } from "fs/promises";
import { join, dirname } from "path";

export type CollectionItem = {
  id: string;
  addedAt: number;
  note?: string;
};

export type BrandCollection = {
  name: string;
  items: CollectionItem[];
  updatedAt: number;
};

export type CollectionsFile = {
  version: number;
  collections: Record<string, BrandCollection>;
};

const COLLECTIONS_FILE =
  process.env.BRAND_COLLECTIONS_FILE || join(process.cwd(), "data", "brand-collections.json");

/** `version` do cache é o contador de escritas — não o `version` do arquivo (esse é o schema). */
let cache: { data: CollectionsFile; version: number } | null = null;
let version = 0;

const SCHEMA_VERSION = 1;

function emptyFile(): CollectionsFile {
  return { version: SCHEMA_VERSION, collections: {} };
}

/** Nome default de uma coleção que ainda não foi renomeada à mão. */
export function defaultCollectionName(brandId: string): string {
  return `Coleção ${brandId}`;
}

async function atomicWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, content);
  await rename(tmp, path);
}

/**
 * Saneia o que veio do disco. Um arquivo editado à mão (ou de uma versão futura)
 * não pode derrubar o grid: o que não bate com o formato é descartado item a
 * item, em vez de invalidar a coleção inteira.
 */
function sanitize(parsed: unknown): CollectionsFile {
  const out = emptyFile();
  if (!parsed || typeof parsed !== "object") return out;
  const raw = (parsed as { collections?: unknown }).collections;
  if (!raw || typeof raw !== "object") return out;

  for (const [brandId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!brandId || !value || typeof value !== "object") continue;
    const v = value as { name?: unknown; items?: unknown; updatedAt?: unknown };
    const items: CollectionItem[] = [];
    const seen = new Set<string>();
    if (Array.isArray(v.items)) {
      for (const it of v.items) {
        if (!it || typeof it !== "object") continue;
        const { id, addedAt, note } = it as { id?: unknown; addedAt?: unknown; note?: unknown };
        if (typeof id !== "string" || !id || seen.has(id)) continue;
        seen.add(id);
        const item: CollectionItem = {
          id,
          addedAt: typeof addedAt === "number" ? addedAt : 0,
        };
        if (typeof note === "string" && note.trim()) item.note = note;
        items.push(item);
      }
    }
    out.collections[brandId] = {
      name: typeof v.name === "string" && v.name ? v.name : defaultCollectionName(brandId),
      items,
      updatedAt: typeof v.updatedAt === "number" ? v.updatedAt : 0,
    };
  }
  return out;
}

/** Todas as coleções + a versão (muda a cada escrita — invalida quem cacheia). */
export async function getCollections(): Promise<{ data: CollectionsFile; version: number }> {
  if (cache) return cache;
  let data = emptyFile();
  if (existsSync(COLLECTIONS_FILE)) {
    try {
      data = sanitize(JSON.parse(await readFile(COLLECTIONS_FILE, "utf8")));
    } catch {
      // Arquivo corrompido não pode derrubar o grid: some com a lista, não com o app.
    }
  }
  cache = { data, version };
  return cache;
}

/** A coleção de uma marca, ou `null` se ela nunca foi tocada. */
export async function getCollection(brandId: string): Promise<BrandCollection | null> {
  if (!brandId || typeof brandId !== "string") return null;
  const { data } = await getCollections();
  return data.collections[brandId] ?? null;
}

/**
 * Muta uma coleção e persiste. Centraliza o contrato de escrita: `updatedAt`
 * novo, `version++` e cache atualizado acontecem sempre, num lugar só.
 */
async function mutate(
  brandId: string,
  fn: (col: BrandCollection) => void,
): Promise<BrandCollection> {
  if (!brandId || typeof brandId !== "string") {
    throw new Error("brandId obrigatório");
  }
  const { data } = await getCollections();
  const next: CollectionsFile = {
    version: SCHEMA_VERSION,
    collections: { ...data.collections },
  };
  const current = next.collections[brandId];
  const col: BrandCollection = current
    ? { name: current.name, items: current.items.map((i) => ({ ...i })), updatedAt: current.updatedAt }
    : { name: defaultCollectionName(brandId), items: [], updatedAt: 0 };

  fn(col);
  col.updatedAt = Date.now();
  next.collections[brandId] = col;

  await atomicWrite(COLLECTIONS_FILE, JSON.stringify(next, null, 2));
  version++;
  cache = { data: next, version };
  return col;
}

/**
 * Liga/desliga a participação de vários ids de uma vez. Idempotente: adicionar
 * quem já está não duplica nem reordena (a curadoria de quem já estava vale
 * mais que o clique repetido); novos entram no fim, na ordem em que chegaram.
 */
export async function setMembers(
  brandId: string,
  ids: string[],
  member: boolean,
): Promise<BrandCollection> {
  return mutate(brandId, (col) => {
    const index = new Map(col.items.map((i) => [i.id, i]));
    const list = Array.isArray(ids) ? ids : [];
    if (member) {
      const now = Date.now();
      for (const id of list) {
        if (!id || typeof id !== "string" || index.has(id)) continue;
        const item = { id, addedAt: now };
        index.set(id, item);
        col.items.push(item);
      }
    } else {
      const drop = new Set(list.filter((x): x is string => typeof x === "string" && !!x));
      col.items = col.items.filter((i) => !drop.has(i.id));
    }
  });
}

/**
 * Reordena pela lista de ids. Quem não aparece em `order` **não some** — vai
 * para o fim mantendo a ordem relativa. Um PATCH parcial (ou uma página só do
 * grid) não pode apagar curadoria que ele nem viu.
 */
export async function reorder(brandId: string, order: string[]): Promise<BrandCollection> {
  return mutate(brandId, (col) => {
    const wanted = (Array.isArray(order) ? order : []).filter(
      (x): x is string => typeof x === "string" && !!x,
    );
    const byId = new Map(col.items.map((i) => [i.id, i]));
    const head: CollectionItem[] = [];
    const used = new Set<string>();
    for (const id of wanted) {
      const item = byId.get(id);
      if (!item || used.has(id)) continue;
      used.add(id);
      head.push(item);
    }
    col.items = [...head, ...col.items.filter((i) => !used.has(i.id))];
  });
}

/** Renomeia. Nome vazio volta para o default derivado do brandId. */
export async function renameCollection(brandId: string, name: string): Promise<BrandCollection> {
  return mutate(brandId, (col) => {
    const clean = typeof name === "string" ? name.trim() : "";
    col.name = clean || defaultCollectionName(brandId);
  });
}

/** Anota um item. Note vazio **remove o campo** — não grava string vazia. */
export async function setNote(
  brandId: string,
  id: string,
  note: string,
): Promise<BrandCollection> {
  return mutate(brandId, (col) => {
    const item = col.items.find((i) => i.id === id);
    if (!item) return;
    const clean = typeof note === "string" ? note.trim() : "";
    if (clean) item.note = clean;
    else delete item.note;
  });
}

/** `{ brandId: n }` — alimenta o badge do seletor de marca. */
export async function collectionCounts(): Promise<Record<string, number>> {
  const { data } = await getCollections();
  const out: Record<string, number> = {};
  for (const [brandId, col] of Object.entries(data.collections)) {
    out[brandId] = col.items.length;
  }
  return out;
}
