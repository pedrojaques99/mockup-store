/**
 * Coleção curada por marca. Espelha `api/references/hide/route.ts`.
 *
 * GET   ?brandId=  → { brandId, name, items, references } — cards hidratados por
 *                    `refsByIds` (ORDEM PRESERVADA: a ordem é a curadoria).
 * GET   (sem id)   → { counts } — para o badge do seletor de marca.
 * POST  { brandId, ids?|id?, member } → { brandId, items } — toggle em lote.
 * PATCH { brandId, order?, name?, note? } → { brandId, name, items }.
 *
 * Marca sem coleção não é 404: é uma coleção vazia com nome derivado. A aba
 * "Coleção" precisa abrir e dizer "ainda não tem nada aqui", não quebrar.
 */
import { NextRequest, NextResponse } from "next/server";
import {
  collectionCounts,
  defaultCollectionName,
  getCollection,
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

export async function GET(req: NextRequest) {
  try {
    const brandId = req.nextUrl.searchParams.get("brandId");
    if (!brandId) return NextResponse.json({ counts: await collectionCounts() });

    const col = await getCollection(brandId);
    const items = col?.items ?? [];
    const references = await refsByIds(items.map((i) => i.id));
    return NextResponse.json({
      brandId,
      name: col?.name ?? defaultCollectionName(brandId),
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

  const { brandId, ids, id, member } = (body ?? {}) as {
    brandId?: unknown; ids?: unknown; id?: unknown; member?: unknown;
  };
  if (typeof brandId !== "string" || !brandId) return fail("brandId obrigatório");
  if (typeof member !== "boolean") return fail("member deve ser boolean");

  const list = strings(ids ?? id);
  try {
    // Lista vazia não é erro — devolve o estado atual e a UI segue.
    const col: BrandCollection | null = list.length
      ? await setMembers(brandId, list, member)
      : await getCollection(brandId);
    return NextResponse.json({ brandId, items: col?.items ?? [] });
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

  const { brandId, order, name, note } = (body ?? {}) as {
    brandId?: unknown; order?: unknown; name?: unknown; note?: unknown;
  };
  if (typeof brandId !== "string" || !brandId) return fail("brandId obrigatório");
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
    if (order !== undefined) col = await reorder(brandId, strings(order));
    if (name !== undefined) col = await renameCollection(brandId, name);
    if (noteId) col = await setNote(brandId, noteId, noteText);
    col ??= await getCollection(brandId);
    return NextResponse.json({
      brandId,
      name: col?.name ?? defaultCollectionName(brandId),
      items: col?.items ?? [],
    });
  } catch (err) {
    return boom(err);
  }
}
