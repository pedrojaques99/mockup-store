import { NextResponse } from "next/server";
import { getAllPsds } from "@/lib/psd-index";

export async function GET() {
  const psds = getAllPsds();
  return NextResponse.json({
    total: psds.length,
    totalSizeGB: +(psds.reduce((s, p) => s + p.sizeBytes, 0) / 1e9).toFixed(2),
    psds: psds.map((p) => ({
      name: p.name,
      folder: p.folder,
      path: p.path,
      sizeMB: +(p.sizeBytes / 1e6).toFixed(1),
    })),
  });
}
