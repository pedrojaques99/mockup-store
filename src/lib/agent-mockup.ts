/**
 * agent-mockup — RAIZ headless do loop de mockups (LLM-agnóstico).
 *
 * Recebe arte + cenas calibradas e renderiza mockups pelo MESMO core WYSIWYG da UI/produção
 * (`buildBaseComposite` + `applyLooks`) → o que o agente gera é byte-idêntico ao app.
 * As superfícies (CLI, MCP, HTTP) são adaptadores finos sobre esta lib — a lógica vive aqui.
 *
 * Robustez na raiz: tipado, try/catch por cena (1 falha não derruba o lote), resumível
 * (pula o que já existe), determinístico, sem estado global.
 */
import { readFile, writeFile, mkdir, readdir } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import {
  buildBaseComposite, applyLooks,
  type RenderEngine, type SceneAnalysis, type BaseParams, type LooksParams,
} from "./photo-render-core";
import { frameArt } from "./server-frame";
import type { FitMode } from "./art-frame";
import type { MaterialKind } from "./material-fx";

const SCENE_ROOTS = [
  join(process.cwd(), "data", "photo-scenes"),
  join(process.cwd(), ".tmp", "photo-scenes"),
];
const ID_RE = /^[a-f0-9]{16}$/;

/** Resolve o diretório de uma cena (data/ tem prioridade sobre .tmp/). */
export function resolveSceneDir(id: string): string | null {
  for (const root of SCENE_ROOTS) {
    const dir = join(root, id);
    if (existsSync(join(dir, "analysis.json"))) return dir;
  }
  return null;
}

/** settings.json (flat, FX-prefixed) — a calibração persistida pela publish route. */
interface SceneSettings {
  shadowOpacity?: number; highlightOpacity?: number; castOpacity?: number;
  maskFeather?: number; maskContract?: number; textureAmount?: number;
  reflectionOpacity?: number; reflectionBlur?: number; specularOpacity?: number;
  lightWrap?: number; matchScene?: number; contactShadow?: number;
  cylinder?: number; bend?: { top?: number; bottom?: number; left?: number; right?: number };
  fxGrain?: number; fxWarmth?: number; fxSaturation?: number; fxBrightness?: number; fxContrast?: number;
  mesh?: unknown; material?: string; surfaceMaterial?: string;
  materialIntensity?: number; materialAngle?: number; materialScale?: number;
  luzOverlays?: unknown[];
  [k: string]: unknown;
}

/** Converte settings.json (flat) → params do core (base + looks). É o ÚNICO ponto de tradução. */
function settingsToParams(s: SceneSettings): { base: BaseParams; looks: LooksParams } {
  const b = s.bend ?? {};
  const hasWarp = !!(s.cylinder || b.top || b.bottom || b.left || b.right);
  const warp = hasWarp
    ? { cylinder: s.cylinder ?? 0, bendTop: b.top ?? 0, bendBottom: b.bottom ?? 0, bendLeft: b.left ?? 0, bendRight: b.right ?? 0 }
    : null;
  const matKind = (s.material ?? s.surfaceMaterial) as string | undefined;
  const material = matKind && matKind !== "none"
    ? { kind: matKind as MaterialKind, intensity: s.materialIntensity, angle: s.materialAngle, scale: s.materialScale }
    : null;

  const base: BaseParams = {
    warp, textureAmount: s.textureAmount, mesh: (s.mesh as BaseParams["mesh"]) ?? null,
    maskFeather: s.maskFeather, maskContract: s.maskContract,
    shadowOpacity: s.shadowOpacity, highlightOpacity: s.highlightOpacity, castOpacity: s.castOpacity,
    material,
  };

  const fxNeutral = (s.fxSaturation ?? 100) === 100 && (s.fxBrightness ?? 100) === 100 &&
    (s.fxContrast ?? 100) === 100 && (s.fxWarmth ?? 0) === 0 && (s.fxGrain ?? 0) === 0;
  const looks: LooksParams = {
    reflectionOpacity: s.reflectionOpacity, reflectionBlur: s.reflectionBlur,
    specularOpacity: s.specularOpacity, lightWrap: s.lightWrap,
    matchScene: s.matchScene, contactShadow: s.contactShadow,
    fx: fxNeutral ? null : { grain: s.fxGrain, warmth: s.fxWarmth, saturation: s.fxSaturation, brightness: s.fxBrightness, contrast: s.fxContrast },
    luzOverlays: (s.luzOverlays as LooksParams["luzOverlays"]) ?? undefined,
  };
  return { base, looks };
}

