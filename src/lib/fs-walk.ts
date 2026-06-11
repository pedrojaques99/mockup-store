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

const PSD_EXTS = new Set([".psd"]);

export function walkPsds(dir: string): FileEntry[] {
  return walkDir(dir, PSD_EXTS);
}
