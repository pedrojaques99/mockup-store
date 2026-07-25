/**
 * Batch genérico: pega layouts de uma marca + biblioteca de PSDs e cospe N
 * mockups full-res, curando por categoria e casando arte por aspect da face.
 * Reaproveitável pra qualquer cliente — é o motor por trás dos lotes Soccer248.
 *
 * Uso:
 *   npx tsx --env-file=.env.local scripts/brand-mockup-batch.ts \
 *     --layouts "H:/.../Layouts" --out "H:/.../Mockups" --count 20
 *
 * Flags:
 *   --layouts <dir|csv>  pasta com PNG/JPG OU lista "a.png,b.png" (caminhos)
 *   --out <dir>          pasta de saída (cria se faltar)
 *   --count <n>          total de mockups (default 20)
 *   --preview            JPEG ~1400px rápido (default: PNG full-res)
 *   --fresh              ignora _summary.json (re-renderiza do zero, nº a partir de 1)
 *   --min-kb <n>         descarta layouts menores que isso (default 0 = usa todos)
 *   --include <csv>      só estas categorias (billboard,poster,device,retail,signage)
 *   --square             ignora categorias; pega PSDs cuja face é ~1:1 (logo/ícone:
 *                        coaster, badge, sticker, selo, tag, mug, app icon, patch…)
 *   --max-crop <f>       0-1: descarta cenas cuja face force o `cover` a cortar mais
 *                        que isso da arte (0.12 = 12%). Default 0 = desligado.
 *                        Essencial pra layout tipográfico: crop come o headline.
 *
 * Aprendizados embutidos (mantêm consistência entre lotes):
 *  - device = face com aspect de TELA (retrato ~0.40-0.65), não a maior →
 *    evita pintar o cenário de fundo e deixar a tela com watermark
 *  - cap de faces (anti-OOM em murais) + try/catch por render (1 falha não derruba)
 *  - art casada por aspect; murais multi-face recebem layouts variados
 *  - retomável: pula nomes do _summary.json e continua a numeração
 */
import { MongoClient } from "mongodb";
import { createConnection } from "net";
import { existsSync, mkdirSync, writeFileSync, readdirSync, readFileSync, statSync } from "fs";
import { join, resolve, isAbsolute } from "path";
import { computeFaces } from "@visant/psd-engine";
import { frameArt } from "../src/lib/server-frame";

const RENDER_PORT = parseInt(process.env.RENDER_PORT || "4200");
const MAX_FACES = 8;
const SCREEN_ASPECT_RANGE: [number, number] = [0.4, 0.65]; // retrato de celular/tablet

// ── args ────────────────────────────────────────────────────────────────────
const A = process.argv.slice(2);
const flag = (k: string, def?: string) => { const i = A.indexOf(`--${k}`); return i !== -1 && A[i + 1] && !A[i + 1].startsWith("--") ? A[i + 1] : def; };
const has = (k: string) => A.includes(`--${k}`);

const layoutsArg = flag("layouts") || die("--layouts <dir|csv> obrigatório");
const outDir = flag("out") || die("--out <dir> obrigatório");
const count = parseInt(flag("count", "20")!);
const preview = has("preview");
const fresh = has("fresh");
const minKb = parseInt(flag("min-kb", "0")!);
const includeCats = (flag("include") || "").split(",").map((s) => s.trim()).filter(Boolean);
const maxCrop = parseFloat(flag("max-crop", "0")!);

/** Fração do lado maior que o `cover` descarta ao encaixar `artAspect` em `faceAspect`. */
const cropOf = (artAspect: number, faceAspect: number) => {
  const r = artAspect / faceAspect;
  return r > 1 ? 1 - 1 / r : 1 - r;
};

/**
 * Tolerância POR ARTE, do sidecar `_layouts-meta.json` (scripts/layout-ingest.ts).
 * O `--max-crop` global paga o pior caso pra todas: uma arte com margem folgada
 * aguenta 20%, uma com texto na borda não aguenta 5%. Com o sidecar cada arte
 * usa a sua. Sem sidecar, cai no global — comportamento antigo intacto.
 */
type LayoutMetaFile = { layouts?: Array<{ file: string; safeCrop?: number }> };
function loadSafeCrops(dir: string): Map<string, number> {
  const m = new Map<string, number>();
  try {
    const j = JSON.parse(readFileSync(join(dir, "_layouts-meta.json"), "utf-8")) as LayoutMetaFile;
    for (const l of j.layouts ?? []) if (typeof l.safeCrop === "number") m.set(l.file, l.safeCrop);
  } catch { /* sem sidecar — segue no global */ }
  return m;
}

