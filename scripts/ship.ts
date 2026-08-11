/**
 * `npm run ship` — tudo que precisa estar verde antes de empurrar.
 *
 * Existe porque os portões deste repo cresceram para dezessete comandos, cada um
 * com pré-requisito próprio (uns querem o app de pé, um quer o render-server, um
 * quer PSD no disco). Guardar essa lista na cabeça é como não ter portão: roda-se
 * os três de sempre e o resto vira decoração.
 *
 * TRÊS REGRAS QUE VÊM DE ERRO PAGO NESTE REPO
 *
 * 1. **Pular é resultado, não silêncio.** Portão que não pôde rodar aparece como
 *    PULADO com o motivo, e o resumo final diz quantos foram. Verde escondendo
 *    ausência é pior que vermelho: foi assim que o `check:offline` já passou
 *    medindo um app configurado, e que o `pack:publish` aprovou mockup quebrado.
 * 2. **Servidor de pé é reaproveitado, nunca duplicado.** Dois `next` no mesmo
 *    `.next` dão 404 com portão verde. Se a porta responde, usa-se ela.
 * 3. **No Windows `kill` não mata `next`/`bun`.** O que este script sobe, ele
 *    derruba com `taskkill /T` — senão a rodada seguinte bate no ZUMBI da
 *    anterior e mede o código velho. Aconteceu hoje com o render-server.
 *
 * Uso:
 *   npm run ship                 # estáticos + os que dão para subir sozinho
 *   npm run ship -- --rapido     # só os estáticos (tsc, lint, ui:audit, test)
 *   npm run ship -- --url http://localhost:4100   # usa um app já de pé
 *   npm run ship -- --sem-build  # pula o `next build` (o mais lento)
 */
import { spawnSync, spawn } from "child_process";
import { existsSync } from "fs";
import { createConnection } from "net";

const argv = process.argv.slice(2);
const tem = (f: string) => argv.includes(f);
const valor = (f: string, padrao = "") => {
  const i = argv.indexOf(f);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : padrao;
};

const RAPIDO = tem("--rapido");
const SEM_BUILD = tem("--sem-build");
const SEM_SERVIDOR = tem("--sem-servidor");
const URL_ARG = valor("--url");
/**
 * `--somente a,b,c` — roda só esses portões (por id). É o que o CI usa: num
 * runner limpo não existe acervo nem render-server, e pedir portão que não pode
 * rodar seria pedir PULADO — que com `--exigir` é falha.
 */
const SOMENTE = valor("--somente")
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean);
/**
 * `--exigir` — PULADO vira FALHA. Local, pular é informação: você vê no resumo e
 * decide. No CI ninguém lê, e portão que se pula sozinho é portão que não
 * existe. Por isso o CI liga isto e diz explicitamente o que espera rodar.
 */
const EXIGIR = tem("--exigir");
const PORTA_APP = 4123; // porta própria: não briga com o dev que você deixou aberto
/**
 * ⚠️ `distDir` PRÓPRIO, sempre.
 *
 * `next build` no mesmo `.next` que um `next dev` aberto corrompe o estado dos
 * dois: o dev passa a servir a home SEM CSS e SEM cards, e os portões visuais
 * acusam "texto a 1.06:1" e "página rola horizontalmente" — defeitos que o
 * build ACABOU de criar, não que existiam. Aconteceu na primeira rodada deste
 * script: 4 falhas, nenhuma real, e o `tsc` junto porque o `.next/types` estava
 * sendo reescrito embaixo dele. O repo já documenta a saída (`NEXT_DIST_DIR`);
 * faltava o portão usá-la.
 */
const DIST = ".next-ship";
const ENV_DIST = { ...process.env, NEXT_DIST_DIR: DIST };

type Estado = "ok" | "falha" | "pulado";
interface Resultado {
  nome: string;
  estado: Estado;
  detalhe: string;
  ms: number;
}
const placar: Resultado[] = [];

const cor = { ok: "\x1b[32m", falha: "\x1b[31m", pulado: "\x1b[33m", off: "\x1b[0m", fraco: "\x1b[90m" };

