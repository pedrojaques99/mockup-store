import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";

export async function POST(req: NextRequest) {
  const { path } = await req.json();
  if (!path) return NextResponse.json({ error: "path required" }, { status: 400 });

  const normalized = path.replace(/\//g, "\\");
  exec(`explorer /select,"${normalized}"`);

  return NextResponse.json({ ok: true });
}
