import { NextRequest, NextResponse } from "next/server";
import { existsSync } from "fs";
import { readFile } from "fs/promises";
import { join } from "path";
import sharp from "sharp";
import type { MaterialKind } from "@/lib/material-fx";
import { resolveDir } from "@/lib/quad-store";
import { meshIsWarped, meshCorners, type WarpMesh } from "@/lib/mesh-warp";
import { extractSceneAssets, buildBaseComposite, applyLooks, type RenderEngine, type SceneAnalysis } from "@/lib/photo-render-core";
import type { QuadCorners, Pt } from "@/lib/key-color-core";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createCanvas, loadImage } = require("canvas");
import { renderScene, perspectiveWarp } from "@visant/psd-engine";

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
  // escala a malha (pontos E hastes) pro espaço de trabalho do preview
  const spv = (p?: Pt) => (p ? sp(p) : undefined);
  const spMesh = (m: WarpMesh): WarpMesh => sc === 1 ? m : {
    ...m, points: m.points.map(sp),
    tangents: m.tangents?.map((t) => ({ h: sp(t.h), v: sp(t.v), hOut: spv(t.hOut), hIn: spv(t.hIn), vOut: spv(t.vOut), vIn: spv(t.vIn) })),
  };
  const mesh = meshRaw ? spMesh(meshRaw) : undefined;
  const quad: QuadCorners = useMesh ? meshCorners(mesh!) : sQuad(body.quad);
  const surfaceType: string = body.surfaceType || "billboard";
  const matKind = (body.material || "none") as MaterialKind;

  // Foto da cena no espaço de trabalho (buffer cru — o core neutraliza neon/magenta).
  const sceneBuf: Buffer = sc !== 1 ? await sharp(full).resize(W, H).toBuffer() : await readFile(full);
  const analysis: SceneAnalysis = { quad, imageWidth: W, imageHeight: H, surfaceType };

  // ── CORE ÚNICO (mesmo de produção) → WYSIWYG. HD = idêntico; preview = res reduzida. ──
  const hd = !!body.hd;
  // Máscara SAM (superfície real): recorta no bbox do quad — IGUAL ao bake do /process →
  // luz só da superfície + máscara da arte interseccionada (sem isso, cenas com SAM divergem).
  let surfaceMaskBuf: Buffer | undefined;
  if (typeof body.surfaceMaskBase64 === "string" && body.surfaceMaskBase64.length > 32) {
    const xs = [quad.tl.x, quad.tr.x, quad.br.x, quad.bl.x];
    const ys = [quad.tl.y, quad.tr.y, quad.br.y, quad.bl.y];
    const left = Math.max(0, Math.floor(Math.min(...xs)));
    const top = Math.max(0, Math.floor(Math.min(...ys)));
    const maxX = Math.min(W - 1, Math.ceil(Math.max(...xs)));
    const maxY = Math.min(H - 1, Math.ceil(Math.max(...ys)));
    const samFull = Buffer.from(body.surfaceMaskBase64.replace(/^data:image\/\w+;base64,/, ""), "base64");
    surfaceMaskBuf = await sharp(samFull)
      .resize(W, H, { fit: "fill" })
      .extract({ left, top, width: maxX - left + 1, height: maxY - top + 1 })
      .ensureAlpha().png().toBuffer();
  }
  const assets = await extractSceneAssets(sceneBuf, analysis, { surfaceMaskBuf, fast: !hd });

  /* Sidecar refinado à mão vence a extração ao vivo.
   *
   * Medido em 06/08/2026 (`npx tsx scripts/render-ab.ts`): 3 de 5 cenas saem
   * BYTE-IDÊNTICAS entre esta rota e a de produção (max 0/255) — o core é o
   * mesmo e o WYSIWYG é real. A que divergiu deu max 152/255, e o diff mostrou
   * que a divergência era um CONTORNO fino, não uma mancha na superfície: o
   * occluder daquela cena tem 632 KB (contra ~10 KB das outras) porque foi
   * pintado à mão. A produção lê esse arquivo do disco; aqui ele era regenerado
   * do zero e o contorno saía noutro lugar.
   *
   * Ou seja: a prévia mentia exatamente nas cenas mais trabalhadas, que são as
   * que mais custaram para ficar boas. Pasta sem sidecar — o caso normal desta
   * rota, que abre `Render/New Mockups/` — cai na extração como antes.
   *
   * Qual asset era o culpado, isolado um a um em vez de deduzido:
   *   occluder + reflexo + cast do disco ....... 0,56% (nada mudou)
   *   + mask.png do disco ...................... 0,34%
   *   + photo-clean.png do disco ............... 0,00%  ← convergiu
   * Os dois culpados eram a máscara e a foto limpa; o occluder que eu suspeitei
   * primeiro não mexeu um pixel. Ele fica assim mesmo, por simetria: a produção
   * lê os cinco, e deixar três de fora recria a mesma assimetria noutro dia. */
  const sidecar = async (arquivo: string): Promise<Buffer | undefined> => {
    const p = join(dir, arquivo);
    if (!existsSync(p)) return undefined;
    const buf = await readFile(p);
    /* O sidecar é full-res e o preview trabalha reduzido: sem reescalar junto, o
     * composite desalinha e o conserto vira um bug pior que o original. */
    return sc === 1 ? buf : await sharp(buf).resize(W, H, { fit: "fill" }).png().toBuffer();
  };
  const [discoOccluder, discoReflexo, discoCast, discoMask, discoClean] = await Promise.all([
    sidecar("occluder.png"),
    sidecar("reflection-mask.png"),
    sidecar("color-cast.png"),
    sidecar("mask.png"),
    sidecar("photo-clean.png"),
  ]);

  // Arte: usuário (`body.artBase64`) ou arte-teste procedural (→ base64 pro core).
  const d = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
  const innerW = Math.max(1, Math.round((d(quad.tl, quad.tr) + d(quad.bl, quad.br)) / 2));
  const innerH = Math.max(1, Math.round((d(quad.tl, quad.bl) + d(quad.tr, quad.br)) / 2));
  let artBase64: string;
  if (typeof body.artBase64 === "string" && body.artBase64.length > 32) {
    artBase64 = body.artBase64;
  } else {
    const testArt = makeTestArt(body.art || "grid", innerW, innerH) as { toBuffer: (t: string) => Buffer };
    artBase64 = testArt.toBuffer("image/png").toString("base64");
  }

  const engine: RenderEngine = {
    createCanvas, loadImage,
    toBuffer: (c: unknown, t: string) => (c as { toBuffer: (t: string) => Buffer }).toBuffer(t),
    renderScene: renderScene as RenderEngine["renderScene"],
    perspectiveWarp: perspectiveWarp as RenderEngine["perspectiveWarp"],
  };

  const base = await buildBaseComposite({
    engine, analysis, photo: discoClean ?? assets.cleanPhoto, rawPhoto: sceneBuf,
    multiply: assets.multiply, screen: assets.screen,
    mask: discoMask ?? assets.mask,
    colorCast: discoCast ?? assets.colorCast,
    artBase64,
    params: {
      warp: body.warp, textureAmount: body.textureAmount, mesh,
      maskFeather: body.maskFeather, maskContract: body.maskContract,
      shadowOpacity: body.shadowOpacity, highlightOpacity: body.highlightOpacity, castOpacity: body.castOpacity,
      material: matKind !== "none" ? { kind: matKind, intensity: body.materialIntensity, angle: body.materialAngle, scale: body.materialScale } : null,
    },
    quality: hd ? "hd" : "preview",
  });

  const png = await applyLooks({
    engine, analysis, png: base.basePng, fullMask: base.fullMask, rawPhoto: sceneBuf, artBase64,
    reflectionMask: discoReflexo ?? assets.reflectionMask, occluder: discoOccluder ?? assets.occluder,
    params: {
      reflectionOpacity: body.reflectionOpacity, reflectionBlur: body.reflectionBlur,
      specularOpacity: body.specularOpacity, lightWrap: body.lightWrap,
      matchScene: body.matchScene, contactShadow: body.contactShadow,
      fx: body.fx, luzOverlays: body.luzOverlays,
    },
  });

  return new NextResponse(new Uint8Array(png), { headers: { "Content-Type": "image/png", "Cache-Control": "no-store" } });
}
