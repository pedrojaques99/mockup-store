/**
 * embeddings — a camada densa da busca, BYOK (bring your own key).
 *
 * Um provedor, três configurações. O NVIDIA NeMo Retriever expõe `/v1/embeddings`
 * compatível com OpenAI em `https://integrate.api.nvidia.com/v1`, então o MESMO SDK
 * `openai` (já dependência do projeto) atende os dois: o que muda é `baseURL` + `model`.
 * Qualquer endpoint compatível (vLLM, TEI, Ollama) entra como `provider=custom`.
 *
 * A regra que sustenta o resto do sistema: **isto nunca lança e nunca é obrigatório**.
 * Sem chave, `isEmbeddingsEnabled()` é `false` e `embedTexts()` devolve `null` — a busca
 * volta a ser exatamente a léxica de hoje. A camada densa é aditiva por construção,
 * porque a home é garantida offline (o mesmo argumento que fez o catálogo sobreviver ao
 * Mongo fora do ar).
 *
 * Envs:
 *
 *   EMBEDDINGS_PROVIDER = openai | nvidia | custom | off   (default: auto-detecta pela chave)
 *   EMBEDDINGS_BASE_URL = https://integrate.api.nvidia.com/v1
 *   EMBEDDINGS_MODEL    = text-embedding-3-small | nvidia/llama-3.2-nv-embedqa-1b-v2 | ...
 *   EMBEDDINGS_API_KEY  = ...     (cai para OPENAI_API_KEY / NVIDIA_API_KEY)
 *   EMBEDDINGS_DIMS     = 512     (só onde o modelo aceita redução)
 */

export type EmbeddingsProvider = "openai" | "nvidia" | "custom";

export interface EmbeddingsConfig {
  provider: EmbeddingsProvider;
  /** `undefined` = default do SDK (api.openai.com). */
  baseURL?: string;
  model: string;
  /** Só é enviado onde o modelo aceita redução de dimensão (Matryoshka da OpenAI). */
  dims?: number;
  keyPresent: boolean;
}

const DEFAULTS: Record<EmbeddingsProvider, { baseURL?: string; model: string; dims?: number }> = {
  openai: { model: "text-embedding-3-small", dims: 512 },
  nvidia: { baseURL: "https://integrate.api.nvidia.com/v1", model: "nvidia/llama-3.2-nv-embedqa-1b-v2" },
  custom: { model: "text-embedding-3-small" },
};

/** ~96 por chamada: o limite prático de payload dos dois provedores, sem virar timeout. */
const BATCH = 96;
const RETRIES = 3;

interface Resolved {
  config: EmbeddingsConfig;
  apiKey: string;
}

let memo: Resolved | null | undefined;

function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

/**
 * Auto-detecção: a chave que existe decide o provedor. Quem aponta `EMBEDDINGS_BASE_URL`
 * sem dizer o provedor está falando com um endpoint próprio — isso é `custom`.
 */
function detectProvider(): EmbeddingsProvider | "off" {
  const explicit = env("EMBEDDINGS_PROVIDER")?.toLowerCase();
  if (explicit === "off") return "off";
  if (explicit === "openai" || explicit === "nvidia" || explicit === "custom") return explicit;
  if (explicit) return "off"; // valor escrito errado ⇒ desligado, não um palpite silencioso
  if (env("EMBEDDINGS_BASE_URL")) return "custom";
  if (env("EMBEDDINGS_API_KEY")) return "openai";
  if (env("OPENAI_API_KEY")) return "openai";
  if (env("NVIDIA_API_KEY")) return "nvidia";
  return "off";
}

function resolve(): Resolved | null {
  const provider = detectProvider();
  if (provider === "off") return null;

  const apiKey =
    env("EMBEDDINGS_API_KEY") ??
    (provider === "openai" ? env("OPENAI_API_KEY") : undefined) ??
    (provider === "nvidia" ? env("NVIDIA_API_KEY") : undefined) ??
    "";
  if (!apiKey) return null; // sem chave não há camada densa — e isso é um estado válido

  const d = DEFAULTS[provider];
  const dimsRaw = env("EMBEDDINGS_DIMS");
  const dims = dimsRaw ? Number(dimsRaw) : d.dims;

  return {
    apiKey,
    config: {
      provider,
      baseURL: env("EMBEDDINGS_BASE_URL") ?? d.baseURL,
      model: env("EMBEDDINGS_MODEL") ?? d.model,
      dims: Number.isFinite(dims) && dims! > 0 ? dims : undefined,
      keyPresent: true,
    },
  };
}

/** Config efetiva (memoizada) ou `null` quando desligado / sem chave. */
export function getEmbeddingsConfig(): EmbeddingsConfig | null {
  // `undefined` = ainda não resolvido; `null` = resolvido e desligado. Um `??=` aqui
  // confundiria os dois e re-resolveria o env a cada chamada.
  if (memo === undefined) memo = resolve();
  return memo?.config ?? null;
}

export function isEmbeddingsEnabled(): boolean {
  return getEmbeddingsConfig() !== null;
}