function linha(r: Resultado) {
  const marca = r.estado === "ok" ? "OK   " : r.estado === "falha" ? "FALHA" : "PULA ";
  const tempo = r.ms ? `${cor.fraco}${(r.ms / 1000).toFixed(1)}s${cor.off}` : "";
  console.log(`  ${cor[r.estado]}${marca}${cor.off}  ${r.nome.padEnd(26)} ${r.detalhe} ${tempo}`);
}

function rodar(
  nome: string,
  cmd: string,
  args: string[],
  opts: { pularSe?: string; env?: NodeJS.ProcessEnv } = {}
) {
  if (SOMENTE.length && !SOMENTE.includes(nome)) return false;
  if (opts.pularSe) {
    // Com `--exigir`, pular é falhar: o CI pediu este portão nominalmente.
    placar.push({
      nome,
      estado: EXIGIR ? "falha" : "pulado",
      detalhe: EXIGIR ? `exigido, mas não pôde rodar: ${opts.pularSe}` : opts.pularSe,
      ms: 0,
    });
    linha(placar[placar.length - 1]);
    return false;
  }
  const t0 = Date.now();
  const r = spawnSync(cmd, args, {
    encoding: "utf8",
    shell: process.platform === "win32",
    env: opts.env ?? process.env,
  });
  const ms = Date.now() - t0;
  const saida = `${r.stdout ?? ""}\n${r.stderr ?? ""}`;
  const ok = r.status === 0;
  const detalhe = ok ? "" : ultimaLinhaUtil(saida);
  placar.push({ nome, estado: ok ? "ok" : "falha", detalhe, ms });
  linha(placar[placar.length - 1]);
  if (!ok) {
    // O erro inteiro, uma vez — quem for consertar precisa do texto, não do resumo.
    console.log(`${cor.fraco}${saida.trim().split("\n").slice(-25).join("\n")}${cor.off}\n`);
  }
  return ok;
}

/** A última linha que diz alguma coisa — pula vazias e ruído de npm. */
function ultimaLinhaUtil(saida: string): string {
  const linhas = saida
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !/^npm (ERR|error|warn)/i.test(l) && !/^>/.test(l));
  return linhas[linhas.length - 1]?.slice(0, 110) ?? "sem saída";
}

function portaResponde(porta: number, host = "127.0.0.1"): Promise<boolean> {
  return new Promise((resolve) => {
    const s = createConnection({ port: porta, host });
    const fim = (v: boolean) => {
      s.destroy();
      resolve(v);
    };
    s.on("connect", () => fim(true));
    s.on("error", () => fim(false));
    setTimeout(() => fim(false), 1200);
  });
}

