/**
 * Adivinhador de material da superfície — visão (gpt-4o-mini, fallback gemini).
 * Olha a foto (com o placeholder magenta) e devolve uma frase curta do MATERIAL
 * real da superfície/objeto, pro inpaint recriar o material certo (ex: continuar a
 * lâmina de carbono em vez de um painel branco). Server-only.
 */
import OpenAI from "openai";

const PROMPT =
  "This image has a MAGENTA/PINK placeholder filling an advertising surface. In 8 words or less, describe the real MATERIAL and look of that surface/object (a seamless continuation of the surrounding material), IGNORING the magenta color. Examples: 'glossy carbon fiber hockey blade', 'matte white paper poster', 'brushed aluminum panel', 'red brick wall', 'dark matte plastic screen bezel'. Answer ONLY the phrase, no quotes.";

export async function guessSurfaceMaterial(buf: Buffer, ext = "png"): Promise<string | null> {
  const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "webp" ? "image/webp" : "image/png";
  const base64 = buf.toString("base64");
  const clean = (s?: string | null) => {
    const t = (s ?? "").trim().replace(/^["'`]+|["'`]+$/g, "").replace(/\s+/g, " ");
    return t.length >= 3 && t.length <= 80 ? t : null;
  };
  try {
    if (process.env.OPENAI_API_KEY) {
      const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const r = await client.chat.completions.create({
        model: "gpt-4o-mini",
        max_tokens: 40,
        messages: [{
          role: "user",
          content: [
            { type: "image_url", image_url: { url: `data:${mime};base64,${base64}`, detail: "low" } },
            { type: "text", text: PROMPT },
          ],
        }],
      });
      return clean(r.choices[0]?.message?.content);
    }
    if (process.env.GEMINI_API_KEY) {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ inline_data: { mime_type: mime, data: base64 } }, { text: PROMPT }] }],
            generationConfig: { maxOutputTokens: 40, temperature: 0.2 },
          }),
        },
      );
      const j = await res.json();
      return clean(j.candidates?.[0]?.content?.parts?.[0]?.text);
    }
  } catch { /* sem visão → null, usa fallback genérico */ }
  return null;
}
