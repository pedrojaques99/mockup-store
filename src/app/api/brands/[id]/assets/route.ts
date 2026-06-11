import { NextRequest, NextResponse } from "next/server";
import { getBrandGuideline } from "@/lib/visant";

// GET /api/brands/:id/assets -> Lista todos os logos/assets da marca para a library
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const guideline = await getBrandGuideline(id);
    const logos = guideline.logos || [];
    
    // Formata para a UI da library
    const assets = logos.map((l, i) => {
      // Proxy server-side: evita CORS/auth/expiração das URLs diretas da Visant.
      const proxy = `/api/brands/${id}/logo?variant=${l.variant}&assetId=${l.id}`;
      return {
        // id pode vir duplicado/vazio da Visant — garante chave única na UI
        id: l.id ? `${l.id}-${i}` : `${l.variant}-${i}`,
        url: proxy,
        directUrl: l.url,
        variant: l.variant,
        label: l.label || l.variant,
        format: l.format,
        thumbnail: proxy,
      };
    });

    return NextResponse.json({
      brandName: guideline.identity?.name,
      assets
    }, {
      headers: {
        "Cache-Control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=7200"
      }
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
