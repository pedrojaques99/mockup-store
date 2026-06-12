/**
 * Batch 2 Soccer248 — pool fixo de 5 layouts escolhidos pelo cliente.
 * Pega 20 PSDs NOVOS (pula os já renderizados, lê _summary.json), casa art por
 * aspect, full-res PNG na mesma pasta Mockups, numerando a partir do próximo nº.
 *
 * Run: npx tsx --env-file=.env.local scripts/soccer248-batch2.ts
 */
import { MongoClient } from "mongodb";
import { createConnection } from "net";
import { existsSync, mkdirSync, writeFileSync, readdirSync, readFileSync } from "fs";
import { join, resolve } from "path";
import { computeFaces } from "@visant/psd-engine";
import { frameArt } from "../src/lib/server-frame";

const OUT_DIR = "H:/Meu Drive/@Clientes VSN/Soccer248/Mockups";
const ART_DIR = resolve(".tmp/soccer248/.art2");
const ORIG = "H:/Meu Drive/@Clientes VSN/Soccer248/Layouts/layouts originais";
const ART_FILES = ["Frame 4408.png", "Frame 4419.png", "Frame 4420.png", "Frame 4421.png", "Frame 4406.png"].map((f) => join(ORIG, f));
const RENDER_PORT = parseInt(process.env.RENDER_PORT || "4200");
const MAX_FACES = 8;

type FaceMode = "all" | "primary";
const PLAN: Array<{ label: string; rx: string; count: number; faceMode: FaceMode }> = [
  { label: "OOH/outdoor", rx: "billboard|outdoor|facade|hoarding|\\bwall\\b|signage|sign\\b", count: 6, faceMode: "all" },
  { label: "poster/wild", rx: "poster|wild|stand|a-frame|easel", count: 4, faceMode: "all" },
  { label: "device", rx: "smartphone|screens|\\bipad\\b|tablet|\\bphone\\b", count: 4, faceMode: "primary" },
  { label: "retail", rx: "t-?shirt|tote|\\bbox\\b|tag|\\bcap\\b|hoodie|\\bmug\\b|bottle|sticker|jersey", count: 6, faceMode: "all" },
];

const slug = (s: string) => s.replace(/[^\wÀ-ɏ-]+/g, "_").replace(/_+/g, "_").slice(0, 50);

function renderJob(job: Record<string, unknown>) {
  return new Promise<{ ok?: boolean; error?: string }>((res, rej) => {
    const sock = createConnection({ port: RENDER_PORT, host: "127.0.0.1" });
    let buf = "";
    const timer = setTimeout(() => { sock.destroy(); res({ error: "timeout" }); }, 180_000);
    sock.on("connect", () => sock.write(JSON.stringify(job) + "\n"));
    sock.on("data", (c) => {
      buf += c.toString(); const lines = buf.split("\n"); buf = lines.pop()!;
      for (const l of lines) if (l.startsWith("{")) { clearTimeout(timer); try { res(JSON.parse(l)); } catch { res({ error: "bad json" }); } sock.destroy(); }
    });
    sock.on("error", (e) => { clearTimeout(timer); rej(e); });
  });
}

interface FaceMeta { name: string; innerWidth: number; innerHeight: number; linkId?: string; hidden?: boolean }

