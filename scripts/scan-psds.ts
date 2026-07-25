/**
 * Scan all PSDs, extract smart object + adjustment layer metadata,
 * and persist to MongoDB collection `psd_metadata`.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/scan-psds.ts
 *   DRY_RUN=1 npx tsx --env-file=.env.local scripts/scan-psds.ts
 *   ONLY_NEW=1 npx tsx --env-file=.env.local scripts/scan-psds.ts
 *
 * ONLY_NEW=1 pula o que já está no psd_metadata → scan incremental, barato o
 * bastante pra rodar sempre que caírem PSDs novos numa pasta do PSD_DIRS.
 * Sem ele, relê os ~2k PSDs (dezenas de GB) — é por isso que ninguém rodava.
 */

import { readFileSync } from "fs";
import { join, basename } from "path";
import { MongoClient } from "mongodb";
import { walkPsds } from "../src/lib/fs-walk";
import { scanPsd, type PsdMetadata } from "../src/lib/psd-scan";

// Load .env.local manually (scripts don't get Next.js env loading)
const envFile = readFileSync(join(process.cwd(), ".env.local"), "utf-8");
for (const line of envFile.split("\n")) {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match && !process.env[match[1].trim()]) {
    process.env[match[1].trim()] = match[2].trim();
  }
}

const DRY_RUN = process.env.DRY_RUN === "1";
const ONLY_NEW = process.env.ONLY_NEW === "1";
const PSD_DIRS = (process.env.PSD_DIRS || "").split(",").map((d) => d.trim()).filter(Boolean);

async function main() {
  console.log("PSD Metadata Scanner");
  console.log(`  dirs: ${PSD_DIRS.join(", ")}`);
  console.log(`  DRY_RUN: ${DRY_RUN}\n`);

  const allPsds = PSD_DIRS.flatMap((dir) => {
    const found = walkPsds(dir);
    console.log(`  ${dir}: ${found.length} PSDs`);
    return found;
  });
  console.log(`\n  Total: ${allPsds.length} PSDs\n`);

  // Deduplicate by fileName (keep first = shortest path)
  const seen = new Set<string>();
  const unique = allPsds.filter((p) => {
    if (seen.has(p.name)) return false;
    seen.add(p.name);
    return true;
  });
  console.log(`  Unique: ${unique.length} (${allPsds.length - unique.length} duplicates removed)\n`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let client: MongoClient | null = null;
  // Conexão só-leitura pro ONLY_NEW quando DRY_RUN não abre a principal
  let dryClient: MongoClient | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let col: any = null;
  if (!DRY_RUN) {
    client = new MongoClient(process.env.MONGODB_URI!);
    await client.connect();
    const db = client.db(process.env.MONGODB_DB_NAME!);
    col = db.collection("psd_metadata");
    await col.createIndex({ fileName: 1 }, { unique: true });
    await col.createIndex({ "smartObjects.name": 1 });
  }

  // ONLY_NEW: descarta o que já está no banco ANTES de abrir qualquer PSD —
  // é o que torna o scan barato o suficiente pra rodar a cada arquivo novo.
  let targets = unique;
  if (ONLY_NEW) {
    let readCol = col;
    if (!readCol) {
      dryClient = new MongoClient(process.env.MONGODB_URI!);
      await dryClient.connect();
      readCol = dryClient.db(process.env.MONGODB_DB_NAME!).collection("psd_metadata");
    }
    const known = new Set<string>(
      (await readCol.find({}, { projection: { fileName: 1 } }).toArray()).map(
        (d: { fileName: string }) => d.fileName
      )
    );
    const before = targets.length;
    targets = targets.filter((p) => !known.has(p.name));
    console.log(`  ONLY_NEW: ${before - targets.length} já indexados · ${targets.length} novos\n`);
    if (!targets.length) {
      console.log("Nada novo — acervo já está em dia.");
      await client?.close();
      await dryClient?.close();
      return;
    }
  }

  let ok = 0, fail = 0;
  const batch: PsdMetadata[] = [];
  const BATCH_SIZE = 25;

  async function flushBatch() {
    if (!col || batch.length === 0) return;
    const ops = batch.map((m) => ({
      updateOne: { filter: { fileName: m.fileName }, update: { $set: m }, upsert: true },
    }));
    await col.bulkWrite(ops, { ordered: false });
    batch.length = 0;
  }

  for (let i = 0; i < targets.length; i++) {
    const entry = targets[i];
    process.stdout.write(`[${i + 1}/${targets.length}] ${entry.name}...`);

    const meta = scanPsd(entry.path);
    if (meta) {
      batch.push(meta);
      const soSummary = meta.smartObjects.map((s) => `${s.name}(${s.innerWidth}x${s.innerHeight})`).join(", ");
      console.log(` ok ${meta.smartObjects.length} SO [${soSummary}] ${meta.adjustments.length} adj`);
      ok++;
      if (batch.length >= BATCH_SIZE) await flushBatch();
    } else {
      console.log(" FAIL");
      fail++;
    }
  }
  await flushBatch();

  console.log(`\nScanned: ${ok} ok, ${fail} failed`);

  if (DRY_RUN) {
    console.log("DRY_RUN — not saved");
  } else {
    const total = await col.countDocuments();
    console.log(`  ${total} total documents in psd_metadata`);
    await client!.close();
  }
  await dryClient?.close();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
