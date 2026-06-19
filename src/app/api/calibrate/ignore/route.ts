import { NextRequest, NextResponse } from "next/server";
import { setIgnored, resolveDir } from "@/lib/quad-store";

function safeName(name: unknown): string | null {
  if (typeof name !== "string" || !name) return null;
  if (name.includes("/") || name.includes("\\") || name.includes("..")) return null;
  return name;
}

/** Liga/desliga o ignore de uma cena (some/volta na fila de calibração). */
export async function POST(req: NextRequest) {
  const { name, ignore, dir: dirParam } = await req.json();
  const safe = safeName(name);
  if (!safe) return NextResponse.json({ error: "nome inválido" }, { status: 400 });
  const ignored = await setIgnored(safe, ignore !== false, resolveDir(dirParam));
  return NextResponse.json({ ignored });
}
