import { MongoClient } from "mongodb";
async function main() {
  const client = new MongoClient(process.env.MONGODB_URI!);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB_NAME!);
  const sample = await db.collection("psd_metadata")
    .find({ filePath: { $regex: "Hazard", $options: "i" } })
    .limit(5).toArray();
  console.log("Hazard in psd_metadata:", sample.length);
  sample.forEach((m) => console.log(" ", m.fileName, "|", m.filePath));

  const hmSample = await db.collection("psd_metadata")
    .find({ fileName: { $regex: "^HM_", $options: "i" } })
    .limit(5).toArray();
  console.log("\nHM_ in psd_metadata:", hmSample.length);
  hmSample.forEach((m) => console.log(" ", m.fileName));
  await client.close();
}
main().catch(console.error);
