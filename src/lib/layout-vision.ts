/**
 * layout-vision — camada MLLM que responde a pergunta que pixel não responde:
 * "onde está o TEXTO nesta arte, e dá pra cortá-la?"
 *
 * Por que existe: em arte full-bleed (foto/gradiente sangrando até a borda) a
 * análise geométrica não separa "detalhe de foto na borda" de "headline na
 * borda" — energia de borda é alta nos dois casos. Resultado: margem 0% e a
 * arte é marcada como incortável mesmo quando cortar a foto seria inofensivo.
 * O modelo enxerga essa diferença; a matemática do corte continua nossa.
 *
 * Mesma estrutura do `ai-vision.ts` (Anthropic → OpenAI → null), pelos mesmos
 * motivos: JSON forçado, haiku barato, degrada silencioso sem chave.
 */
import { readFile } from "fs/promises";

export type LayoutKind = "poster" | "hero" | "story" | "card" | "pattern" | "lockup" | "other";
export const LAYOUT_KINDS: LayoutKind[] = ["poster", "hero", "story", "card", "pattern", "lockup", "other"];

export interface LayoutVisionResult {
  provider: "anthropic" | "openai" | "gemini";
  kind: LayoutKind;
  hasText: boolean;
  /** Caixa (normalizada 0..1) que engloba TODO texto/logo que não pode ser cortado. */
  textBox: { x0: number; y0: number; x1: number; y1: number } | null;
  /** Fundo é extensível (cor chapada/gradiente)? Se sim, `contain` fica natural. */
  bleedSafe: boolean;
  description: string;
  confidence: number;
}

const SCHEMA_PROMPT = `Você analisa um LAYOUT de campanha (arte publicitária) que será aplicado em mockups.
Retorne APENAS JSON válido (sem markdown, sem prosa):
{
  "kind": "<um destes: ${LAYOUT_KINDS.join(" | ")}>",
  "hasText": <true|false>,
  "textBox": { "x0": <0..1>, "y0": <0..1>, "x1": <0..1>, "y1": <0..1> },
  "bleedSafe": <true|false>,
  "description": "<frase curta em pt-BR: o que é a peça>",
  "confidence": <0..1>
}
Regras:
- "textBox" = o retângulo MÍNIMO que engloba TODO texto legível E o logo/símbolo.
  Coordenadas normalizadas: x0/y0 = canto superior-esquerdo, x1/y1 = inferior-direito.
  0,0 é o topo-esquerdo da imagem; 1,1 é o rodapé-direito.
- IGNORE fotos, gradientes, texturas e grafismos decorativos ao medir a textBox —
  eles podem ser cortados sem prejuízo. Só texto e logo importam.
- Se não houver texto nem logo, "hasText": false e "textBox": null.
- "bleedSafe": true se o fundo for cor chapada ou gradiente suave (dá pra estender
  a arte sem emenda visível); false se for foto/composição com detalhe.
- "kind": "story" = vertical 9:16 de social; "hero" = banner horizontal amplo;
  "poster" = cartaz vertical; "card" = peça de feed; "pattern" = textura/grafismo
  sem hierarquia; "lockup" = só logo/assinatura.
- Seja PRECISO na textBox: ela vira tolerância de corte. Errar pra mais descarta
  cenas boas; errar pra menos decepa o headline.`;

async function toB64(input: string | Buffer): Promise<string> {
  const buf = typeof input === "string" ? await readFile(input) : input;
  return buf.toString("base64");
}

function parseJSON(txt: string): Record<string, unknown> | null {
  const s = txt.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  try { return JSON.parse(s) as Record<string, unknown>; } catch {
    const m = s.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try { return JSON.parse(m[0]) as Record<string, unknown>; } catch { return null; }
  }
}

const clamp01 = (n: unknown, def = 0) => {
  const v = typeof n === "number" && Number.isFinite(n) ? n : def;
  return Math.max(0, Math.min(1, v));
};

function normalize(p: Record<string, unknown> | null, provider: LayoutVisionResult["provider"]): LayoutVisionResult | null {
  if (!p) return null;
  const kind = typeof p.kind === "string" && (LAYOUT_KINDS as string[]).includes(p.kind) ? (p.kind as LayoutKind) : "other";
  const hasText = p.hasText === true;

  let textBox: LayoutVisionResult["textBox"] = null;
  const tb = p.textBox as Record<string, unknown> | null | undefined;
  if (hasText && tb && typeof tb === "object") {
    let x0 = clamp01(tb.x0), y0 = clamp01(tb.y0), x1 = clamp01(tb.x1, 1), y1 = clamp01(tb.y1, 1);
    // O modelo às vezes troca os cantos — ordena em vez de descartar a resposta.
    if (x1 < x0) [x0, x1] = [x1, x0];
    if (y1 < y0) [y0, y1] = [y1, y0];
    textBox = { x0, y0, x1, y1 };
  }

  return {
    provider,
    kind,
    hasText,
    textBox,
    bleedSafe: p.bleedSafe === true,
    description: typeof p.description === "string" ? p.description : "",
    confidence: clamp01(p.confidence, 0.5),
  };
}

