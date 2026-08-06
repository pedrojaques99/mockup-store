/**
 * Configuração local do app — pastas do acervo e chaves BYOK, editáveis pela
 * tela em vez de por arquivo + reboot.
 *
 * Hoje tudo sai de `process.env`: trocar uma chave significa abrir
 * `.env.local`, editar e reiniciar o servidor. Para o dev é um incômodo; para
 * quem baixou o app é uma barreira — a pessoa não tem terminal aberto e não
 * sabe o que é um arquivo de env.
 *
 * ## Uma config, um lugar
 *
 * `data/config.json`, dentro do projeto, gitignored. **Sem cópia espelhada em
 * `userData`**: a cópia diverge do original nos dois sentidos e ninguém
 * percebe qual está valendo — já custou caro neste ecossistema (a config de um
 * app viveu numa cópia que ganhou 5 entradas que o repo não tinha e perdeu 2
 * que ele tinha).
 *
 * ## Precedência: o ambiente vence, e a tela CONTA isso
 *
 * `process.env` continua ganhando de `config.json`. Quem já tem `.env.local`,
 * o CI e os scripts não mudam de comportamento.
 *
 * O risco dessa escolha é o modo de falha silencioso: a pessoa digita a chave
 * no painel, salva, e nada muda porque o env sobrepõe — sem erro, sem aviso.
 * Por isso toda leitura devolve **de onde o valor veio** (`origem`), e a UI
 * mostra "definido no .env.local" e **desabilita** o campo travado. O painel
 * nunca finge que gravou algo que não vale.
 *
 * ## Chave nunca volta para o cliente
 *
 * A API expõe presença + máscara (`sk-…4f2a`) + origem. O valor em claro só
 * existe no servidor. Teste de conexão roda no servidor pelo mesmo motivo.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { dirname, join } from "path";

export type Origem = "env" | "config" | "ausente";

/** Provedores que o app usa, com o que cada um liga. */
export const PROVEDORES = [
  { chave: "OPENAI_API_KEY", nome: "OpenAI", liga: "geração de imagem" },
  { chave: "GEMINI_API_KEY", nome: "Gemini", liga: "detecção assistida de superfície" },
  { chave: "ANTHROPIC_API_KEY", nome: "Anthropic", liga: "análise de cena" },
  { chave: "REPLICATE_API_TOKEN", nome: "Replicate", liga: "segmentação, profundidade, reluz e upscale" },
  { chave: "VISANT_API_KEY", nome: "Visant Labs", liga: "lotes por marca (brand kit)" },
  { chave: "NVIDIA_API_KEY", nome: "NVIDIA", liga: "upscale alternativo" },
  { chave: "EMBEDDINGS_API_KEY", nome: "Embeddings", liga: "busca semântica" },
] as const;

export type ChaveProvedor = (typeof PROVEDORES)[number]["chave"];

export interface ConfigLocal {
  versao: 1;
  /** Pastas do acervo, equivalente ao `PSD_DIRS`. */
  psdDirs?: string[];
  /** Pastas de overlay (Luz/Sombra). */
  overlayDirs?: string[];
  /** Porta do render-server. */
  renderPort?: number;
  /** Chaves BYOK. Nunca sai daqui para o cliente. */
  chaves?: Partial<Record<ChaveProvedor, string>>;
}

const VAZIA: ConfigLocal = { versao: 1 };

export function caminhoConfig(): string {
  return process.env.APP_CONFIG_PATH || join(process.cwd(), "data", "config.json");
}

let cache: { valor: ConfigLocal; at: number } | null = null;
const TTL_MS = 2_000;

export function lerConfig(): ConfigLocal {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.valor;
  const caminho = caminhoConfig();
  let valor: ConfigLocal = VAZIA;
  if (existsSync(caminho)) {
    try {
      const bruto = JSON.parse(readFileSync(caminho, "utf8")) as ConfigLocal;
      if (bruto && typeof bruto === "object") valor = { ...VAZIA, ...bruto };
    } catch (e) {
      // Config corrompida não pode derrubar o app — mas também não pode sumir
      // calada, senão a pessoa edita e não entende por que nada muda.
      console.error(
        `[app-config] ${caminho} ilegível, seguindo com o padrão:`,
        e instanceof Error ? e.message : e,
      );
    }
  }
  cache = { valor, at: Date.now() };
  return valor;
}

export function invalidarConfig() {
  cache = null;
}

/** Só para teste: esquece o que foi injetado no ambiente. */
export function _resetInjecoes() {
  injetadas.clear();
}

/**
 * Escrita **merge, nunca overwrite**. Um `PUT` parcial que substituísse o
 * arquivo apagaria o que a outra aba acabou de gravar — é literalmente o bug
 * que já apagou o estúdio de cenas em produção neste projeto, pelo mesmo
 * mecanismo, noutro arquivo.
 */
