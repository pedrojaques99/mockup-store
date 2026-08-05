/**
 * Coleções curadas. Espelha `api/references/hide/route.ts`.
 *
 * A chave de uma coleção é o `brandId` (coleção da marca) **ou** um `col_…`
 * (coleção avulsa, sem marca). Toda rota aceita `collectionId` e, por compat,
 * `brandId` — são a mesma chave, e o cliente antigo continua funcionando.
 *
 * GET    ?collectionId=|?brandId= → { id, brandId, name, items, references }
 *                                   (cards por `refsByIds`; ORDEM PRESERVADA — é a curadoria)
 * GET    (sem id)                 → { counts, collections } — badge do seletor + lista
 * POST   { create: true, name?, brandId? }        → { collection } (avulsa)
 * POST   { collectionId, ids?|id?, member }       → { id, items } — toggle em lote
 * PATCH  { collectionId, order?, name?, note? }   → { id, name, items }
 * DELETE ?collectionId=                           → { deleted }
 *
 * Coleção inexistente não é 404 no GET: é uma coleção vazia com nome default. A
 * aba "Coleção" precisa abrir e dizer "ainda não tem nada aqui", não quebrar.
 */
import { NextRequest, NextResponse } from "next/server";
import {
  collectionCounts,
  createCollection,
  defaultCollectionName,
  deleteCollection,
  getCollection,
  listCollections,
  renameCollection,
  reorder,
  setMembers,
  setNote,
  type BrandCollection,
} from "@/lib/collection-store";
import { refsByIds } from "@/lib/search-index";

const strings = (v: unknown): string[] =>
  (Array.isArray(v) ? v : [v]).filter((x): x is string => typeof x === "string" && x.length > 0);

function fail(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/** Nenhuma exceção pode virar 500 mudo — a UI precisa de um motivo para mostrar. */
function boom(err: unknown) {
  return fail(err instanceof Error ? err.message : "erro inesperado", 500);
}

/** `collectionId` é o nome novo; `brandId` continua valendo e aponta para a mesma chave. */
function keyOf(source: { collectionId?: unknown; brandId?: unknown }): string {
  const { collectionId, brandId } = source;
  if (typeof collectionId === "string" && collectionId) return collectionId;
  if (typeof brandId === "string" && brandId) return brandId;
  return "";
}

export async function GET(req: NextRequest) {
  try {
    const p = req.nextUrl.searchParams;
    const id = keyOf({ collectionId: p.get("collectionId"), brandId: p.get("brandId") });
    if (!id) {
      return NextResponse.json({
        counts: await collectionCounts(),
        collections: await listCollections(),
      });
    }

    const col = await getCollection(id);
    const items = col?.items ?? [];
    const references = await refsByIds(items.map((i) => i.id));
    return NextResponse.json({
      id,
      // O cliente legado lê `brandId` da resposta; para coleção de marca a chave É o brandId.
      brandId: col?.brandId ?? (id.startsWith("col_") ? undefined : id),
      name: col?.name ?? defaultCollectionName(),
      items,
      references,
    });
  } catch (err) {
    return boom(err);
  }
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail("body inválido");
  }

  const { create, name, ids, id, member, ...rest } = (body ?? {}) as {
    create?: unknown; name?: unknown; ids?: unknown; id?: unknown; member?: unknown;
    collectionId?: unknown; brandId?: unknown;
  };

  // Criar coleção avulsa: não exige marca — é o ponto da feature.
  if (create) {
    if (name !== undefined && typeof name !== "string") return fail("name deve ser string");
    try {
      const brandId = typeof rest.brandId === "string" && rest.brandId ? rest.brandId : undefined;
      return NextResponse.json({ collection: await createCollection(name as string | undefined, brandId) });
    } catch (err) {
      return boom(err);
    }
  }

  const key = keyOf(rest);
  if (!key) return fail("collectionId (ou brandId) obrigatório");
  if (typeof member !== "boolean") return fail("member deve ser boolean");

  const list = strings(ids ?? id);
  try {
    // Lista vazia não é erro — devolve o estado atual e a UI segue.
    const col: BrandCollection | null = list.length
      ? await setMembers(key, list, member)
      : await getCollection(key);
    return NextResponse.json({ id: key, brandId: col?.brandId, items: col?.items ?? [] });
  } catch (err) {
    return boom(err);
  }
}

export async function PATCH(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail("body inválido");
  }

  const { order, name, note, ...rest } = (body ?? {}) as {
    order?: unknown; name?: unknown; note?: unknown; collectionId?: unknown; brandId?: unknown;
  };
  const key = keyOf(rest);
  if (!key) return fail("collectionId (ou brandId) obrigatório");
  if (order === undefined && name === undefined && note === undefined) {
    return fail("nada para alterar: informe order, name ou note");
  }
  if (order !== undefined && !Array.isArray(order)) return fail("order deve ser array de ids");
  if (name !== undefined && typeof name !== "string") return fail("name deve ser string");

  let noteId: string | null = null;
  let noteText = "";
  if (note !== undefined) {
    const n = (note ?? {}) as { id?: unknown; text?: unknown };
    if (typeof n.id !== "string" || !n.id) return fail("note.id obrigatório");
    noteId = n.id;
    noteText = typeof n.text === "string" ? n.text : "";
  }

  try {
    let col: BrandCollection | null = null;
    if (order !== undefined) col = await reorder(key, strings(order));
    if (name !== undefined) col = await renameCollection(key, name);
    if (noteId) col = await setNote(key, noteId, noteText);
    col ??= await getCollection(key);
    return NextResponse.json({
      id: key,
      brandId: col?.brandId,
      name: col?.name ?? defaultCollectionName(),
      items: col?.items ?? [],
    });
  } catch (err) {
    return boom(err);
  }
}

export async function DELETE(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const key = keyOf({ collectionId: p.get("collectionId"), brandId: p.get("brandId") });
  if (!key) return fail("collectionId obrigatório");
  try {
    return NextResponse.json({ deleted: await deleteCollection(key) });
  } catch (err) {
    return boom(err);
  }
}
