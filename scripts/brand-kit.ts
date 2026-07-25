/**
 * Brand Mockup Kit — white-label. Pluga UMA marca do Visant Labs e metralha um
 * kit: N mockups com LAYOUTS (criativos do cliente) + N com LOGO/símbolo (faces
 * ~1:1), curando cena/PSD coerente. A marca (paleta + logo) vem do Visant.
 *
 * Uso:
 *   npx tsx --env-file=.env.local scripts/brand-kit.ts \
 *     --brand <visantId> --layouts "<dir criativos>" --out "<dir>" --count 10
 *
 * Flags:
 *   --brand <id>      brand id da Visant (obrigatório; veja `agent-cli brands`)
 *   --layouts <dir>   criativos de campanha do cliente (metade "layouts")
 *   --out <dir>       saída (cria <out>/layouts e <out>/logo)
 *   --count <n>       mockups por metade (default 10)
 *   --symbol <p|url>  símbolo/ícone alta-res p/ a metade "logo" (override do logo
 *                     do Visant, que costuma ser lockup horizontal baixa-res)
 *   --mono            o símbolo é silhueta → recolore nas cores da marca (lime/dark)
 *   --only layouts|logo   roda só uma metade
 *   --max-crop <f>    0-1: descarta cenas cuja face force o `cover` a cortar mais
 *                     que isso da arte (0.12 recomendado p/ layout tipográfico)
 *   --preview         JPEG rápido   --fresh   ignora _summary e recomeça
 *
 * Não reinventa: o render/curadoria é o brand-mockup-batch.ts; este orquestrador
 * só pluga a marca do Visant + prepara as artes 1:1 e chama o motor 2×.
 */
import { spawnSync } from "child_process";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { join, resolve, isAbsolute } from "path";

const A = process.argv.slice(2);
const flag = (k: string, def?: string) => { const i = A.indexOf(`--${k}`); return i !== -1 && A[i + 1] && !A[i + 1].startsWith("--") ? A[i + 1] : def; };
const has = (k: string) => A.includes(`--${k}`);
function die(m: string): never { console.error(`✗ ${m}`); process.exit(1); }

const brandId = flag("brand") || die("--brand <visantId> obrigatório (veja `agent-cli brands`)");
const layoutsArg = flag("layouts");
const outDir = flag("out") || die("--out <dir> obrigatório");
const count = parseInt(flag("count", "10")!);
const only = flag("only");
const symbolArg = flag("symbol");
const maxCropArg = flag("max-crop");
const mono = has("mono");

// ── helpers de cor ───────────────────────────────────────────────────────────
type RGB = { r: number; g: number; b: number };
const hexToRgb = (h: string): RGB => { const x = h.replace("#", ""); return { r: parseInt(x.slice(0, 2), 16), g: parseInt(x.slice(2, 4), 16), b: parseInt(x.slice(4, 6), 16) }; };
const lum = (c: RGB) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
const chroma = (c: RGB) => Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b);

