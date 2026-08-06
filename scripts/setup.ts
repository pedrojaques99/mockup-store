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
import { createInterface } from "readline/promises";
import {
  lerConfig, gravarConfig, pastasAcervo, PROVEDORES, valorChave, caminhoConfig,
} from "../src/lib/app-config";

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

/**
 * Uma chave conta como presente venha do ambiente OU do painel. Medir só o
 * `process.env` faria o quadro dizer "desligado" para o que a pessoa acabou de
 * configurar na tela — e o valor deste script é justamente não mentir.
 */
function temChave(nome: string) {
  return valorChave(nome as Parameters<typeof valorChave>[0]).origem !== "ausente";
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
  const psdDirs = pastasAcervo().valor;
  const psdOk = psdDirs.length > 0 && psdDirs.some((d) => existsSync(d));

  const linhas: Array<[boolean, string, string]> = [
    [
      temEnv("MONGODB_URI", "MONGODB_DB_NAME"),
      "MongoDB",
      "catálogo local (SQLite) — é o modo normal para uso pessoal",
    ],
    [psdOk, "acervo (PSDs)", "nenhum PSD no catálogo (cenas de foto seguem)"],
    [
      (process.env.OVERLAY_DIRS ?? "").trim().length > 0,
      "OVERLAY_DIRS",
      "galeria de overlays (Luz/Sombra) vazia",
    ],
    [
      temChave("VISANT_API_KEY") || existsSync(join(process.env.HOME ?? process.env.USERPROFILE ?? "", ".visant")),
      "Visant Labs",
      "lotes por marca (agent-cli, brand-kit) indisponíveis",
    ],
    [
      await portaViva(Number(process.env.RENDER_PORT ?? 4200)),
      `render-server :${process.env.RENDER_PORT ?? 4200}`,
      "navegar e buscar funciona; renderizar não (suba com `npm run render`)",
    ],
    [await temBun(), "bun", "`npm run render` não roda (o render-server precisa dele)"],
    [temChave("REPLICATE_API_TOKEN"), "Replicate", "segmentação, profundidade, reluz e upscale desligados"],
    [temChave("ANTHROPIC_API_KEY"), "Anthropic", "análise de cena desligada"],
    [temChave("OPENAI_API_KEY"), "OpenAI", "geração de imagem desligada"],
    [temChave("GEMINI_API_KEY"), "Gemini", "detecção assistida desligada"],
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

/**
 * A parte interativa — só quando há terminal de verdade.
 *
 * Este script roda em dois contextos que não podem se confundir: a máquina de
 * quem acabou de baixar o app (quer ser guiada) e o CI (não tem teclado; uma
 * pergunta ali trava o job até o timeout). O portão é `isTTY`, e `--sim` força
 * o modo mudo para quem quiser testar.
 */
function interativo(): boolean {
  if (process.argv.includes("--mudo")) return false;
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

async function perguntar() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log(`\n  ${bold("Vamos configurar")} ${off("(Enter pula qualquer pergunta)")}\n`);

    // 1. O acervo. É a única resposta que muda o que aparece na tela.
    const acervo = pastasAcervo();
    if (acervo.origem === "env") {
      console.log(`  ${ok("✓")} acervo definido no .env.local ${off("(o arquivo vence)")}`);
    } else {
      const atual = acervo.valor;
      if (atual.length) console.log(`  ${off(`acervo atual: ${atual.join(", ")}`)}`);
      const resp = (
        await rl.question(`  ${bold("Onde estão os seus PSDs?")} ${off("(caminho da pasta)")}\n  > `)
      ).trim();
      if (resp) {
        const limpo = resp.replace(/^["']|["']$/g, "").replace(/\\/g, "/");
        if (!existsSync(limpo)) {
          console.log(`  ${warn("!")} não encontrei "${limpo}" — gravei mesmo assim, corrija depois no painel.`);
        }
        gravarConfig({ psdDirs: [...new Set([...atual, limpo])] });
        console.log(`  ${ok("✓")} acervo salvo em ${caminhoConfig()}`);
      }
    }

    // 2. Seed do time — só oferece se o arquivo estiver ali.
    const seed = join(ROOT, "data", "catalog-seed.json.gz");
    if (existsSync(seed)) {
      const r = (await rl.question(`\n  ${bold("Achei um seed do acervo. Importar?")} ${off("[S/n]")} `)).trim().toLowerCase();
      if (r !== "n" && r !== "nao" && r !== "não") {
        const { execFileSync } = await import("child_process");
        try {
          execFileSync("npx", ["tsx", "scripts/catalog-seed.ts", "import"], {
            stdio: "inherit", shell: process.platform === "win32",
          });
        } catch {
          console.log(`  ${warn("!")} import falhou — rode \`npm run seed:import\` depois.`);
        }
      }
    }

    // 3. Chaves. Todas opcionais, e o script diz o que cada uma liga.
    console.log(`\n  ${bold("Chaves")} ${off("— nenhuma é obrigatória; ficam só nesta máquina")}`);
    for (const p of PROVEDORES) {
      const { origem } = valorChave(p.chave);
      if (origem === "env") {
        console.log(`  ${ok("✓")} ${p.nome.padEnd(14)} ${off("no .env.local")}`);
        continue;
      }
      if (origem === "config") {
        console.log(`  ${ok("✓")} ${p.nome.padEnd(14)} ${off("já salva")}`);
        continue;
      }
      const v = (await rl.question(`  ${p.nome.padEnd(14)} ${off(`liga ${p.liga}`)}\n  > `)).trim();
      if (v) {
        gravarConfig({ chaves: { [p.chave]: v } });
        console.log(`  ${ok("✓")} ${p.nome} salva`);
      }
    }
  } finally {
    rl.close();
  }
}

async function main() {
  console.log(`\n  ${bold("mockup-store — setup")}\n`);
  checarNode();
  if (bloqueado) process.exit(1);
  prepararEnv();
  semearDemo();

  if (interativo()) {
    await perguntar();
  } else if (!lerConfig().psdDirs?.length && pastasAcervo().origem === "ausente") {
    console.log(
      `  ${off("sem terminal interativo — pulando as perguntas.")}` +
        `\n  ${off("configure o acervo e as chaves na engrenagem do app, ou rode `npm run setup` num terminal.")}`,
    );
  }

  await quadro();
  console.log(
    `\n  Nada acima é obrigatório para subir.` +
      `\n  Próximo passo: ${bold("npm run dev")} → http://localhost:3000` +
      `\n  ${off("Tudo isso também é editável na engrenagem, dentro do app.")}\n`,
  );
}

main().catch((e) => {
  console.error(`\n  Falhou: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
