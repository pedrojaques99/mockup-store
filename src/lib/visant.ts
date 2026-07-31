// Cliente da Visant Labs API (api.visantlabs.com) — fonte dos dados de marca.
// Auth resolvida por visant-auth (env key → OAuth device flow → CLI), cache curto.

import { getAccessToken } from "@/lib/visant-auth";
import { getDb } from "@/lib/db";

const API_BASE = process.env.VISANT_API_URL || "https://api.visantlabs.com/api";

const CACHE_TTL_MS = 5 * 60 * 1000;

export interface VisantLogo {
  id: string;
  url: string;
  variant: "primary" | "dark" | "light" | "icon" | "accent" | "custom";
  label?: string;
  format?: string;
  thumbnailUrl?: string;
}

export interface VisantColor {
  hex: string;
  name: string;
  role?: string;
}

export interface VisantBrandGuideline {
  id: string;
  _id?: string;
  identity?: { name?: string; website?: string; tagline?: string; description?: string };
  logos?: VisantLogo[];
  colors?: VisantColor[];
  typography?: Array<{ family: string; role: string; style?: string }>;
  tags?: Record<string, string[]>;
  strategy?: {
    manifesto?: unknown;
    positioning?: string[];
    coreMessage?: { product?: string; differential?: string; emotionalBond?: string };
    pillars?: Array<{ title?: string; name?: string; description?: string }>;
    archetypes?: Array<{ name?: string; description?: string }>;
    personas?: Array<{ name?: string; description?: string }>;
    voiceValues?: Array<{ name?: string; value?: string; description?: string }>;
  };
  guidelines?: { voice?: string; imagery?: string; dos?: string[]; donts?: string[] };
  currentVersion?: number;
  updatedAt?: string;
}

export interface VisantBrandSummary {
  id: string;
  name: string;
  logoUrl?: string;
  colors: VisantColor[];
  currentVersion?: number;
  updatedAt?: string;
}

const cache = new Map<string, { at: number; data: unknown }>();

async function visantFetch<T>(path: string): Promise<T> {
  const token = await getAccessToken();
  if (!token) {
    throw new Error("Não conectado à Visant — use o botão Conectar Visant");
  }
  const hit = cache.get(path);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data as T;

  let lastErr: Error | null = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      console.log(`[visant] Fetching ${path} (attempt ${attempt}/3)...`);
      const res = await fetch(`${API_BASE}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const text = await res.text();

      // Se for erro transitório (502, 503, 504), tenta de novo com delay progressivo
      if (res.status >= 502 && res.status <= 504 && attempt < 3) {
        console.warn(`[visant] Received ${res.status} for ${path}, retrying in ${attempt}s...`);
        await new Promise((r) => setTimeout(r, attempt * 1000));
        continue;
      }

      if (!res.ok) {
        console.error(`[visant] API Error ${res.status} for ${path}: ${text.slice(0, 100)}`);
        throw new Error(`Visant API ${res.status} ${path}: ${text.slice(0, 200)}`);
      }
      const data = JSON.parse(text) as T;
      cache.set(path, { at: Date.now(), data });
      return data;
    } catch (err) {
      lastErr = err as Error;
      if (attempt === 3) throw err;
      await new Promise((r) => setTimeout(r, attempt * 1000));
    }
  }
  throw lastErr || new Error("Falha desconhecida no visantFetch");
}

// ── Image generation (Visant prod) ──────────────────────────────────────────
// Endpoints pagos (escopo "generate"). Contratos confirmados na visantlabs-os:
//   POST /moodboard/upscale   { imageBase64, size }        → { upscaledBase64 }
//   POST /ai/change-object    { baseImage, newObject, … }  → { imageBase64 } (sem prefixo)
//   POST /imagelab/inpaint    { imageUrl, maskBase64, … }  → { base64, imageUrl }
// Cada chamada custa ~2 créditos.

async function visantPost<T>(path: string, body: unknown): Promise<T> {
  const token = await getAccessToken();
  if (!token) throw new Error("Não conectado à Visant — use o botão Conectar Visant");
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Visant ${res.status} ${path}: ${text.slice(0, 200)}`);
  return JSON.parse(text) as T;
}

