/**
 * ai-vision — camada MLLM opcional sobre o classify heurístico. Pede ao modelo
 * pra descrever a cena e sugerir um substrato (entre os 16 da nossa lib) +
 * atributos finos (form factor, material, condition, lighting).
 *
 * Providers (em ordem de preferência):
 *   1. Anthropic Claude (vision; cabe em haiku/sonnet, baratíssimo).
 *   2. OpenAI gpt-4o-mini (vision; alternativa).
 *   3. null (sem chave) → fallback silencioso pra UI usar só a heurística.
 *
 * Saída ESTRUTURADA (JSON) — modelo é forçado a responder com schema fixo, sem
 * texto livre, pra integrar com `rankSubstrates` (boosta o score do candidato
 * sugerido). Latência típica: 0.5–2s. Custo: ~$0.0005/imagem (haiku).
 */
import { readFile } from "fs/promises";
import { SUBSTRATE_KEYS, type SubstrateKind } from "./substrate-presets";

export interface AIVisionResult {
  provider: "anthropic" | "openai";
  substrate: SubstrateKind | null;
  /** [0,1] — quanto o modelo está certo (claim do próprio modelo). */
  confidence: number;
  /** Descrição livre (curta). */
  description: string;
  /** Atributos finos: "white", "matte", "wrinkled", "frontal", "soft side-light"… */
  attributes: string[];
}

const SCHEMA_PROMPT = `Analise esta imagem de mockup e retorne APENAS JSON válido (sem markdown, sem prosa) com:
{
  "substrate": "<um destes: ${SUBSTRATE_KEYS.join(" | ")}>",
  "confidence": <número 0..1>,
  "description": "<frase curta em pt-BR descrevendo o objeto/superfície editável>",
  "attributes": [<3-6 tags em inglês: forma, material, condição, iluminação>]
}
Regras:
- O substrato é o OBJETO PRINCIPAL editável (camiseta, garrafa, billboard…), não o fundo.
- Se houver placeholder magenta/branco marcando a área, classifique pelo objeto que CARREGA o placeholder.
- "tube" = bisnaga/tubo flexível; "bottle" = garrafa rígida; "mug" = caneca/lata reta.
- Se não tiver certeza, escolha o mais próximo e diminua confidence.`;

async function imageToDataUrl(input: string | Buffer): Promise<string> {
  const buf = typeof input === "string" ? await readFile(input) : input;
  return `data:image/png;base64,${buf.toString("base64")}`;
}

function parseJSON(txt: string): AIVisionResult["substrate"] extends unknown ? Record<string, unknown> | null : never {
  const stripped = txt.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  try { return JSON.parse(stripped) as never; } catch {
    // Tenta achar o primeiro objeto {...}
    const m = stripped.match(/\{[\s\S]*\}/);
    if (!m) return null as never;
    try { return JSON.parse(m[0]) as never; } catch { return null as never; }
  }
}

function normalize(parsed: Record<string, unknown> | null, provider: AIVisionResult["provider"]): AIVisionResult | null {
  if (!parsed) return null;
  const sub = typeof parsed.substrate === "string" ? parsed.substrate.trim() as SubstrateKind : null;
  const valid = sub && (SUBSTRATE_KEYS as string[]).includes(sub) ? sub : null;
  const conf = Math.max(0, Math.min(1, typeof parsed.confidence === "number" ? parsed.confidence : 0.5));
  const desc = typeof parsed.description === "string" ? parsed.description : "";
  const attrs = Array.isArray(parsed.attributes) ? parsed.attributes.filter((a) => typeof a === "string").slice(0, 8) as string[] : [];
  return { provider, substrate: valid, confidence: valid ? conf : conf * 0.5, description: desc, attributes: attrs };
}

async function callAnthropic(dataUrl: string): Promise<AIVisionResult | null> {
  const key = process.env.ANTHROPIC_API_KEY; if (!key) return null;
  const b64 = dataUrl.replace(/^data:image\/\w+;base64,/, "");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 512,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/png", data: b64 } },
          { type: "text", text: SCHEMA_PROMPT },
        ],
      }],
    }),
  });
  if (!res.ok) return null;
  const j = await res.json().catch(() => null) as { content?: Array<{ type: string; text?: string }> } | null;
  const txt = j?.content?.find((c) => c.type === "text")?.text ?? "";
  return normalize(parseJSON(txt), "anthropic");
}

async function callOpenAI(dataUrl: string): Promise<AIVisionResult | null> {
  const key = process.env.OPENAI_API_KEY; if (!key) return null;
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [{
        role: "user",
        content: [
          { type: "image_url", image_url: { url: dataUrl } },
          { type: "text", text: SCHEMA_PROMPT },
        ],
      }],
      max_tokens: 512,
    }),
  });
  if (!res.ok) return null;
  const j = await res.json().catch(() => null) as { choices?: Array<{ message?: { content?: string } }> } | null;
  const txt = j?.choices?.[0]?.message?.content ?? "";
  return normalize(parseJSON(txt), "openai");
}

/**
 * Analisa a cena via MLLM. Tenta Anthropic, depois OpenAI. Retorna null se não
 * houver chave ou o modelo falhar — o caller continua com a heurística.
 */
export async function analyzeSceneAI(input: string | Buffer): Promise<AIVisionResult | null> {
  let dataUrl: string;
  try { dataUrl = await imageToDataUrl(input); } catch { return null; }
  // Resize implícito: a API aceita até ~5MB; pra cenas grandes seria bom resize antes.
  // Fica a cargo do caller mandar Buffer pequeno se precisar.
  try {
    const a = await callAnthropic(dataUrl); if (a) return a;
  } catch { /* fallthrough */ }
  try {
    const o = await callOpenAI(dataUrl); if (o) return o;
  } catch { /* */ }
  return null;
}
