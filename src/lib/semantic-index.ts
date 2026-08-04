/**
 * semantic-index — o cache de vetores do catálogo e a busca por cosseno em cima dele.
 *
 * O que isto resolve: `"engenharia"` tem de trazer canteiro, obra, capacete e industrial
 * mesmo que ninguém tenha escrito "engenharia" em lugar nenhum do acervo. O léxico
 * (MiniSearch + sinônimos) só acha o que está escrito; o vetor acha o que é parecido.
 *
 * Três decisões que valem o comentário:
 *
 * 1. **Cache incremental por hash.** Reindexar o acervo é evento raro (entra mockup novo,
 *    muda tag), não custo por request. Cada doc guarda o hash do texto que gerou o vetor;
 *    só re-embeda quem mudou — ou quando o `fingerprint` do modelo muda, porque vetor de
 *    dois modelos diferentes no mesmo arquivo é ranking estragado em silêncio.
 * 2. **Varredura direta, sem ANN.** ~20k docs × 512 dims é aritmética de milissegundos, e
 *    os vetores já vêm L2-normalizados de `embeddings.ts` — então cosseno é só produto
 *    escalar. Índice aproximado aqui seria uma dependência a mais para ganhar nada.
 * 3. **Nunca obrigatório.** Sem chave, sem cache ou com o arquivo corrompido, tudo devolve
 *    `null`/`skipped` e a busca segue exatamente como hoje.
 *
 * O diretório do cache é `.tmp/search/` e pode ser trocado por `SEARCH_CACHE_DIR` (é o que
 * os testes usam, para não sujar o `.tmp` do projeto).
 */
import { createHash } from "crypto";
import { readFile, writeFile, rename, mkdir, appendFile, stat } from "fs/promises";
import { join, dirname } from "path";
import type { SearchDoc } from "./search-engine";
import { embedTexts, embedFingerprint, isEmbeddingsEnabled, getEmbeddingsConfig } from "./embeddings";

function cacheDir(): string {
  // Lido a cada chamada de propósito: o teste seta a env antes de exercitar a função,
  // e uma const de topo de módulo congelaria o valor no import.
  return process.env.SEARCH_CACHE_DIR?.trim() || join(process.cwd(), ".tmp", "search");
}
const docCachePath = () => join(cacheDir(), "embeddings.jsonl");
const queryCachePath = () => join(cacheDir(), "query-embeddings.jsonl");

/** Piso de similaridade: abaixo disso o "parecido" é ruído de espaço vetorial, não resultado. */
const MIN_SCORE = 0.15;
const DEFAULT_K = 100;
/** Quantas queries ficam na memória do processo antes de a mais velha cair. */
const QUERY_LRU = 200;

// ---------------------------------------------------------------- texto e hash

/**
 * O texto que representa o doc no espaço vetorial = o que o card mostra.
 * Campo técnico (caminho de PSD, nome de smart object) fica de fora: engorda o embedding
 * com string de sistema e aproxima docs que só têm em comum a pasta onde foram salvos.
 */
export function docText(doc: Pick<SearchDoc, "name" | "studio" | "description" | "tags" | "mockupType">): string {
  const parts = [
    doc.name?.trim(),
    doc.studio?.trim(),
    [...new Set(doc.mockupType ?? [])].filter(Boolean).join(", "),
    [...new Set(doc.tags ?? [])].filter(Boolean).join(", "),
    doc.description?.trim(),
  ].filter((p): p is string => !!p);
  return parts.join(" · ");
}

export function hashText(text: string): string {
  return createHash("sha1").update(text, "utf8").digest("hex");
}

// ---------------------------------------------------------------- (de)serialização

/** Float32Array → base64. Ocupa ~1/4 de um array JSON de floats e não perde precisão. */
export function encodeVec(v: Float32Array): string {
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString("base64");
}

export function decodeVec(b64: string): Float32Array {
  const buf = Buffer.from(b64, "base64");
  // `Buffer` do Node pode vir com offset dentro de um pool compartilhado — copiar é o que
  // garante alinhamento de 4 bytes para o Float32Array.
  const copy = new Uint8Array(buf.byteLength);
  copy.set(buf);
  return new Float32Array(copy.buffer);
}

