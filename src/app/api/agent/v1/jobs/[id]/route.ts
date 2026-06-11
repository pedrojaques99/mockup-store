import { NextRequest, NextResponse } from "next/server";
import { existsSync } from "fs";
import { readFile } from "fs/promises";
import { requireAgentAuth } from "@/lib/agent-auth";
import { readJobStatus, jobOutputPath } from "@/lib/render-client";

// GET /api/agent/v1/jobs/:id            → status JSON
// GET /api/agent/v1/jobs/:id?format=png    → bytes da imagem (quando pronta)
// GET /api/agent/v1/jobs/:id?format=base64 → JSON com data URL (quando pronta)
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = requireAgentAuth(req);
  if (denied) return denied;

  const { id } = await params;
  const status = await readJobStatus(id);
  if (!status) {
    return NextResponse.json({ error: "Job não encontrado ou expirado (TTL 30 min)" }, { status: 404 });
  }

  const format = req.nextUrl.searchParams.get("format");
  const outputPath = jobOutputPath(id);
  const ready = status.status === "done" && existsSync(outputPath);

  if (format === "png" || format === "base64") {
    if (!ready) {
      return NextResponse.json(
        { ...status, error: status.error || "Render ainda não concluído" },
        { status: status.status === "error" ? 500 : 425 }
      );
    }
    const buf = await readFile(outputPath);
    const isJpeg = buf[0] === 0xff && buf[1] === 0xd8;
    const mime = isJpeg ? "image/jpeg" : "image/png";

    if (format === "base64") {
      return NextResponse.json({
        ...status,
        mime,
        dataUrl: `data:${mime};base64,${buf.toString("base64")}`,
      });
    }
    return new NextResponse(buf, {
      headers: {
        "Content-Type": mime,
        "Cache-Control": "private, max-age=1800",
        "Content-Disposition": `inline; filename="render-${id.slice(0, 8)}.${isJpeg ? "jpg" : "png"}"`,
      },
    });
  }

  return NextResponse.json({
    ...status,
    imageUrl: ready ? `/api/agent/v1/jobs/${id}?format=png` : undefined,
  });
}
