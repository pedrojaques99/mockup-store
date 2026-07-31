/**
 * POST /api/open-file — revela no explorador ou abre no aplicativo padrão.
 *
 * `mode: "reveal"` (default) mantém o comportamento antigo (`explorer /select,`),
 * que só destaca o arquivo na pasta. `mode: "open"` dispara o aplicativo associado
 * — para `.psd`/`.psb` isso é o Photoshop. Eram duas ações diferentes disputando um
 * botão só: quem queria abrir o arquivo ganhava uma janela do explorador.
 */
import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { existsSync, statSync } from "fs";

export async function POST(req: NextRequest) {
  const { path, mode } = await req.json();
  if (!path || typeof path !== "string") {
    return NextResponse.json({ error: "path required" }, { status: 400 });
  }

  const normalized = path.replace(/\//g, "\\");

  // Este endpoint executa um processo com um caminho vindo do cliente, e a versão
  // anterior interpolava direto numa string de shell (`exec`). Agora: nada de
  // metacaracteres — um `&` ou `"` num nome de arquivo viraria comando — e o
  // arquivo tem de existir. `execFile` (sem shell) fecha o resto.
  if (/["'`&|<>^\n\r]/.test(normalized)) {
    return NextResponse.json({ error: "caminho inválido" }, { status: 400 });
  }
  if (!existsSync(normalized) || !statSync(normalized).isFile()) {
    return NextResponse.json({ error: "arquivo não encontrado" }, { status: 404 });
  }

  if (mode === "open") {
    // `cmd /c start "" <arquivo>` = abrir no app associado. O `""` é o TÍTULO da
    // janela: sem ele o `start` trata o caminho como título e não abre nada — o
    // clássico que faz o botão parecer quebrado sem erro nenhum.
    execFile("cmd", ["/c", "start", "", normalized], () => {});
  } else {
    execFile("explorer", [`/select,${normalized}`], () => {});
  }

  return NextResponse.json({ ok: true });
}
