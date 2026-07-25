/**
 * textbox-bakeoff — compara lado a lado quem mede melhor a caixa de texto:
 * geometria (sharp), OCR (tesseract), VLM Anthropic e VLM Gemini.
 *
 * Decide uma pergunta concreta: vale carregar tesseract.js (WASM, worker por
 * asset) pro prod, ou o Gemini — que já está no stack — resolve de graça?
 *
 * Gabarito = geometria em arte de fundo chapado, onde a margem é medível de
 * verdade. Quem discorda dela ali está errado, ponto.
 *
 * Uso: npx tsx --env-file=.env.local scripts/textbox-bakeoff.ts --layouts "<dir>"
 */
import { readdirSync } from "fs";
import { join } from "path";
import { analyzeLayoutAI, GEMINI_BBOX_MODEL } from "../src/lib/layout-vision";
import { ocrLayout, safeCropFromBox, closeOcr } from "../src/lib/layout-ocr";

const A = process.argv.slice(2);
const flag = (k: string, def?: string) => { const i = A.indexOf(`--${k}`); return i !== -1 && A[i + 1] && !A[i + 1].startsWith("--") ? A[i + 1] : def; };
function die(m: string): never { console.error(`✗ ${m}`); process.exit(1); }

const dir = flag("layouts") || die("--layouts <dir> obrigatório");
const SAMPLE = 640;

type Box = { x0: number; y0: number; x1: number; y1: number } | null;
const safeOf = (b: Box) => safeCropFromBox(b);

/** Geometria: energia de borda. Confiável só quando a borda é uniforme. */
async function geometry(path: string) {
  const sharp = (await import("sharp")).default;
  const { data, info } = await sharp(path)
    .resize(SAMPLE, SAMPLE, { fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" }).raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels: ch } = info;
  const at = (x: number, y: number) => { const i = (y * w + x) * ch; return [data[i], data[i + 1], data[i + 2]] as const; };
  const lum = (p: readonly [number, number, number]) => 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];

  const ring: Array<readonly [number, number, number]> = [];
  for (let x = 0; x < w; x++) { ring.push(at(x, 0)); ring.push(at(x, h - 1)); }
  for (let y = 0; y < h; y++) { ring.push(at(0, y)); ring.push(at(w - 1, y)); }
  const med = (arr: number[]) => arr.sort((a, b) => a - b)[Math.floor(arr.length / 2)];
  const bg = [0, 1, 2].map((c) => med(ring.map((p) => p[c]))) as [number, number, number];
  const dev = ring.reduce((s, p) => s + Math.abs(p[0] - bg[0]) + Math.abs(p[1] - bg[1]) + Math.abs(p[2] - bg[2]), 0) / (ring.length * 3);
  const bgSolid = dev < 6;

  const colE = new Float64Array(w); const rowE = new Float64Array(h); let total = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const e = Math.abs(lum(at(x + 1, y)) - lum(at(x - 1, y))) + Math.abs(lum(at(x, y + 1)) - lum(at(x, y - 1)));
    if (e <= 24) continue;
    colE[x] += e; rowE[y] += e; total += e;
  }
  if (total <= 0) return { bgSolid, safe: 1 };
  const edge = (arr: Float64Array, rev: boolean) => {
    let acc = 0; const n = arr.length;
    for (let i = 0; i < n; i++) { acc += arr[rev ? n - 1 - i : i]; if (acc >= total * 0.005) return i / n; }
    return 0;
  };
  const box: Box = { x0: edge(colE, false), y0: edge(rowE, false), x1: 1 - edge(colE, true), y1: 1 - edge(rowE, true) };
  return { bgSolid, safe: safeOf(box) };
}

async function main() {
  const sharp = (await import("sharp")).default;
  const files = readdirSync(dir).filter((f) => /\.(png|jpe?g|webp)$/i.test(f) && !f.startsWith("_"));
  if (!files.length) die("sem imagens");

  console.log(`bake-off em ${files.length} artes · gemini=${GEMINI_BBOX_MODEL}\n`);
  console.log("arte                              solid   geo    ocr   claude gemini");
  console.log("-".repeat(74));

  const rows: Array<{ file: string; bgSolid: boolean; geo: number; ocr: number | null; claude: number | null; gem: number | null }> = [];

  for (const f of files) {
    const path = join(dir, f);
    const small = await sharp(path).resize(768, 768, { fit: "inside", withoutEnlargement: true }).png().toBuffer();
    const g = await geometry(path);

    let ocr: number | null = null;
    try { const r = await ocrLayout(small); ocr = r.trustworthy && r.textBox ? safeOf(r.textBox) : null; } catch { /* */ }

    const [cl, gm] = await Promise.all([
      analyzeLayoutAI(small, "anthropic").catch(() => null),
      analyzeLayoutAI(small, "gemini").catch(() => null),
    ]);
    const claude = cl?.textBox ? safeOf(cl.textBox) : null;
    const gem = gm?.textBox ? safeOf(gm.textBox) : null;

    rows.push({ file: f, bgSolid: g.bgSolid, geo: g.safe, ocr, claude, gem });
    const p = (n: number | null) => (n === null ? "   -" : `${(n * 100).toFixed(0).padStart(3)}%`);
    console.log(`${f.slice(0, 31).padEnd(32)} ${(g.bgSolid ? "sim" : "não").padEnd(5)} ${p(g.safe)}  ${p(ocr)}  ${p(claude)}  ${p(gem)}`);
  }

  // Veredito: erro médio contra o gabarito (geometria em fundo chapado)
  const truth = rows.filter((r) => r.bgSolid);
  console.log("\n" + "=".repeat(74));
  if (!truth.length) { console.log("sem arte de fundo chapado — nenhum gabarito pra julgar"); await closeOcr(); return; }

  console.log(`gabarito: ${truth.length} arte(s) de fundo chapado (geometria mede a margem real)\n`);
  for (const m of ["ocr", "claude", "gem"] as const) {
    const vals = truth.filter((r) => r[m] !== null);
    if (!vals.length) { console.log(`  ${m.padEnd(7)} sem leitura no gabarito`); continue; }
    const err = vals.reduce((s, r) => s + Math.abs(r[m]! - r.geo), 0) / vals.length;
    console.log(`  ${m.padEnd(7)} erro médio ${(err * 100).toFixed(1).padStart(5)}pp   (n=${vals.length})`);
  }

  // Cobertura importa tanto quanto precisão: método que só responde às vezes
  // deixa o resto no fallback conservador, descartando cena boa.
  console.log("\ncobertura (respondeu com caixa):");
  for (const m of ["ocr", "claude", "gem"] as const) {
    const n = rows.filter((r) => r[m] !== null).length;
    console.log(`  ${m.padEnd(7)} ${String(n).padStart(2)}/${rows.length}`);
  }
  await closeOcr();
}

main().catch((e) => { console.error(e); process.exit(1); });
