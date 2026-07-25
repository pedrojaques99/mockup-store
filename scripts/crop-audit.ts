/**
 * Audita quanto da arte o modo `cover` descartou em cada mockup de um lote.
 * Reproduz o pickArt/selectFaces do brand-mockup-batch pra medir o corte real —
 * porque "renderizou com sucesso" não quer dizer que o headline sobreviveu.
 *
 * Uso:
 *   npx tsx --env-file=.env.local scripts/crop-audit.ts \
 *     --layouts "<dir dos criativos>" --out "<dir do lote>"
 *
 * Flags:
 *   --layouts <dir>   mesma pasta passada ao batch (define o pool de aspects)
 *   --out <dir>       pasta do lote (lê o _summary.json de lá)
 *   --warn <f>        limiar de "leve" (default 0.07)
 *   --fail <f>        limiar de "corte pesado" (default 0.15)
 *
 * ⚠️ Exato só pra lote gerado numa tacada: o `variant` do pickArt é o índice
 * DENTRO da run, então em lotes encadeados (vários --include) os números erram.
 */
import { MongoClient } from "mongodb";
import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import { computeFaces } from "@visant/psd-engine";

const A = process.argv.slice(2);
const flag = (k: string, def?: string) => { const i = A.indexOf(`--${k}`); return i !== -1 && A[i + 1] && !A[i + 1].startsWith("--") ? A[i + 1] : def; };
function die(m: string): never { console.error(`✗ ${m}`); process.exit(1); }

const layoutsDir = flag("layouts") || die("--layouts <dir> obrigatório");
const outDir = flag("out") || die("--out <dir> obrigatório");
const warnAt = parseFloat(flag("warn", "0.07")!);
const failAt = parseFloat(flag("fail", "0.15")!);

/**
 * Tolerância POR ARTE do sidecar (`_layouts-meta.json`). Sem ela o audit julga
 * todo mundo pelo mesmo limiar — e acusa "corte pesado" numa arte que aguenta
 * 20% de sobra. Com ela, o veredito é contra o que AQUELA arte suporta.
 */
function loadSafeCrops(dir: string): Map<string, number> {
  const m = new Map<string, number>();
  try {
    const j = JSON.parse(readFileSync(join(dir, "_layouts-meta.json"), "utf-8")) as { layouts?: Array<{ file: string; safeCrop?: number }> };
    for (const l of j.layouts ?? []) if (typeof l.safeCrop === "number") m.set(l.file, l.safeCrop);
  } catch { /* sem sidecar — julga pelo limiar global */ }
  return m;
}

const MAX_FACES = 8;
const SCREEN: [number, number] = [0.4, 0.65];

// Espelha o ALL_PLAN do brand-mockup-batch (label → regex, faceMode)
const CAT: Array<{ label: string; rx: RegExp; mode: "all" | "screen" }> = [
  { label: "billboard", rx: /billboard|outdoor|facade|hoarding|\bwall\b/i, mode: "all" },
  { label: "poster", rx: /poster|wild|posters-and-stickers|stand|a-frame|easel/i, mode: "all" },
  { label: "device", rx: /smartphone|screens|\bipad\b|tablet|\biphone\b|\bphone\b/i, mode: "screen" },
  { label: "retail", rx: /t-?shirt|tote|\bbox\b|tag|\bcap\b|hoodie|\bmug\b|bottle|sticker|jersey/i, mode: "all" },
];

/** Fração do lado maior que o `cover` descarta. Idêntico ao do batch. */
const cropOf = (artAspect: number, faceAspect: number) => {
  const r = artAspect / faceAspect;
  return r > 1 ? 1 - 1 / r : 1 - r;
};

