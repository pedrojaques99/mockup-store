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
import { readFile, writeFile, mkdir, readdir, copyFile } from "fs/promises";
import { existsSync } from "fs";
import { join, basename } from "path";
import { randomUUID } from "crypto";
import sharp from "sharp";
import {
  extractSceneAssets, buildBaseComposite, applyLooks,
  type RenderEngine, type SceneAnalysis, type BaseParams, type LooksParams,
} from "./photo-render-core";
import { loadQuads, type QuadEntry } from "./quad-store";
import { detectKeyColorQuad } from "./photo-detect";
import { detectQuadSAM } from "./sam-mask";
import { frameArt } from "./server-frame";
import type { FitMode } from "./art-frame";
import type { MaterialKind } from "./material-fx";
import type { QuadCorners } from "./key-color-core";

const SCENE_ROOTS = [
  join(process.cwd(), "data", "photo-scenes"),
  join(process.cwd(), ".tmp", "photo-scenes"),
];
const ID_RE = /^[a-f0-9]{16}$/;

// Thumbnail do grid (card ~200px de largura na home) — nada de guardar o render full-res
// (que tinha média 3,9 MB, pico 17,5 MB). 640px cobre até telas retina de um card pequeno
// com folga, e WebP q80 é imperceptível nesse tamanho.
export const PREVIEW_MAX_WIDTH = 640;
export const PREVIEW_WEBP_QUALITY = 80;

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

// ─────────────────────────────────────────────────────────────────────────────
// FINALIZAR — imagem-fonte (+ quad corrigido do quads.json) → cena baked no store.
// É a cola que faltava entre o /calibrate (quads.json) e o store do photo-mockup.
// ─────────────────────────────────────────────────────────────────────────────

function bbox(q: QuadCorners, W: number, H: number) {
  const xs = [q.tl.x, q.tr.x, q.br.x, q.bl.x], ys = [q.tl.y, q.tr.y, q.br.y, q.bl.y];
  const left = Math.max(0, Math.floor(Math.min(...xs)));
  const top = Math.max(0, Math.floor(Math.min(...ys)));
  return { left, top, width: Math.min(W - 1, Math.ceil(Math.max(...xs))) - left + 1, height: Math.min(H - 1, Math.ceil(Math.max(...ys))) - top + 1 };
}

/**
 * Cria uma cena baked em `.tmp/photo-scenes/<id>/` a partir de uma imagem-fonte e seu
 * QuadEntry (quad corrigido + surfaceType + material/mesh + SAM opcional). Usa o MESMO
 * `extractSceneAssets` do /process → assets idênticos ao app. Retorna o id criado.
 */
