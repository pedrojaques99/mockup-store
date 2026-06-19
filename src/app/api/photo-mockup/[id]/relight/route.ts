/**
 * POST /api/photo-mockup/[id]/relight { artBase64 }
 *
 * Inverse rendering — recebe a arte (base64) e usa a cena salva no upload `id`
 * como referência de luz. Devolve PNG da arte relit (IC-Light). Sem
 * REPLICATE_API_TOKEN: 503 + mensagem clara.
 */
import { NextRequest, NextResponse } from "next/server";
import { existsSync } from "fs";
import { readFile } from "fs/promises";
import { join } from "path";
import { relight } from "@/lib/relight";

const TMP_DIR = join(process.cwd(), ".tmp", "photo-scenes");
const DATA_DIR = join(process.cwd(), "data", "photo-scenes");

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const t0 = Date.now();
  const { id } = await params;
  if (!id || !/^[a-f0-9]{16}$/.test(id)) return NextResponse.json({ error: "invalid id" }, { status: 400 });
  const dataDir = join(DATA_DIR, id);
  const dir = existsSync(dataDir) ? dataDir : join(TMP_DIR, id);
  const metaPath = join(dir, "meta.json");
  if (!existsSync(metaPath)) return NextResponse.json({ error: "scene not found" }, { status: 404 });
  const body = await req.json();
  if (!body.artBase64) return NextResponse.json({ error: "artBase64 required" }, { status: 400 });

  const { ext } = JSON.parse(await readFile(metaPath, "utf-8")) as { ext: string };
  const scenePath = join(dir, `photo.${ext}`);
  if (!existsSync(scenePath)) return NextResponse.json({ error: "photo missing" }, { status: 404 });

  const artBuf = Buffer.from(String(body.artBase64).replace(/^data:image\/\w+;base64,/, ""), "base64");
  const sceneBuf = await readFile(scenePath);
  const out = await relight(artBuf, sceneBuf, { prompt: body.prompt });
  if (!out) return NextResponse.json({ error: "relight unavailable (set REPLICATE_API_TOKEN)" }, { status: 503 });

  return new NextResponse(new Uint8Array(out.png), {
    headers: {
      "Content-Type": "image/png", "Cache-Control": "no-store",
      "X-Relight-Provider": out.provider,
      "Server-Timing": `relight;dur=${Date.now() - t0}`,
    },
  });
}
