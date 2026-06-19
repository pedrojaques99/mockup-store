import { NextRequest, NextResponse } from "next/server";
import { existsSync } from "fs";
import { join } from "path";
import { getDb } from "@/lib/db";
import { findPsdForRef } from "@/lib/psd-index";
import { listPhotoScenes } from "@/lib/agent-mockup";

let textIndexEnsured = false;

const PREVIEW_DIR = join(process.cwd(), "public", "photo-previews");

/**
 * Photo-scenes do FILESYSTEM (data/ + .tmp/) como itens do grid — Mongo + local juntos.
 * Thumbnail = /photo-previews/<id>.png (gerado por `photo-agent previews`). Aplica os
 * mesmos filtros (studio/search/tags) e pula ids já vindos do Mongo (publicada vence).
 */
async function filesystemPhotoRefs(opts: { search: string; studio: string; tags: string[]; tagMode: "AND" | "OR"; existingIds: Set<string> }) {
  const scenes = await listPhotoScenes();
  const q = opts.search.toLowerCase();
  const matchTag = (surfaceType: string, studio: string, t: string) =>
    t === surfaceType || t === studio || t === "photo" || t === "local";
  return scenes
    .filter((s) => !opts.existingIds.has(s.id))
    .map((s) => ({ s, studio: s.published ? "Photo Scene" : "Local" }))
    .filter(({ s, studio }) => {
      if (opts.studio && studio !== opts.studio) return false;
      if (q && !s.name.toLowerCase().includes(q) && !s.surfaceType.toLowerCase().includes(q)) return false;
      if (opts.tags.length) {
        const ok = opts.tagMode === "OR"
          ? opts.tags.some((t) => matchTag(s.surfaceType, studio, t))
          : opts.tags.every((t) => matchTag(s.surfaceType, studio, t));
        if (!ok) return false;
      }
      return true;
    })
    .map(({ s, studio }) => ({
      id: s.id,
      name: s.name.replace(/\.[^.]+$/, ""),
      studio,
      description: `${s.surfaceType} photo mockup`,
      referenceImageUrl: existsSync(join(PREVIEW_DIR, `${s.id}.png`)) ? `/photo-previews/${s.id}.png` : undefined,
      dimensions: { mockup_type: [s.surfaceType] },
      tags: [s.surfaceType, "photo", studio === "Local" ? "local" : "publicada"],
      type: "photo" as const,
      photoSceneId: s.id,
    }));
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const page = parseInt(searchParams.get("page") || "1");
  const limit = Math.min(parseInt(searchParams.get("limit") || "60"), 200);
  const search = searchParams.get("search") || "";
  const studio = searchParams.get("studio") || "";
  // Multi-tag: `tags` (CSV, até 5) com modo AND/OR. Mantém compat com `tag`.
  const tags = (searchParams.get("tags") || searchParams.get("tag") || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 5);
  const tagMode = searchParams.get("tagMode") === "OR" ? "OR" : "AND";
  const hasPsd = searchParams.get("has_psd") === "true";

  const TAG_DIMS = ["niche", "style", "vibe", "material", "mockup_type", "setting", "color_palette"];
  // Uma tag casa em `tags` flat OU em qualquer dimensão.
  const tagCond = (t: string) => [
    { tags: t },
    ...TAG_DIMS.map((dim) => ({ [`dimensions.${dim}`]: t })),
  ];

  const filter: Record<string, unknown> = {
    category: "reference",
    isAdminCurated: true,
  };

  if (studio) filter.studio = studio;

  // Busca: text search (≥3 chars, com stemming/peso) ou regex pra termos curtos.
  const searchCond = search
    ? search.length >= 3
      ? { $text: { $search: search } }
      : {
          $or: [
            { name: { $regex: search, $options: "i" } },
            { description: { $regex: search, $options: "i" } },
            { tags: { $regex: search, $options: "i" } },
          ],
        }
    : null;
  const hasText = !!(searchCond && "$text" in searchCond);

  // Combina busca + tags via $and top-level (preserva category/isAdminCurated).
  const and: Record<string, unknown>[] = [];
  if (searchCond) and.push(searchCond);
  if (tags.length) {
    if (tagMode === "OR") {
      and.push({ $or: tags.flatMap(tagCond) });
    } else {
      for (const t of tags) and.push({ $or: tagCond(t) });
    }
  }
  if (and.length) filter.$and = and;

  const fetchLimit = hasPsd ? 500 : limit;
  const skip = hasPsd ? 0 : (page - 1) * limit;

  // Mongo é a fonte das PSDs + cenas publicadas. Resiliente: se cair, segue só com o
  // filesystem (a UI nunca fica em skeleton eterno).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let enriched: any[] = [];
  let totalRaw = 0;
  try {
    const db = await getDb();
    const col = db.collection("community_presets");

    if (!textIndexEnsured) {
      try {
        await col.createIndex(
          { name: "text", description: "text", tags: "text" },
          { name: "mockup_search", default_language: "portuguese", weights: { name: 10, tags: 5, description: 1 } }
        );
      } catch { /* index já existe — fine */ }
      textIndexEnsured = true;
    }

    const projection: Record<string, number> = {
      id: 1, name: 1, studio: 1, description: 1,
      referenceImageUrl: 1, dimensions: 1, tags: 1,
      psdFileName: 1, psdPath: 1, smartObjectName: 1, soInnerWidth: 1, soInnerHeight: 1,
      type: 1, photoSceneId: 1,
    };
    const useTextScore = hasText;
    if (useTextScore) projection.score = { $meta: "textScore" } as unknown as number;
    const sort: Record<string, unknown> = useTextScore ? { score: { $meta: "textScore" } } : { name: 1 };

    const [references, count] = await Promise.all([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      col.find(filter, { projection }).sort(sort as any).skip(skip).limit(fetchLimit).toArray(),
      col.countDocuments(filter),
    ]);
    totalRaw = count;
    enriched = references.map((ref) => {
      if (!ref.psdPath && ref.psdFileName) {
        const psd = findPsdForRef(ref.psdFileName, ref.studio);
        if (psd) return { ...ref, psdPath: psd.path, psdSizeBytes: psd.sizeBytes };
      }
      if (!ref.psdFileName) {
        const psd = findPsdForRef(ref.name, ref.studio);
        if (psd) return { ...ref, psdFileName: psd.name, psdPath: psd.path, psdSizeBytes: psd.sizeBytes };
      }
      return ref;
    });
  } catch (e) {
    console.error("[references] Mongo indisponível — usando só o filesystem:", e instanceof Error ? e.message : e);
  }

  if (hasPsd) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const withPsd = enriched.filter((r) => r.psdPath || (r as any).type === "photo");
    // Mescla as photo-scenes do filesystem (dedup por id — publicada/Mongo vence).
    const existingIds = new Set<string>(withPsd.flatMap((r) => [r.id, r.photoSceneId].filter(Boolean)));
    const fsRefs = await filesystemPhotoRefs({ search, studio, tags, tagMode, existingIds });
    const merged = [...withPsd, ...fsRefs].sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
    const start = (page - 1) * limit;
    return NextResponse.json({
      references: merged.slice(start, start + limit),
      total: merged.length,
      page,
      pages: Math.ceil(merged.length / limit),
    });
  }

  return NextResponse.json({ references: enriched, total: totalRaw, page, pages: Math.ceil(totalRaw / limit) });
}