export async function finalizeScene(imagePath: string, entry: QuadEntry, sidecarDir: string): Promise<string> {
  const meta = await sharp(imagePath).metadata();
  const W = meta.width ?? entry.imageWidth, H = meta.height ?? entry.imageHeight;
  const sx = entry.imageWidth ? W / entry.imageWidth : 1, sy = entry.imageHeight ? H / entry.imageHeight : 1;
  const sp = (p: { x: number; y: number }) => ({ x: Math.round(p.x * sx), y: Math.round(p.y * sy) });
  const quad: QuadCorners = (sx === 1 && sy === 1)
    ? entry.quad
    : { tl: sp(entry.quad.tl), tr: sp(entry.quad.tr), br: sp(entry.quad.br), bl: sp(entry.quad.bl) };
  const surfaceType = entry.surfaceType || "billboard";

  const id = randomUUID().replace(/-/g, "").slice(0, 16);
  const dir = join(process.cwd(), ".tmp", "photo-scenes", id);
  await mkdir(dir, { recursive: true });

  const photoPng = join(dir, "photo.png");
  await writeFile(photoPng, await sharp(imagePath).png().toBuffer());
  await writeFile(join(dir, "meta.json"), JSON.stringify({ ext: "png", width: W, height: H, originalName: basename(imagePath) }, null, 2));
  const analysis = {
    id, quad, surfaceType, material: entry.material ?? "unknown", hasOcclusion: false,
    confidence: entry.confidence ?? 1, imageWidth: W, imageHeight: H,
    ...(entry.needsReview ? { needsReview: true, qaReasons: entry.qaReasons ?? [] } : {}),
  };
  await writeFile(join(dir, "analysis.json"), JSON.stringify(analysis, null, 2));

  // SAM sidecar (surfaceMaskRel) → recorta no bbox do quad (igual /process)
  let surfaceMaskBuf: Buffer | undefined;
  if (entry.surfaceMaskRel) {
    const samPath = join(sidecarDir, entry.surfaceMaskRel);
    if (existsSync(samPath)) {
      surfaceMaskBuf = await sharp(samPath).resize(W, H, { fit: "fill" }).extract(bbox(quad, W, H)).ensureAlpha().png().toBuffer();
    }
  }

  const assets = await extractSceneAssets(photoPng, { quad, imageWidth: W, imageHeight: H, surfaceType }, { surfaceMaskBuf, cleanSource: photoPng });
  await Promise.all([
    writeFile(join(dir, "shadow.png"), assets.multiply),
    writeFile(join(dir, "shadow-screen.png"), assets.screen),
    writeFile(join(dir, "mask.png"), assets.mask),
    writeFile(join(dir, "color-cast.png"), assets.colorCast),
    writeFile(join(dir, "photo-clean.png"), assets.cleanPhoto),
    assets.reflectionMask ? writeFile(join(dir, "reflection-mask.png"), assets.reflectionMask) : Promise.resolve(),
    assets.occluder ? writeFile(join(dir, "occluder.png"), assets.occluder) : Promise.resolve(),
  ]);

  // settings.json — calibração de material/mesh do quads.json (o resto usa defaults do core).
  // MERGE: `studio`/`tags` vivem neste mesmo arquivo (escritos por `tagScenes`) e um
  // re-finalize não pode apagá-los — senão a cena some do filtro por estúdio do grid.
  const settingsPath = join(dir, "settings.json");
  let prevSettings: Record<string, unknown> = {};
  try { if (existsSync(settingsPath)) prevSettings = JSON.parse(await readFile(settingsPath, "utf-8")); } catch { /* corrompido — recomeça */ }
  await writeFile(settingsPath, JSON.stringify({
    ...prevSettings,
    surfaceType, material: entry.material, materialIntensity: entry.materialIntensity,
    materialAngle: entry.materialAngle, materialScale: entry.materialScale, mesh: entry.mesh,
  }, null, 2));

  return id;
}

export interface FinalizeResult { filename: string; id?: string; ok: boolean; error?: string; needsReview?: boolean; qaReasons?: string[]; }

/**
 * Finaliza as imagens de uma pasta. Usa o quad corrigido do `quads.json` quando existe;
 * senão **auto-detecta** o quad da superfície magenta (detectKeyColorQuad, CV puro) — então
 * funciona em pastas recém-geradas (ex.: cenas do visant-mockup-creator, sem quads.json).
 * `only` filtra por nomes (substring).
 */
