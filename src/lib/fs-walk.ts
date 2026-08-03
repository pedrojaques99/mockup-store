import { readdirSync, statSync } from "fs";
import { readdir, stat } from "fs/promises";
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

export interface WalkProgress {
  /** Arquivos que já casaram o filtro. */
  found: number;
  /** Pasta sendo lida agora, para o usuário ver que anda. */
  dir: string;
}

export interface WalkOptions {
  filterExts?: Set<string>;
  signal?: AbortSignal;
  onProgress?: (p: WalkProgress) => void;
}

/**
 * Versão assíncrona, cancelável e com progresso.
 *
 * A `walkDir` acima é síncrona e recursiva: numa pasta de rede ou de Drive ela
 * segura o event loop inteiro até terminar. Como o total de arquivos só existe
 * DEPOIS dela, nenhum evento de progresso conseguia sair antes — a interface
 * mostrava barra sem valor exatamente durante a fase mais lenta do scan, que é
 * esta. Aqui a listagem em si já reporta, e dá para cancelar no meio.
 *
 * A `walkDir` continua existindo e não muda: vários chamadores (overlays,
 * scan-psds) rodam em contexto onde o síncrono é o certo.
 */
export async function walkDirAsync(dir: string, opts: WalkOptions = {}): Promise<FileEntry[]> {
  const { filterExts, signal, onProgress } = opts;
  const results: FileEntry[] = [];
  let ultimoAviso = 0;

  async function anda(atual: string, depth: number): Promise<void> {
    if (depth > MAX_DEPTH) return;
    signal?.throwIfAborted();
    let entries;
    try {
      entries = await readdir(atual, { withFileTypes: true });
    } catch {
      return; // pasta ilegível: mesmo silêncio da versão síncrona
    }
    for (const entry of entries) {
      signal?.throwIfAborted();
      const fullPath = join(atual, entry.name);
      if (entry.isDirectory()) {
        await anda(fullPath, depth + 1);
        continue;
      }
      if (entry.name.startsWith("._")) continue;
      const ext = extname(entry.name).toLowerCase();
      if (filterExts && !filterExts.has(ext)) continue;
      let size = 0;
      try {
        size = (await stat(fullPath)).size;
      } catch {
        continue;
      }
      results.push({
        name: basename(entry.name, ext),
        path: fullPath.replace(/\\/g, "/"),
        ext,
        folder: atual.split(/[/\\]/).pop() || "",
        sizeBytes: size,
      });
      // Estrangula o aviso: numa pasta de 4 mil arquivos, um evento por arquivo
      // custa mais que a leitura.
      const agora = Date.now();
      if (onProgress && (results.length % 25 === 0 || agora - ultimoAviso > 200)) {
        ultimoAviso = agora;
        onProgress({ found: results.length, dir: atual.replace(/\\/g, "/") });
      }
    }
  }

  await anda(dir, 0);
  onProgress?.({ found: results.length, dir });
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
