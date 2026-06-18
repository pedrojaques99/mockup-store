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

export const NEW_MOCKUPS_DIR = join(process.cwd(), "Render", "New Mockups");
const FILE = "quads.json";

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
