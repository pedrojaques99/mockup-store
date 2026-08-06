/**
 * Portão do offline-first — o app sobe e serve SEM configuração nenhuma?
 *
 *   npm run check:offline                      # sobe o próprio servidor
 *   npm run check:offline -- --url http://…    # mede um que já está de pé
 *
 * É a prova de que o produto pode ser distribuído. Todo o resto do projeto roda
 * numa máquina com `.env.local` cheio, Mongo ligado e três drives montados —
 * nada disso existe na máquina de quem baixa o app.
 *
 * ## Duas armadilhas que já deixaram este portão verde POR ENGANO
 *
 * 1. **O Next carrega `.env.local` sozinho.** Passar um `env` mínimo para o
 *    processo filho não basta: o servidor lê o arquivo do disco e sobe
 *    configurado. O portão ficava verde medindo o app COM tudo ligado. Por isso
 *    o arquivo sai do caminho durante o teste e volta em `exit`, `SIGINT` e
 *    exceção.
 * 2. **`kill` no shell não mata o `next start` no Windows.** O servidor
 *    sobrevivia à rodada, e a seguinte batia no ZUMBI da anterior — respondendo
 *    com a configuração velha. `taskkill /T` mata a árvore.
 *
 * O modo `--url` existe para o CI, onde o clone é limpo por construção e subir
 * um segundo servidor só custaria minutos.
 *
 * Pré-requisito do modo próprio: `NEXT_DIST_DIR=.next-shipgate npx next build`.
 */
import { spawn, spawnSync } from "child_process";
import { mkdtempSync, renameSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const iUrl = process.argv.indexOf("--url");
const urlExterna = iUrl >= 0 ? process.argv[iUrl + 1].replace(/\/+$/, "") : null;
const PORTA = 4198;
const BASE = urlExterna ?? `http://127.0.0.1:${PORTA}`;

const ENV = ".env.local";
const BAK = ".env.local.portao-bak";
let movido = false;
let filho = null;

function restaurar() {
  if (movido && existsSync(BAK)) {
    renameSync(BAK, ENV);
    movido = false;
    console.log("[.env.local restaurado]");
  }
}
function matarArvore() {
  if (!filho) return;
  try {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/pid", String(filho.pid), "/T", "/F"], { stdio: "ignore", shell: true });
    } else {
      filho.kill();
    }
  } catch { /* já morreu */ }
}
function limpar() {
  matarArvore();
  restaurar();
}
process.on("exit", limpar);
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => { limpar(); process.exit(1); });
process.on("uncaughtException", (e) => { console.error(e); limpar(); process.exit(1); });

