// Motor de sugestões brand-aware: traduz a brand guideline para o vocabulário
// de tags da biblioteca (1 chamada LLM cacheada por versão da marca, com
// fallback heurístico) e rankeia referências com score determinístico.

import Anthropic from "@anthropic-ai/sdk";
import { getDb } from "@/lib/db";
import { summarizeBrand, type VisantBrandGuideline } from "@/lib/visant";

export const DIMENSIONS = [
  "niche",
  "mockup_type",
  "style",
  "vibe",
  "material",
  "setting",
  "color_palette",
] as const;

export type Dimension = (typeof DIMENSIONS)[number];

export interface BrandProfile {
  dims: Partial<Record<Dimension, string[]>>;
  keywords: string[];
  avoid: string[];
  source: "llm" | "llm-nvidia" | "heuristic";
}

export type Taxonomy = Partial<Record<Dimension, string[]>>;

export interface ScorableRef {
  name?: string;
  description?: string;
  tags?: string[];
  dimensions?: Record<string, string[]>;
  psdPath?: string;
}

const DIM_WEIGHTS: Record<Dimension, number> = {
  niche: 3,
  mockup_type: 2.5,
  style: 2,
  vibe: 1.5,
  material: 1,
  setting: 1,
  color_palette: 0.5,
};

const KEYWORD_WEIGHT = 0.75;
const AVOID_PENALTY = 2;
const PSD_BONUS = 1.5;

const norm = (s: string) => s.toLowerCase().trim();

/** Score determinístico de uma referência contra o perfil da marca. Puro e testável. */
export function scoreReference(
  ref: ScorableRef,
  profile: BrandProfile
): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  const refDims = ref.dimensions || {};
  for (const dim of DIMENSIONS) {
    const wanted = (profile.dims[dim] || []).map(norm);
    if (!wanted.length) continue;
    const have = (refDims[dim] || []).map(norm);
    const matches = have.filter((v) => wanted.includes(v));
    if (matches.length) {
      score += DIM_WEIGHTS[dim] * matches.length;
      reasons.push(`${dim}: ${matches.join(", ")}`);
    }
  }

  const haystack = norm(
    `${ref.name || ""} ${ref.description || ""} ${(ref.tags || []).join(" ")}`
  );
  const kwMatches = profile.keywords.map(norm).filter((k) => k && haystack.includes(k));
  if (kwMatches.length) {
    score += KEYWORD_WEIGHT * Math.min(kwMatches.length, 4);
    reasons.push(`keywords: ${kwMatches.slice(0, 4).join(", ")}`);
  }

  const allRefValues = [
    ...Object.values(refDims).flat(),
    ...(ref.tags || []),
  ].map(norm);
  const avoidHits = profile.avoid.map(norm).filter((a) => a && allRefValues.includes(a));
  if (avoidHits.length) {
    score -= AVOID_PENALTY * avoidHits.length;
    reasons.push(`evitar: ${avoidHits.join(", ")}`);
  }

  if (ref.psdPath) score += PSD_BONUS;

  return { score, reasons };
}

/** Fallback sem LLM: cruza o texto da marca com o vocabulário real da biblioteca. */
export function buildHeuristicProfile(
  brandText: string,
  taxonomy: Taxonomy
): BrandProfile {
  const text = norm(brandText);
  const dims: BrandProfile["dims"] = {};
  for (const dim of DIMENSIONS) {
    const matched = (taxonomy[dim] || []).filter((v) => {
      const nv = norm(v);
      return nv.length >= 3 && text.includes(nv);
    });
    if (matched.length) dims[dim] = matched.slice(0, 6);
  }
  // Palavras-chave: termos significativos do texto da marca (nome, produto, etc.)
  const keywords = Array.from(
    new Set(
      text
        .split(/[^a-zà-ú0-9]+/i)
        .filter((w) => w.length >= 5)
        .slice(0, 12)
    )
  );
  return { dims, keywords, avoid: [], source: "heuristic" };
}

const PROFILE_SCHEMA = {
  type: "object",
  properties: {
    dims: {
      type: "object",
      properties: Object.fromEntries(
        DIMENSIONS.map((d) => [d, { type: "array", items: { type: "string" } }])
      ),
      required: [...DIMENSIONS],
      additionalProperties: false,
    },
    keywords: {
      type: "array",
      items: { type: "string" },
      description: "Termos de busca livres que descrevem produtos/superfícies ideais para a marca",
    },
    avoid: {
      type: "array",
      items: { type: "string" },
      description: "Tags do vocabulário que NÃO combinam com a marca",
    },
  },
  required: ["dims", "keywords", "avoid"],
  additionalProperties: false,
} as const;

async function buildLlmProfile(
  brandText: string,
  taxonomy: Taxonomy,
  opts?: { key?: string; provider?: string }
): Promise<BrandProfile | null> {
  const provider = opts?.provider || "anthropic";

  if (provider === "nvidia") {
    return buildNvidiaProfile(brandText, taxonomy, opts?.key);
  }

  // Default: Anthropic
  const key = opts?.key || process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const client = new Anthropic({ apiKey: key });

  const vocab = DIMENSIONS.map(
    (d) => `${d}: ${(taxonomy[d] || []).join(", ") || "(vazio)"}`
  ).join("\n");

  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 1500,
      system:
        "Você é um diretor de criação que seleciona mockups físicos (PSD) para marcas. " +
        "Dado o contexto de uma marca e o vocabulário de tags de uma biblioteca de mockups, " +
        "selecione SOMENTE valores que existem no vocabulário fornecido (cópia exata, " +
        "case-sensitive) para cada dimensão. Escolha os mais relevantes para a estética e " +
        "o nicho da marca. Em keywords, dê 4-8 termos livres (produtos, superfícies, contextos) " +
        "para busca textual. Em avoid, liste tags do vocabulário que destoariam da marca.",
      messages: [
        {
          role: "user",
          content: `CONTEXTO DA MARCA:\n${brandText}\n\nVOCABULÁRIO DA BIBLIOTECA:\n${vocab}`,
        },
      ],
      output_config: {
        format: { type: "json_schema", schema: PROFILE_SCHEMA },
      },
    });

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") return null;
    return validateAndCleanProfile(JSON.parse(textBlock.text), taxonomy);
  } catch (err) {
    console.error("[brand-match] Anthropic profile failed:", err);
    return null;
  }
}