async function fetchToBuffer(src: string): Promise<Buffer> {
  if (/^https?:\/\//.test(src)) { const r = await fetch(src); if (!r.ok) die(`falha baixando ${src}: HTTP ${r.status}`); return Buffer.from(await r.arrayBuffer()); }
  const p = isAbsolute(src) ? src : resolve(src);
  if (!existsSync(p)) die(`símbolo não encontrado: ${p}`);
  return readFileSync(p);
}

/** Roda o brand-mockup-batch.ts como subprocesso (reusa o motor validado).
 * shell:true re-divide por espaços → cita cada arg (caminhos com espaço). */
function runBatch(args: string[], label: string): number {
  const q = (s: string) => (/[\s"]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s);
  const cmd = ["npx", "tsx", "--env-file=.env.local", "scripts/brand-mockup-batch.ts", ...args].map(q).join(" ");
  console.log(`\n▶ lote ${label}: ${args.join(" ")}`);
  const r = spawnSync(cmd, { stdio: "inherit", shell: true });
  if (r.status !== 0) console.warn(`! lote ${label} saiu com status ${r.status}`);
  return r.status ?? 1;
}

async function main() {
  const sharp = (await import("sharp")).default;
  const { getBrandGuideline, pickLogo } = await import("../src/lib/visant");

  // 1. Marca via Visant
  console.log(`Marca: buscando ${brandId} no Visant…`);
  const g = await getBrandGuideline(brandId);
  const brandName = g.identity?.name || brandId;
  const colors = (g.colors || []).map((c) => c.hex).filter((h) => /^#?[0-9a-fA-F]{6}$/.test(h)).map((h) => (h.startsWith("#") ? h : `#${h}`));
  if (!colors.length) die("marca sem paleta no Visant");
  const rgbs = colors.map(hexToRgb);
  const dark = colors[rgbs.map(lum).indexOf(Math.min(...rgbs.map(lum)))];
  // accent = maior croma, com desempate por luminância alta (cor "viva" da marca)
  const accent = colors[rgbs.map((c) => chroma(c) + lum(c) * 0.15).indexOf(Math.max(...rgbs.map((c) => chroma(c) + lum(c) * 0.15)))];
  console.log(`✓ ${brandName} — ${colors.length} cores · dark=${dark} accent=${accent}`);

  mkdirSync(outDir, { recursive: true });

  // ── metade LAYOUTS ───────────────────────────────────────────────────────
  if (only !== "logo") {
    if (!layoutsArg) die("--layouts <dir> obrigatório pra metade layouts (ou use --only logo)");
    const a = ["--layouts", layoutsArg, "--out", join(outDir, "layouts"), "--count", String(count)];
    if (maxCropArg) a.push("--max-crop", maxCropArg);
    if (has("preview")) a.push("--preview");
    if (has("fresh")) a.push("--fresh");
    runBatch(a, "layouts");
  }

  // ── metade LOGO (faces ~1:1) ──────────────────────────────────────────────
  if (only !== "layouts") {
    // resolve o símbolo: override --symbol, senão logo do Visant (icon→primary)
    let symBuf: Buffer;
    if (symbolArg) { symBuf = await fetchToBuffer(symbolArg); console.log(`Símbolo: ${symbolArg}`); }
    else {
      const logo = pickLogo(g, "icon") || pickLogo(g);
      if (!logo?.url) die("marca sem logo no Visant — passe --symbol <path|url>");
      console.log(`Símbolo: Visant ${logo.variant}${logo.label ? ` (${logo.label})` : ""} ${logo.url}`);
      symBuf = await fetchToBuffer(logo.url);
    }

    const SQ = 1600;
    const artDir = resolve(".tmp/brand-kit-art", brandId);
    mkdirSync(artDir, { recursive: true });
    // trim do símbolo (densidade alta p/ SVG)
    const trimmed = await sharp(symBuf, { density: 384 }).trim({ threshold: 12 }).png().toBuffer();

    const place = async (fg: string | null, bg: string, inner: number, name: string) => {
      const innerPx = Math.round(SQ * inner);
      let icon: Buffer;
      if (fg) {
        // silhueta recolorida: sólido fg recortado pelo alpha do símbolo (dest-in)
        const sil = await sharp(trimmed).resize(innerPx, innerPx, { fit: "inside" }).png().toBuffer();
        const m = await sharp(sil).metadata();
        icon = await sharp({ create: { width: m.width!, height: m.height!, channels: 4, background: hexToRgb(fg) } })
          .composite([{ input: sil, blend: "dest-in" }]).png().toBuffer();
      } else {
        icon = await sharp(trimmed).resize(innerPx, innerPx, { fit: "inside" }).png().toBuffer();
      }
      const im = await sharp(icon).metadata();
      const out = join(artDir, name);
      await sharp({ create: { width: SQ, height: SQ, channels: 4, background: hexToRgb(bg) } })
        .composite([{ input: icon, left: Math.round((SQ - im.width!) / 2), top: Math.round((SQ - im.height!) / 2) }])
        .png().toFile(out);
      console.log(`  ✓ ${name}`);
    };

    if (mono) {
      await place(accent, dark, 0.78, "sym-accent-on-dark.png");
      await place(dark, accent, 0.78, "sym-dark-on-accent.png");
      await place(accent, dark, 0.96, "sym-appicon.png");
    } else {
      // logo como está: contrasta o fundo com a luminância média do símbolo
      await place(null, dark, 0.7, "logo-on-dark.png");
      await place(null, accent, 0.7, "logo-on-accent.png");
    }

    const a = ["--layouts", artDir, "--square", "--out", join(outDir, "logo"), "--count", String(count)];
    if (has("preview")) a.push("--preview");
    if (has("fresh")) a.push("--fresh");
    runBatch(a, "logo");
  }

  // ── kit-summary ───────────────────────────────────────────────────────────
  const read = (p: string) => { try { return JSON.parse(readFileSync(p, "utf-8")); } catch { return []; } };
  const summary = {
    brand: { id: brandId, name: brandName, dark, accent, colors },
    layouts: read(join(outDir, "layouts", "_summary.json")),
    logo: read(join(outDir, "logo", "_summary.json")),
    generatedFor: layoutsArg || null,
  };
  writeFileSync(join(outDir, "kit-summary.json"), JSON.stringify(summary, null, 2));
  const okL = (summary.layouts as Array<{ file?: string }>).filter((r) => r.file).length;
  const okG = (summary.logo as Array<{ file?: string }>).filter((r) => r.file).length;
  console.log(`\n★ Kit ${brandName}: ${okL} layouts + ${okG} logo → ${outDir}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