export async function finalizeFolder(
  dir: string,
  opts: { only?: string[]; surfaceType?: string; strict?: boolean; onProgress?: (m: string) => void } = {},
): Promise<FinalizeResult[]> {
  const store = await loadQuads(dir);
  const log = opts.onProgress ?? (() => {});
  const imgs = (await readdir(dir)).filter((f) => /\.(png|jpe?g|webp)$/i.test(f) && !/-analysis\./i.test(f));
  const names = imgs.filter((n) => !opts.only?.length || opts.only.some((o) => n.includes(o)));
  const results: FinalizeResult[] = [];
  for (const filename of names) {
    try {
      const imagePath = join(dir, filename);
      let entry: QuadEntry | undefined = store[filename];
      // Quad corrigido à mão no quads.json vence sempre — pula o gate.
      if (!entry) {
        const meta = await sharp(imagePath).metadata();
        const W = meta.width ?? 0, H = meta.height ?? 0;
        const surfaceType = opts.surfaceType ?? "poster";
        const det = await detectKeyColorQuad(imagePath, W, H);
        if (!det?.quad) { results.push({ filename, ok: false, error: "sem superfície magenta detectada" }); continue; }

        entry = {
          quad: det.quad, method: det.method ?? "key-color", surfaceType,
          source: "auto", hue: det.hue, confidence: det.confidence, imageWidth: W, imageHeight: H, savedAt: 0,
        };

        // ── Gate de QA: reprovou o magenta ⇒ cascata pro SAM; senão marca review ──
        if (det.qa.verdict !== "ok") {
          const why = det.qa.reasons.join("; ");
          log(`  ⚠ ${filename}: QA ${det.qa.verdict} (${why}) — tentando SAM`);
          const sam = await detectQuadSAM(imagePath, undefined, surfaceType, W, H, "grounded");
          if (sam?.quad) {
            log(`  ✓ ${filename}: SAM recuperou a superfície`);
            entry = { ...entry, quad: sam.quad, auto: det.quad, method: "sam", confidence: det.qa.confidence, qaReasons: det.qa.reasons };
          } else if (opts.strict && det.qa.verdict === "reject") {
            results.push({ filename, ok: false, error: `QA reject sem SAM: ${why}` });
            continue;
          } else {
            // Lenient: baka mesmo assim, mas sinaliza pro /calibrate (não some da fila).
            log(`  → ${filename}: sem SAM — bakando com needsReview`);
            entry = { ...entry, needsReview: true, confidence: det.qa.confidence, qaReasons: det.qa.reasons };
          }
        }
      }
      const id = await finalizeScene(imagePath, entry, dir);
      results.push({ filename, id, ok: true, needsReview: entry.needsReview, qaReasons: entry.qaReasons });
    } catch (e: unknown) {
      results.push({ filename, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return results;
}

export interface AuditResult {
  filename: string;
  verdict: "ok" | "review" | "reject" | "no-magenta";
  confidence: number; fillRatio: number; ambiguity: number; componentCount: number;
  reasons: string[];
}

/**
 * Pré-voo READ-ONLY: roda a detecção + gate de QA em cada imagem de uma pasta
 * SEM bakar nada. É o que o operador roda antes de `finalize` para ver quais
 * cenas vão dar problema (ambíguas / glow / sem magenta) e corrigir o quads.json.
 */
export async function auditFolder(dir: string, opts: { only?: string[] } = {}): Promise<AuditResult[]> {
  const imgs = (await readdir(dir)).filter((f) => /\.(png|jpe?g|webp)$/i.test(f) && !/-analysis\./i.test(f));
  const names = imgs.filter((n) => !opts.only?.length || opts.only.some((o) => n.includes(o)));
  const out: AuditResult[] = [];
  for (const filename of names) {
    const imagePath = join(dir, filename);
    try {
      const meta = await sharp(imagePath).metadata();
      const det = await detectKeyColorQuad(imagePath, meta.width ?? 0, meta.height ?? 0);
      if (!det) { out.push({ filename, verdict: "no-magenta", confidence: 0, fillRatio: 0, ambiguity: 0, componentCount: 0, reasons: ["sem superfície magenta"] }); continue; }
      const { verdict, confidence, fillRatio, ambiguity, componentCount, reasons } = det.qa;
      out.push({ filename, verdict, confidence, fillRatio, ambiguity, componentCount, reasons });
    } catch (e: unknown) {
      out.push({ filename, verdict: "no-magenta", confidence: 0, fillRatio: 0, ambiguity: 0, componentCount: 0, reasons: [e instanceof Error ? e.message : String(e)] });
    }
  }
  return out;
}

/**
 * Gera previews renderizados (com arte) em `public/photo-previews/<id>.webp` pra cada cena
 * — é o thumbnail que o grid da home mostra (como um PSD). Reusa createPhotoMockups.
 *
 * Antes isso era um `copyFile` cru do render FULL-RES pro thumbnail — 130 arquivos,
 * ~507 MB, média 3,9 MB (pico 17,5 MB), pra um card de grid que mostra ~200px. A home
 * pede 60 por página: era 60x mais bytes do que o card precisa. Passa por `sharp()`
 * (já é dependência daqui) pra reduzir a largura e trocar pra WebP.
 */
export async function generateScenePreviews(
  art: Buffer, sceneIds: string[], opts: { fit?: FitMode; bg?: string | null; padding?: number; onProgress?: (m: string) => void } = {},
): Promise<MockupResult[]> {
  const tmp = join(process.cwd(), ".tmp", "preview-gen");
  const { results } = await createPhotoMockups({
    art, sceneIds, outDir: tmp, fit: opts.fit ?? "cover", bg: opts.bg ?? null, padding: opts.padding,
    quality: "preview", fresh: true, onProgress: opts.onProgress,
  });
  const pub = join(process.cwd(), "public", "photo-previews");
  await mkdir(pub, { recursive: true });
  for (const r of results) {
    if (!r.ok || !r.file) continue;
    await sharp(r.file)
      .resize({ width: PREVIEW_MAX_WIDTH, withoutEnlargement: true })
      .webp({ quality: PREVIEW_WEBP_QUALITY })
      .toFile(join(pub, `${r.sceneId}.webp`));
  }
  return results;
}

export interface SceneInfo { id: string; name: string; surfaceType: string; published: boolean; studio?: string; tags?: string[]; aspect?: number; }

/** Aspecto (w/h) do bbox de um quad — usado pra casar arte↔cena e filtrar por formato. */
export function quadAspect(q: QuadCorners | undefined): number | undefined {
  if (!q?.tl || !q.tr || !q.br || !q.bl) return undefined;
  const xs = [q.tl.x, q.tr.x, q.br.x, q.bl.x], ys = [q.tl.y, q.tr.y, q.br.y, q.bl.y];
  const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
  return h > 0 ? w / h : undefined;
}

/** Enumera as cenas calibradas disponíveis (data/ = publicadas, .tmp/ = rascunho).
 *  Lê `studio`/`tags` do settings.json (override do grouping no grid). */
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
        let studio: string | undefined, tags: string[] | undefined;
        if (existsSync(join(dir, "settings.json"))) {
          const s = JSON.parse(await readFile(join(dir, "settings.json"), "utf-8"));
          if (typeof s.studio === "string") studio = s.studio;
          if (Array.isArray(s.tags)) tags = s.tags;
        }
        out.push({ id, name: m.originalName ?? id, surfaceType: a.surfaceType ?? "unknown", published: i === 0, studio, tags, aspect: quadAspect(a.quad) });
      } catch { /* cena corrompida — ignora */ }
    }
  }
  return out;
}

