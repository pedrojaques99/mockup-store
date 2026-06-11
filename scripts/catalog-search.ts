/** Busca no psd_metadata por grupos de palavra-chave. Uso: npx tsx --env-file=.env.local scripts/catalog-search.ts */
import { MongoClient } from "mongodb";

const GROUPS: Record<string, string[]> = {
  "OOH / billboard / urbano": ["billboard", "outdoor", "banner", "urban", "wall", "subway", "metro", "\\bbus\\b", "street", "hoarding", "mupi", "facade"],
  "Pôster / quadro / vitrine": ["poster", "frame", "store", "window", "a-frame", "stand", "easel"],
  "Device / celular / social": ["phone", "iphone", "story", "instagram", "social", "device", "mobile", "screen"],
  "Web / laptop / desktop": ["macbook", "laptop", "browser", "imac", "desktop", "monitor"],
  "Retail físico": ["\\bbag\\b", "tag", "shirt", "jersey", "tshirt", "\\bbox\\b", "cap", "tote", "sticker", "hoodie", "mug", "bottle"],
};

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI!);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB_NAME!);
  const col = db.collection("psd_metadata");

  for (const [label, kws] of Object.entries(GROUPS)) {
    const regex = kws.join("|");
    const docs = await col
      .find({ fileName: { $regex: regex, $options: "i" } })
      .project({ fileName: 1, folder: 1, smartObjects: 1 })
      .limit(10)
      .toArray();
    const total = await col.countDocuments({ fileName: { $regex: regex, $options: "i" } });
    console.log(`\n### ${label} — ${total} PSDs`);
    for (const d of docs) {
      const faces = (d.smartObjects || []).filter((s: { name: string }) => !/sombra|shadow|luz|light|grain|\[boxy\]|base|mesh|textur/i.test(s.name || "")).length;
      console.log(`  ${d.fileName}  (${d.folder})${faces > 1 ? `  [${faces} faces]` : ""}`);
    }
  }
  await client.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
