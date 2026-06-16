import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { findPsdForRef } from "@/lib/psd-index";

let textIndexEnsured = false;

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const page = parseInt(searchParams.get("page") || "1");
  const limit = Math.min(parseInt(searchParams.get("limit") || "60"), 200);
  const search = searchParams.get("search") || "";
  const studio = searchParams.get("studio") || "";
  const tag = searchParams.get("tag") || "";
  const hasPsd = searchParams.get("has_psd") === "true";

  const db = await getDb();
  const col = db.collection("community_presets");

  if (!textIndexEnsured) {
    try {
      await col.createIndex(
        { name: "text", description: "text", tags: "text" },
        { name: "mockup_search", default_language: "portuguese", weights: { name: 10, tags: 5, description: 1 } }
      );
    } catch {
      // index already exists or different config — fine
    }
    textIndexEnsured = true;
  }

  const filter: Record<string, unknown> = {
    category: "reference",
    isAdminCurated: true,
  };

  if (search) {
    // Try text search first (supports stemming, language, weighted fields)
    // Fall back to regex for short queries or partial matches
    if (search.length >= 3) {
      filter.$text = { $search: search };
    } else {
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
        { tags: { $regex: search, $options: "i" } },
      ];
    }
  }

  if (studio) filter.studio = studio;
  if (tag) {
    // Support filtering by dimension value across all dimension keys, or by flat tags
    filter.$or = [
      ...(Array.isArray(filter.$or) ? filter.$or : []),
      { tags: tag },
      ...["niche", "style", "vibe", "material", "mockup_type", "setting", "color_palette"].map(
        (dim) => ({ [`dimensions.${dim}`]: tag })
      ),
    ];
    // If we already have $or from search, merge them with $and
    if (search && filter.$or) {
      const searchCondition = search.length >= 3
        ? { $text: { $search: search } }
        : {
            $or: [
              { name: { $regex: search, $options: "i" } },
              { description: { $regex: search, $options: "i" } },
              { tags: { $regex: search, $options: "i" } },
            ],
          };
      delete filter.$text;
      delete filter.$or;
      filter.$and = [
        searchCondition,
        {
          $or: [
            { tags: tag },
            ...["niche", "style", "vibe", "material", "mockup_type", "setting", "color_palette"].map(
              (dim) => ({ [`dimensions.${dim}`]: tag })
            ),
          ],
        },
      ];
    }
  }

  const fetchLimit = hasPsd ? 500 : limit;
  const skip = hasPsd ? 0 : (page - 1) * limit;

  const projection: Record<string, number> = {
    id: 1, name: 1, studio: 1, description: 1,
    referenceImageUrl: 1, dimensions: 1, tags: 1,
    psdFileName: 1, psdPath: 1, smartObjectName: 1, soInnerWidth: 1, soInnerHeight: 1,
    type: 1, photoSceneId: 1,
  };

  // Add text score for relevance sorting when using $text
  const useTextScore = search.length >= 3 && filter.$text;
  if (useTextScore) projection.score = { $meta: "textScore" } as unknown as number;

  const sort: Record<string, unknown> = useTextScore
    ? { score: { $meta: "textScore" } }
    : { name: 1 };

  const [references, totalRaw] = await Promise.all([
    col
      .find(filter, { projection })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .sort(sort as any)
      .skip(skip)
      .limit(fetchLimit)
      .toArray(),
    col.countDocuments(filter),
  ]);

  const enriched = references.map((ref) => {
    if (!ref.psdPath && ref.psdFileName) {
      const psd = findPsdForRef(ref.psdFileName, ref.studio);
      if (psd) return { ...ref, psdPath: psd.path, psdSizeBytes: psd.sizeBytes };
    }
    if (!ref.psdFileName) {
      const psd = findPsdForRef(ref.name, ref.studio);
      if (psd) return { ...ref, psdFileName: psd.name, psdPath: psd.path, psdSizeBytes: psd.sizeBytes };
    }
    return ref;
  });

  if (hasPsd) {
    const withPsd = enriched.filter((r) => r.psdPath || (r as any).type === "photo");
    const start = (page - 1) * limit;
    const sliced = withPsd.slice(start, start + limit);
    return NextResponse.json({
      references: sliced,
      total: withPsd.length,
      page,
      pages: Math.ceil(withPsd.length / limit),
    });
  }

  return NextResponse.json({
    references: enriched,
    total: totalRaw,
    page,
    pages: Math.ceil(totalRaw / limit),
  });
}
