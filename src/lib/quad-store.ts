/**
 * quad-store — store golden dos quads calibrados (SSoT que aposenta o OVERRIDE_QUADS
 * hardcoded em scripts/test-pipeline-cv.ts).
 *
 * Sidecar `quads.json` na própria pasta das cenas (default Render/New Mockups):
 * viaja com as imagens, versionável, inspecionável. Guarda o CHUTE do detector
 * (`auto`) junto da CORREÇÃO humana (`quad`) → destrava eval por IoU, bias aprendido
 * e triagem sem reprocessar nada.
 *
 * Server-only (fs). Consumido pela API /api/calibrate e pelos scripts do pipeline.
 */
import { readFile, writeFile, rename } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import type { QuadCorners } from "./key-color-core";
import type { WarpMesh } from "./mesh-warp";

export const NEW_MOCKUPS_DIR = join(process.cwd(), "Render", "New Mockups");
/** Pasta de trabalho para imagens enviadas via upload na rota /calibrate. */
export const UPLOAD_DIR = join(process.cwd(), ".tmp", "calibrate-upload");
const FILE = "quads.json";
const IGNORE_FILE = "calibrate-ignore.json";

/** Resolve o `dir` vindo da API (default = Render/New Mockups). Trim só; o caller checa existsSync. */
export function resolveDir(d?: string | null): string {
  const t = (d ?? "").trim();
  return t || NEW_MOCKUPS_DIR;
}

export interface QuadEntry {
  /** Verdade — o que o humano encaixou (ou o auto, se ainda não corrigido). */
  quad: QuadCorners;
  /** Chute do detector no momento do save — base do delta/IoU. */
  auto?: QuadCorners;
  method: string;            // "key-color" | "white" | "sam" | "llm" | "manual"
  surfaceType: string;       // billboard | poster | card | wall | ...
  hue?: number;
  source: "manual" | "auto";
  confidence?: number;
  /** IoU auto×quad no momento do save (quão bom o detector estava). */
  iou?: number;
  detectorVersion?: number;
  /** Calibração de displacement: amplitude do warp e suavização do mapa de profundidade. */
  dispScale?: number;
  dispBlur?: number;
  /** Calibração de material/pós-edit (procedural): tipo + força + ângulo + escala. */
  material?: string;       // none | fabric | metal | glass | worn | shadow
  materialIntensity?: number;
  materialAngle?: number;
  materialScale?: number;
  /** Malha de warp (grade Coons estilo PS Warp) — abaulamento/envelope da superfície. */
  mesh?: WarpMesh;
  /** Substrato confirmado (auto-detectado ou override manual). Alimenta o
   *  self-learning loop e é re-importado pelo photo-mockup editor. */
  substrate?: string;
  /** Caminho relativo (dentro de `dir`) de um PNG sidecar com a máscara da superfície
   *  desenhada no /calibrate. SSoT compartilhado com o photo-mockup editor (importa/exporta). */
  surfaceMaskRel?: string;
  imageWidth: number;
  imageHeight: number;
  savedAt: number;
}

export type QuadStore = Record<string, QuadEntry>;

/** Escrita atômica (tmp + rename) — evita o pipeline ler um JSON pela metade. */
async function atomicWrite(path: string, buf: Buffer | string): Promise<void> {
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, buf);
  await rename(tmp, path);
}

export async function loadQuads(dir: string = NEW_MOCKUPS_DIR): Promise<QuadStore> {
  const p = join(dir, FILE);
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(await readFile(p, "utf8")) as QuadStore;
  } catch {
    return {};
  }
}

export async function getQuad(name: string, dir: string = NEW_MOCKUPS_DIR): Promise<QuadEntry | null> {
  const all = await loadQuads(dir);
  return all[name] ?? null;
}

// ── Lista de ignorados (cenas que somem da fila de calibração) ──────────────

export async function loadIgnored(dir: string = NEW_MOCKUPS_DIR): Promise<string[]> {
  const p = join(dir, IGNORE_FILE);
  if (!existsSync(p)) return [];
  try {
    const arr = JSON.parse(await readFile(p, "utf8"));
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

/** Liga/desliga o ignore de um arquivo. Retorna a lista final. */
export async function setIgnored(
  name: string,
  ignore: boolean,
  dir: string = NEW_MOCKUPS_DIR,
): Promise<string[]> {
  const set = new Set(await loadIgnored(dir));
  if (ignore) set.add(name); else set.delete(name);
  const list = [...set].sort();
  await atomicWrite(join(dir, IGNORE_FILE), JSON.stringify(list, null, 2));
  return list;
}

/** Upsert de uma entrada (merge raso com o que já existir). Retorna a entrada final. */
export async function upsertQuad(
  name: string,
  entry: QuadEntry,
  dir: string = NEW_MOCKUPS_DIR,
): Promise<QuadEntry> {
  const all = await loadQuads(dir);
  all[name] = { ...all[name], ...entry };
  await atomicWrite(join(dir, FILE), JSON.stringify(all, null, 2));
  return all[name];
}
