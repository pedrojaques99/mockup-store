/**
 * `/api/config/test` — "essa chave funciona?", respondido pelo servidor.
 *
 * Uma chave salva não é uma chave válida, e descobrir isso só na hora de
 * renderizar é caro: o erro chega embrulhado em três camadas de SDK, com a
 * mensagem do provedor perdida no meio. Aqui o painel pergunta antes.
 *
 * O teste roda **no servidor** porque é lá que a chave em claro mora — mandá-la
 * para o browser bater no provedor a exporia a qualquer extensão instalada, e
 * ainda esbarraria em CORS.
 *
 * Cada provedor tem um endpoint barato de listagem. Nenhum deles gera nada:
 * testar chave não pode custar crédito.
 */
import { NextRequest, NextResponse } from "next/server";
import { valorChave, PROVEDORES, type ChaveProvedor } from "@/lib/app-config";

export const runtime = "nodejs";

const TIMEOUT_MS = 8_000;

/** Endpoint de leitura por provedor. Sem geração, sem custo. */
const SONDA: Record<ChaveProvedor, (k: string) => { url: string; headers: Record<string, string> }> = {
  OPENAI_API_KEY: (k) => ({
    url: "https://api.openai.com/v1/models?limit=1",
    headers: { Authorization: `Bearer ${k}` },
  }),
  ANTHROPIC_API_KEY: (k) => ({
    url: "https://api.anthropic.com/v1/models?limit=1",
    headers: { "x-api-key": k, "anthropic-version": "2023-06-01" },
  }),
  GEMINI_API_KEY: (k) => ({
    url: `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(k)}&pageSize=1`,
    headers: {},
  }),
  REPLICATE_API_TOKEN: (k) => ({
    url: "https://api.replicate.com/v1/account",
    headers: { Authorization: `Bearer ${k}` },
  }),
  VISANT_API_KEY: (k) => ({
    url: "https://api.visantlabs.com/api/account/profile",
    headers: { Authorization: `Bearer ${k}` },
  }),
  NVIDIA_API_KEY: (k) => ({
    url: "https://integrate.api.nvidia.com/v1/models",
    headers: { Authorization: `Bearer ${k}` },
  }),
  EMBEDDINGS_API_KEY: (k) => ({
    url: "https://api.openai.com/v1/models?limit=1",
    headers: { Authorization: `Bearer ${k}` },
  }),
};

export async function POST(req: NextRequest) {
  const { chave } = (await req.json().catch(() => ({}))) as { chave?: string };
  const provedor = PROVEDORES.find((p) => p.chave === chave);
  if (!provedor) {
    return NextResponse.json({ error: `Provedor desconhecido: ${chave}` }, { status: 400 });
  }

  const { valor, origem } = valorChave(provedor.chave);
  if (!valor) {
    return NextResponse.json({ ok: false, motivo: "Nenhuma chave configurada.", origem });
  }

  const { url, headers } = SONDA[provedor.chave](valor);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { headers, signal: ctrl.signal });
    if (r.ok) return NextResponse.json({ ok: true, origem });

    // 401/403 é chave errada; o resto é o provedor de mau humor, e dizer
    // "chave inválida" nesse caso mandaria a pessoa trocar uma chave que serve.
    const motivo =
      r.status === 401 || r.status === 403
        ? "Chave recusada pelo provedor."
        : `Provedor respondeu ${r.status} — a chave pode estar certa; tente de novo.`;
    return NextResponse.json({ ok: false, motivo, status: r.status, origem });
  } catch (e) {
    const abortado = e instanceof Error && e.name === "AbortError";
    return NextResponse.json({
      ok: false,
      motivo: abortado
        ? `Sem resposta em ${TIMEOUT_MS / 1000}s — rede ou provedor fora do ar.`
        : `Não consegui alcançar o provedor: ${e instanceof Error ? e.message : String(e)}`,
      origem,
    });
  } finally {
    clearTimeout(t);
  }
}
