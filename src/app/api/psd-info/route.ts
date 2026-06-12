import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { computeFaces } from "@visant/psd-engine";

export async function GET(req: NextRequest) {
  const fileName = req.nextUrl.searchParams.get("name");
  if (!fileName) {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }

  const db = await getDb();
  const meta = await db.collection("psd_metadata").findOne({ fileName });

  if (!meta) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  return NextResponse.json({
    fileName: meta.fileName,
    width: meta.width,
    height: meta.height,
    sizeBytes: meta.sizeBytes,
    smartObjects: meta.smartObjects,
    adjustments: meta.adjustments,
    faces: computeFaces(meta.smartObjects || []),
  });
}