function die(msg: string): never { console.error(`✗ ${msg}`); process.exit(1); }

type FaceMode = "all" | "primary" | "screen";
const ALL_PLAN: Array<{ label: string; rx: string; weight: number; faceMode: FaceMode }> = [
  { label: "billboard", rx: "billboard|outdoor|facade|hoarding|\\bwall\\b", weight: 0.35, faceMode: "all" },
  { label: "poster", rx: "poster|wild|posters-and-stickers|stand|a-frame|easel", weight: 0.2, faceMode: "all" },
  { label: "device", rx: "smartphone|screens|\\bipad\\b|tablet|\\biphone\\b|\\bphone\\b", weight: 0.2, faceMode: "screen" },
  { label: "retail", rx: "t-?shirt|tote|\\bbox\\b|tag|\\bcap\\b|hoodie|\\bmug\\b|bottle|sticker|jersey", weight: 0.25, faceMode: "all" },
  { label: "signage", rx: "sign|storefront|window|flag|banner", weight: 0, faceMode: "all" },
];

const slug = (s: string) => s.replace(/[^\wÀ-ɏ-]+/g, "_").replace(/_+/g, "_").slice(0, 50);
/** Chave de "família" do mockup: tira números/série → agrupa 31-sign / 28-sign. */
const famKey = (s: string) => s.replace(/\.[^.]+$/, "").replace(/\d+/g, "").replace(/[-_\s]+/g, "-").replace(/^-|-$/g, "").toLowerCase().slice(0, 20);

function renderJob(job: Record<string, unknown>) {
  return new Promise<{ ok?: boolean; error?: string }>((res, rej) => {
    const sock = createConnection({ port: RENDER_PORT, host: "127.0.0.1" });
    let buf = "";
    const timer = setTimeout(() => { sock.destroy(); res({ error: "timeout" }); }, 180_000);
    sock.on("connect", () => sock.write(JSON.stringify(job) + "\n"));
    sock.on("data", (c) => { buf += c.toString(); const ls = buf.split("\n"); buf = ls.pop()!; for (const l of ls) if (l.startsWith("{")) { clearTimeout(timer); try { res(JSON.parse(l)); } catch { res({ error: "bad json" }); } sock.destroy(); } });
    sock.on("error", (e) => { clearTimeout(timer); rej(e); });
  });
}

interface FaceMeta { name: string; innerWidth: number; innerHeight: number; linkId?: string; hidden?: boolean }

/** Escolhe a face certa pro modo. screen = aspect de tela (retrato) maior; senão maior. */
function selectFaces(all: ReturnType<typeof computeFaces>, mode: FaceMode) {
  if (mode === "primary") return [all.reduce((a, b) => (b.innerWidth * b.innerHeight > a.innerWidth * a.innerHeight ? b : a))];
  if (mode === "screen") {
    const portrait = all.filter((f) => { const r = f.innerWidth / f.innerHeight; return r >= SCREEN_ASPECT_RANGE[0] && r <= SCREEN_ASPECT_RANGE[1]; });
    const pool = portrait.length ? portrait : all;
    return [pool.reduce((a, b) => (b.innerWidth * b.innerHeight > a.innerWidth * a.innerHeight ? b : a))];
  }
  return all.length > MAX_FACES ? [...all].sort((a, b) => b.innerWidth * b.innerHeight - a.innerWidth * a.innerHeight).slice(0, MAX_FACES) : all;
}

