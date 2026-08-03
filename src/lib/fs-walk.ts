import { readdirSync, statSync } from "fs";
import { join, basename, extname } from "path";

const MAX_DEPTH = 5;

export interface FileEntry {
  name: string;
  path: string;
  ext: string;
  folder: string;
  sizeBytes: number;
}

export function walkDir(
  dir: string,
  filterExts?: Set<string>,
  depth = 0,
): FileEntry[] {
  if (depth > MAX_DEPTH) return [];
  const results: FileEntry[] = [];
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...walkDir(fullPath, filterExts, depth + 1));
      } else {
        // AppleDouble: o macOS grava um "._Foo.psd" ao lado de "Foo.psd" com o
        // resource fork. O Drive sincroniza esse lixo e ele tem extensão .psd,
        // mas não é PSD — o scan abria e falhava (18 FAILs no acervo).
        if (entry.name.startsWith("._")) continue;
        const ext = extname(entry.name).toLowerCase();
        if (filterExts && !filterExts.has(ext)) continue;
        const stat = statSync(fullPath);
        results.push({
          name: basename(entry.name, ext),
          path: fullPath.replace(/\\/g, "/"),
          ext,
          folder: dir.split(/[/\\]/).pop() || "",
          sizeBytes: stat.size,
        });
      }
    }
  } catch {}
  return results;
}

/**
 * Raízes de scan vindas de PSD_DIRS, sem sobreposição.
 *
 * PSD_DIRS listava `.../ASSETS VISANT/MOCKUPS MAISON` E o pai `.../ASSETS VISANT`.
 * Como o walk é recursivo, todo arquivo dentro de MOCKUPS MAISON era visitado duas
 * vezes — mesmo caminho, mesmo tamanho, mesmo hash — e o scan de duplicatas
 * anunciava o arquivo como cópia de si mesmo. Aqui a raiz filha é descartada.
 */
export function psdRoots(raw = process.env.PSD_DIRS || ""): string[] {
  const dirs = raw
    .split(",")
    .map((d) => d.trim().replace(/\\/g, "/").replace(/\/+$/, ""))
    .filter(Boolean);
  const uniq = [...new Set(dirs.map((d) => d.toLowerCase()))].map(
    (lower) => dirs.find((d) => d.toLowerCase() === lower)!,
  );
  return uniq.filter((d) => {
    const lower = d.toLowerCase();
    return !uniq.some((other) => {
      const o = other.toLowerCase();
      return o !== lower && lower.startsWith(o + "/");
    });
  });
}

const PSD_EXTS = new Set([".psd"]);

export function walkPsds(dir: string): FileEntry[] {
  return walkDir(dir, PSD_EXTS);
}