export interface VecRow {
  id: string;
  hash: string;
  fp: string;
  dims: number;
  vec: string;
}

/**
 * Lê o jsonl tolerando linha podre. Um `Ctrl+C` no meio de um append deixa meia linha no
 * fim do arquivo — e perder uma linha de cache é irrelevante perto de derrubar a busca.
 * Linha repetida: a última vence (o arquivo é append-only entre reescritas).
 */
export function parseVecLines(content: string): Map<string, VecRow> {
  const out = new Map<string, VecRow>();
  for (const line of content.split("\n")) {
    const s = line.trim();
    if (!s) continue;
    try {
      const row = JSON.parse(s) as Partial<VecRow>;
      if (typeof row?.id !== "string" || typeof row.vec !== "string") continue;
      out.set(row.id, {
        id: row.id,
        hash: typeof row.hash === "string" ? row.hash : "",
        fp: typeof row.fp === "string" ? row.fp : "",
        dims: typeof row.dims === "number" ? row.dims : 0,
        vec: row.vec,
      });
    } catch {
      // linha corrompida: pula, não explode
    }
  }
  return out;
}

async function readRows(path: string): Promise<Map<string, VecRow>> {
  try {
    return parseVecLines(await readFile(path, "utf8"));
  } catch {
    return new Map();
  }
}

/** Escrita atômica (tmp+rename), o mesmo molde do `hidden-store.ts`. */
async function atomicWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, content);
  await rename(tmp, path);
}

function serialize(rows: Iterable<VecRow>): string {
  let out = "";
  for (const r of rows) out += JSON.stringify(r) + "\n";
  return out;
}

// ---------------------------------------------------------------- ranking puro

export interface DotRankOpts {
  k?: number;
  ids?: Set<string>;
  minScore?: number;
}

/**
 * Produto escalar contra todo o acervo, top-k. Puro e sem I/O — é a peça que os testes
 * exercitam com vetores sintéticos. Vetores de dimensão diferente são ignorados em vez de
 * comparados pela metade (acontece quando o cache tem sobra de um modelo anterior).
 */
export function rankByDot(
  query: Float32Array,
  vectors: Map<string, Float32Array>,
  opts: DotRankOpts = {},
): { id: string; score: number }[] {
  const k = opts.k ?? DEFAULT_K;
  const floor = opts.minScore ?? MIN_SCORE;
  const scored: { id: string; score: number }[] = [];
  for (const [id, v] of vectors) {
    if (opts.ids && !opts.ids.has(id)) continue;
    if (v.length !== query.length) continue;
    let dot = 0;
    for (let i = 0; i < v.length; i++) dot += v[i] * query[i];
    if (dot >= floor) scored.push({ id, score: dot });
  }
  // Desempate por id mantém a saída determinística — senão dois docs com score idêntico
  // trocam de lugar entre execuções e o teste vira loteria.
  scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return scored.slice(0, Math.max(0, k));
}

/** Centróide L2-normalizado de um conjunto de vetores (o "assunto médio" da coleção). */
export function centroidOf(vecs: Float32Array[]): Float32Array | null {
  const first = vecs.find((v) => v.length > 0);
  if (!first) return null;
  const dims = first.length;
  const acc = new Float32Array(dims);
  let n = 0;
  for (const v of vecs) {
    if (v.length !== dims) continue;
    for (let i = 0; i < dims; i++) acc[i] += v[i];
    n++;
  }
  if (!n) return null;
  let sum = 0;
  for (let i = 0; i < dims; i++) { acc[i] /= n; sum += acc[i] * acc[i]; }
  const norm = Math.sqrt(sum);
  if (norm > 0) for (let i = 0; i < dims; i++) acc[i] /= norm;
  return acc;
}

// ---------------------------------------------------------------- cache dos docs

let vecCache: { path: string; mtimeMs: number; fp: string; vectors: Map<string, Float32Array> } | null = null;

/**
 * Vetores do catálogo, memoizados e invalidados por mtime do arquivo — o `embed-catalog.ts`
 * roda FORA do processo do app, então cache por TTL deixaria o servidor cego para um
 * reindex recém-terminado.
 */
