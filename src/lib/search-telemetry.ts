/**
 * search-telemetry — o que a busca aprendeu com o uso, e o que ela não sabe responder.
 *
 * Duas coisas num arquivo só, porque uma alimenta a outra:
 *
 * 1. LOG DE QUERY (`queries.jsonl`): toda busca vira uma linha `{q, hits, ms, pass}`.
 *    Serve pra responder "quantas queries deram ZERO resultado" — que é exatamente o
 *    sinal que teria pego o bug do `"t-shirt"` (1444 de 1620 hits) sem ninguém precisar
 *    ir medir na mão. Sem isso a busca só parece boa.
 * 2. SINAIS DE CLIQUE (`signals.json`): qual resultado foi realmente aberto/renderizado
 *    para cada query. Vira `boostDocument` no ranking — mesma relevância textual, ordem
 *    melhor, e melhora sozinha conforme o acervo é usado.
 *
 * Tudo best-effort e assíncrono: telemetria NUNCA pode derrubar nem atrasar uma busca.
 * O mesmo princípio do `engine-feedback`, que já faz isso pro detector de quad.
 */
import { readFile, writeFile, mkdir, appendFile, stat } from "fs/promises";
import { join } from "path";
import { foldTerm } from "./search-synonyms";

const DIR = join(process.cwd(), ".tmp", "search");
const LOG_PATH = join(DIR, "queries.jsonl");
const SIGNALS_PATH = join(DIR, "signals.json");

/** Acima disso o log rotaciona (vira `.1`), pra não crescer sem fim em dev. */
const MAX_LOG_BYTES = 5_000_000;

export interface QueryLogEntry {
  t: string;
  q: string;
  hits: number;
  ms: number;
  /** em qual passe da cascata parou (1 = exato, 3 = precisou afrouxar tudo) */
  pass: number;
  studio?: string;
  aspect?: string;
  tags?: string[];
}

let dirReady: Promise<void> | null = null;
function ensureDir() {
  dirReady ??= mkdir(DIR, { recursive: true }).then(() => {});
  return dirReady;
}

/** Registra uma busca. Dispara e esquece — o await é só pra teste. */
export async function logQuery(e: Omit<QueryLogEntry, "t">): Promise<void> {
  try {
    await ensureDir();
    try {
      const s = await stat(LOG_PATH);
      if (s.size > MAX_LOG_BYTES) {
        const { rename } = await import("fs/promises");
        await rename(LOG_PATH, `${LOG_PATH}.1`);
      }
    } catch { /* log ainda não existe — normal */ }
    await appendFile(LOG_PATH, JSON.stringify({ t: new Date().toISOString(), ...e }) + "\n", "utf-8");
  } catch { /* telemetria nunca quebra a busca */ }
}

// ---------------------------------------------------------------- sinais de clique

interface Signals {
  /** cliques totais por doc — popularidade global */
  docs: Record<string, number>;
  /** cliques por termo normalizado → doc — afinidade query↔doc */
  terms: Record<string, Record<string, number>>;
}

const EMPTY: Signals = { docs: {}, terms: {} };

let signalsCache: Signals | null = null;
let signalsDirty = false;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

async function loadSignals(): Promise<Signals> {
  if (signalsCache) return signalsCache;
  try {
    const raw = JSON.parse(await readFile(SIGNALS_PATH, "utf-8"));
    signalsCache = {
      docs: raw?.docs && typeof raw.docs === "object" ? raw.docs : {},
      terms: raw?.terms && typeof raw.terms === "object" ? raw.terms : {},
    };
  } catch {
    signalsCache = { ...EMPTY, docs: {}, terms: {} };
  }
  return signalsCache;
}

/** Grava agrupado: um clique não pode custar um write síncrono no caminho do usuário. */
function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(async () => {
    flushTimer = null;
    if (!signalsDirty || !signalsCache) return;
    signalsDirty = false;
    try {
      await ensureDir();
      await writeFile(SIGNALS_PATH, JSON.stringify(signalsCache), "utf-8");
    } catch { /* best-effort */ }
  }, 2_000);
  // Não segura o processo vivo (CLI/script que só faz uma busca precisa sair).
  flushTimer.unref?.();
}

