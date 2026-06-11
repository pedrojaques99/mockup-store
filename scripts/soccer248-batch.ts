/**
 * Batch curado de mockups pra Soccer248 usando os layouts do cliente.
 * - device = só a face maior (a tela); resto = todas as faces (cap 8)
 * - murais multi-face recebem layouts variados (parede de pôsteres diferentes)
 * - art casada por aspect da face, enquadrada cover
 * - full-res PNG direto na pasta Mockups do Drive
 *
 * Run: npx tsx --env-file=.env.local scripts/soccer248-batch.ts
 */
import { MongoClient } from "mongodb";
import { createConnection } from "net";
import { existsSync, mkdirSync, writeFileSync, readdirSync, statSync, readFileSync } from "fs";
import { join, resolve } from "path";
import { computeFaces } from "@visantlabs/psd-engine";
import { frameArt } from "../src/lib/server-frame";

const LAYOUTS_DIR = "H:/Meu Drive/@Clientes VSN/Soccer248/Layouts";
const OUT_DIR = "H:/Meu Drive/@Clientes VSN/Soccer248/Mockups";
const ART_DIR = resolve(".tmp/soccer248/.art"); // temp local, não sincroniza
const RENDER_PORT = parseInt(process.env.RENDER_PORT || "4200");
const MAX_FACES = 8; // teto pra não estourar memória em murais

type FaceMode = "all" | "primary";
const PLAN: Array<{ label: string; rx: string; count: number; faceMode: FaceMode }> = [
  { label: "OOH/outdoor", rx: "billboard|outdoor|facade|hoarding|\\bwall\\b", count: 7, faceMode: "all" },
  { label: "wild posting/poster", rx: "poster|posters-and-stickers|wild", count: 4, faceMode: "all" },
  { label: "device/celular", rx: "iphone|smartphone|\\bphone\\b|screens", count: 4, faceMode: "primary" },
  { label: "retail", rx: "t-?shirt|tote|\\bbox\\b|tag|\\bcap\\b|hoodie", count: 5, faceMode: "all" },
];

const slug = (s: string) => s.replace(/[^\wÀ-ɏ-]+/g, "_").replace(/_+/g, "_").slice(0, 50);

function renderJob(job: Record<string, unknown>) {
  return new Promise<{ ok?: boolean; error?: string }>((res, rej) => {
    const sock = createConnection({ port: RENDER_PORT, host: "127.0.0.1" });
    let buf = "";
    const timer = setTimeout(() => { sock.destroy(); res({ error: "timeout" }); }, 180_000);
    sock.on("connect", () => sock.write(JSON.stringify(job) + "\n"));
    sock.on("data", (c) => {
      buf += c.toString();
      const lines = buf.split("\n"); buf = lines.pop()!;
      for (const l of lines) {
        if (l.startsWith("{")) { clearTimeout(timer); try { res(JSON.parse(l)); } catch { res({ error: "bad json" }); } sock.destroy(); }
      }
    });
    sock.on("error", (e) => { clearTimeout(timer); rej(e); });
  });
}

interface FaceMeta { name: string; innerWidth: number; innerHeight: number; linkId?: string; hidden?: boolean }