async function callAnthropic(b64: string): Promise<LayoutVisionResult | null> {
  const key = process.env.ANTHROPIC_API_KEY; if (!key) return null;
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
  return normalize(parseJSON(j?.content?.find((c) => c.type === "text")?.text ?? ""), "anthropic");
}

async function callOpenAI(b64: string): Promise<LayoutVisionResult | null> {
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
          { type: "image_url", image_url: { url: `data:image/png;base64,${b64}` } },
          { type: "text", text: SCHEMA_PROMPT },
        ],
      }],
      max_tokens: 512,
    }),
  });
  if (!res.ok) return null;
  const j = await res.json().catch(() => null) as { choices?: Array<{ message?: { content?: string } }> } | null;
  return normalize(parseJSON(j?.choices?.[0]?.message?.content ?? ""), "openai");
}

/**
 * Gemini tem convenção PRÓPRIA de detecção: `box_2d` = [ymin, xmin, ymax, xmax]
 * normalizado 0-1000, nessa ordem (y antes de x). Pedir no nosso formato seria
 * testá-lo fora do que ele foi treinado — e o teste sairia injustamente ruim.
 * Doc: ai.google.dev/gemini-api/docs/image-understanding#object-detection
 */
const GEMINI_BBOX_PROMPT = `Detect the region containing ALL legible text and logo in this advertising layout.
Ignore photos, gradients, textures and decorative graphics — only text and logo matter.
Return APENAS JSON:
{
  "box_2d": [ymin, xmin, ymax, xmax],
  "kind": "<${LAYOUT_KINDS.join(" | ")}>",
  "hasText": true|false,
  "bleedSafe": true|false,
  "description": "<frase curta pt-BR>",
  "confidence": <0..1>
}
box_2d: coordenadas normalizadas 0-1000, ordem [ymin, xmin, ymax, xmax].
A caixa deve ser a MÍNIMA que engloba todo texto/logo. Seja preciso: ela vira
tolerância de corte. Se não houver texto nem logo, "hasText": false e omita box_2d.`;

async function callGemini(b64: string, model: string): Promise<LayoutVisionResult | null> {
  const key = process.env.GEMINI_API_KEY; if (!key) return null;
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [
            { inline_data: { mime_type: "image/png", data: b64 } },
            { text: GEMINI_BBOX_PROMPT },
          ],
        }],
        generationConfig: { responseMimeType: "application/json", temperature: 0 },
      }),
    }
  );
  if (!res.ok) return null;
  const j = await res.json().catch(() => null) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> } | null;
  const p = parseJSON(j?.candidates?.[0]?.content?.parts?.[0]?.text ?? "");
  if (!p) return null;

  // Converte box_2d [ymin,xmin,ymax,xmax] 0-1000 → nosso {x0,y0,x1,y1} 0-1
  const bb = Array.isArray(p.box_2d) ? (p.box_2d as unknown[]).map(Number) : null;
  if (bb && bb.length === 4 && bb.every((n) => Number.isFinite(n))) {
    p.textBox = { y0: bb[0] / 1000, x0: bb[1] / 1000, y1: bb[2] / 1000, x1: bb[3] / 1000 };
  }
  return normalize(p, "gemini");
}

/** Analisa o layout via MLLM. null se não houver chave ou o modelo falhar. */
export async function analyzeLayoutAI(
  input: string | Buffer,
  provider: LayoutVisionResult["provider"] | "auto" = "auto"
): Promise<LayoutVisionResult | null> {
  let b64: string;
  try { b64 = await toB64(input); } catch { return null; }
  if (provider === "gemini") { try { return await callGemini(b64, GEMINI_BBOX_MODEL); } catch { return null; } }
  if (provider === "anthropic") { try { return await callAnthropic(b64); } catch { return null; } }
  try { const a = await callAnthropic(b64); if (a) return a; } catch { /* fallthrough */ }
  try { const o = await callOpenAI(b64); if (o) return o; } catch { /* */ }
  return null;
}

export const GEMINI_BBOX_MODEL = process.env.GEMINI_BBOX_MODEL || "gemini-2.5-flash";