const asDataUrl = (s: string) => (s.startsWith("data:") ? s : `data:image/png;base64,${s}`);

export interface UpscaleResult { base64: string; width?: number; height?: number }

export async function upscaleImage(dataUrl: string, size: "1K" | "2K" | "4K"): Promise<UpscaleResult> {
  const r = await visantPost<{ upscaledBase64: string }>("/moodboard/upscale", { imageBase64: dataUrl, size });
  return { base64: asDataUrl(r.upscaledBase64) };
}

export async function changeObjectImage(p: {
  dataUrl: string; mimeType?: string; newObject: string; resolution?: "1K" | "2K" | "4K";
}): Promise<{ base64: string }> {
  const r = await visantPost<{ imageBase64: string }>("/ai/change-object", {
    baseImage: { base64: p.dataUrl, mimeType: p.mimeType ?? "image/png" },
    newObject: p.newObject,
    resolution: p.resolution ?? "2K",
  });
  return { base64: asDataUrl(r.imageBase64) };
}

export type InpaintMode = "replace" | "remove" | "retouch";

export async function inpaintMask(p: {
  imageDataUrl: string; maskBase64: string; prompt?: string; mode: InpaintMode; resolution?: "1K" | "2K" | "4K";
}): Promise<{ base64: string; imageUrl?: string }> {
  const r = await visantPost<{ base64: string; imageUrl?: string }>("/imagelab/inpaint", {
    imageUrl: p.imageDataUrl,
    maskBase64: p.maskBase64,
    prompt: p.prompt,
    mode: p.mode,
    resolution: p.resolution ?? "2K",
    async: false,
  });
  return { base64: asDataUrl(r.base64), imageUrl: r.imageUrl };
}

export async function listBrandGuidelines(): Promise<VisantBrandSummary[]> {
  const data = await visantFetch<{ guidelines: VisantBrandGuideline[] }>(
    "/brand-guidelines?limit=100"
  );
  return (data.guidelines || []).map((g) => ({
    id: g.id || g._id || "",
    name: g.identity?.name || "(sem nome)",
    logoUrl: pickLogo(g)?.url,
    colors: g.colors || [],
    currentVersion: g.currentVersion,
    updatedAt: g.updatedAt,
  }));
}

export async function getBrandGuideline(id: string): Promise<VisantBrandGuideline> {
  const db = await getDb();
  const col = db.collection("brand_guidelines_cache");
  
  // 1. Tenta cache local primeiro (TTL 1 hora para "frescor", mas guardamos por 7 dias como fallback)
  const cached = await col.findOne({ id });
  const isFresh = cached && (Date.now() - new Date(cached.cachedAt).getTime() < CACHE_TTL_MS * 12); // 1h frescor

  if (isFresh) return cached.data as VisantBrandGuideline;

  try {
    // 2. Tenta buscar da API
    const data = await visantFetch<{ guideline: VisantBrandGuideline }>(
      `/brand-guidelines/${encodeURIComponent(id)}`
    );
    const guideline = data.guideline;

    // 3. Atualiza cache atômico
    await col.updateOne(
      { id },
      { $set: { id, data: guideline, cachedAt: new Date() } },
      { upsert: true }
    );
    return guideline;
  } catch (err) {
    // 4. Fallback: Se a API falhar (502, timeout), usa o cache antigo se existir
    if (cached) {
      console.warn(`[visant] API falhou, usando cache stale para ${id}`);
      return cached.data as VisantBrandGuideline;
    }
    throw err;
  }
}

/** Escolhe o melhor logo: variante pedida → primary → icon → primeiro disponível. */
export function pickLogo(
  g: VisantBrandGuideline,
  variant?: VisantLogo["variant"]
): VisantLogo | undefined {
  const logos = g.logos || [];
  if (!logos.length) return undefined;
  if (variant) {
    const exact = logos.find((l) => l.variant === variant);
    if (exact) return exact;
  }
  return (
    logos.find((l) => l.variant === "primary") ||
    logos.find((l) => l.variant === "icon") ||
    logos[0]
  );
}

