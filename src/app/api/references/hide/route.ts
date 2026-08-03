/**
 * Esconder / reexibir itens do catálogo. Nada é apagado do disco.
 *
 * GET  → { ids, references } — a lista e os cards correspondentes (painel "Ocultos").
 * POST → { ids?: string[] | string, paths?: string[], hidden: boolean } → { ids, matched }
 *
 * `paths` existe para o painel de duplicatas, que conhece caminho no disco e não
 * id de catálogo. A resolução é feita aqui, do lado que tem o catálogo.
 */
import { NextRequest, NextResponse } from "next/server";
import { getHidden, setHidden } from "@/lib/hidden-store";
import { hiddenRefs, refIdsByPsdPath } from "@/lib/search-index";

export async function GET() {
  const [{ ids }, references] = await Promise.all([getHidden(), hiddenRefs()]);
  return NextResponse.json({ ids: [...ids].sort(), references });
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "body inválido" }, { status: 400 });
  }

  const { ids, id, paths, hidden } = (body ?? {}) as {
    ids?: unknown; id?: unknown; paths?: unknown; hidden?: unknown;
  };
  if (typeof hidden !== "boolean") {
    return NextResponse.json({ error: "hidden deve ser boolean" }, { status: 400 });
  }

  const strings = (v: unknown) =>
    (Array.isArray(v) ? v : [v]).filter((x): x is string => typeof x === "string" && x.length > 0);

  const list = strings(ids ?? id);
  const byPath = paths ? await refIdsByPsdPath(strings(paths)) : [];
  const all = [...new Set([...list, ...byPath])];

  // Caminho que não está no catálogo não é erro — é um arquivo que o grid nunca
  // mostrou. Responder 200 com matched:0 deixa a UI dizer isso ao usuário.
  if (!all.length) return NextResponse.json({ ids: [...(await getHidden()).ids].sort(), matched: 0 });

  return NextResponse.json({ ids: await setHidden(all, hidden), matched: all.length });
}