/** Um resultado foi aberto/renderizado a partir desta query. */
export async function logClick(query: string, docId: string): Promise<void> {
  if (!docId) return;
  try {
    const s = await loadSignals();
    s.docs[docId] = (s.docs[docId] ?? 0) + 1;
    for (const term of queryTerms(query)) {
      (s.terms[term] ??= {})[docId] = (s.terms[term][docId] ?? 0) + 1;
    }
    signalsDirty = true;
    scheduleFlush();
  } catch { /* best-effort */ }
}

function queryTerms(query: string): string[] {
  return [...new Set(query.split(/[\s\-_/.,]+/).map(foldTerm).filter((t) => t.length >= 3))];
}

/**
 * Multiplicador de popularidade por doc (0..~1.4) para o `boostDocument` do MiniSearch.
 *
 * Escala logarítmica de propósito: o primeiro clique importa muito mais que o centésimo,
 * senão os 3 mockups mais usados afundam todo o resto do acervo pra sempre — o clássico
 * feedback loop que mata a descoberta. E a afinidade query↔doc pesa mais que a
 * popularidade global, porque "o mais clicado PARA ESTA busca" é sinal melhor que
 * "o mais clicado de todos".
 */
export async function getBoostFn(query: string): Promise<(docId: string) => number> {
  let s: Signals;
  try {
    s = await loadSignals();
  } catch {
    return () => 0;
  }
  const terms = queryTerms(query);
  const affinity: Record<string, number> = {};
  for (const t of terms) {
    for (const [id, c] of Object.entries(s.terms[t] ?? {})) {
      affinity[id] = (affinity[id] ?? 0) + c;
    }
  }
  const norm = (c: number, cap: number) => (c > 0 ? Math.min(1, Math.log1p(c) / Math.log1p(cap)) : 0);
  return (docId: string) => 0.5 * norm(s.docs[docId] ?? 0, 50) + 0.9 * norm(affinity[docId] ?? 0, 10);
}

/** Só pra teste: zera o cache em memória (o arquivo continua onde está). */
export function __resetSignalsCache() {
  signalsCache = null;
  signalsDirty = false;
}

// ---------------------------------------------------------------- relatório

export interface SearchStats {
  total: number;
  zeroResult: { q: string; count: number }[];
  topQueries: { q: string; count: number; avgHits: number }[];
  latency: { p50: number; p95: number; max: number };
  /** quantas queries precisaram afrouxar pra fuzzy/OR — qualidade do acervo e do dicionário */
  byPass: Record<number, number>;
  topClicked: { id: string; clicks: number }[];
}

export async function getSearchStats(): Promise<SearchStats> {
  let lines: string[] = [];
  try {
    lines = (await readFile(LOG_PATH, "utf-8")).split("\n").filter(Boolean);
  } catch { /* sem log ainda */ }

  const entries: QueryLogEntry[] = [];
  for (const l of lines) {
    try { entries.push(JSON.parse(l)); } catch { /* linha truncada — ignora */ }
  }

  const zero = new Map<string, number>();
  const byQuery = new Map<string, { count: number; hits: number }>();
  const byPass: Record<number, number> = {};
  const times: number[] = [];

  for (const e of entries) {
    const q = (e.q ?? "").trim();
    if (!q) continue;
    if (!e.hits) zero.set(q, (zero.get(q) ?? 0) + 1);
    const agg = byQuery.get(q) ?? { count: 0, hits: 0 };
    agg.count++; agg.hits += e.hits ?? 0;
    byQuery.set(q, agg);
    byPass[e.pass ?? 0] = (byPass[e.pass ?? 0] ?? 0) + 1;
    if (typeof e.ms === "number") times.push(e.ms);
  }

  times.sort((a, b) => a - b);
  const pct = (p: number) => (times.length ? times[Math.min(times.length - 1, Math.floor(times.length * p))] : 0);

  const s = await loadSignals().catch(() => EMPTY);

  return {
    total: entries.length,
    zeroResult: [...zero.entries()].map(([q, count]) => ({ q, count })).sort((a, b) => b.count - a.count).slice(0, 50),
    topQueries: [...byQuery.entries()]
      .map(([q, v]) => ({ q, count: v.count, avgHits: Math.round(v.hits / v.count) }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 50),
    latency: { p50: pct(0.5), p95: pct(0.95), max: times.at(-1) ?? 0 },
    byPass,
    topClicked: Object.entries(s.docs).map(([id, clicks]) => ({ id, clicks })).sort((a, b) => b.clicks - a.clicks).slice(0, 25),
  };
}
