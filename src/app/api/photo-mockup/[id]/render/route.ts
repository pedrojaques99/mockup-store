import { NextRequest, NextResponse } from "next/server";
import { existsSync, statSync } from "fs";
import { join } from "path";
import { getEngine, readFileCached, sha, getBaseComposite, setBaseComposite } from "@/lib/render-cache";
import { buildBaseComposite, applyLooks, type RenderEngine } from "@/lib/photo-render-core";
import type { MaterialKind } from "@/lib/material-fx";

const TMP_DIR  = join(process.cwd(), ".tmp",  "photo-scenes");
const DATA_DIR = join(process.cwd(), "data", "photo-scenes");

const mtime = (p: string): number => { try { return statSync(p).mtimeMs; } catch { return 0; } };

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!id || !/^[a-f0-9]{16}$/.test(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  // ── Server-Timing: marca etapas pra header (observabilidade do gargalo). ──
  const T: Array<[string, number]> = [];
  let _t = Date.now();
  const mark = (name: string) => { const now = Date.now(); T.push([name, now - _t]); _t = now; };

  const dataScene = join(DATA_DIR, id);
  const dir = existsSync(dataScene) ? dataScene : join(TMP_DIR, id);
  const metaPath = join(dir, "meta.json");
  const analysisPath = join(dir, "analysis.json");
  const shadowPath = join(dir, "shadow.png");
  const maskPath = join(dir, "mask.png");

  for (const p of [metaPath, analysisPath, shadowPath, maskPath]) {
    if (!existsSync(p)) {
      return NextResponse.json(
        { error: `Not ready: ${p.split(/[/\\]/).pop()} missing. Run process first.` },
        { status: 400 }
      );
    }
  }

  const body = await req.json();
  const { artBase64, shadowOpacity, highlightOpacity, castOpacity, maskFeather, maskContract, fx, warp, textureAmount, specularOpacity, luzOverlays, mesh } = body;

  if (!artBase64 || typeof artBase64 !== "string") {
    return NextResponse.json({ error: "artBase64 required" }, { status: 400 });
  }

  const { ext } = JSON.parse(await readFileCached(metaPath).then((b) => b.toString("utf-8")));
  const analysis = JSON.parse(await readFileCached(analysisPath).then((b) => b.toString("utf-8")));

  const engine = await getEngine();
  const { createCanvas, loadImage, toBuffer, renderScene, perspectiveWarp } = engine;
  mark("init");

  const rawPhotoPath = join(dir, `photo.${ext}`);
  const cleanPhotoPath = join(dir, "photo-clean.png");
  const photoPath = existsSync(cleanPhotoPath) ? cleanPhotoPath : rawPhotoPath;
  const screenPath = join(dir, "shadow-screen.png");

  // Quad (entra na chave do cache; o core recalcula inner/bbox internamente).
  const q = analysis.quad as { tl:{x:number;y:number}; tr:{x:number;y:number}; br:{x:number;y:number}; bl:{x:number;y:number} };

  // SSAA dentro do core (quality 'hd'): compõe em S× e reduz. S aqui só pra chave do cache.
  const S = Math.max(analysis.imageWidth, analysis.imageHeight) > 3000 ? 1 : 2;
  const colorCastPath = join(dir, "color-cast.png");
  const reflectionMaskPath = join(dir, "reflection-mask.png");
  const occluderPath = join(dir, "occluder.png");

  // Engine único passado pro core (mesmo de @visant/psd-engine).
  const coreEngine: RenderEngine = {
    createCanvas: createCanvas as RenderEngine["createCanvas"],
    loadImage: loadImage as RenderEngine["loadImage"],
    toBuffer: toBuffer as RenderEngine["toBuffer"],
    renderScene: renderScene as RenderEngine["renderScene"],
    perspectiveWarp: perspectiveWarp as RenderEngine["perspectiveWarp"],
  };
  const material = (body.material && typeof body.material === "string" && body.material !== "none")
    ? { kind: body.material as MaterialKind, intensity: body.materialIntensity, angle: body.materialAngle, scale: body.materialScale }
    : null;

  // ── Tier 1: cache do composite BASE (engine+downscale) + fullMask, keyed pela
  //    geometria. Mexer só no look reaproveita a base. A chave inclui mtime dos assets. ──
  const filesSig = sha(mtime(photoPath), mtime(shadowPath), mtime(screenPath), mtime(maskPath), mtime(colorCastPath));
  const geomKey = id + ":" + sha(
    artBase64, q, warp ?? null, mesh ?? null, textureAmount ?? 0, maskFeather ?? 0, maskContract ?? 1,
    shadowOpacity ?? null, highlightOpacity ?? null, castOpacity ?? null, material, S, filesSig,
  );

  let basePng: Buffer;
  let fullMask: Buffer;
  const cached = getBaseComposite(geomKey);

  if (cached) {
    basePng = cached.basePng;
    fullMask = cached.fullMask;
    mark("base-cache-hit");
  } else {
    // Assets pré-assados em disco → core único (mesma base da prévia /calibrate).
    const [photo, rawPhoto, multiply, screenBuf, maskDisk, colorCast] = await Promise.all([
      readFileCached(photoPath),
      readFileCached(rawPhotoPath),
      readFileCached(shadowPath),
      existsSync(screenPath) ? readFileCached(screenPath) : readFileCached(shadowPath),
      readFileCached(maskPath),
      existsSync(colorCastPath) ? readFileCached(colorCastPath) : Promise.resolve(undefined),
    ]);
    const baseOut = await buildBaseComposite({
      engine: coreEngine, analysis, photo, rawPhoto, multiply, screen: screenBuf, mask: maskDisk,
      colorCast: colorCast as Buffer | undefined,
      artBase64,
      params: { warp, textureAmount, mesh, maskFeather, maskContract, shadowOpacity, highlightOpacity, castOpacity, material },
      quality: "hd",
    });
    basePng = baseOut.basePng;
    fullMask = baseOut.fullMask;
    mark("base");
    setBaseComposite(geomKey, { basePng, fullMask });
  }

  // ── LOOK — rail unificado no core (idêntico à prévia /calibrate). ──
  const [rawPhotoBuf, reflectionMaskBuf, occluderBuf] = await Promise.all([
    readFileCached(rawPhotoPath),
    existsSync(reflectionMaskPath) ? readFileCached(reflectionMaskPath) : Promise.resolve(null),
    existsSync(occluderPath) ? readFileCached(occluderPath) : Promise.resolve(null),
  ]);
  const png = await applyLooks({
    engine: coreEngine, analysis, png: basePng, fullMask, rawPhoto: rawPhotoBuf, artBase64,
    reflectionMask: reflectionMaskBuf as Buffer | null, occluder: occluderBuf as Buffer | null,
    params: {
      reflectionOpacity: body.reflectionOpacity, reflectionBlur: body.reflectionBlur,
      specularOpacity, lightWrap: body.lightWrap, matchScene: body.matchScene, contactShadow: body.contactShadow,
      fx, luzOverlays,
    },
  });
  mark("look");

  const serverTiming = T.map(([n, d]) => `${n};dur=${d}`).join(", ");

  return new NextResponse(png as unknown as BodyInit, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "no-store",
      "Server-Timing": serverTiming,
    },
  });
}