/** Aspecto da superfície (bbox do quad) de uma cena finalizada — pra casar arte por aspecto. */
async function sceneAspect(id: string): Promise<number> {
  const dir = resolveSceneDir(id);
  if (!dir) return 1;
  try {
    const a = JSON.parse(await readFile(join(dir, "analysis.json"), "utf-8"));
    const q = a.quad;
    const xs = [q.tl.x, q.tr.x, q.br.x, q.bl.x], ys = [q.tl.y, q.tr.y, q.br.y, q.bl.y];
    const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
    return h > 0 ? w / h : 1;
  } catch { return 1; }
}

async function imgAspect(path: string): Promise<number> {
  try { const m = await sharp(path).metadata(); return m.width && m.height ? m.width / m.height : 1; } catch { return 1; }
}

export interface KitResult { kind: "layout" | "logo"; art: string; sceneId: string; file?: string; ok: boolean; error?: string; }

/**
 * **Kit de marca em uma tacada** (a lição do fluxo Hockey Direct): finaliza as cenas de
 * uma pasta (auto-detect do quad), marca com o estúdio da marca, **casa cada layout/logo
 * na cena mais coerente por aspecto** (layout=cover full-bleed; logo=contain no fundo da
 * marca), renderiza via core WYSIWYG, gera previews pro grid e devolve os results.
 */
