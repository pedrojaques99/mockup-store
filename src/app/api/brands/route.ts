import { NextResponse } from "next/server";
import { listBrandGuidelines } from "@/lib/visant";

export async function GET() {
  try {
    const brands = await listBrandGuidelines();
    return NextResponse.json({ brands });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