let _engine: RenderEngine | null = null;
async function getHeadlessEngine(): Promise<RenderEngine> {
  if (_engine) return _engine;
  const mod = await import("@visant/psd-engine");
  const { createCanvas, loadImage, toBuffer } = await (mod as { createNodeAdapter: () => Promise<{ createCanvas: unknown; loadImage: unknown; toBuffer: unknown }> }).createNodeAdapter();
  _engine = {
    createCanvas: createCanvas as RenderEngine["createCanvas"],
    loadImage: loadImage as RenderEngine["loadImage"],
    toBuffer: toBuffer as RenderEngine["toBuffer"],
    renderScene: (mod as { renderScene: RenderEngine["renderScene"] }).renderScene,
    perspectiveWarp: (mod as { perspectiveWarp: RenderEngine["perspectiveWarp"] }).perspectiveWarp,
  };
  return _engine;
}

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

export interface PhotoMockupJob {
  /** Arte/logo (qualquer formato que o sharp leia). É enquadrada por cena. */
  art: Buffer;
  /** IDs das cenas a renderizar. */
  sceneIds: string[];
  /** Pasta de saída (PNGs numerados + summary.json). */
  outDir: string;
  /** Enquadramento da arte no aspect da superfície. Default "contain". */
  fit?: FitMode;
  bg?: string | null;
  padding?: number;
  /** "hd" = SSAA full-res (entrega); "preview" = rápido. Default "hd". */
  quality?: "preview" | "hd";
  /** Ignora o que já existe e recomeça. */
  fresh?: boolean;
  onProgress?: (msg: string) => void;
}

export interface MockupResult {
  sceneId: string; ok: boolean; file?: string; name?: string; error?: string; ms: number;
}

const slug = (s: string) => s.replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48) || "scene";

/**
 * Renderiza um lote de mockups-foto via o core WYSIWYG. Uma cena que falha vira um result
 * com `ok:false` (não derruba o lote). Resumível: sem `fresh`, pula PNGs já presentes.
 */
