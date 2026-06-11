import { NextRequest, NextResponse } from "next/server";
import { getBrandGuideline, pickLogo, type VisantLogo } from "@/lib/visant";

// Proxy do logo da marca: evita CORS e mantém a API key no servidor.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const variant = req.nextUrl.searchParams.get("variant") as
    | VisantLogo["variant"]
    | null;
  const assetId = req.nextUrl.searchParams.get("assetId");

  try {
    const guideline = await getBrandGuideline(id);
    let logo: VisantLogo | undefined;
    
    if (assetId) {
      logo = guideline.logos?.find(l => l.id === assetId);
    }
    
    if (!logo) {
      logo = pickLogo(guideline, variant || undefined);
    }
    if (!logo?.url) {
      return NextResponse.json({ error: "Marca sem logo" }, { status: 404 });
    }

    const upstream = await fetch(logo.url, {
      next: { revalidate: 3600 } // Next.js cache hints
    });
    
    if (!upstream.ok) {
      return NextResponse.json(
        { error: `Falha ao baixar logo (${upstream.status})` },
        { status: 502 }
      );
    }
    
    const buf = await upstream.arrayBuffer();
    const contentType = upstream.headers.get("content-type") || "image/png";
    const etag = upstream.headers.get("etag") || `W/"${logo.id}"`;

    // 304 Not Modified check
    if (req.headers.get("if-none-match") === etag) {
      return new NextResponse(null, { status: 304 });
    }

    return new NextResponse(buf, {
      headers: {
        "Content-Type": contentType,
        "ETag": etag,
        // Cache agressivo no browser e no Edge (Vercel/CDN)
        // s-maxage=2592000 (30 dias) no CDN, mas revalida em background (stale-while-revalidate)
        "Cache-Control": "public, max-age=3600, s-maxage=2592000, stale-while-revalidate=86400",
        "X-Logo-Variant": logo.variant,
        "X-Asset-ID": logo.id,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