async function esperarHttp(url: string, segundos: number): Promise<boolean> {
  for (let i = 0; i < segundos; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (r.ok) return true;
    } catch {
      /* ainda subindo */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

/** `taskkill /T` no Windows: `kill` não derruba a árvore do next/bun. */
function derrubar(pid?: number) {
  if (!pid) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/F", "/T", "/PID", String(pid)], { encoding: "utf8" });
  else process.kill(-pid, "SIGKILL");
}

async function main() {
  const t0 = Date.now();
  console.log(`\n  ${cor.fraco}ship — os portões antes de empurrar${cor.off}\n`);

  // ── 1. Git: o que você está prestes a empurrar ───────────────────────────
  const sujo = spawnSync("git", ["status", "--porcelain"], { encoding: "utf8" }).stdout?.trim() ?? "";
  const branch = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8" }).stdout?.trim() ?? "?";
  const naFrente = spawnSync("git", ["rev-list", "--count", "@{u}..HEAD"], { encoding: "utf8" }).stdout?.trim() || "0";
  const arquivosSujos = sujo ? sujo.split("\n").length : 0;
  console.log(
    `  ${cor.fraco}branch ${branch} · ${naFrente} commit(s) para empurrar · ${arquivosSujos} arquivo(s) sem commit${cor.off}\n`
  );

  // ── 2. Estáticos: não precisam de nada de pé ─────────────────────────────
  rodar("tsc", "npx", ["tsc", "--noEmit"]);
  rodar("lint", "npm", ["run", "lint"]);
  rodar("ui:audit", "npm", ["run", "ui:audit"]);
  rodar("test", "npm", ["test"]);

  if (RAPIDO) return fechar(t0);

  rodar("build", "npx", ["next", "build"], {
    pularSe: SEM_BUILD ? "--sem-build" : undefined,
    env: ENV_DIST,
  });

  // Os que precisam do app respondendo. Se `--somente` não pede nenhum deles,
  // nem procura servidor: subir um app para não usar é minuto jogado fora.
  const COM_SERVIDOR = [
    "smoke",
    "visual:ingest",
    "check:offline",
    "visual:console",
    "visual:home",
    "check:colors",
  ];
  if (SEM_SERVIDOR) return fechar(t0);
  if (SOMENTE.length && !SOMENTE.some((id) => COM_SERVIDOR.includes(id))) return fechar(t0);

  // ── 3. Portões que precisam do app respondendo ───────────────────────────
  let url = URL_ARG;
  let pid: number | undefined;

  if (!url) {
    // Reaproveita um dev já aberto antes de subir outro: dois `next` no mesmo
    // `.next` dão 404 com portão verde.
    for (const p of [4100, 3000]) {
      if (await portaResponde(p)) {
        url = `http://localhost:${p}`;
        console.log(`  ${cor.fraco}app já de pé na ${p} — reaproveitando${cor.off}`);
        break;
      }
    }
  }

  if (!url && !SEM_BUILD && existsSync(DIST)) {
    console.log(`  ${cor.fraco}subindo o app na ${PORTA_APP}...${cor.off}`);
    const filho = spawn("npx", ["next", "start", "-p", String(PORTA_APP)], {
      shell: process.platform === "win32",
      stdio: "ignore",
      detached: process.platform !== "win32",
      env: ENV_DIST,
    });
    pid = filho.pid;
    if (await esperarHttp(`http://localhost:${PORTA_APP}`, 90)) url = `http://localhost:${PORTA_APP}`;
    else derrubar(pid);
  }

  const semApp = url ? undefined : "app não está de pé (rode `npm run dev` ou passe --url)";

  try {
    rodar("smoke", "npm", ["run", "smoke", "--", "--url", url || ""], { pularSe: semApp });

    // A fixture é o que torna a checagem de virtualização real em vez de pulada.
    if (!semApp && (!SOMENTE.length || SOMENTE.includes("visual:ingest"))) {
      spawnSync("npm", ["run", "fixture:virt"], { encoding: "utf8", shell: process.platform === "win32" });
    }
    rodar("visual:ingest", "npm", ["run", "visual:ingest", "--", "--url", url || ""], { pularSe: semApp });
    rodar("check:offline", "npm", ["run", "check:offline", "--", "--url", url || ""], { pularSe: semApp });
    rodar("visual:console", "npm", ["run", "visual:console", "--", "--url", url || ""], { pularSe: semApp });
    rodar("visual:home", "npm", ["run", "visual:home", "--", "--url", url || ""], { pularSe: semApp });

    // Cor precisa do render-server TCP, não só do app.
    const temRender = await portaResponde(4200);
    rodar("check:colors", "npm", ["run", "check:colors", "--", "--url", url || ""], {
      pularSe: semApp ?? (temRender ? undefined : "render-server fora do ar (`npm run render`)"),
    });
  } finally {
    if (pid) {
      derrubar(pid);
      console.log(`  ${cor.fraco}app derrubado (taskkill /T)${cor.off}`);
    }
  }

  fechar(t0);
}

function fechar(t0: number) {
  const falhas = placar.filter((r) => r.estado === "falha");
  const pulados = placar.filter((r) => r.estado === "pulado");
  const oks = placar.filter((r) => r.estado === "ok");
  const seg = ((Date.now() - t0) / 1000).toFixed(0);

  console.log(
    `\n  ${oks.length} ok · ${cor.falha}${falhas.length} falha(s)${cor.off} · ${cor.pulado}${pulados.length} pulado(s)${cor.off} · ${seg}s\n`
  );

  if (pulados.length) {
    console.log(`  ${cor.pulado}Não medido — isto NÃO é verde:${cor.off}`);
    for (const p of pulados) console.log(`    ${p.nome}: ${p.detalhe}`);
    console.log("");
  }

  if (falhas.length) {
    console.log(`  ${cor.falha}Não empurre.${cor.off} Conserte: ${falhas.map((f) => f.nome).join(", ")}\n`);
    process.exit(1);
  }

  console.log(`  ${cor.ok}Pode empurrar.${cor.off}\n`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
