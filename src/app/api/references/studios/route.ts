import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET() {
  const db = await getDb();
  const studios = await db
    .collection("community_presets")
    .aggregate([
      { $match: { category: "reference", isAdminCurated: true } },
      { $group: { _id: "$studio", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ])
    .toArray();

  return NextResponse.json(
    studios.map((s) => ({ name: s._id || "Unknown", count: s.count }))
  );
}