/** Só para teste: descarta a memoização depois de mexer no `process.env`. */
export function resetEmbeddingsConfig(): void {
  memo = undefined;
  clientPromise = null;
}

/**
 * Identidade do vetor: `provider:model:dims`. É o que invalida o cache de embeddings
 * quando alguém troca de modelo — misturar vetores de dois modelos no mesmo arquivo é o
 * jeito mais silencioso de estragar um ranking (o cosseno continua "funcionando", só que
 * comparando espaços diferentes).
 */
export function embedFingerprint(): string {
  const c = getEmbeddingsConfig();
  if (!c) return "off";
  return `${c.provider}:${c.model}:${c.dims ?? "native"}`;
}

/**
 * Assimetria query/passage. Modelos de retrieval são treinados com dois papéis (a
 * pergunta e o documento não vivem no mesmo canto do espaço). A NVIDIA expõe isso pelo
 * sufixo no nome do modelo, justamente pra caber no schema da OpenAI; a OpenAI não tem o
 * conceito, e aí o sufixo tem de ser ignorado — mandar `-query` viraria 404.
 */
function modelFor(config: EmbeddingsConfig, kind: "passage" | "query"): string {
  if (config.provider !== "nvidia") return config.model;
  if (/-(query|passage)$/.test(config.model)) return config.model;
  return `${config.model}-${kind}`;
}

/** `dimensions` é extensão da OpenAI — mandar pra NVIDIA/custom devolve 400. */
function supportsDimensions(config: EmbeddingsConfig): boolean {
  return config.provider === "openai" && !!config.dims;
}

/**
 * L2-normaliza in-place: com vetor unitário, cosseno **é** produto escalar. Guardar
 * normalizado tira a raiz quadrada de dentro do laço de busca — que roda por doc, por
 * query — e deixa a varredura ser só multiplicação e soma.
 */
function normalize(v: Float32Array): Float32Array {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i] * v[i];
  const n = Math.sqrt(sum);
  if (n > 0) for (let i = 0; i < v.length; i++) v[i] = v[i] / n;
  return v;
}

function statusOf(e: unknown): number {
  const s = (e as { status?: unknown })?.status;
  return typeof s === "number" ? s : 0;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type OpenAILike = {
  embeddings: {
    create(body: Record<string, unknown>): Promise<{ data: { embedding: number[]; index?: number }[] }>;
  };
};

let clientPromise: Promise<OpenAILike | null> | null = null;

function getClient(): Promise<OpenAILike | null> {
  clientPromise ??= (async () => {
    if (memo === undefined) memo = resolve();
    if (!memo) return null;
    try {
      // import dinâmico: o SDK só é carregado por quem realmente tem chave — e os testes
      // das partes puras não pagam por ele.
      const { default: OpenAI } = await import("openai");
      return new OpenAI({ apiKey: memo.apiKey, baseURL: memo.config.baseURL }) as unknown as OpenAILike;
    } catch (e) {
      console.error("[embeddings] SDK indisponível:", e instanceof Error ? e.message : e);
      return null;
    }
  })();
  return clientPromise;
}

async function embedBatch(
  client: OpenAILike,
  config: EmbeddingsConfig,
  texts: string[],
  kind: "passage" | "query",
): Promise<Float32Array[] | null> {
  const body: Record<string, unknown> = { model: modelFor(config, kind), input: texts };
  if (supportsDimensions(config)) body.dimensions = config.dims;

  for (let attempt = 0; attempt < RETRIES; attempt++) {
    try {
      const res = await client.embeddings.create(body);
      const out = new Array<Float32Array>(texts.length);
      res.data.forEach((row, i) => {
        const at = typeof row.index === "number" ? row.index : i;
        out[at] = normalize(Float32Array.from(row.embedding));
      });
      // Provedor que devolveu menos vetores do que entradas não é resultado parcial
      // aproveitável: o alinhamento id↔vetor viraria mentira.
      if (out.some((v) => !v)) return null;
      return out;
    } catch (e) {
      const status = statusOf(e);
      const retriable = status === 429 || status >= 500 || status === 0;
      if (!retriable || attempt === RETRIES - 1) {
        console.error("[embeddings] falhou:", e instanceof Error ? e.message : e);
        return null;
      }
      await sleep(500 * 2 ** attempt);
    }
  }
  return null;
}

/**
 * Embeda um lote de textos. Devolve vetores JÁ normalizados, na mesma ordem da entrada —
 * ou `null` se estiver desligado ou se a rede/provedor falhou. Nunca lança: quem chama
 * decide o degradê, e o degradê é sempre "segue sem a camada densa".
 */
export async function embedTexts(
  texts: string[],
  kind: "passage" | "query",
): Promise<Float32Array[] | null> {
  const config = getEmbeddingsConfig();
  if (!config || !texts.length) return config ? [] : null;

  const client = await getClient();
  if (!client) return null;

  const out: Float32Array[] = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const chunk = await embedBatch(client, config, texts.slice(i, i + BATCH), kind);
    if (!chunk) return null;
    out.push(...chunk);
  }
  return out;
}
