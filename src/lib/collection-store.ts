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
  /**
   * Marca dona, quando existe. Coleção de marca é chaveada PELO brandId (legado e
   * atual); coleção avulsa tem chave `col_…` e nenhum brandId. O campo existe para
   * a lista saber dizer de quem é a coleção sem adivinhar pelo formato da chave.
   */
  brandId?: string;
};

/** Resumo para o seletor — sem carregar os itens de todas as coleções. */
export type CollectionSummary = {
  id: string;
  name: string;
  count: number;
  updatedAt: number;
  brandId?: string;
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

/**
 * Nome default de uma coleção que ainda não foi renomeada à mão.
 *
 * Era `Coleção ${brandId}` — e o id da marca (`69e8e78b51a13978c9bc90d8`) vazava
 * para a aba do grid. Id de banco não é nome: não se lê, não se digita, não diz de
 * quem é. O nome default agora é neutro, e quem sabe o nome da marca (a UI) é quem
 * o exibe no lugar.
 */
export function defaultCollectionName(): string {
  return "Coleção";
}

/**
 * O nome legado (`Coleção <id>`) precisa ser tratado como "nunca renomeado", não
 * como escolha do usuário — senão o id continuaria na tela para sempre em toda
 * coleção já criada.
 */
function normalizeName(name: unknown, key: string): string {
  const clean = typeof name === "string" ? name.trim() : "";
  if (!clean) return defaultCollectionName();
  if (clean === `Coleção ${key}` || /^Cole(ç|c)ão\s+[A-Za-z0-9_-]{12,}$/.test(clean)) {
    return defaultCollectionName();
  }
  return clean;
}

/** Id de coleção avulsa. Prefixo `col_` distingue da chave que É um brandId. */
export function newCollectionId(): string {
  return `col_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
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

  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!key || !value || typeof value !== "object") continue;
    const v = value as { name?: unknown; items?: unknown; updatedAt?: unknown; brandId?: unknown };
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
    // Chave que não é `col_…` é um brandId (formato legado e atual das coleções de marca).
    const brandId = typeof v.brandId === "string" && v.brandId
      ? v.brandId
      : key.startsWith("col_") ? undefined : key;
    out.collections[key] = {
      name: normalizeName(v.name, key),
      items,
      updatedAt: typeof v.updatedAt === "number" ? v.updatedAt : 0,
      ...(brandId ? { brandId } : {}),
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

/**
 * A coleção de uma chave, ou `null` se ela nunca foi tocada. A chave é o brandId
 * (coleção da marca) ou um `col_…` (coleção avulsa) — as duas moram no mesmo mapa.
 */
export async function getCollection(collectionId: string): Promise<BrandCollection | null> {
  if (!collectionId || typeof collectionId !== "string") return null;
  const { data } = await getCollections();
  return data.collections[collectionId] ?? null;
}

/** Todas as coleções em resumo, mais recente primeiro — alimenta o seletor. */
export async function listCollections(): Promise<CollectionSummary[]> {
  const { data } = await getCollections();
  return Object.entries(data.collections)
    .map(([id, col]) => ({
      id,
      name: col.name,
      count: col.items.length,
      updatedAt: col.updatedAt,
      ...(col.brandId ? { brandId: col.brandId } : {}),
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * Muta uma coleção e persiste. Centraliza o contrato de escrita: `updatedAt`
 * novo, `version++` e cache atualizado acontecem sempre, num lugar só.
 */
async function mutate(
  collectionId: string,
  fn: (col: BrandCollection) => void,
): Promise<BrandCollection> {
  if (!collectionId || typeof collectionId !== "string") {
    throw new Error("brandId (ou collectionId) obrigatório");
  }
  const { data } = await getCollections();
  const next: CollectionsFile = {
    version: SCHEMA_VERSION,
    collections: { ...data.collections },
  };
  const current = next.collections[collectionId];
  const col: BrandCollection = current
    ? {
        name: current.name,
        items: current.items.map((i) => ({ ...i })),
        updatedAt: current.updatedAt,
        ...(current.brandId ? { brandId: current.brandId } : {}),
      }
    : {
        name: defaultCollectionName(),
        items: [],
        updatedAt: 0,
        // Coleção criada pelo toggle do grid é sempre de marca: a chave É o brandId.
        ...(collectionId.startsWith("col_") ? {} : { brandId: collectionId }),
      };

  fn(col);
  col.updatedAt = Date.now();
  next.collections[collectionId] = col;

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

/** Renomeia. Nome vazio volta para o default neutro. */
export async function renameCollection(
  collectionId: string,
  name: string,
): Promise<BrandCollection> {
  return mutate(collectionId, (col) => {
    const clean = typeof name === "string" ? name.trim() : "";
    col.name = clean || defaultCollectionName();
  });
}

/**
 * Cria uma coleção **avulsa** — sem marca. Nem toda curadoria é de um cliente:
 * "referências de tipografia", "o que mandar pro fotógrafo". Antes só existia
 * coleção como efeito colateral de conectar uma marca.
 */
export async function createCollection(name?: string, brandId?: string): Promise<CollectionSummary> {
  const id = newCollectionId();
  const col = await mutate(id, (c) => {
    const clean = typeof name === "string" ? name.trim() : "";
    c.name = clean || defaultCollectionName();
    if (typeof brandId === "string" && brandId) c.brandId = brandId;
  });
  return {
    id,
    name: col.name,
    count: col.items.length,
    updatedAt: col.updatedAt,
    ...(col.brandId ? { brandId: col.brandId } : {}),
  };
}

/**
 * Apaga a coleção inteira. Só existe porque criar avulsa passou a existir: uma
 * lista que só cresce vira lixo permanente no seletor. `false` = não havia nada.
 */
export async function deleteCollection(collectionId: string): Promise<boolean> {
  if (!collectionId || typeof collectionId !== "string") return false;
  const { data } = await getCollections();
  if (!data.collections[collectionId]) return false;
  const next: CollectionsFile = { version: SCHEMA_VERSION, collections: { ...data.collections } };
  delete next.collections[collectionId];
  await atomicWrite(COLLECTIONS_FILE, JSON.stringify(next, null, 2));
  version++;
  cache = { data: next, version };
  return true;
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
