/**
 * GET /api/local-image?path=<arquivo> — serve imagem de fora do `public/`.
 *
 * Três modos, e a diferença entre eles importa:
 *
 * - padrão: WebP derivado (lado maior 1600px), cacheado em disco. É o que o
 *   otimizador do Next consome para gerar as variantes dos cards.
 * - `&w=N`: derivado nessa largura. Existia como parâmetro e era IGNORADO — o
 *   `IngestDialog` pedia `w=64` para uma bolinha de 64px e recebia o arquivo
 *   original inteiro.
 * - `&raw=1`: os bytes originais, sem tocar. Obrigatório para quem lê PIXEL
 *   (o `/calibrate` monta canvas com `naturalWidth` e compara com as dimensões
 *   reais do arquivo — servir um derivado ali desalinharia todo o quad em
 *   silêncio).
 *
 * Medido antes desta versão: 12 cards do grid = 26,6 MB de fonte lida do Google
 * Drive para entregar 119 KB ao browser.
 */
import { NextRequest, NextResponse } from "next/server";
import { createReadStream, existsSync, statSync } from "fs";
import { Readable } from "stream";
import { extname } from "path";
import { derivado, lerDerivado, extensaoValida } from "@/lib/image-cache";

const MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".bmp": "image/bmp",
};

/** `immutable` é honesto aqui: a chave do cache inclui o mtime do arquivo, então
 *  arquivo trocado = URL nova do ponto de vista do derivado. */
const CACHE = "private, max-age=31536000, immutable";

export async function GET(req: NextRequest) {
  const filePath = req.nextUrl.searchParams.get("path");
  if (!filePath || filePath.includes("..")) {
    return NextResponse.json({ error: "invalid path" }, { status: 400 });
  }
  // Sem esta linha a rota lê QUALQUER arquivo do disco e devolve como
  // `application/octet-stream` — era um leitor de arquivo arbitrário exposto.
  if (!extensaoValida(filePath)) {
    return NextResponse.json({ error: "not an image" }, { status: 400 });
  }
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const raw = req.nextUrl.searchParams.get("raw") === "1";
  const wParam = parseInt(req.nextUrl.searchParams.get("w") || "", 10);

  if (raw) {
    // Stream, não `readFile`: o original pode ter 50 MB e não há motivo para
    // ele existir inteiro em memória antes do primeiro byte sair.
    const st = statSync(filePath);
    const mime = MIME[extname(filePath).toLowerCase()] || "application/octet-stream";
    const body = Readable.toWeb(createReadStream(filePath)) as ReadableStream;
    return new NextResponse(body, {
      headers: {
        "Content-Type": mime,
        "Content-Length": String(st.size),
        "Cache-Control": "private, max-age=3600",
      },
    });
  }

  try {
    const d = await derivado(filePath, Number.isFinite(wParam) ? wParam : undefined);

    // 304: o browser (e o otimizador) já têm este byte a byte.
    if (req.headers.get("if-none-match") === `"${d.etag}"`) {
      return new NextResponse(null, { status: 304, headers: { ETag: `"${d.etag}"`, "Cache-Control": CACHE } });
    }

    const buf = await lerDerivado(d);
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "image/webp",
        "Content-Length": String(buf.length),
        ETag: `"${d.etag}"`,
        "Cache-Control": CACHE,
        // Diagnóstico barato: dá para ver no DevTools se o card pagou conversão.
        "X-Img-Cache": d.doCache ? "hit" : "miss",
      },
    });
  } catch (e) {
    // Arquivo corrompido ou formato que o sharp não abre não pode derrubar o
    // card: cai para os bytes originais, que o browser talvez saiba exibir.
    console.error("[local-image] derivado falhou:", filePath, e instanceof Error ? e.message : e);
    const mime = MIME[extname(filePath).toLowerCase()] || "application/octet-stream";
    const body = Readable.toWeb(createReadStream(filePath)) as ReadableStream;
    return new NextResponse(body, {
      headers: { "Content-Type": mime, "Cache-Control": "private, max-age=3600" },
    });
  }
}