export function gravarConfig(parcial: Partial<ConfigLocal>): ConfigLocal {
  const atual = lerConfig();
  const novo: ConfigLocal = {
    ...atual,
    ...parcial,
    versao: 1,
    chaves: { ...(atual.chaves ?? {}), ...(parcial.chaves ?? {}) },
  };
  // Chave apagada explicitamente (string vazia) sai do arquivo em vez de virar "".
  for (const [k, v] of Object.entries(novo.chaves ?? {})) {
    if (typeof v !== "string" || !v.trim()) delete novo.chaves![k as ChaveProvedor];
  }
  const caminho = caminhoConfig();
  mkdirSync(dirname(caminho), { recursive: true });
  writeFileSync(caminho, JSON.stringify(novo, null, 2));
  invalidarConfig();
  return novo;
}

/**
 * Nomes que **nós** escrevemos no `process.env` a partir do `config.json`.
 *
 * Sem esta lista o app mente para o usuário. `aplicarConfigNoProcesso` injeta a
 * chave do painel no ambiente (é assim que os SDKs a enxergam), e a partir daí
 * ela é indistinguível de uma variável real — a origem voltaria como `env` e a
 * tela diria "definido no .env.local, o arquivo vence o painel" para uma chave
 * que a pessoa acabou de digitar ali. Pego pelo portão de ship.
 */
const injetadas = new Set<string>();

function doEnv(nome: string): string | undefined {
  // O que veio de nós não conta como ambiente — conta como config.
  if (injetadas.has(nome)) return undefined;
  const v = (process.env[nome] ?? "").trim();
  return v || undefined;
}

/** O valor efetivo de uma chave e **de onde ele veio**. */
export function valorChave(chave: ChaveProvedor): { valor?: string; origem: Origem } {
  const env = doEnv(chave);
  if (env) return { valor: env, origem: "env" };
  const local = lerConfig().chaves?.[chave]?.trim();
  if (local) return { valor: local, origem: "config" };
  return { origem: "ausente" };
}

/**
 * Máscara para a tela: começo e fim, nunca o miolo. Chave curta demais vira só
 * pontos — mostrar 6 de 8 caracteres não é máscara, é vazamento.
 */
export function mascarar(valor: string): string {
  if (valor.length <= 12) return "•".repeat(8);
  return `${valor.slice(0, 4)}${"•".repeat(6)}${valor.slice(-4)}`;
}

/** Pastas do acervo: env vence, config preenche. Sempre normalizadas. */
export function pastasAcervo(): { valor: string[]; origem: Origem } {
  const env = doEnv("PSD_DIRS");
  if (env) {
    return { valor: env.split(",").map((s) => s.trim()).filter(Boolean), origem: "env" };
  }
  const local = lerConfig().psdDirs?.filter(Boolean) ?? [];
  return { valor: local, origem: local.length ? "config" : "ausente" };
}

export function pastasOverlay(): { valor: string[]; origem: Origem } {
  const env = doEnv("OVERLAY_DIRS");
  if (env) {
    return { valor: env.split(",").map((s) => s.trim()).filter(Boolean), origem: "env" };
  }
  const local = lerConfig().overlayDirs?.filter(Boolean) ?? [];
  return { valor: local, origem: local.length ? "config" : "ausente" };
}

export function portaRender(): { valor: number; origem: Origem } {
  const env = doEnv("RENDER_PORT");
  if (env) return { valor: Number(env), origem: "env" };
  const local = lerConfig().renderPort;
  return { valor: local ?? 4200, origem: local ? "config" : "ausente" };
}

/**
 * Injeta no `process.env` do processo o que só existe na config.
 *
 * Existe porque o app tem dezenas de pontos lendo `process.env.X` direto
 * (SDKs de terceiros inclusive, que leem sozinhos). Reescrever todos seria
 * mexer em muito código para o mesmo efeito; e reescrever os SDKs é impossível.
 *
 * **Nunca sobrescreve** o que já veio do ambiente — a precedência acima
 * continua valendo, e é por isso que a UI precisa contar a origem.
 */
export function aplicarConfigNoProcesso(): { aplicadas: string[] } {
  const cfg = lerConfig();
  const aplicadas: string[] = [];
  const injetar = (nome: string, valor: string) => {
    process.env[nome] = valor;
    injetadas.add(nome);
    aplicadas.push(nome);
  };
  for (const [k, v] of Object.entries(cfg.chaves ?? {})) {
    if (typeof v === "string" && v.trim() && !doEnv(k)) injetar(k, v.trim());
  }
  if (!doEnv("PSD_DIRS") && cfg.psdDirs?.length) injetar("PSD_DIRS", cfg.psdDirs.join(","));
  if (!doEnv("OVERLAY_DIRS") && cfg.overlayDirs?.length) {
    injetar("OVERLAY_DIRS", cfg.overlayDirs.join(","));
  }
  if (!doEnv("RENDER_PORT") && cfg.renderPort) injetar("RENDER_PORT", String(cfg.renderPort));
  return { aplicadas };
}
