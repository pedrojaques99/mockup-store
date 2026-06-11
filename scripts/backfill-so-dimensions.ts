/**
 * Populates soInnerWidth / soInnerHeight on community_presets documents
 * by matching each ref to psd_metadata using the same fuzzy logic as
 * findPsdForRef in src/lib/psd-index.ts.
 *
 * Run: npx tsx --env-file=.env.local scripts/backfill-so-dimensions.ts
 */

import { MongoClient } from "mongodb";
import { SO_TARGET } from "../src/lib/psd-constants";

const uri = process.env.MONGODB_URI!;
const dbName = process.env.MONGODB_DB_NAME!;

interface SmartObjectMeta {
  name: string;
  path: string;
  innerWidth: number;
  innerHeight: number;
  layerLeft: number;
  layerTop: number;
  layerRight: number;
  layerBottom: number;
}

interface PsdMeta {
  fileName: string;
  smartObjects: SmartObjectMeta[];
}

// Same normalize as psd-index.ts
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s*média$/i, "")
    .replace(/-?preview$/i, "")
    .replace(/[-_\s.]+/g, "")
    .trim();
}

function buildIndex(psds: PsdMeta[]): Map<string, PsdMeta> {
  const map = new Map<string, PsdMeta>();
  for (const p of psds) {
    map.set(p.fileName.toLowerCase(), p);
    map.set(normalize(p.fileName), p);
  }
  return map;
}

// Same matching logic as findPsdForRef
function findMeta(index: Map<string, PsdMeta>, all: PsdMeta[], refName: string, studio?: string): PsdMeta | null {
  let cleaned = refName;
  if (studio === "Mockups Maison" || refName.startsWith("MM_") || refName.startsWith("MM ")) {
    cleaned = refName.replace(/\s*Média$/i, "").trim();
  } else if (studio === "Hazard Mockups" || refName.startsWith("HM_")) {
    cleaned = refName.replace(/-?preview$/i, "").trim();
  }

  if (/^\d+$/.test(cleaned) || cleaned.length < 4) return null;

  const exactLower = index.get(cleaned.toLowerCase());
  if (exactLower) return exactLower;

  const normRef = normalize(cleaned);
  if (normRef.length < 5) return null;

  const normMatch = index.get(normRef);
  if (normMatch) return normMatch;

  if (normRef.length >= 8) {
    const partial = all.find((p) => {
      const pNorm = normalize(p.fileName);
      return pNorm.length >= 8 && (pNorm.includes(normRef) || normRef.includes(pNorm));
    });
    if (partial) return partial;
  }

  return null;
}

function pickSo(sos: SmartObjectMeta[], preferredName?: string): SmartObjectMeta | null {
  if (!sos.length) return null;

  if (preferredName) {
    const exact = sos.find((s) => s.path === preferredName || s.name === preferredName);
    if (exact) return exact;
    const partial = sos.find(
      (s) =>
        s.path?.toLowerCase().includes(preferredName.toLowerCase()) ||
        s.name?.toLowerCase().includes(preferredName.toLowerCase())
    );
    if (partial) return partial;
  }

  if (sos.length === 1) return sos[0];

  const byPattern = sos.find((s) => SO_TARGET.test(s.name) || SO_TARGET.test(s.path));
  if (byPattern) return byPattern;

  return sos.reduce((best, s) => {
    const area = (s.layerRight - s.layerLeft) * (s.layerBottom - s.layerTop);
    const bestArea = (best.layerRight - best.layerLeft) * (best.layerBottom - best.layerTop);
    return area > bestArea ? s : best;
  });
}

async function main() {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);

  // Load all psd_metadata into memory
  const allMeta = await db
    .collection("psd_metadata")
    .find({}, { projection: { fileName: 1, smartObjects: 1 } })
    .toArray() as unknown as PsdMeta[];

  console.log(`Loaded ${allMeta.length} psd_metadata entries`);

  const index = buildIndex(allMeta);

  const refs = await db
    .collection("community_presets")
    .find({
      category: "reference",
      $or: [{ soInnerWidth: { $exists: false } }, { soInnerHeight: { $exists: false } }],
    })
    .toArray();

  console.log(`Processing ${refs.length} refs without SO dimensions…`);

  let updated = 0;
  let skipped = 0;

  for (const ref of refs) {
    const meta = findMeta(index, allMeta, ref.name as string, ref.studio as string | undefined);
    if (!meta?.smartObjects?.length) { skipped++; continue; }

    const so = pickSo(meta.smartObjects, ref.smartObjectName as string | undefined);
    if (!so?.innerWidth || !so?.innerHeight) { skipped++; continue; }

    await db.collection("community_presets").updateOne(
      { _id: ref._id },
      { $set: { soInnerWidth: so.innerWidth, soInnerHeight: so.innerHeight } }
    );
    updated++;
  }

  console.log(`Done. Updated: ${updated}, Skipped: ${skipped}`);
  await client.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