async function buildNvidiaProfile(
  brandText: string,
  taxonomy: Taxonomy,
  apiKey?: string
): Promise<BrandProfile | null> {
  const key = apiKey || process.env.NVIDIA_API_KEY;
  if (!key) return null;

  const vocab = DIMENSIONS.map(
    (d) => `${d}: ${(taxonomy[d] || []).join(", ") || "(vazio)"}`
  ).join("\n");

  try {
    const res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: "nvidia/nemotron-3-super-120b-a12b",
        messages: [
          {
            role: "system",
            content:
              "Você é um diretor de criação. Responda APENAS com JSON puro seguindo este schema: " +
              JSON.stringify(PROFILE_SCHEMA) +
              "\nUse EXATAMENTE as tags do vocabulário fornecido.",
          },
          {
            role: "user",
            content: `CONTEXTO DA MARCA:\n${brandText}\n\nVOCABULÁRIO DA BIBLIOTECA:\n${vocab}`,
          },
        ],
        temperature: 0.1,
        response_format: { type: "json_object" },
      }),
    });

    if (!res.ok) throw new Error(`NVIDIA API error: ${res.status}`);
    const data = await res.json();
    const text = data.choices[0].message.content;
    const json = JSON.parse(text.replace(/```json|```/g, "").trim());
    return validateAndCleanProfile(json, taxonomy, "llm-nvidia");
  } catch (err) {
    console.error("[brand-match] NVIDIA profile failed:", err);
    return null;
  }
}

function validateAndCleanProfile(
  parsed: any,
  taxonomy: Taxonomy,
  source: BrandProfile["source"] = "llm"
): BrandProfile {
  const dims: BrandProfile["dims"] = {};
  for (const dim of DIMENSIONS) {
    const allowed = new Set((taxonomy[dim] || []).map(norm));
    const vals = (parsed.dims?.[dim] || []).filter((v: string) => allowed.has(norm(v)));
    if (vals.length) dims[dim] = vals;
  }
  return {
    dims,
    keywords: (parsed.keywords || []).slice(0, 10),
    avoid: (parsed.avoid || []).slice(0, 10),
    source,
  };
}

let taxonomyCache: { data: Taxonomy; at: number } | null = null;
const TAXONOMY_TTL = 24 * 60 * 60 * 1000; // 24h

/** Vocabulário real de tags da biblioteca (mesma agregação do /api/references/tags). */
export async function getTaxonomy(): Promise<Taxonomy> {
  if (taxonomyCache && Date.now() - taxonomyCache.at < TAXONOMY_TTL) {
    return taxonomyCache.data;
  }

  const db = await getDb();
  const raw = await db
    .collection("community_presets")
    .aggregate([
      { $match: { category: "reference", isAdminCurated: true } },
      { $project: { dimensions: { $objectToArray: "$dimensions" } } },
      { $unwind: "$dimensions" },
      { $unwind: "$dimensions.v" },
      { $group: { _id: { dim: "$dimensions.k", value: "$dimensions.v" }, count: { $sum: 1 } } },
      { $sort: { count: -1 as const } },
    ])
    .toArray();

  const taxonomy: Taxonomy = {};
  for (const r of raw) {
    const dim = r._id.dim as Dimension;
    if (!DIMENSIONS.includes(dim)) continue;
    if (!taxonomy[dim]) taxonomy[dim] = [];
    taxonomy[dim]!.push(r._id.value);
  }
  
  taxonomyCache = { data: taxonomy, at: Date.now() };
  return taxonomy;
}

/** Perfil da marca, cacheado no MongoDB por (brandId, version). */
export async function getBrandProfile(
  guideline: VisantBrandGuideline | null,
  opts?: { force?: boolean; llmKey?: string; llmProvider?: string; brandIdFallback?: string }
): Promise<BrandProfile & { brandName?: string }> {
  const db = await getDb();
  const col = db.collection("brand_profiles");

  const brandId = guideline?.id || guideline?._id || opts?.brandIdFallback || "";
  const version = guideline?.currentVersion ?? -1;

  if (!opts?.force && brandId) {
    // Se temos a versão, busca exato; senão, busca o mais recente desse brandId
    const query = version >= 0 ? { brandId, version } : { brandId };
    const cached = await col.find(query).sort({ version: -1 }).limit(1).toArray();
    if (cached.length && cached[0].profile) {
      return { ...cached[0].profile, brandName: cached[0].brandName };
    }
  }

  if (!guideline) {
    throw new Error(`Perfil da marca não encontrado no cache e guideline indisponível (brandId: ${brandId})`);
  }

  const brandText = summarizeBrand(guideline);
  const taxonomy = await getTaxonomy();

  const profile =
    (await buildLlmProfile(brandText, taxonomy, {
      key: opts?.llmKey,
      provider: opts?.llmProvider,
    })) ?? buildHeuristicProfile(brandText, taxonomy);

  const brandName = guideline.identity?.name || "";
  await col.updateOne(
    { brandId, version },
    { $set: { brandId, version, profile, brandName, updatedAt: new Date() } },
    { upsert: true }
  );

  return { ...profile, brandName };
}
