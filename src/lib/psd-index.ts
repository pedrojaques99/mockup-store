import { walkPsds, type FileEntry } from "./fs-walk";

export interface PsdFile {
  name: string;
  path: string;
  folder: string;
  sizeBytes: number;
}

let psdCache: PsdFile[] | null = null;
let normalizedIndex: Map<string, PsdFile> | null = null;
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
  for (const p of psds) {
    map.set(p.name.toLowerCase(), p);
    map.set(normalize(p.name), p);
  }
  return map;
}

export function addRuntimeDir(dir: string) {
  runtimeDirs.add(dir.replace(/\\/g, "/"));
  psdCache = null;
  normalizedIndex = null;
}

export function getAllPsds(forceRefresh = false): PsdFile[] {
  if (psdCache && !forceRefresh) return psdCache;

  const envDirs = (process.env.PSD_DIRS || "")
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean);
  const allDirs = [...new Set([...envDirs, ...runtimeDirs])];
  const results: PsdFile[] = [];
  for (const dir of allDirs) {
    results.push(...walkPsds(dir).map(toPsdFile));
  }
  psdCache = results;
  normalizedIndex = buildIndex(results);
  return results;
}

export function findPsdForRef(refName: string, studio?: string): PsdFile | null {
  const psds = getAllPsds();
  if (!normalizedIndex) normalizedIndex = buildIndex(psds);

  let cleaned = refName;
  if (studio === "Mockups Maison" || refName.startsWith("MM_") || refName.startsWith("MM ")) {
    cleaned = refName.replace(/\s*Média$/i, "").trim();
  } else if (studio === "Hazard Mockups" || refName.startsWith("HM_")) {
    cleaned = refName.replace(/-?preview$/i, "").trim();
  }

  const isGeneric = /^\d+$/.test(cleaned) || cleaned.length < 4;
  if (isGeneric) return null;

  const exactLower = normalizedIndex.get(cleaned.toLowerCase());
  if (exactLower) return exactLower;

  const normRef = normalize(cleaned);
  if (normRef.length < 5) return null;
  const normMatch = normalizedIndex.get(normRef);
  if (normMatch) return normMatch;

  if (normRef.length >= 8) {
    const match = psds.find((p) => {
      const pNorm = normalize(p.name);
      return pNorm.length >= 8 && (pNorm.includes(normRef) || normRef.includes(pNorm));
    });
    if (match) return match;
  }

  return null;
}