async function main() {
  const sharp = (await import("sharp")).default;

  const artPool: Array<{ name: string; aspect: number }> = [];
  for (const f of readdirSync(layoutsDir).filter((n) => /\.(png|jpe?g)$/i.test(n))) {
    const m = await sharp(join(layoutsDir, f)).metadata();
    if (m.width && m.height) artPool.push({ name: f, aspect: m.width / m.height });
  }
  if (!artPool.length) die("nenhum layout válido em --layouts");

  // Espelha o pickArt do batch: com sidecar, o rodízio respeita a tolerância
  // por arte. Sem isso o audit simula uma escolha que o batch não fez.
  const safeCrops = loadSafeCrops(layoutsDir);
  const tolOf = (name: string) => safeCrops.get(name);
  const artFits = (a: { name: string; aspect: number }, faceAspect: number) => {
    const tol = tolOf(a.name);
    return tol === undefined || tol <= 0 ? true : cropOf(a.aspect, faceAspect) <= tol;
  };

  const pickArt = (faceAspect: number, variant = 0) => {
    const sorted = [...artPool].sort((a, b) => Math.abs(Math.log(a.aspect / faceAspect)) - Math.abs(Math.log(b.aspect / faceAspect)));
    const within = safeCrops.size ? sorted.filter((a) => artFits(a, faceAspect)) : sorted;
    const pool = within.length ? within : sorted;
    const top = pool.slice(0, Math.min(3, pool.length));
    return top[variant % top.length];
  };

  let summary: Array<{ name: string; file?: string }>;
  try { summary = JSON.parse(readFileSync(join(outDir, "_summary.json"), "utf-8")); }
  catch { die(`sem _summary.json em ${outDir}`); }

  const client = new MongoClient(process.env.MONGODB_URI!);
  await client.connect();
  const col = client.db(process.env.MONGODB_DB_NAME!).collection("psd_metadata");

  if (safeCrops.size) console.log(`sidecar: tolerância por arte em ${safeCrops.size} layouts — veredito é contra o que CADA arte aguenta\n`);
  console.log("idx  cat        mockup                          face   art    corte  tolerância");
  console.log("-".repeat(90));
  const bad: string[] = [];

  // Só audita o que está no disco: o _summary guarda o histórico (inclusive
  // renders descartados), e auditar entrada órfã reporta defeito já resolvido.
  // Casa ignorando um sufixo " [LxA]" — o arquivo pode ter sido renomeado.
  const stem = (p: string) => p.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, "").replace(/\s*\[\d+x\d+\]\s*$/, "");
  const onDisk = new Set(readdirSync(outDir).filter((f) => /\.(png|jpe?g)$/i.test(f)).map(stem));

  let skipped = 0;
  for (const [i, row] of summary.entries()) {
    if (!row.file || !onDisk.has(stem(row.file))) { skipped++; continue; }
    const d = await col.findOne({ fileName: row.name }, { projection: { smartObjects: 1 } });
    if (!d) continue;
    const cat = CAT.find((c) => c.rx.test(row.name));
    let faces = computeFaces((d.smartObjects || []) as never);
    if (!faces.length) continue;

    if (cat?.mode === "screen") {
      const p = faces.filter((f) => { const r = f.innerWidth / f.innerHeight; return r >= SCREEN[0] && r <= SCREEN[1]; });
      const pool = p.length ? p : faces;
      faces = [pool.reduce((a, b) => (b.innerWidth * b.innerHeight > a.innerWidth * a.innerHeight ? b : a))];
    } else if (faces.length > MAX_FACES) {
      faces = [...faces].sort((a, b) => b.innerWidth * b.innerHeight - a.innerWidth * a.innerHeight).slice(0, MAX_FACES);
    }

    let worst = 0, wFace = 0, wArt = 0, wTol: number | undefined, over = false;
    for (const [fi, face] of faces.entries()) {
      const fa = face.innerWidth / face.innerHeight;
      const art = pickArt(fa, i + fi);
      const lost = cropOf(art.aspect, fa);
      const tol = tolOf(art.name);
      // Veredito por arte quando há sidecar: estourou o que ELA aguenta?
      if (tol !== undefined && lost > tol + 1e-6) over = true;
      if (lost > worst) { worst = lost; wFace = fa; wArt = art.aspect; wTol = tol; }
    }
    const fail = safeCrops.size ? over : worst >= failAt;
    const flagTxt = fail ? "  <<< ESTOUROU A ARTE" : worst >= warnAt ? "  < leve" : "";
    const tolTxt = wTol === undefined ? "   -" : `${(wTol * 100).toFixed(0).padStart(3)}%`;
    console.log(
      `${String(i + 1).padStart(2)}   ${(cat?.label ?? "?").padEnd(10)} ${row.name.slice(0, 30).padEnd(31)} ${wFace.toFixed(2).padStart(5)}  ${wArt.toFixed(2).padStart(5)}  ${(worst * 100).toFixed(0).padStart(3)}%  tol=${tolTxt}${flagTxt}`
    );
    if (fail) bad.push(`${i + 1} ${cat?.label ?? "?"}`);
  }

  console.log("-".repeat(90));
  if (skipped) console.log(`(${skipped} entradas do _summary ignoradas — arquivo não está mais no disco)`);
  const criterio = safeCrops.size ? "estourou a tolerância da própria arte" : `corte >= ${(failAt * 100).toFixed(0)}%`;
  console.log(`${criterio}: ${bad.length}/${summary.length - skipped}${bad.length ? ` → ${bad.join(", ")}` : ""}`);
  console.log(
    bad.length
      ? safeCrops.size
        ? "→ o batch escolheu arte que a cena não comporta; ver pickArt/facesFitCrop"
        : "→ gere o sidecar (layout-ingest --ocr) ou re-rode com --max-crop 0.12"
      : "→ lote limpo"
  );
  await client.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
