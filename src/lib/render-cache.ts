/**
 * Caches de render (server, em memória do processo). Dois níveis:
 *  - Tier 4: engine warm (import + adapter memoizados) + leitura de disco por path+mtime.
 *  - Tier 1: composite BASE (engine+downscale) + fullMask, keyed por geometria — para
 *    que mexer só no "look" (sombra/realismo/grão/specular…) não re-warpe a cena.
 *
 * Tudo é por-processo (dev server / node). Sem persistência: chaves incluem o id da
 * cena + mtime dos assets, então upscale/crop (novo id ou novo arquivo) invalidam só.
 */
import { createHash } from "crypto";
import { statSync } from "fs";
import { readFile } from "fs/promises";

// ── LRU mínimo (Map preserva ordem de inserção = ordem de uso) ──────────────────
class LRU<V> {
  private map = new Map<string, V>();
  constructor(private max: number) {}
  get(k: string): V | undefined {
    const v = this.map.get(k);
    if (v !== undefined) { this.map.delete(k); this.map.set(k, v); } // toca → fim
    return v;
  }
  set(k: string, v: V): void {
    if (this.map.has(k)) this.map.delete(k);
    this.map.set(k, v);
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }
}

/** Hash curto e estável de qualquer mistura de strings/números/objetos. */
export function sha(...parts: unknown[]): string {
  const h = createHash("sha1");
  for (const p of parts) h.update(typeof p === "string" ? p : JSON.stringify(p));
  return h.digest("hex").slice(0, 24);
}

// ── Tier 4: engine warm ─────────────────────────────────────────────────────────
type Engine = {
  createCanvas: (w: number, h: number) => unknown;
  loadImage: (b: Buffer) => Promise<unknown>;
  toBuffer: (canvas: unknown, mime: string) => Buffer;
  renderScene: (...a: unknown[]) => unknown;
  perspectiveWarp: (...a: unknown[]) => unknown;
};
let _engine: Promise<Engine> | null = null;

/** Importa @visant/psd-engine + adapter node UMA vez por processo (cold-import some). */
export function getEngine(): Promise<Engine> {
  if (!_engine) {
    _engine = (async () => {
      const mod = await import("@visant/psd-engine");
      const adapter = await mod.createNodeAdapter();
      return {
        createCanvas: adapter.createCanvas as Engine["createCanvas"],
        loadImage: adapter.loadImage as Engine["loadImage"],
        toBuffer: adapter.toBuffer as Engine["toBuffer"],
        renderScene: mod.renderScene as Engine["renderScene"],
        perspectiveWarp: mod.perspectiveWarp as Engine["perspectiveWarp"],
      };
    })();
  }
  return _engine;
}

// ── Tier 4: leitura de disco cacheada por path+mtime ────────────────────────────
const _fileCache = new LRU<{ mtimeMs: number; buf: Buffer }>(64);

/** readFile com cache invalidado pelo mtime do arquivo (escrita de process re-lê). */
export async function readFileCached(path: string): Promise<Buffer> {
  let mtimeMs = 0;
  try { mtimeMs = statSync(path).mtimeMs; } catch { /* sumiu → deixa o readFile estourar */ }
  const hit = _fileCache.get(path);
  if (hit && hit.mtimeMs === mtimeMs) return hit.buf;
  const buf = await readFile(path);
  _fileCache.set(path, { mtimeMs, buf });
  return buf;
}

// ── Tier 1: cache do composite base (geometria) ─────────────────────────────────
export interface BaseComposite {
  basePng: Buffer;   // saída do engine + downscale (resolução nativa), antes do look
  fullMask: Buffer;  // máscara da superfície (W×H, alpha) usada por todos os FX de look
}
const _baseCache = new LRU<BaseComposite>(24); // ~24 cenas/geometrias quentes

export function getBaseComposite(key: string): BaseComposite | undefined {
  return _baseCache.get(key);
}
export function setBaseComposite(key: string, v: BaseComposite): void {
  _baseCache.set(key, v);
}
