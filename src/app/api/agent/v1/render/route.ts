import { NextRequest, NextResponse } from "next/server";
import { existsSync } from "fs";
import { requireAgentAuth } from "@/lib/agent-auth";
import { getDb } from "@/lib/db";
import { findPsdForRef } from "@/lib/psd-index";
import { getBrandGuideline, pickLogo, type VisantLogo } from "@/lib/visant";
import { frameArt } from "@/lib/server-frame";
import { startRenderJob, awaitJob } from "@/lib/render-client";
import type { FitMode } from "@/lib/art-frame";

interface AgentRenderBody {
  // Arte: URL explícita OU logo da marca (brandId)
  brandId?: string;
  artUrl?: string;
  assetId?: string; // ID específico do asset na Visant
  logoVariant?: VisantLogo["variant"];
  // Mockup: refId da biblioteca OU psdPath direto
  refId?: string;
  psdPath?: string;
  // Opções
  smartObject?: string;
  mode?: FitMode;
  bg?: string | null;
  padding?: number;
  hideLayers?: string[];
  preview?: boolean;
  /** true = espera o render terminar e devolve o status final */
  wait?: boolean;
}

interface SmartObjectMeta {
  name: string;
  innerWidth?: number;
  innerHeight?: number;
}

// POST /api/agent/v1/render — renderiza um mockup sem UI.
// Exemplo mínimo: { "brandId": "…", "refId": "…" } → logo da marca aplicado no PSD.
export async function POST(req: NextRequest) {
  const denied = requireAgentAuth(req);
  if (denied) return denied;

  let body: AgentRenderBody;
  try {
    body = (await req.json()) as AgentRenderBody;
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  try {
    // ── 1. Resolve o PSD ──────────────────────────────────────────────
    let psdPath = body.psdPath || "";
    let refSmartObject: string | undefined;

    if (!psdPath && body.refId) {
      const db = await getDb();
      const ref = await db.collection("community_presets").findOne(
        { id: body.refId, category: "reference" },
        { projection: { name: 1, studio: 1, psdFileName: 1, psdPath: 1, smartObjectName: 1 } }
      );
      if (!ref) {
        return NextResponse.json({ error: `Referência não encontrada: ${body.refId}` }, { status: 404 });
      }
      refSmartObject = ref.smartObjectName;
      psdPath = ref.psdPath || "";
      if (!psdPath) {
        const psd = findPsdForRef(ref.psdFileName || ref.name, ref.studio);
        if (psd) psdPath = psd.path;
      }
    }

    if (!psdPath) {
      return NextResponse.json(
        { error: "Informe refId (com PSD na biblioteca) ou psdPath" },
        { status: 400 }
      );
    }
    if (!existsSync(psdPath)) {
      return NextResponse.json({ error: `PSD não encontrado no disco: ${psdPath}` }, { status: 404 });
    }

    // ── 2. Metadados do smart object (pra enquadrar a arte) ──────────
    const psdName = psdPath.split(/[\\/]/).pop()?.replace(/\.psd$/i, "") || "";
    const db = await getDb();
    const meta = await db.collection("psd_metadata").findOne({ fileName: psdName });
    const smartObjects: SmartObjectMeta[] = meta?.smartObjects || [];

    let so: SmartObjectMeta | undefined;
    const wanted = body.smartObject || refSmartObject;
    if (wanted) {
      so =
        smartObjects.find((s) => s.name === wanted) ||
        smartObjects.find((s) => s.name.toLowerCase().includes(wanted.toLowerCase()));
    }
    if (!so && smartObjects.length) so = smartObjects[0];
    const smartObjectName = so?.name || wanted || "Your design";

    // ── 3. Resolve a arte (URL explícita ou logo da marca) ───────────
    let artSourceUrl = body.artUrl || "";
    let isLogo = false;
    if (!artSourceUrl) {
      if (!body.brandId) {
        return NextResponse.json({ error: "Informe artUrl ou brandId" }, { status: 400 });
      }
      const guideline = await getBrandGuideline(body.brandId);
      let logo: VisantLogo | undefined;
      
      if (body.assetId) {
        logo = guideline.logos?.find(l => l.id === body.assetId);
      }
      
      if (!logo) {
        logo = pickLogo(guideline, body.logoVariant);
      }
      if (!logo?.url) {
        return NextResponse.json({ error: "Marca sem logo cadastrado" }, { status: 404 });
      }
      artSourceUrl = logo.url;
      isLogo = true;
    }

    const artRes = await fetch(artSourceUrl);
    if (!artRes.ok) {
      return NextResponse.json(
        { error: `Falha ao baixar a arte (${artRes.status}): ${artSourceUrl}` },
        { status: 502 }
      );
    }
    let artBuffer: Buffer = Buffer.from(await artRes.arrayBuffer());

    // ── 4. Enquadra no aspect do SO (logo = contain com margem) ──────
    if (so?.innerWidth && so?.innerHeight) {
      artBuffer = await frameArt(artBuffer, so.innerWidth, so.innerHeight, {
        mode: body.mode || (isLogo ? "contain" : "cover"),
        bg: body.bg ?? null,
        padding: body.padding ?? (isLogo ? 0.12 : 0),
      });
    }

    // ── 5. Render ─────────────────────────────────────────────────────
    const job = await startRenderJob({
      psdPath,
      artBuffer,
      smartObject: smartObjectName,
      hideLayers: body.hideLayers,
      preview: body.preview === true,
    });

    const jobUrl = `/api/agent/v1/jobs/${job.jobId}`;
    if (body.wait) {
      const final = await awaitJob(job.jobId);
      return NextResponse.json({
        ...(final || job),
        smartObject: smartObjectName,
        psdPath,
        statusUrl: jobUrl,
        imageUrl: final?.status === "done" ? `${jobUrl}?format=png` : undefined,
      });
    }

    return NextResponse.json(
      {
        ...job,
        smartObject: smartObjectName,
        psdPath,
        statusUrl: jobUrl,
        imageUrl: `${jobUrl}?format=png`,
      },
      { status: 202 }
    );
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
