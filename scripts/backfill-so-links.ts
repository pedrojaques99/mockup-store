/**
 * Re-escaneia os PSDs do psd_metadata (header-only, rápido) para preencher
 * linkId/hidden nos smartObjects — necessário pro agrupamento de faces.
 * Pula entradas que já têm linkId (use --force para re-escanear tudo).
 *
 * Run: bun scripts/backfill-so-links.ts [--force]
 */
import { MongoClient } from "mongodb";
import { existsSync } from "fs";
import { scanPsd } from "../src/lib/psd-scan";

const FORCE = process.argv.includes("--force");

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI!);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB_NAME!);
  const col = db.collection("psd_metadata");

  const docs = await col
    .find({}, { projection: { fileName: 1, filePath: 1, smartObjects: 1 } })
    .toArray();
  console.log(`${docs.length} psd_metadata entries`);

  let updated = 0, skippedDone = 0, missing = 0, failed = 0;
  const t0 = Date.now();

  for (const [i, doc] of docs.entries()) {
    const sos = (doc.smartObjects as Array<{ linkId?: string }>) || [];
    if (!FORCE && sos.length > 0 && sos.every((s) => s.linkId !== undefined)) {
      skippedDone++;
      continue;
    }

    const filePath = doc.filePath as string;
    if (!filePath || !existsSync(filePath)) {
      missing++;
      continue;
    }

    const meta = scanPsd(filePath);
    if (!meta) {
      failed++;
      console.log(`  ✗ scan failed: ${doc.fileName}`);
      continue;
    }

    await col.updateOne(
      { _id: doc._id },
      { $set: { smartObjects: meta.smartObjects, adjustments: meta.adjustments, scannedAt: meta.scannedAt } }
    );
    updated++;

    if (updated % 25 === 0) {
      const rate = updated / ((Date.now() - t0) / 1000);
      console.log(`  ${i + 1}/${docs.length} — ${updated} updated (${rate.toFixed(1)}/s)`);
    }
  }

  console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(0)}s. Updated: ${updated}, já tinham linkId: ${skippedDone}, arquivo ausente: ${missing}, falhas: ${failed}`);
  await client.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
