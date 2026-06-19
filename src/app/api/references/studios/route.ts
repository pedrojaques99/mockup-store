import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { listPhotoScenes } from "@/lib/agent-mockup";

// Estúdios que viraram lixo na ingestão (nomes de arquivo, não de estúdio).
const FILE_LIKE = /\.(png|jpe?g|gif|webp|psd|psb|tiff?)$/i;

export async function GET() {
  const counts = new Map<string, number>();
  // Mongo (PSDs + cenas publicadas) — resiliente.
  try {
    const db = await getDb();
    const studios = await db
      .collection("community_presets")
      .aggregate([
        {
          $match: {
            category: "reference",
            isAdminCurated: true,
            $or: [
              { psdFileName: { $exists: true, $nin: [null, ""] } },
              { psdPath: { $exists: true, $nin: [null, ""] } },
              { type: "photo" },
            ],
          },
        },
        { $group: { _id: "$studio", count: { $sum: 1 } } },
      ])
      .toArray();
    for (const s of studios) {
      const name = s._id || "Unknown";
      if (!FILE_LIKE.test(name)) counts.set(name, (counts.get(name) ?? 0) + s.count);
    }
  } catch (e) {
    console.error("[studios] Mongo indisponível:", e instanceof Error ? e.message : e);
  }

  // Filesystem: só as não-publicadas (.tmp = "Local"); as publicadas já vêm do Mongo.
  try {
    const local = (await listPhotoScenes()).filter((s) => !s.published).length;
    if (local) counts.set("Local", (counts.get("Local") ?? 0) + local);
  } catch { /* sem filesystem — ok */ }

  return NextResponse.json(
    [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count)
  );
}
