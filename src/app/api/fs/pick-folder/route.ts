/**
 * POST /api/fs/pick-folder — abre o seletor de pasta do Windows.
 *
 * Por que isto existe do lado do SERVIDOR: nenhuma API de browser entrega
 * caminho absoluto de pasta, por design. `showDirectoryPicker()` devolve um
 * handle, `<input webkitdirectory>` devolve arquivos com caminho relativo,
 * arrastar do Explorer idem. E o servidor precisa de caminho absoluto para
 * varrer. Como o app roda local (mesmo host, mesmo usuário, mesmo desktop) e o
 * repo já executa processo nativo a partir de rota (`api/open-file`), abrir o
 * diálogo aqui é a resposta certa hoje. No dia do Electron
 * (`docs/PLAN-desktop-hybrid.md`), `dialog.showOpenDialog` substitui isto e a
 * rota some.
 *
 * Abrir janela do sistema a partir de um POST pede guardas, e são seis:
 *   1. só Windows
 *   2. só requisição de localhost
 *   3. atrás de INGEST_NATIVE_PICKER=1, desligado por padrão
 *   4. timeout matando o processo (diálogo esquecido não segura handle eterno)
 *   5. um diálogo por vez (dois cliques não abrem duas janelas)
 *   6. execFile sem shell, script por -EncodedCommand, nada interpolado
 */
import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { existsSync, statSync } from "fs";

export const runtime = "nodejs";
export const maxDuration = 180;

const TIMEOUT_MS = 120_000;

/** Guarda 5: um diálogo por vez, no escopo do módulo. */
let aberto = false;

/**
 * Shell.Application é o diálogo estilo Vista, que aceita digitar caminho e
 * navegar de verdade. `System.Windows.Forms` fica de reserva porque em algumas
 * instalações o assembly não carrega.
 */
const SCRIPT = `
$ErrorActionPreference = 'Stop'
try {
  $shell = New-Object -ComObject Shell.Application
  $pasta = $shell.BrowseForFolder(0, 'Escolha a pasta com os mockups', 0x211, 0)
  if ($pasta -ne $null) { Write-Output $pasta.Self.Path }
} catch {
  Add-Type -AssemblyName System.Windows.Forms
  $dlg = New-Object System.Windows.Forms.FolderBrowserDialog
  if ($dlg.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $dlg.SelectedPath }
}
`;

function ehLocal(req: NextRequest): boolean {
  const host = (req.headers.get("host") ?? "").split(":")[0].toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
}

export async function POST(req: NextRequest) {
  // 1. Só Windows.
  if (process.platform !== "win32") {
    return NextResponse.json(
      { error: "O seletor nativo só existe no Windows. Use o navegador de pastas." },
      { status: 501 },
    );
  }
  // 2. Só localhost.
  if (!ehLocal(req)) {
    return NextResponse.json({ error: "Só disponível localmente." }, { status: 403 });
  }
  // 3. Desligado por padrão.
  if (process.env.INGEST_NATIVE_PICKER !== "1") {
    return NextResponse.json(
      { error: "Seletor nativo desligado. Ligue com INGEST_NATIVE_PICKER=1 no .env.local." },
      { status: 503 },
    );
  }
  // 5. Um por vez.
  if (aberto) {
    return NextResponse.json({ error: "Já existe um seletor aberto." }, { status: 409 });
  }

  aberto = true;
  try {
    // 6. Sem shell, e o script vai em base64 UTF-16LE — nada de interpolar
    // string de comando com dado que volta do sistema de arquivos.
    const encoded = Buffer.from(SCRIPT, "utf16le").toString("base64");
    const saida = await new Promise<string>((resolve, reject) => {
      const filho = execFile(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-STA", "-EncodedCommand", encoded],
        { timeout: TIMEOUT_MS, windowsHide: false }, // 4. timeout mata o processo
        (err, stdout) => (err && !stdout ? reject(err) : resolve(String(stdout ?? ""))),
      );
      filho.on("error", reject);
    });

    const caminho = saida.trim().split(/\r?\n/).filter(Boolean).pop() ?? "";
    if (!caminho) {
      return NextResponse.json({ cancelado: true });
    }
    const normalizado = caminho.replace(/\\/g, "/");
    if (!existsSync(normalizado) || !statSync(normalizado).isDirectory()) {
      return NextResponse.json({ error: "O que voltou não é uma pasta." }, { status: 400 });
    }
    return NextResponse.json({ caminho: normalizado });
  } catch (e) {
    return NextResponse.json(
      { error: `Não deu para abrir o seletor: ${(e as Error)?.message ?? e}` },
      { status: 500 },
    );
  } finally {
    aberto = false;
  }
}
