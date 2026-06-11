import { NextRequest, NextResponse } from "next/server";
import { suggestForBrand } from "@/lib/suggest-core";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const brandId = searchParams.get("brandId");
  if (!brandId) {
    return NextResponse.json({ error: "brandId é obrigatório" }, { status: 400 });
  }

  try {
    const result = await suggestForBrand(brandId, {
      limit: parseInt(searchParams.get("limit") || "24"),
      onlyPsd: searchParams.get("has_psd") !== "false",
      force: searchParams.get("refresh") === "true",
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