export async function createPhotoMockups(job: PhotoMockupJob): Promise<{ results: MockupResult[]; outDir: string }> {
  const { art, sceneIds, outDir } = job;
  const fit: FitMode = job.fit ?? "contain";
  const quality = job.quality ?? "hd";
  const log = job.onProgress ?? (() => {});
  await mkdir(outDir, { recursive: true });
  const engine = await getHeadlessEngine();
  const results: MockupResult[] = [];

  let n = 0;
  for (const sceneId of sceneIds) {
    n++;
    const t0 = Date.now();
    const idx = String(n).padStart(3, "0");
    try {
      if (!ID_RE.test(sceneId)) throw new Error("id inválido");
      const dir = resolveSceneDir(sceneId);
      if (!dir) throw new Error("cena não encontrada");

      const analysis = JSON.parse(await readFile(join(dir, "analysis.json"), "utf-8")) as SceneAnalysis;
      const meta = JSON.parse(await readFile(join(dir, "meta.json"), "utf-8")) as { ext: string; originalName?: string };
      const settings: SceneSettings = existsSync(join(dir, "settings.json"))
        ? JSON.parse(await readFile(join(dir, "settings.json"), "utf-8"))
        : {};
      const name = slug(meta.originalName?.replace(/\.[^.]+$/, "") ?? sceneId);
      const file = join(outDir, `${idx}_${name}.png`);

      if (!job.fresh && existsSync(file)) {
        results.push({ sceneId, ok: true, file, name, ms: 0 });
        log(`= ${idx} ${name} (pulado, já existe)`);
        continue;
      }

      // pré-requisitos do core
      for (const f of ["shadow.png", "mask.png"]) {
        if (!existsSync(join(dir, f))) throw new Error(`falta ${f} (rode /process)`);
      }

      // enquadra a arte no aspect interno da superfície (média das arestas opostas)
      const q = analysis.quad;
      const innerW = Math.max(1, Math.round((dist(q.tl, q.tr) + dist(q.bl, q.br)) / 2));
      const innerH = Math.max(1, Math.round((dist(q.tl, q.bl) + dist(q.tr, q.br)) / 2));
      const framed = await frameArt(art, innerW, innerH, { mode: fit, bg: job.bg ?? null, padding: job.padding });
      const artBase64 = framed.toString("base64");

      const rawPhotoPath = join(dir, `photo.${meta.ext}`);
      const cleanPath = join(dir, "photo-clean.png");
      const rd = (p: string) => readFile(join(dir, p));
      const [rawPhoto, photo, multiply, screen, mask, colorCast, reflectionMask, occluder] = await Promise.all([
        readFile(rawPhotoPath),
        existsSync(cleanPath) ? readFile(cleanPath) : readFile(rawPhotoPath),
        rd("shadow.png"),
        existsSync(join(dir, "shadow-screen.png")) ? rd("shadow-screen.png") : rd("shadow.png"),
        rd("mask.png"),
        existsSync(join(dir, "color-cast.png")) ? rd("color-cast.png") : Promise.resolve(undefined),
        existsSync(join(dir, "reflection-mask.png")) ? rd("reflection-mask.png") : Promise.resolve(null),
        existsSync(join(dir, "occluder.png")) ? rd("occluder.png") : Promise.resolve(null),
      ]);

      const { base, looks } = settingsToParams(settings);
      const baseOut = await buildBaseComposite({
        engine, analysis, photo, rawPhoto, multiply, screen, mask,
        colorCast: colorCast as Buffer | undefined, artBase64, params: base, quality,
      });
      const png = await applyLooks({
        engine, analysis, png: baseOut.basePng, fullMask: baseOut.fullMask, rawPhoto, artBase64,
        reflectionMask: (reflectionMask as Buffer | null) ?? null, occluder: (occluder as Buffer | null) ?? null,
        params: looks,
      });

      await writeFile(file, png);
      const ms = Date.now() - t0;
      results.push({ sceneId, ok: true, file, name, ms });
      log(`✓ ${idx} ${name} (${ms}ms)`);
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : String(e);
      results.push({ sceneId, ok: false, error, ms: Date.now() - t0 });
      log(`✗ ${idx} ${sceneId}: ${error}`);
    }
  }

  const summary = {
    total: results.length, ok: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length,
    quality, fit, results,
  };
  await writeFile(join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
  return { results, outDir };
}

export interface SceneInfo { id: string; name: string; surfaceType: string; published: boolean; }

/** Enumera as cenas calibradas disponíveis (data/ = publicadas, .tmp/ = rascunho). */
export async function listPhotoScenes(): Promise<SceneInfo[]> {
  const out: SceneInfo[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < SCENE_ROOTS.length; i++) {
    const root = SCENE_ROOTS[i];
    if (!existsSync(root)) continue;
    for (const id of await readdir(root)) {
      if (!ID_RE.test(id) || seen.has(id)) continue;
      const dir = join(root, id);
      if (!existsSync(join(dir, "analysis.json")) || !existsSync(join(dir, "shadow.png"))) continue;
      seen.add(id);
      try {
        const a = JSON.parse(await readFile(join(dir, "analysis.json"), "utf-8"));
        const m = JSON.parse(await readFile(join(dir, "meta.json"), "utf-8"));
        out.push({ id, name: m.originalName ?? id, surfaceType: a.surfaceType ?? "unknown", published: i === 0 });
      } catch { /* cena corrompida — ignora */ }
    }
  }
  return out;
}
