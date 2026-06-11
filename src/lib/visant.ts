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
