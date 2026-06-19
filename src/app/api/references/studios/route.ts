import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

// Estúdios que viraram lixo na ingestão (nomes de arquivo, não de estúdio).
const FILE_LIKE = /\.(png|jpe?g|gif|webp|psd|psb|tiff?)$/i;

export async function GET() {
  const db = await getDb();
  const studios = await db
    .collection("community_presets")
    .aggregate([
      {
        $match: {
          category: "reference",
          isAdminCurated: true,
          // Só conta o que é mockup de verdade (tem PSD) ou cena-foto.
          $or: [
            { psdFileName: { $exists: true, $nin: [null, ""] } },
            { psdPath: { $exists: true, $nin: [null, ""] } },
            { type: "photo" },
          ],
        },
      },
      { $group: { _id: "$studio", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ])
    .toArray();

  return NextResponse.json(
    studios
      .map((s) => ({ name: s._id || "Unknown", count: s.count }))
      // Descarta nomes que parecem arquivo (ex: "halftone-export.png").
      .filter((s) => !FILE_LIKE.test(s.name))
  );
}
