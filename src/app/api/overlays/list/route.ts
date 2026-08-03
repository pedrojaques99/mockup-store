import { NextResponse } from "next/server";
import { existsSync } from "fs";
import { walkDir, type FileEntry } from "@/lib/fs-walk";

/**
 * Lista os assets de overlay (Luz/Sombra) das pastas locais/rede. Reusa walkDir.
 * Cache em memória (TTL) porque varrer pasta de rede/Drive é lento — não
 * re-escanear a cada abertura do modal.
 *
 * As pastas vêm de OVERLAY_DIRS (mesmo formato de PSD_DIRS: caminhos absolutos
 * separados por vírgula). Estavam cravadas aqui como `Z:/…` e `H:/…`, o que
 * fazia esta rota devolver vazio em qualquer máquina que não fosse a do autor.
 * Sem a variável, a galeria fica vazia e o resto do editor segue inteiro.
 */
const OVERLAY_DIRS = (process.env.OVERLAY_DIRS ?? "")
  .split(",")
  .map((d) => d.trim())
  .filter(Boolean);

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const TTL_MS = 60_000;

let cache: { at: number; items: FileEntry[] } | null = null;

export async function GET() {
  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) {
    return NextResponse.json({ items: cache.items, cached: true });
  }

  const items: FileEntry[] = [];
  for (const dir of OVERLAY_DIRS) {
    if (!existsSync(dir)) continue;
    items.push(...walkDir(dir, IMAGE_EXTS));
  }
  items.sort((a, b) => a.name.localeCompare(b.name));

  cache = { at: now, items };
  return NextResponse.json({ items, cached: false });
}