async function main() {
  const sharp = (await import("sharp")).default;
  mkdirSync(ART_DIR, { recursive: true });
  mkdirSync(OUT_DIR, { recursive: true });

  // Pool = os 5 explícitos (sem filtro de tamanho — escolha do cliente)
  const artPool: Array<{ path: string; aspect: number; name: string }> = [];
  for (const p of ART_FILES) {
    if (!existsSync(p)) { console.log(`! layout ausente: ${p}`); continue; }
    const m = await sharp(p).metadata();
    if (m.width && m.height) artPool.push({ path: p, aspect: m.width / m.height, name: p.split(/[\\/]/).pop()! });
  }
  if (!artPool.length) { console.error("nenhum layout válido"); process.exit(1); }
  console.log(`pool: ${artPool.map((a) => `${a.name}(${a.aspect.toFixed(2)})`).join(", ")}`);

  const pickArt = (faceAspect: number, variant = 0) => {
    const sorted = [...artPool].sort((a, b) => Math.abs(Math.log(a.aspect / faceAspect)) - Math.abs(Math.log(b.aspect / faceAspect)));
    const top = sorted.slice(0, Math.min(3, sorted.length));
    return top[variant % top.length];
  };

  // Nomes já usados (batch 1) + próximo índice
  const used = new Set<string>();
  try {
    const sum = JSON.parse(readFileSync(join(OUT_DIR, "_summary.json"), "utf-8")) as Array<{ name: string }>;
    for (const r of sum) used.add(r.name);
  } catch {}
  let nextIdx = 1;
  for (const f of readdirSync(OUT_DIR)) {
    const m = /^(\d+)-/.exec(f);
    if (m) nextIdx = Math.max(nextIdx, parseInt(m[1]) + 1);
  }
  console.log(`pulando ${used.size} já feitos; numerando a partir de ${nextIdx}`);

  // Seleciona 20 PSDs novos
  const client = new MongoClient(process.env.MONGODB_URI!);
  await client.connect();
  const col = client.db(process.env.MONGODB_DB_NAME!).collection("psd_metadata");
  interface Target { fileName: string; filePath: string; smartObjects: FaceMeta[]; label: string; faceMode: FaceMode }
  const targets: Target[] = [];
  for (const cat of PLAN) {
    const docs = await col.find({ fileName: { $regex: cat.rx, $options: "i" } })
      .project({ fileName: 1, filePath: 1, smartObjects: 1 }).limit(cat.count * 8).toArray();
    let taken = 0;
    for (const d of docs) {
      if (taken >= cat.count) break;
      const fp = (d.filePath as string)?.replace(/\//g, "\\");
      if (!fp || used.has(d.fileName) || !existsSync(fp)) continue;
      if (!computeFaces((d.smartObjects || []) as never).length) continue;
      used.add(d.fileName);
      targets.push({ fileName: d.fileName, filePath: fp, smartObjects: d.smartObjects as never, label: cat.label, faceMode: cat.faceMode });
      taken++;
    }
    console.log(`  ${cat.label}: ${taken}/${cat.count}`);
  }
  await client.close();

  console.log(`\n${targets.length} mockups novos → ${OUT_DIR}\n`);
  const results: Array<{ name: string; file?: string; error?: string }> = [];
  for (const [i, t] of targets.entries()) {
    let faces = computeFaces(t.smartObjects as never);
    if (t.faceMode === "primary") faces = [faces.reduce((a, b) => (b.innerWidth * b.innerHeight > a.innerWidth * a.innerHeight ? b : a))];
    else if (faces.length > MAX_FACES) faces = [...faces].sort((a, b) => b.innerWidth * b.innerHeight - a.innerWidth * a.innerHeight).slice(0, MAX_FACES);

    const replacements: Array<{ smartObject: string; artPath: string }> = [];
    for (const [fi, face] of faces.entries()) {
      const art = pickArt(face.innerWidth / face.innerHeight, fi);
      const framed = await frameArt(readFileSync(art.path), face.innerWidth, face.innerHeight, { mode: "cover", bg: null });
      const ap = join(ART_DIR, `${slug(t.fileName)}-${fi}.png`);
      writeFileSync(ap, framed);
      replacements.push({ smartObject: face.smartObject, artPath: ap });
    }

    const n = nextIdx + i;
    const outFile = join(OUT_DIR, `${String(n).padStart(2, "0")}-${slug(t.fileName)}.png`);
    try {
      const r = await renderJob({ psdPath: t.filePath, replacements, outputPath: outFile, hideLayers: [], preview: false });
      if (r.error) { console.log(`✗ [${n}] ${t.fileName} — ${r.error}`); results.push({ name: t.fileName, error: r.error }); }
      else { console.log(`✓ [${n}] ${t.label} · ${t.fileName} (${faces.length}f)`); results.push({ name: t.fileName, file: outFile }); }
    } catch (e) { console.log(`✗ [${n}] ${t.fileName} — ${(e as Error).message}`); results.push({ name: t.fileName, error: (e as Error).message }); }
  }

  // Append ao summary existente
  let prev: Array<{ name: string; file?: string; error?: string }> = [];
  try { prev = JSON.parse(readFileSync(join(OUT_DIR, "_summary.json"), "utf-8")); } catch {}
  writeFileSync(join(OUT_DIR, "_summary.json"), JSON.stringify([...prev, ...results], null, 2));
  const ok = results.filter((r) => r.file).length;
  console.log(`\n${ok}/${results.length} novos em ${OUT_DIR}`);
  if (ok < results.length) for (const r of results.filter((x) => x.error)) console.log(`  falhou: ${r.name} — ${r.error}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
