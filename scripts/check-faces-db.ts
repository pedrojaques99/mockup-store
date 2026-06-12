/** Confere faces calculadas a partir do psd_metadata do banco.
 * Run: npx tsx --env-file=.env.local scripts/check-faces-db.ts <fileName>
 */
import { MongoClient } from "mongodb";
import { computeFaces } from "@visant/psd-engine";

async function main() {
  const fileName = process.argv[2] || "BOX_ISOLATED";
  const client = new MongoClient(process.env.MONGODB_URI!);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB_NAME!);
  const meta = await db.collection("psd_metadata").findOne({ fileName });
  if (!meta) { console.log("não encontrado:", fileName); await client.close(); return; }
  const sos = (meta.smartObjects || []) as Array<{ name: string; linkId?: string; hidden?: boolean }>;
  console.log("SOs:", sos.map((s) => `${s.name}${s.linkId ? ` [${s.linkId.slice(0, 8)}]` : " [sem linkId]"}${s.hidden ? " (hidden)" : ""}`).join(", "));
  console.log("faces:", JSON.stringify(computeFaces(sos as never), null, 1));
  await client.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
