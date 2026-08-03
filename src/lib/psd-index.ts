import { walkPsds, psdRoots, type FileEntry } from "./fs-walk";

export interface PsdFile {
  name: string;
  path: string;
  folder: string;
  sizeBytes: number;
}

let psdCache: PsdFile[] | null = null;
let normalizedIndex: Map<string, PsdFile> | null = null;
/**
 * Nomes já normalizados, para a busca por substring do último recurso.
 *
 * Medido no acervo real: montar o catálogo levava 14s, e **9,2s eram este
 * fallback** — ele varria a lista inteira de PSDs chamando `normalize()` (quatro
 * regex + `toLowerCase`) em cada nome, a cada uma das 3.772 consultas que não
 * casavam por igualdade. Trabalho idêntico refeito milhões de vezes.
 *
 * Agora a normalização acontece UMA vez, junto do índice, e o fallback vira só
 * `String.includes` sobre strings prontas. Mesma ordem, mesmo resultado.
 * Já filtrado por `length >= 8` porque o chamador descartava esses de qualquer jeito.
 */
let substringIndex: { norm: string; psd: PsdFile }[] | null = null;
const runtimeDirs: Set<string> = new Set();

function toPsdFile(f: FileEntry): PsdFile {
  return { name: f.name, path: f.path, folder: f.folder, sizeBytes: f.sizeBytes };
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s*média$/i, "")
    .replace(/-?preview$/i, "")
    .replace(/[-_\s.]+/g, "")
    .trim();
}

function buildIndex(psds: PsdFile[]): Map<string, PsdFile> {
  const map = new Map<string, PsdFile>();
  const subs: { norm: string; psd: PsdFile }[] = [];
  for (const p of psds) {
    const norm = normalize(p.name);
    map.set(p.name.toLowerCase(), p);
    map.set(norm, p);
    if (norm.length >= 8) subs.push({ norm, psd: p });
  }
  substringIndex = subs;
  return map;
}

export function addRuntimeDir(dir: string) {
  runtimeDirs.add(dir.replace(/\\/g, "/"));
  psdCache = null;
  normalizedIndex = null;
  substringIndex = null;
}

export function getAllPsds(forceRefresh = false): PsdFile[] {
  if (psdCache && !forceRefresh) return psdCache;

  const allDirs = psdRoots([...psdRoots(), ...runtimeDirs].join(","));
  const results: PsdFile[] = [];
  const seenPaths = new Set<string>();
  for (const dir of allDirs) {
    for (const f of walkPsds(dir)) {
      const key = f.path.toLowerCase();
      if (seenPaths.has(key)) continue;
      seenPaths.add(key);
      results.push(toPsdFile(f));
    }
  }
  psdCache = results;
  normalizedIndex = buildIndex(results);
  return results;
}

/**
 * Memo do resultado por (nome, estúdio). O último recurso é uma varredura por
 * substring — inerentemente O(refs × psds) — e o catálogo se reconstrói a cada 60s
 * (TTL do `search-index`), refazendo exatamente as mesmas 3.772 consultas com
 * exatamente as mesmas respostas. Guarda o `null` também: "não achei" custa a
 * varredura inteira e é a resposta mais comum.
 */
let resolveMemo = new Map<string, PsdFile | null>();

export function findPsdForRef(refName: string, studio?: string): PsdFile | null {
  const psds = getAllPsds();
  if (!normalizedIndex || !substringIndex) {
    normalizedIndex = buildIndex(psds);
    resolveMemo = new Map(); // o conjunto de PSDs mudou → as respostas antigas não valem
  }

  // Separador NUL: um espaco colidiria ("Estudio A"+"x" vs "Estudio"+"A x").
  const memoKey = `${studio ?? ""}\u0000${refName}`;
  const memo = resolveMemo.get(memoKey);
  if (memo !== undefined) return memo;

  const result = resolvePsdForRef(refName, studio);
  resolveMemo.set(memoKey, result);
  return result;
}

function resolvePsdForRef(refName: string, studio?: string): PsdFile | null {
  // Chamada só por `findPsdForRef`, que garante os índices montados.
  const index = normalizedIndex!;
  let cleaned = refName;
  if (studio === "Mockups Maison" || refName.startsWith("MM_") || refName.startsWith("MM ")) {
    cleaned = refName.replace(/\s*Média$/i, "").trim();
  } else if (studio === "Hazard Mockups" || refName.startsWith("HM_")) {
    cleaned = refName.replace(/-?preview$/i, "").trim();
  }

  const isGeneric = /^\d+$/.test(cleaned) || cleaned.length < 4;
  if (isGeneric) return null;

  const exactLower = index.get(cleaned.toLowerCase());
  if (exactLower) return exactLower;

  const normRef = normalize(cleaned);
  if (normRef.length < 5) return null;
  const normMatch = index.get(normRef);
  if (normMatch) return normMatch;

  if (normRef.length >= 8) {
    const match = substringIndex!.find(
      ({ norm }) => norm.includes(normRef) || normRef.includes(norm),
    );
    if (match) return match.psd;
  }

  return null;
}
