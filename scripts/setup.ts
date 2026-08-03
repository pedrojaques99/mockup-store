/**
 * setup — prepara um clone novo e diz a verdade sobre o que está ligado.
 *
 *   npm run setup
 *
 * Idempotente: rode quantas vezes quiser. Nunca sobrescreve `.env.local`,
 * nunca apaga dado.
 *
 * Existe porque o repo tem 26 variáveis de ambiente, 4 serviços externos e
 * nenhum deles obrigatório — o que é ótimo para rodar rápido e péssimo para
 * entender. Em vez de um README prometendo o que funciona sem cada peça, este
 * script MEDE e imprime. O quadro que ele mostra é o estado real da máquina.
 */
import { existsSync, copyFileSync, mkdirSync, readdirSync, cpSync } from "fs";
import { join } from "path";
import { createConnection } from "net";

const ROOT = process.cwd();
const ok = (s: string) => `\x1b[32m${s}\x1b[0m`;
const off = (s: string) => `\x1b[90m${s}\x1b[0m`;
const warn = (s: string) => `\x1b[33m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;

let bloqueado = false;

/** Node abaixo do `engines` quebra de formas confusas. Falhar aqui é mais barato. */
function checarNode() {
  const min = 22;
  const atual = Number(process.versions.node.split(".")[0]);
  if (atual < min) {
    console.error(
      `\n  ${warn("✗")} Node ${process.versions.node} — este projeto pede >=${min}.` +
        `\n    Instale o Node 22 LTS e rode de novo.\n`,
    );
    bloqueado = true;
    return;
  }
  console.log(`  ${ok("✓")} Node ${process.versions.node}`);
}

/** Copia o exemplo. Nunca sobrescreve: o .env.local do dev é dele. */
function prepararEnv() {
  const alvo = join(ROOT, ".env.local");
  const exemplo = join(ROOT, ".env.example");
  if (existsSync(alvo)) {
    console.log(`  ${ok("✓")} .env.local já existe (intocado)`);
    return;
  }
  if (!existsSync(exemplo)) {
    console.log(`  ${warn("!")} .env.example sumiu do repo`);
    return;
  }
  copyFileSync(exemplo, alvo);
  console.log(`  ${ok("✓")} .env.local criado a partir do .env.example`);
}

/**
 * Semeia a cena de demonstração se `data/photo-scenes/` estiver vazio.
 * Sem isto o app sobe correto e mostra um grid vazio — e o dev novo não tem
 * como saber se quebrou ou se é assim mesmo.
 */
function semearDemo() {
  const destino = join(ROOT, "data", "photo-scenes");
  const fixtures = join(ROOT, "fixtures", "demo-scenes");
  const jaTem =
    existsSync(destino) && readdirSync(destino).filter((d) => !d.startsWith(".")).length > 0;
  if (jaTem) {
    console.log(`  ${ok("✓")} data/photo-scenes já tem cena (demo não copiada)`);
    return;
  }
  if (!existsSync(fixtures)) {
    console.log(`  ${warn("!")} fixtures/demo-scenes não encontrado — grid vai subir vazio`);
    return;
  }
  mkdirSync(destino, { recursive: true });
  for (const cena of readdirSync(fixtures)) {
    cpSync(join(fixtures, cena), join(destino, cena), { recursive: true });
  }
  console.log(`  ${ok("✓")} cena de demonstração copiada para data/photo-scenes`);
}

function temEnv(...nomes: string[]) {
  return nomes.every((n) => (process.env[n] ?? "").trim().length > 0);
}

/** O render-server é TCP puro, não HTTP — testa abrindo socket. */
function portaViva(porta: number, timeoutMs = 400): Promise<boolean> {
  return new Promise((resolve) => {
    const s = createConnection({ port: porta, host: "127.0.0.1" });
    const fim = (v: boolean) => {
      s.destroy();
      resolve(v);
    };
    s.setTimeout(timeoutMs);
    s.on("connect", () => fim(true));
    s.on("timeout", () => fim(false));
    s.on("error", () => fim(false));
  });
}

async function temBun() {
  const { execFile } = await import("child_process");
  return new Promise<boolean>((resolve) => {
    execFile("bun", ["--version"], { timeout: 3000 }, (e) => resolve(!e));
  });
}

/** O quadro de degradação: para cada peça, o que a ausência dela desliga. */
async function quadro() {
  const psdDirs = (process.env.PSD_DIRS ?? "")
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean);
  const psdOk = psdDirs.length > 0 && psdDirs.some((d) => existsSync(d));

  const linhas: Array<[boolean, string, string]> = [
    [
      temEnv("MONGODB_URI", "MONGODB_DB_NAME"),
      "MongoDB",
      "catálogo lê só o disco; ingest e publicar respondem 500",
    ],
    [psdOk, "PSD_DIRS", "nenhum PSD no catálogo (cenas de foto seguem)"],
    [
      (process.env.OVERLAY_DIRS ?? "").trim().length > 0,
      "OVERLAY_DIRS",
      "galeria de overlays (Luz/Sombra) vazia",
    ],
    [
      temEnv("VISANT_API_KEY") || existsSync(join(process.env.HOME ?? process.env.USERPROFILE ?? "", ".visant")),
      "Visant Labs",
      "lotes por marca (agent-cli, brand-kit) indisponíveis",
    ],
    [
      await portaViva(Number(process.env.RENDER_PORT ?? 4200)),
      `render-server :${process.env.RENDER_PORT ?? 4200}`,
      "navegar e buscar funciona; renderizar não (suba com `npm run render`)",
    ],
    [await temBun(), "bun", "`npm run render` não roda (o render-server precisa dele)"],
    [temEnv("REPLICATE_API_TOKEN"), "Replicate", "segmentação, profundidade, reluz e upscale desligados"],
    [temEnv("ANTHROPIC_API_KEY"), "Anthropic", "análise de cena desligada"],
    [temEnv("OPENAI_API_KEY"), "OpenAI", "geração de imagem desligada"],
    [temEnv("GEMINI_API_KEY"), "Gemini", "detecção assistida desligada"],
  ];

  console.log(`\n  ${bold("O que está ligado nesta máquina")}\n`);
  for (const [ativo, nome, efeito] of linhas) {
    console.log(
      ativo
        ? `  ${ok("●")} ${nome.padEnd(22)} ${off("ok")}`
        : `  ${off("○")} ${nome.padEnd(22)} ${off(efeito)}`,
    );
  }
}

async function main() {
  console.log(`\n  ${bold("mockup-store — setup")}\n`);
  checarNode();
  if (bloqueado) process.exit(1);
  prepararEnv();
  semearDemo();
  await quadro();
  console.log(
    `\n  Nada acima é obrigatório para subir.` +
      `\n  Próximo passo: ${bold("npm run dev")} → http://localhost:3000\n`,
  );
}

main().catch((e) => {
  console.error(`\n  Falhou: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
