/**
 * GET /api/engine/stats?tenant=<name>
 *
 * Resumo público da engine-pai: versão, samples e IoU médio do `_global`, e do
 * tenant se passado. Usado pela UI pra mostrar transparência ("engine vN • S
 * samples · IoU 0.93") — base do diferencial "produto que aprende".
 */
import { NextRequest, NextResponse } from "next/server";
import { engineStats } from "@/lib/engine-feedback";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const tenant = (req.headers.get("x-tenant") || searchParams.get("tenant") || "").trim() || undefined;
  try {
    const stats = await engineStats(tenant);
    return NextResponse.json(stats, { headers: { "Cache-Control": "no-store" } });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "stats failed" }, { status: 500 });
  }
}
