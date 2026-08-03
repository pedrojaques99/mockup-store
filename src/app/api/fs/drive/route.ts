/**
 * GET /api/fs/drive?url= — link do Google Drive vira caminho local.
 *
 * Sem OAuth e sem download: o Drive para computador materializa pasta
 * compartilhada em `<mount>/.shortcut-targets-by-id/<ID>`, e esse ID é o mesmo
 * que aparece na URL. Cobre o caso real (as raízes de PSD_DIRS já apontam para
 * lá) com zero configuração.
 *
 * Nunca varre sozinho: devolve o caminho para a interface confirmar, porque a
 * resolução pode acertar a pasta errada quando o atalho tem mais de uma dentro.
 */
import { NextRequest, NextResponse } from "next/server";
import { resolverUrlDrive } from "@/lib/fs-browse";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const url = (req.nextUrl.searchParams.get("url") ?? "").trim();
  if (!url) return NextResponse.json({ error: "url required" }, { status: 400 });
  return NextResponse.json(resolverUrlDrive(url));
}