/** Resumo textual compacto da marca para prompts LLM (mapeamento de tags). */
export function summarizeBrand(g: VisantBrandGuideline): string {
  const parts: string[] = [];
  const idn = g.identity;
  if (idn?.name) parts.push(`Marca: ${idn.name}`);
  if (idn?.tagline) parts.push(`Tagline: ${idn.tagline}`);
  if (idn?.description) parts.push(`Descrição: ${idn.description}`);

  const s = g.strategy;
  if (s?.positioning?.length) parts.push(`Posicionamento: ${s.positioning.join("; ")}`);
  if (s?.coreMessage?.product) parts.push(`Produto: ${s.coreMessage.product}`);
  if (s?.coreMessage?.emotionalBond) parts.push(`Vínculo emocional: ${s.coreMessage.emotionalBond}`);
  if (s?.archetypes?.length)
    parts.push(`Arquétipos: ${s.archetypes.map((a) => a.name).filter(Boolean).join(", ")}`);
  if (s?.pillars?.length)
    parts.push(`Pilares: ${s.pillars.map((p) => p.title || p.name).filter(Boolean).join(", ")}`);
  if (s?.voiceValues?.length)
    parts.push(`Voz/valores: ${s.voiceValues.map((v) => v.name || v.value).filter(Boolean).join(", ")}`);

  if (g.guidelines?.voice) parts.push(`Tom de voz: ${g.guidelines.voice}`);
  if (g.guidelines?.imagery) parts.push(`Diretrizes de imagem: ${g.guidelines.imagery}`);

  if (g.colors?.length)
    parts.push(
      `Cores: ${g.colors.map((c) => `${c.name || c.hex}${c.role ? ` (${c.role})` : ""}`).join(", ")}`
    );
  if (g.typography?.length)
    parts.push(`Tipografia: ${g.typography.map((t) => `${t.family} (${t.role})`).join(", ")}`);

  if (g.tags) {
    const flat = Object.entries(g.tags)
      .map(([k, v]) => `${k}: ${(v || []).join(", ")}`)
      .join(" · ");
    if (flat) parts.push(`Tags da marca: ${flat}`);
  }

  return parts.join("\n");
}

// ── Busca visual (Pinecone, do lado da Visant) ───────────────────────────────
/**
 * Busca por imagem: manda uma imagem e recebe as referências visualmente
 * parecidas, ranqueadas por embedding multimodal.
 *
 * Por que delegar em vez de indexar aqui: a busca local (`search-engine.ts`) é
 * MiniSearch — léxica, sem embeddings, e o próprio `search-synonyms.ts` diz que
 * é assim de propósito. Montar um índice vetorial neste repo significaria uma
 * segunda cópia do acervo, um segundo custo de embedding e duas verdades que
 * divergem. A Visant já mantém esse índice (namespace `reference-examples`) e
 * indexa a MESMA coleção `community_presets` que este projeto lê.
 *
 * O que volta é a lista de ids — e eles casam 1:1 com o catálogo local, porque
 * o `id` é a mesma chave nos dois lados. Então o chamador ranqueia o próprio
 * índice em vez de renderizar registros de outro formato.
 *
 * Cena PSD APARECE aqui: o guard que a esconde (`BROWSABLE`) vive no feed
 * humano do app da Visant, e a hidratação da busca vetorial não o aplica.
 * Só entra o que tem vetor — ou seja, o que já passou pelo enriquecimento.
 */
export interface VisualMatch {
  id: string;
  score: number;
  name?: string;
  referenceImageUrl?: string;
}

export async function searchByImage(
  imageBase64: string,
  opts: { limit?: number } = {}
): Promise<VisualMatch[]> {
  const token = await getAccessToken();
  if (!token) {
    throw new Error("Não conectado à Visant — use o botão Conectar Visant");
  }

  const res = await fetch(`${API_BASE}/references/search-by-image`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ imageBase64, limit: opts.limit ?? 48 }),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Busca visual falhou (${res.status}): ${text.slice(0, 200)}`);
  }

  const json = JSON.parse(text) as { references?: Array<Record<string, unknown>> };
  return (json.references ?? []).map((r) => ({
    id: String(r.id),
    score: typeof r.score === "number" ? r.score : 0,
    name: typeof r.name === "string" ? r.name : undefined,
    referenceImageUrl:
      typeof r.referenceImageUrl === "string" ? r.referenceImageUrl : undefined,
  }));
}