export async function getVectors(): Promise<Map<string, Float32Array>> {
  const path = docCachePath();
  const fp = embedFingerprint();
  let mtimeMs = 0;
  try {
    mtimeMs = (await stat(path)).mtimeMs;
  } catch {
    return new Map();
  }
  if (vecCache && vecCache.path === path && vecCache.mtimeMs === mtimeMs && vecCache.fp === fp) {
    return vecCache.vectors;
  }
  const rows = await readRows(path);
  const vectors = new Map<string, Float32Array>();
  for (const row of rows.values()) {
    // Vetor de outro modelo não entra: comparar espaços diferentes devolve número, não sentido.
    if (row.fp && fp !== "off" && row.fp !== fp) continue;
    try {
      vectors.set(row.id, decodeVec(row.vec));
    } catch {
      // base64 estragado: some com o vetor, não com a busca
    }
  }
  vecCache = { path, mtimeMs, fp, vectors };
  return vectors;
}

/** Só para teste / após reindex no mesmo processo. */
export function invalidateSemanticCache(): void {
  vecCache = null;
  queryMemo.clear();
}

export interface EnsureOpts {
  onProgress?: (done: number, total: number) => void;
  /** Lotes de embedding disparados em paralelo (default 2). */
  concurrency?: number;
  /** Ignora o hash e re-embeda tudo. */
  force?: boolean;
}

interface TodoItem {
  id: string;
  text: string;
  hash: string;
}

export interface EnsureResult {
  embedded: number;
  cached: number;
  skipped: boolean;
}

/**
 * Garante um vetor por doc, embedando só o que mudou de hash (ou de modelo).
 * Reescreve o arquivo inteiro no fim, atomicamente: o jsonl é o estado completo, e
 * append incremental deixaria linhas órfãs de docs que saíram do acervo.
 */
export async function ensureEmbeddings(docs: SearchDoc[], opts: EnsureOpts = {}): Promise<EnsureResult> {
  if (!isEmbeddingsEnabled()) return { embedded: 0, cached: 0, skipped: true };

  const path = docCachePath();
  const fp = embedFingerprint();
  const existing = await readRows(path);
  const next = new Map<string, VecRow>();
  const todo: TodoItem[] = [];

  for (const doc of docs) {
    const text = docText(doc);
    if (!text) continue;
    const hash = hashText(text);
    const prev = existing.get(doc.id);
    if (!opts.force && prev && prev.hash === hash && prev.fp === fp) {
      next.set(doc.id, prev);
      continue;
    }
    todo.push({ id: doc.id, text, hash });
  }

  const cached = next.size;
  let embedded = 0;
  opts.onProgress?.(0, todo.length);

  // Lotes de 32 (menores que o batch do provedor) só para o progresso ser útil e para a
  // falha de UMA chamada não jogar fora o lote inteiro já pago.
  const CHUNK = 32;
  const chunks: TodoItem[][] = [];
  for (let i = 0; i < todo.length; i += CHUNK) chunks.push(todo.slice(i, i + CHUNK));

  const concurrency = Math.max(1, Math.min(opts.concurrency ?? 2, 8));
  let cursor = 0;
  const worker = async () => {
    for (;;) {
      const chunk = chunks[cursor++];
      if (!chunk) return;
      const vecs = await embedTexts(chunk.map((t) => t.text), "passage");
      if (!vecs) continue; // provedor fora do ar: o que já está em cache continua valendo
      chunk.forEach((t, i) => {
        const v = vecs[i];
        if (!v) return;
        next.set(t.id, { id: t.id, hash: t.hash, fp, dims: v.length, vec: encodeVec(v) });
        embedded++;
      });
      opts.onProgress?.(embedded, todo.length);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));

  if (embedded || next.size !== existing.size) {
    await atomicWrite(path, serialize(next.values()));
    vecCache = null;
  }
  return { embedded, cached, skipped: false };
}

// ---------------------------------------------------------------- embedding da query

const queryMemo = new Map<string, Float32Array>();

function rememberQuery(key: string, vec: Float32Array) {
  queryMemo.delete(key);
  queryMemo.set(key, vec);
  if (queryMemo.size > QUERY_LRU) {
    const oldest = queryMemo.keys().next().value;
    if (oldest !== undefined) queryMemo.delete(oldest);
  }
}

