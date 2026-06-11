import { NextRequest, NextResponse } from "next/server";
import { requireAgentAuth } from "@/lib/agent-auth";
import { suggestForBrand } from "@/lib/suggest-core";

// GET /api/agent/v1/suggest?brandId=…&limit=…&has_psd=…
// Resposta compacta pensada pra consumo por LLM (sem campos pesados).
export async function GET(req: NextRequest) {
  const denied = requireAgentAuth(req);
  if (denied) return denied;

  const { searchParams } = req.nextUrl;
  const brandId = searchParams.get("brandId");
  if (!brandId) {
    return NextResponse.json({ error: "brandId é obrigatório" }, { status: 400 });
  }

  const llmProvider = req.headers.get("x-llm-provider") || "anthropic";
  const llmKey = req.headers.get("x-llm-key") || req.headers.get("x-anthropic-key") || undefined;

  try {
    const result = await suggestForBrand(brandId, {
      limit: parseInt(searchParams.get("limit") || "12"),
      // Agente quer renderizar — default só refs com PSD no disco
      onlyPsd: searchParams.get("has_psd") !== "false",
      force: searchParams.get("refresh") === "true",
      llmKey,
      llmProvider,
    });

    return NextResponse.json({
      brand: result.brand,
      profile: { dims: result.profile.dims, source: result.profile.source },
      total: result.total,
      suggestions: result.suggestions.map((s) => ({
        refId: s.ref.id,
        name: s.ref.name,
        studio: s.ref.studio,
        score: Math.round(s.score * 100) / 100,
        reasons: s.reasons,
        hasPsd: !!s.ref.psdPath,
        smartObjectName: s.ref.smartObjectName || undefined,
        imageUrl: s.ref.referenceImageUrl || undefined,
      })),
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
