import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { join, basename } from "path";
import { resolveDir, UPLOAD_DIR, NEW_MOCKUPS_DIR } from "@/lib/quad-store";

const ALLOWED = ["image/jpeg", "image/png", "image/webp"];

/**
 * Recebe imagens (drag/drop ou seletor) e salva na pasta de destino.
 * Sem `dir` → grava na pasta de trabalho .tmp/calibrate-upload e a retorna,
 * pra UI passar a apontar pra lá.
 */
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (!files.length) return NextResponse.json({ error: "nenhum arquivo" }, { status: 400 });

  // dir do form (se o usuário já estava numa pasta); senão a pasta de trabalho.
  const dirParam = form.get("dir");
  const requested = typeof dirParam === "string" ? resolveDir(dirParam) : UPLOAD_DIR;
  // Nunca gravar na pasta canônica de cenas curadas por upload avulso.
  const dir = requested === NEW_MOCKUPS_DIR ? UPLOAD_DIR : requested;
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });

  const saved: string[] = [];
  for (const file of files) {
    if (!ALLOWED.includes(file.type)) continue;
    const name = basename(file.name).replace(/[/\\]/g, "_");
    await writeFile(join(dir, name), Buffer.from(await file.arrayBuffer()));
    saved.push(name);
  }

  if (!saved.length) return NextResponse.json({ error: "nenhum arquivo de imagem válido" }, { status: 400 });
  return NextResponse.json({ dir, saved });
}