/**
 * Vetor da query, com dois níveis de cache: LRU em memória (a mesma query repetida numa
 * sessão de scroll) e jsonl em disco (sobrevive ao restart do dev server). Query custa
 * uma chamada de rede DENTRO do caminho da busca — é o único ponto do sistema onde
 * embedding entra no p95, então vale os dois.
 */
async function embedQuery(query: string): Promise<Float32Array | null> {
  const fp = embedFingerprint();
  const key = `${fp} ${query}`;
  const hit = queryMemo.get(key);
  if (hit) return hit;

  const path = queryCachePath();
  const id = hashText(key);
  const rows = await readRows(path);
  const row = rows.get(id);
  if (row && row.fp === fp) {
    try {
      const v = decodeVec(row.vec);
      rememberQuery(key, v);
      return v;
    } catch { /* linha estragada: reembeda */ }
  }

  const vecs = await embedTexts([query], "query");
  const vec = vecs?.[0];
  if (!vec) return null;
  rememberQuery(key, vec);
  try {
    await mkdir(dirname(path), { recursive: true });
    // Append (não reescrita): o cache de query é histórico, e várias abas escrevendo ao
    // mesmo tempo num rename atômico se sobrescreveriam.
    await appendFile(path, JSON.stringify({ id, hash: id, fp, dims: vec.length, vec: encodeVec(vec) }) + "\n", "utf8");
  } catch { /* cache de query é conveniência, não pode derrubar a busca */ }
  return vec;
}

// ---------------------------------------------------------------- API pública

export interface SemanticRankOpts {
  k?: number;
  /** Restringe a varredura (ex.: só os ids que passaram nas facetas). */
  ids?: Set<string>;
  minScore?: number;
}

/**
 * Ids do catálogo mais próximos da query, do mais para o menos parecido.
 * `null` = camada densa indisponível (desligada, sem cache ou provedor fora) — quem chama
 * segue só com a lista léxica.
 */
export async function semanticRank(query: string, opts: SemanticRankOpts = {}): Promise<string[] | null> {
  const q = query?.trim();
  if (!q || !isEmbeddingsEnabled()) return null;
  const vectors = await getVectors();
  if (!vectors.size) return null;
  const vec = await embedQuery(q);
  if (!vec) return null;
  return rankByDot(vec, vectors, opts).map((r) => r.id);
}

export interface CentroidRankOpts {
  k?: number;
  exclude?: Set<string>;
  minScore?: number;
}

/**
 * "Mais como estes": centróide dos vetores dos ids dados → vizinhos mais próximos.
 * É o *completar a coleção* — a curadoria já feita é que diz o que buscar, sem ninguém
 * precisar escrever uma query. Não gasta rede: só usa vetor que já está em cache.
 */
export async function centroidRank(ids: string[], opts: CentroidRankOpts = {}): Promise<string[] | null> {
  if (!ids.length || !isEmbeddingsEnabled()) return null;
  const vectors = await getVectors();
  if (!vectors.size) return null;
  const seeds = ids.map((id) => vectors.get(id)).filter((v): v is Float32Array => !!v);
  if (!seeds.length) return null;
  const c = centroidOf(seeds);
  if (!c) return null;

  const exclude = new Set([...ids, ...(opts.exclude ?? [])]);
  const k = opts.k ?? 24;
  // Pede k + |exclude| e corta depois: filtrar antes do slice é o que evita devolver
  // menos do que k só porque as sementes ocupavam o topo (elas SEMPRE ocupam).
  return rankByDot(c, vectors, { k: k + exclude.size, minScore: opts.minScore })
    .filter((r) => !exclude.has(r.id))
    .slice(0, k)
    .map((r) => r.id);
}

export interface SemanticStats {
  enabled: boolean;
  vectors: number;
  model: string | null;
  dims: number | null;
}

/** Diagnóstico: o `embed-catalog.ts` e o `doctor` querem saber se há vetor no chão. */
export async function semanticStats(): Promise<SemanticStats> {
  const config = getEmbeddingsConfig();
  const vectors = config ? await getVectors() : new Map<string, Float32Array>();
  const first = vectors.values().next().value as Float32Array | undefined;
  return {
    enabled: !!config,
    vectors: vectors.size,
    model: config?.model ?? null,
    dims: first?.length ?? config?.dims ?? null,
  };
}
