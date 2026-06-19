import { NextRequest, NextResponse } from "next/server";
import { existsSync } from "fs";
import { join } from "path";
import sharp from "sharp";
import {
  extractGrayscaleLayers, extractMask, extractDisplacementMap, extractColorCastLayer, neutralizeNeonPixels,
} from "@/lib/photo-shadow";
import { buildPhotoSceneDoc } from "@/lib/photo-scene";
import { buildMaterialOverlay, MATERIAL_BLEND, type MaterialKind } from "@/lib/material-fx";
import { resolveDir } from "@/lib/quad-store";
import { generateMeshDisplacement, meshIsWarped, meshCorners, composeDispFields, type WarpMesh } from "@/lib/mesh-warp";
import type { QuadCorners } from "@/lib/key-color-core";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createCanvas, loadImage } = require("canvas");
import { renderScene } from "@visant/psd-engine";

function safeName(name: unknown): string | null {
  if (typeof name !== "string" || !name) return null;
  if (name.includes("/") || name.includes("\\") || name.includes("..")) return null;
  return name;
}
function validQuad(q: any): q is QuadCorners {
  return q && ["tl", "tr", "br", "bl"].every((k) => q[k] && typeof q[k].x === "number" && typeof q[k].y === "number");
}

/** Artes-teste procedurais — validam warp/luz/displacement/material num render real. */
function makeTestArt(kind: string, w: number, h: number): any {
  const c = createCanvas(w, h); const ctx = c.getContext("2d");
  if (kind === "checker") {
    const n = 8, cw = w / n, ch = h / n;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { ctx.fillStyle = (x + y) % 2 ? "#111" : "#eee"; ctx.fillRect(x * cw, y * ch, cw + 1, ch + 1); }
    return c;
  }
  if (kind === "poster") {
    const g = ctx.createLinearGradient(0, 0, w, h); g.addColorStop(0, "#0f1923"); g.addColorStop(1, "#1a2535");
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#c9a84c"; ctx.fillRect(0, 0, w, Math.max(4, h * 0.02));
    ctx.fillStyle = "#f5f0e8"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = `bold ${Math.round(Math.min(w * 0.16, h * 0.3))}px Arial`;
    ctx.fillText("VISANT", w / 2, h / 2, w * 0.82);
    return c;
  }
  // grid (default) — verde + cantos coloridos + crosshair: distorção fica óbvia
  ctx.fillStyle = "#00E64D"; ctx.fillRect(0, 0, w, h);
  const cs = Math.round(Math.min(w, h) * 0.18);
  ([[0, 0, "#FF2222"], [w, 0, "#2255FF"], [w, h, "#FFE000"], [0, h, "#FFFFFF"]] as const).forEach(([cx, cy, col], i) => {
    ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(cx, cy);
    ctx.lineTo(cx + (i === 0 || i === 3 ? cs : -cs), cy); ctx.lineTo(cx, cy + (i === 0 || i === 1 ? cs : -cs)); ctx.closePath(); ctx.fill();
  });
  ctx.strokeStyle = "#000"; ctx.lineWidth = Math.max(2, Math.min(w, h) * 0.012);
  ctx.beginPath(); ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();
  return c;
}