export async function buildBrandKit(opts: {
  scenesDir: string; layouts: string[]; logos: string[];
  studio: string; tags?: string[]; outDir: string; bg?: string;
  nLayouts?: number; nLogo?: number; onProgress?: (m: string) => void;
}): Promise<KitResult[]> {
  const log = opts.onProgress ?? (() => {});
  // 1) finaliza + tag
  const fin = await finalizeFolder(opts.scenesDir);
  const ids = fin.filter((r) => r.ok && r.id).map((r) => r.id!) as string[];
  log(`finalizadas ${ids.length} cenas`);
  await tagScenes(ids, { studio: opts.studio, tags: opts.tags });

  // 2) aspecto de cada cena + de cada arte
  const scenes = await Promise.all(ids.map(async (id) => ({ id, aspect: await sceneAspect(id) })));
  const layouts = await Promise.all(opts.layouts.map(async (p) => ({ p, aspect: await imgAspect(p) })));
  const logos = await Promise.all(opts.logos.map(async (p) => ({ p, aspect: await imgAspect(p) })));

  // 3) casa: cada layout pega a cena livre de aspecto mais próximo (cover full-bleed)
  const used = new Set<string>();
  const closest = (aspect: number) => {
    let best: { id: string; aspect: number } | null = null, bd = Infinity;
    for (const s of scenes) { if (used.has(s.id)) continue; const d = Math.abs(Math.log(s.aspect / aspect)); if (d < bd) { bd = d; best = s; } }
    if (best) used.add(best.id);
    return best?.id;
  };
  const pairs: { kind: "layout" | "logo"; art: string; sceneId: string; fit: FitMode; bg?: string | null; padding?: number }[] = [];
  for (const l of layouts.slice(0, opts.nLayouts ?? 5)) {
    const sid = closest(l.aspect); if (sid) pairs.push({ kind: "layout", art: l.p, sceneId: sid, fit: "cover" });
  }
  // logos nas cenas restantes (contain no fundo da marca), ciclando os logos disponíveis
  const rest = scenes.filter((s) => !used.has(s.id)).slice(0, opts.nLogo ?? 5);
  rest.forEach((s, i) => {
    const lg = logos[i % Math.max(1, logos.length)];
    if (lg) pairs.push({ kind: "logo", art: lg.p, sceneId: s.id, fit: "contain", bg: opts.bg ?? null, padding: 0.16 });
  });

  // 4) render + previews
  await mkdir(opts.outDir, { recursive: true });
  const results: KitResult[] = [];
  let n = 0;
  for (const p of pairs) {
    n++;
    try {
      const art = await readFile(p.art);
      const { results: rr } = await createPhotoMockups({ art, sceneIds: [p.sceneId], outDir: opts.outDir, fit: p.fit, bg: p.bg ?? null, padding: p.padding, quality: "hd", fresh: true });
      const r = rr[0];
      if (r?.ok && r.file) {
        const name = `${p.kind}_${String(n).padStart(2, "0")}_${basename(p.art).replace(/\.[^.]+$/, "").replace(/[^\w]+/g, "_")}.png`;
        const dest = join(opts.outDir, name);
        await copyFile(r.file, dest);
        // Mesmo tratamento do `generateScenePreviews`: thumbnail do grid é WebP ~640px,
        // não o render full-res (o `kit` gera N cenas de uma vez — sem isso, cada kit
        // engordava public/photo-previews/ em dezenas de MB à toa).
        await sharp(r.file)
          .resize({ width: PREVIEW_MAX_WIDTH, withoutEnlargement: true })
          .webp({ quality: PREVIEW_WEBP_QUALITY })
          .toFile(join(process.cwd(), "public", "photo-previews", `${p.sceneId}.webp`))
          .catch(() => {});
        results.push({ kind: p.kind, art: basename(p.art), sceneId: p.sceneId, file: dest, ok: true });
        log(`✓ ${name}`);
      } else results.push({ kind: p.kind, art: basename(p.art), sceneId: p.sceneId, ok: false, error: r?.error });
    } catch (e) {
      results.push({ kind: p.kind, art: basename(p.art), sceneId: p.sceneId, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return results;
}

/** Grava `studio`/`tags` no settings.json das cenas (grouping no grid). Merge, não sobrescreve. */
export async function tagScenes(ids: string[], opts: { studio?: string; tags?: string[] }): Promise<{ id: string; ok: boolean }[]> {
  const res: { id: string; ok: boolean }[] = [];
  for (const id of ids) {
    const dir = resolveSceneDir(id);
    if (!dir) { res.push({ id, ok: false }); continue; }
    const p = join(dir, "settings.json");
    let s: Record<string, unknown> = {};
    try { if (existsSync(p)) s = JSON.parse(await readFile(p, "utf-8")); } catch { /* */ }
    if (opts.studio) s.studio = opts.studio;
    if (opts.tags) s.tags = [...new Set([...(Array.isArray(s.tags) ? s.tags : []), ...opts.tags])];
    await writeFile(p, JSON.stringify(s, null, 2));
    res.push({ id, ok: true });
  }
  return res;
}
