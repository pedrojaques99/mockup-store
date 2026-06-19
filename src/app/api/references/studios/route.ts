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

  // Filesystem não-publicadas: agrupa pelo `studio` da cena (settings.json) ou "Local".
  try {
    for (const s of (await listPhotoScenes()).filter((x) => !x.published)) {
      const studio = s.studio || "Local";
      counts.set(studio, (counts.get(studio) ?? 0) + 1);
    }
  } catch { /* sem filesystem — ok */ }

  return NextResponse.json(
    [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count)
  );
}