async function subir() {
  if (urlExterna) return true;
  if (existsSync(ENV)) { renameSync(ENV, BAK); movido = true; }
  const tmp = mkdtempSync(join(tmpdir(), "boxy-zero-"));
  filho = spawn("npx", ["next", "start", "-p", String(PORTA)], {
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      PATH: process.env.PATH,
      SYSTEMROOT: process.env.SYSTEMROOT,
      TEMP: process.env.TEMP,
      NODE_ENV: "production",
      NEXT_DIST_DIR: process.env.NEXT_DIST_DIR ?? ".next-shipgate",
      APP_CONFIG_PATH: join(tmp, "config.json"),
      LOCAL_DB_PATH: join(tmp, "catalog.sqlite"),
    },
  });
  let log = "";
  filho.stdout.on("data", (d) => (log += d));
  filho.stderr.on("data", (d) => (log += d));
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/api/config`)).ok) return true;
    } catch { /* ainda subindo */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.log("NÃO SUBIU\n" + log.slice(-1200));
  return false;
}

let falhas = 0;
async function bater(nome, caminho) {
  try {
    const r = await fetch(BASE + caminho);
    const t = await r.text();
    if (!r.ok) falhas++;
    console.log(`${r.ok ? "OK   " : "FALHA"} ${nome.padEnd(18)}${r.status}  ${t.slice(0, 78).replace(/\n/g, " ")}`);
    return t;
  } catch (e) {
    falhas++;
    console.log(`FALHA ${nome} -> ${e.message}`);
    return "";
  }
}

if (!(await subir())) process.exit(1);

console.log(`\n  PORTÃO OFFLINE — ${BASE}\n`);
console.log("--- o app serve sem configuração ---");
await bater("home responde", "/");
await bater("grid lista", "/api/references?limit=3");
await bater("busca acha", "/api/references?search=paper&limit=3");
await bater("facetas", "/api/references/facets");
const bruto = await bater("config lê", "/api/config");

let cfg0;
try {
  cfg0 = JSON.parse(bruto);
} catch {
  console.log("FALHA /api/config não devolveu JSON");
  process.exit(1);
}
console.log(
  `  catálogo: ${cfg0.catalogo} · acervo: ${cfg0.acervo.pastas.length} pastas · ` +
    `chaves definidas: ${cfg0.provedores.filter((p) => p.definida).length}`,
);

console.log("\n--- configurando PELO PAINEL, sem tocar em arquivo ---");
const SEGREDO = "sk-teste-1234567890abcdef";
const PASTA_TESTE = "Z:/portao-offline-pasta-de-teste";

/**
 * No modo `--url` a config é a config DE VERDADE da máquina, e este portão
 * escreve nela. Sem desfazer, ele deixa uma chave falsa e uma pasta inventada
 * gravadas — foi o que aconteceu na primeira execução: `data/config.json` ficou
 * com `sk-teste-…` dentro. Guardo o estado anterior e devolvo no fim.
 */
const antes = {
  psdDirs: cfg0.acervo.origem === "config" ? cfg0.acervo.pastas.map((p) => p.caminho) : [],
  tinhaChave: cfg0.provedores.find((x) => x.chave === "OPENAI_API_KEY")?.origem === "config",
};
async function desfazer() {
  if (!urlExterna) return; // servidor próprio usa config em diretório temporário
  await fetch(`${BASE}/api/config`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    // string vazia APAGA a chave (ver gravarConfig). Só apago o que EU criei.
    body: JSON.stringify({
      psdDirs: antes.psdDirs,
      ...(antes.tinhaChave ? {} : { chaves: { OPENAI_API_KEY: "" } }),
    }),
  }).catch(() => {});
}

const put = await fetch(`${BASE}/api/config`, {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ chaves: { OPENAI_API_KEY: SEGREDO }, psdDirs: [PASTA_TESTE] }),
});
console.log(`${put.ok ? "OK   " : "FALHA"} config grava      ${put.status}`);
if (!put.ok) falhas++;

const cfg1 = await (await fetch(`${BASE}/api/config`)).json();
const o = cfg1.provedores.find((x) => x.chave === "OPENAI_API_KEY");
console.log(`  chave: definida=${o.definida} máscara=${o.mascara} origem=${o.origem}`);

// A chave em claro nunca pode atravessar para o cliente.
if (JSON.stringify(cfg1).includes("1234567890")) {
  console.log("FALHA a chave VAZOU em claro na resposta");
  falhas++;
}
/**
 * Chave digitada no painel não pode se disfarçar de variável de ambiente: a UI
 * travaria o campo dizendo "definido no .env.local" para o que a pessoa acabou
 * de digitar ali. Foi assim que o defeito apareceu.
 *
 * A checagem só vale quando o ambiente NÃO manda nessa chave. Numa máquina com
 * `.env.local` preenchido, `origem: "env"` é a resposta certa — a precedência é
 * essa de propósito — e exigir "config" ali seria vermelho falso.
 */
const envMandaNaChave =
  cfg0.provedores.find((x) => x.chave === "OPENAI_API_KEY")?.origem === "env";
if (envMandaNaChave) {
  console.log(`  (origem "env" esperada: esta máquina define a chave no ambiente)`);
} else if (o.origem !== "config") {
  console.log(`FALHA origem devia ser "config", veio "${o.origem}"`);
  falhas++;
}

const acervoNoEnv = cfg0.acervo.origem === "env";
if (!acervoNoEnv && !cfg1.acervo.pastas.some((p) => p.caminho === PASTA_TESTE)) {
  console.log("FALHA a pasta gravada não voltou no acervo");
  falhas++;
}

await desfazer();
console.log(falhas ? `\n=== PORTÃO VERMELHO: ${falhas} ===` : "\n=== PORTÃO VERDE ===");
process.exit(falhas ? 1 : 0);