async function main() {
  const sharp = (await import("sharp")).default;
  mkdirSync(ART_DIR, { recursive: true });
  mkdirSync(OUT_DIR, { recursive: true });

  // 1. Pool de artes (layouts > 0.3MB, com aspect)
  const artPool: Array<{ path: string; aspect: number; name: string }> = [];
  for (const f of readdirSync(LAYOUTS_DIR)) {
    if (!/\.(png|jpe?g)$/i.test(f)) continue;
    const p = join(LAYOUTS_DIR, f);
    if (statSync(p).size < 300_000) continue;
    const m = await sharp(p).metadata();
    if (m.width && m.height) artPool.push({ path: p, aspect: m.width / m.height, name: f });
  }
  console.log(`${artPool.length} layouts no pool`);

  // n-ésima melhor art pro aspect (rotaciona em murais pra dar variedade)
  const pickArt = (faceAspect: number, variant = 0) => {
    const sorted = [...artPool].sort(
      (a, b) => Math.abs(Math.log(a.aspect / faceAspect)) - Math.abs(Math.log(b.aspect / faceAspect))
    );
    const top = sorted.slice(0, Math.min(5, sorted.length));
    return top[variant % top.length];
  };

  // 2. Seleciona PSDs por categoria
  const client = new MongoClient(process.env.MONGODB_URI!);
  await client.connect();
  const col = client.db(process.env.MONGODB_DB_NAME!).collection("psd_metadata");

  interface Target { fileName: string; filePath: string; smartObjects: FaceMeta[]; label: string; faceMode: FaceMode }
  const targets: Target[] = [];
  const seen = new Set<string>();
  for (const cat of PLAN) {
    const docs = await col.find({ fileName: { $regex: cat.rx, $options: "i" } })
      .project({ fileName: 1, filePath: 1, smartObjects: 1 }).limit(cat.count * 4).toArray();
    let taken = 0;
    for (const d of docs) {
      if (taken >= cat.count) break;
      const fp = (d.filePath as string)?.replace(/\//g, "\\");
      if (!fp || seen.has(d.fileName) || !existsSync(fp)) continue;
      if (!computeFaces((d.smartObjects || []) as never).length) continue;
      seen.add(d.fileName);
      targets.push({ fileName: d.fileName, filePath: fp, smartObjects: d.smartObjects as never, label: cat.label, faceMode: cat.faceMode });
      taken++;
    }
    console.log(`  ${cat.label}: ${taken}/${cat.count}`);
  }
  await client.close();

  console.log(`\n${targets.length} mockups → ${OUT_DIR}\n`);

  // 3. Render full-res PNG
  const results: Array<{ name: string; file?: string; error?: string }> = [];
  for (const [i, t] of targets.entries()) {
    let faces = computeFaces(t.smartObjects as never);
    if (t.faceMode === "primary") {
      faces = [faces.reduce((a, b) => (b.innerWidth * b.innerHeight > a.innerWidth * a.innerHeight ? b : a))];
    } else if (faces.length > MAX_FACES) {
      faces = [...faces].sort((a, b) => b.innerWidth * b.innerHeight - a.innerWidth * a.innerHeight).slice(0, MAX_FACES);
    }

    const replacements: Array<{ smartObject: string; artPath: string }> = [];
    for (const [fi, face] of faces.entries()) {
      const art = pickArt(face.innerWidth / face.innerHeight, fi);
      const framed = await frameArt(readFileSync(art.path), face.innerWidth, face.innerHeight, { mode: "cover", bg: null });
      const ap = join(ART_DIR, `${slug(t.fileName)}-${fi}.png`);
      writeFileSync(ap, framed);
      replacements.push({ smartObject: face.smartObject, artPath: ap });
    }

    const outFile = join(OUT_DIR, `${String(i + 1).padStart(2, "0")}-${slug(t.fileName)}.png`);
    try {
      const r = await renderJob({ psdPath: t.filePath, replacements, outputPath: outFile, hideLayers: [], preview: false });
      if (r.error) { console.log(`✗ [${i + 1}/${targets.length}] ${t.fileName} — ${r.error}`); results.push({ name: t.fileName, error: r.error }); }
      else { console.log(`✓ [${i + 1}/${targets.length}] ${t.label} · ${t.fileName} (${faces.length}f)`); results.push({ name: t.fileName, file: outFile }); }
    } catch (e) { console.log(`✗ [${i + 1}/${targets.length}] ${t.fileName} — ${(e as Error).message}`); results.push({ name: t.fileName, error: (e as Error).message }); }
  }

  writeFileSync(join(OUT_DIR, "_summary.json"), JSON.stringify(results, null, 2));
  const ok = results.filter((r) => r.file).length;
  console.log(`\n${ok}/${results.length} renderizados em ${OUT_DIR}`);
  if (ok < results.length) for (const r of results.filter((x) => x.error)) console.log(`  falhou: ${r.name} — ${r.error}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
