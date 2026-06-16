import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { existsSync } from "fs";

export async function GET(req: NextRequest) {
  const filePath = req.nextUrl.searchParams.get("path");
  if (!filePath || filePath.includes("..")) {
    return NextResponse.json({ error: "invalid path" }, { status: 400 });
  }

  if (!existsSync(filePath)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const buf = await readFile(filePath);

  return new NextResponse(buf, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Cache-Control": "private, max-age=300",
    },
  });
}