/** Render final ao vivo: compõe a arte-teste com quad+luz+displacement+material calibrados. */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const safe = safeName(body.name);
  if (!safe) return NextResponse.json({ error: "nome inválido" }, { status: 400 });
  if (!validQuad(body.quad)) return NextResponse.json({ error: "quad inválido" }, { status: 400 });

  const dir = resolveDir(body.dir);
  const full = join(dir, safe);
  if (!existsSync(full)) return NextResponse.json({ error: "cena não encontrada" }, { status: 404 });

  const meta = await sharp(full).metadata();
  const W0 = meta.width ?? 0, H0 = meta.height ?? 0;

  // Preview: downscale (~900px) → pipeline 3-4× mais rápido = iteração fluida.
  // Full-res só quando preview=false (save/HD). Coords escalam junto.
  const PREV_MAX = 900;
  const longest = Math.max(W0, H0);
  const sc = body.preview && longest > PREV_MAX ? PREV_MAX / longest : 1;
  const W = Math.round(W0 * sc), H = Math.round(H0 * sc);
  const sp = (p: QuadCorners["tl"]) => ({ x: p.x * sc, y: p.y * sc });
  const sQuad = (q: QuadCorners): QuadCorners => ({ tl: sp(q.tl), tr: sp(q.tr), br: sp(q.br), bl: sp(q.bl) });

  // Malha warpada → quad-base = cantos da malha; o abaulamento vira displacement field.
  const meshRaw: WarpMesh | undefined = body.mesh && Array.isArray(body.mesh.points) ? body.mesh : undefined;
  const useMesh = !!(meshRaw && meshIsWarped(meshRaw));
  const mesh = meshRaw && sc !== 1 ? { ...meshRaw, points: meshRaw.points.map(sp) } : meshRaw;
  const quad: QuadCorners = useMesh ? meshCorners(mesh!) : sQuad(body.quad);
  const surfaceType: string = body.surfaceType || "billboard";
  const matKind = (body.material || "none") as MaterialKind;
  const dispBlur = (typeof body.dispBlur === "number" ? body.dispBlur : 8) * sc;

  const isCard = surfaceType === "card" || surfaceType === "paper";
  const isBillboard = surfaceType === "billboard" || surfaceType === "poster";

  // Fonte da cena (downscalada no preview) + neutraliza magenta/neon (best-effort).
  const sceneInput: string | Buffer = sc !== 1 ? await sharp(full).resize(W, H).toBuffer() : full;
  let photoSrc: string | Buffer = sceneInput;
  try { photoSrc = await neutralizeNeonPixels(sceneInput, W, H); } catch { /* */ }

  const multiplyFloor = isCard ? 0 : 200;
  const lightingPreBlur = !isCard && !isBillboard ? 25 : 0;

  const [{ screen, multiply }, maskBuf, dispBuf, castBuf] = await Promise.all([
    extractGrayscaleLayers(photoSrc, quad, undefined, multiplyFloor, lightingPreBlur),
    extractMask(W, H, quad, 4),
    extractDisplacementMap(photoSrc, W, H, quad, dispBlur),
    extractColorCastLayer(sceneInput, W, H, quad),
  ]);

  const matBuf = matKind !== "none"
    ? await buildMaterialOverlay(W, H, quad, { material: matKind, intensity: body.materialIntensity, angle: body.materialAngle, scale: body.materialScale })
    : null;

  // Malha (envelope) + relevo da foto/material **trabalham juntos**: o abaulamento
  // (geometria macro) e o relevo (textura micro) viram offsets que SOMAM no mesmo
  // displacement field — sem um sobrescrever o outro. Composição via composeDispFields.
  const meshDisp = useMesh ? await generateMeshDisplacement(mesh!) : null;
  const photoDispScale = typeof body.dispScale === "number" ? body.dispScale * sc : 0;
  let composedDisp: { png: Buffer; scale: number } | null = null;
  if (meshDisp && photoDispScale > 0) {
    composedDisp = await composeDispFields([
      { png: meshDisp.png, w: meshDisp.width, h: meshDisp.height, scale: meshDisp.dispScale, offsetX: meshDisp.offsetX, offsetY: meshDisp.offsetY },
      { png: dispBuf, w: W, h: H, scale: photoDispScale, offsetX: 0, offsetY: 0 },
    ], W, H);
  }
  const dispScaleFinal = composedDisp ? composedDisp.scale
    : meshDisp ? meshDisp.dispScale
    : (photoDispScale > 0 ? photoDispScale : undefined);

  const doc = buildPhotoSceneDoc(
    { quad, imageWidth: W, imageHeight: H, surfaceType } as any,
    {
      screenOpacity: isCard ? 0 : isBillboard ? 0 : 0.20,
      multiplyOpacity: isCard ? 0.30 : isBillboard ? 0 : 0.45,
      dispScale: dispScaleFinal,
      material: matBuf ? { blend: MATERIAL_BLEND[matKind] } : undefined,
    },
  );
  const face = doc.faces[0];

  const [photoImg, screenImg, multiplyImg, maskImg, castImg, dispImg, matImg] = await Promise.all([
    loadImage(photoSrc), loadImage(screen), loadImage(multiply), loadImage(maskBuf),
    loadImage(castBuf), loadImage(dispBuf), matBuf ? loadImage(matBuf) : Promise.resolve(null),
  ]);

  const assets: Record<string, any> = { photo: photoImg, light_screen: screenImg, light_multiply: multiplyImg, mask: maskImg, color_cast: castImg, displacement: dispImg };
  if (matImg) assets.material = matImg;
  // Disp final: composto (mesh+foto) > só mesh > só foto. O slot do engine é único.
  if (composedDisp) assets.displacement = await loadImage(composedDisp.png);
  else if (meshDisp) assets.displacement = await loadImage(meshDisp.png);

  // Arte: pode vir do usuário (`body.artBase64`) ou usar uma arte-teste procedural.
  let artInput: any;
  if (typeof body.artBase64 === "string" && body.artBase64.length > 32) {
    const b64 = body.artBase64.replace(/^data:image\/\w+;base64,/, "");
    const buf = Buffer.from(b64, "base64");
    // resize pra inner do quad — preserva nitidez e evita moiré
    const resized = await sharp(buf).resize(face.innerW, face.innerH, { fit: "fill" }).png().toBuffer();
    artInput = await loadImage(resized);
  } else {
    artInput = makeTestArt(body.art || "grid", face.innerW, face.innerH);
  }
  const canvas = renderScene(doc, assets, { surface: artInput }, createCanvas);
  const png: Buffer = (canvas as any).toBuffer("image/png");

  return new NextResponse(new Uint8Array(png), { headers: { "Content-Type": "image/png", "Cache-Control": "no-store" } });
}