async function main() {
  const sharp = (await import("sharp")).default;
  const artTmp = resolve(".tmp/brand-batch-art");
  mkdirSync(artTmp, { recursive: true });
  mkdirSync(outDir, { recursive: true });

  // Pool de artes
  let artFiles: string[];
  if (layoutsArg.includes(",") || /\.(png|jpe?g)$/i.test(layoutsArg)) {
    artFiles = layoutsArg.split(",").map((s) => (isAbsolute(s.trim()) ? s.trim() : resolve(s.trim())));
  } else {
    artFiles = readdirSync(layoutsArg).filter((f) => /\.(png|jpe?g)$/i.test(f)).map((f) => join(layoutsArg, f));
  }
  const artPool: Array<{ path: string; aspect: number; name: string }> = [];
  for (const p of artFiles) {
    if (!existsSync(p)) { console.log(`! ausente: ${p}`); continue; }
    if (minKb && statSync(p).size < minKb * 1024) continue;
    const m = await sharp(p).metadata();
    if (m.width && m.height) artPool.push({ path: p, aspect: m.width / m.height, name: p.split(/[\\/]/).pop()! });
  }
  if (!artPool.length) die("nenhum layout válido no pool");
  console.log(`pool: ${artPool.map((a) => `${a.name}(${a.aspect.toFixed(2)})`).join(", ")}`);

  // Tolerância por arte (sidecar) com fallback pro --max-crop global.
  const safeCrops = loadSafeCrops(layoutsArg);
  if (safeCrops.size) console.log(`sidecar: safeCrop por arte em ${safeCrops.size}/${artPool.length} layouts`);
  const tolOf = (art: { name: string }) => safeCrops.get(art.name) ?? maxCrop;
  /** A arte cabe nessa face sem perder conteúdo? */
  const artFits = (art: { name: string; aspect: number }, faceAspect: number) => {
    const tol = tolOf(art);
    return tol <= 0 ? true : cropOf(art.aspect, faceAspect) <= tol;
  };

  const pickArt = (faceAspect: number, variant = 0) => {
    const sorted = [...artPool].sort((a, b) => Math.abs(Math.log(a.aspect / faceAspect)) - Math.abs(Math.log(b.aspect / faceAspect)));
    // Sem tolerância o rodízio entre os 3 mais próximos pode cair numa arte que
    // corta demais; com ela, só rodiziamos entre as que aguentam esta face.
    const within = sorted.filter((a) => artFits(a, faceAspect));
    const pool = within.length ? within : sorted;
    const top = pool.slice(0, Math.min(3, pool.length));
    return top[variant % top.length];
  };

  /** Toda face selecionada precisa ter ao menos uma arte que a suporte. */
  const facesFitCrop = (all: ReturnType<typeof computeFaces>, mode: FaceMode) =>
    (maxCrop <= 0 && !safeCrops.size) ||
    selectFaces(all, mode).every((f) =>
      artPool.some((a) => artFits(a, f.innerWidth / f.innerHeight))
    );

  // Resume
  const used = new Set<string>();
  let nextIdx = 1;
  if (!fresh) {
    try { for (const r of JSON.parse(readFileSync(join(outDir, "_summary.json"), "utf-8")) as Array<{ name: string }>) used.add(r.name); } catch {}
    for (const f of readdirSync(outDir)) { const m = /^(\d+)-/.exec(f); if (m) nextIdx = Math.max(nextIdx, parseInt(m[1]) + 1); }
  }
  if (used.size) console.log(`resume: pulando ${used.size} feitos, numerando de ${nextIdx}`);

  const client = new MongoClient(process.env.MONGODB_URI!);
  await client.connect();
  const col = client.db(process.env.MONGODB_DB_NAME!).collection("psd_metadata");
  interface Target { fileName: string; filePath: string; smartObjects: FaceMeta[]; label: string; faceMode: FaceMode }
  const targets: Target[] = [];

  if (has("square")) {
    // Mockups com face ~1:1 — onde um logo/ícone brilha
    const LOGO_RX = "coaster|badge|sticker|stamp|\\bseal\\b|\\bpin\\b|button|label|\\bsign\\b|logo|patch|\\bcap\\b|\\bmug\\b|\\btag\\b|\\bcard\\b|emboss|deboss|tile|\\bcan\\b|\\bjar\\b|candle|soap|vinyl|coin|medal|\\bwax\\b|sleeve|\\bcd\\b|plate|disc|sphere|\\bball\\b|\\bcup\\b|napkin|keychain|sphere";
    // $sample = sorteio real sobre TODO o acervo (varia a cada run, não a mesma ordem)
    const docs = await col.aggregate([
      { $match: { fileName: { $regex: LOGO_RX, $options: "i" } } },
      { $sample: { size: count * 20 } },
      { $project: { fileName: 1, filePath: 1, smartObjects: 1 } },
    ]).toArray();
    // teto por "família" (ex.: *-sign-mockup) pra não virar monocultura de placa
    const famCount = new Map<string, number>();
    for (const d of docs) {
      if (targets.length >= count) break;
      const fp = (d.filePath as string)?.replace(/\//g, "\\");
      if (!fp || used.has(d.fileName) || !existsSync(fp)) continue;
      const faces = computeFaces((d.smartObjects || []) as never);
      if (!faces.length) continue;
      const primary = faces.reduce((a, b) => (b.innerWidth * b.innerHeight > a.innerWidth * a.innerHeight ? b : a));
      const ar = primary.innerWidth / primary.innerHeight;
      if (ar < 0.82 || ar > 1.22) continue; // só faces quadradas
      const fam = famKey(d.fileName as string);
      if ((famCount.get(fam) || 0) >= 2) continue; // máx 2 por família
      famCount.set(fam, (famCount.get(fam) || 0) + 1);
      used.add(d.fileName);
      // 'all' = preenche TODAS as faces quadradas (coaster com 5, etc.), não só uma
      targets.push({ fileName: d.fileName, filePath: fp, smartObjects: d.smartObjects as never, label: "square", faceMode: "all" });
    }
    console.log(`  square (face ~1:1): ${targets.length}/${count}`);
  } else {
    const plan = ALL_PLAN.filter((c) => (includeCats.length ? includeCats.includes(c.label) : c.weight > 0));
    const totalW = plan.reduce((s, c) => s + c.weight, 0);
    for (const cat of plan) {
      const want = Math.max(1, Math.round((cat.weight / totalW) * count));
      // $sample = cenas diferentes a cada run (antes: find().limit() = sempre as primeiras)
      const docs = await col.aggregate([
        { $match: { fileName: { $regex: cat.rx, $options: "i" } } },
        // Com filtro de corte ligado a rejeição é alta — precisa de mais candidatos.
        { $sample: { size: want * (maxCrop > 0 || safeCrops.size ? 30 : 8) } },
        { $project: { fileName: 1, filePath: 1, smartObjects: 1 } },
      ]).toArray();
      let taken = 0;
      for (const d of docs) {
        if (taken >= want || targets.length >= count) break;
        const fp = (d.filePath as string)?.replace(/\//g, "\\");
        if (!fp || used.has(d.fileName) || !existsSync(fp)) continue;
        const faces = computeFaces((d.smartObjects || []) as never);
        if (!faces.length) continue;
        if (!facesFitCrop(faces, cat.faceMode)) continue;
        used.add(d.fileName);
        targets.push({ fileName: d.fileName, filePath: fp, smartObjects: d.smartObjects as never, label: cat.label, faceMode: cat.faceMode });
        taken++;
      }
      console.log(`  ${cat.label}: ${taken}/${want}`);
    }
  }
  await client.close();

  console.log(`\n${targets.length} mockups → ${outDir} (${preview ? "preview JPEG" : "full PNG"})\n`);
  const results: Array<{ name: string; file?: string; error?: string }> = [];
  for (const [i, t] of targets.entries()) {
    const faces = selectFaces(computeFaces(t.smartObjects as never), t.faceMode);
    const replacements: Array<{ smartObject: string; artPath: string }> = [];
    // varia a arte por mockup (i) E por face (fi) → vizinhos nunca repetem
    for (const [fi, face] of faces.entries()) {
      const art = pickArt(face.innerWidth / face.innerHeight, i + fi);
      const framed = await frameArt(readFileSync(art.path), face.innerWidth, face.innerHeight, { mode: "cover", bg: null });
      const ap = join(artTmp, `${slug(t.fileName)}-${fi}.png`);
      writeFileSync(ap, framed);
      replacements.push({ smartObject: face.smartObject, artPath: ap });
    }
    const n = nextIdx + i;
    const outFile = join(outDir, `${String(n).padStart(2, "0")}-${slug(t.fileName)}.${preview ? "jpg" : "png"}`);
    try {
      const r = await renderJob({ psdPath: t.filePath, replacements, outputPath: outFile, hideLayers: [], preview: preview ? 1400 : false });
      if (r.error) { console.log(`✗ [${n}] ${t.fileName} — ${r.error}`); results.push({ name: t.fileName, error: r.error }); }
      else { console.log(`✓ [${n}] ${t.label} · ${t.fileName} (${faces.length}f)`); results.push({ name: t.fileName, file: outFile }); }
    } catch (e) { console.log(`✗ [${n}] ${t.fileName} — ${(e as Error).message}`); results.push({ name: t.fileName, error: (e as Error).message }); }
  }

  let prev: typeof results = [];
  if (!fresh) { try { prev = JSON.parse(readFileSync(join(outDir, "_summary.json"), "utf-8")); } catch {} }
  writeFileSync(join(outDir, "_summary.json"), JSON.stringify([...prev, ...results], null, 2));
  const ok = results.filter((r) => r.file).length;
  console.log(`\n${ok}/${results.length} novos em ${outDir}`);
  if (ok < results.length) for (const r of results.filter((x) => x.error)) console.log(`  falhou: ${r.name} — ${r.error}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
