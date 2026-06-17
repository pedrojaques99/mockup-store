import { NextResponse } from "next/server";
import { existsSync } from "fs";
import { walkDir, type FileEntry } from "@/lib/fs-walk";

/**
 * Lista os assets de overlay (Luz/Sombra) das pastas locais/rede. Reusa walkDir.
 * Cache em memória (TTL) porque varrer Z:/H: (rede/Drive) é lento — não re-escanear
 * a cada abertura do modal. Adicione pastas aqui para expandir a galeria.
 */
const OVERLAY_DIRS = [
  "Z:/Recursos 2.0/Shadow Overlay",
  "H:/Meu Drive/ASSETS VISANT/Texturefabrik/Shadow Overlay",
];

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
