// Núcleo das sugestões brand-aware — compartilhado entre /api/suggest (UI)
// e /api/agent/v1/suggest (agente headless).

import { getDb } from "@/lib/db";
import { findPsdForRef } from "@/lib/psd-index";
import { getBrandGuideline } from "@/lib/visant";
import {
  getBrandProfile,
  scoreReference,
  DIMENSIONS,
  type BrandProfile,
  type ScorableRef,
} from "@/lib/brand-match";

const CANDIDATE_LIMIT = 600;
const MAX_PER_STUDIO = 4;

export interface SuggestionItem {
  ref: Record<string, unknown>;
  score: number;
  reasons: string[];
}

export interface SuggestResult {
  brand: { id: string; name: string };
  profile: BrandProfile;
  total: number;
  suggestions: SuggestionItem[];
}

export async function suggestForBrand(
  brandId: string,
  opts: { limit?: number; onlyPsd?: boolean; force?: boolean; llmKey?: string; llmProvider?: string } = {}
): Promise<SuggestResult> {
  const limit = Math.min(opts.limit ?? 24, 60);

  let guideline: any = null;
  let profile: any = null;

  try {
    guideline = await getBrandGuideline(brandId);
  } catch (err) {
    console.error(`[suggest-core] Failed to fetch guideline for ${brandId}:`, err);
    // Se falhar a Visant (ex: 502), tentamos o cache do Mongo como fallback
    if (!opts.force) {
      profile = await getBrandProfile(null, { brandIdFallback: brandId });
    }
    if (!profile) throw err; // Se não tem nem no cache, aí sim estoura
  }

  if (!profile) {
    profile = await getBrandProfile(guideline, {
      force: opts.force,
      llmKey: opts.llmKey,
      llmProvider: opts.llmProvider,
    });
  }

  const brandName = guideline?.identity?.name || profile.brandName || "";

  const db = await getDb();
  const col = db.collection("community_presets");

  // Candidatos: qualquer match de dimensão do perfil OU busca textual por keywords.
  const dimOr = DIMENSIONS.flatMap((dim) =>
    (profile.dims[dim] || []).map((v: string) => ({ [`dimensions.${dim}`]: v }))
  );
  const filter: Record<string, unknown> = {
    category: "reference",
    isAdminCurated: true,
  };
  if (dimOr.length) {
    filter.$or = dimOr;
  } else if (profile.keywords.length) {
    filter.$text = { $search: profile.keywords.join(" ") };
  }

  const projection = {
    id: 1, name: 1, studio: 1, description: 1,
    referenceImageUrl: 1, dimensions: 1, tags: 1,
    psdFileName: 1, psdPath: 1, smartObjectName: 1,
  };

  const candidates = await col.find(filter, { projection }).limit(CANDIDATE_LIMIT).toArray();

  // Resolve PSD local (mesma lógica do /api/references) antes do score —
  // a presença de PSD entra como bônus no ranking.
  const enriched = candidates.map((ref) => {
    if (!ref.psdPath) {
      const psd = findPsdForRef(ref.psdFileName || ref.name, ref.studio);
      if (psd) return { ...ref, psdFileName: psd.name, psdPath: psd.path, psdSizeBytes: psd.sizeBytes };
    }
    return ref;
  });

  const pool = opts.onlyPsd ? enriched.filter((r) => r.psdPath) : enriched;

  const scored = pool
    .map((ref) => {
      const { score, reasons } = scoreReference(ref as unknown as ScorableRef, profile);
      return { ref: ref as unknown as Record<string, unknown>, score, reasons };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  // Diversidade: no topo, evita uma sequência longa do mesmo estúdio.
  const suggestions: SuggestionItem[] = [];
  const studioCount = new Map<string, number>();
  for (const s of scored) {
    const studio = (s.ref.studio as string) || "?";
    const used = studioCount.get(studio) || 0;
    if (used >= MAX_PER_STUDIO && suggestions.length < limit) continue;
    studioCount.set(studio, used + 1);
    suggestions.push(s);
    if (suggestions.length >= limit) break;
  }

  return {
    brand: { id: brandId, name: brandName },
    profile,
    total: scored.length,
    suggestions,
  };
}
