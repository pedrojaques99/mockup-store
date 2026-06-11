import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET() {
  const db = await getDb();

  const pipeline = [
    { $match: { category: "reference", isAdminCurated: true } },
    { $project: { dimensions: { $objectToArray: "$dimensions" } } },
    { $unwind: "$dimensions" },
    { $unwind: "$dimensions.v" },
    {
      $group: {
        _id: { dim: "$dimensions.k", value: "$dimensions.v" },
        count: { $sum: 1 },
      },
    },
    { $sort: { count: -1 as const } },
  ];

  const raw = await db
    .collection("community_presets")
    .aggregate(pipeline)
    .toArray();

  const tags: Record<string, Array<{ value: string; count: number }>> = {};
  for (const r of raw) {
    const dim = r._id.dim;
    if (!tags[dim]) tags[dim] = [];
    tags[dim].push({ value: r._id.value, count: r.count });
  }

  return NextResponse.json(tags);
}
