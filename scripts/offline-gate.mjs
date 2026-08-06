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
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "os";
import { join } from "path";

const iUrl = process.argv.indexOf("--url");
const urlExterna = iUrl >= 0 ? process.argv[iUrl + 1].replace(/\/+$/, "") : null;
/**
 * `--ingest <pasta>` liga a checagem do laço central: plugar pasta, scan,
 * commit, e o card aparecendo no grid. Precisa de PSD de verdade, que o runner
 * do CI não tem — sem a flag a checagem é **pulada e reportada**, nunca omitida
 * em silêncio.
 */
const iIng = process.argv.indexOf("--ingest");
const pastaIngest = iIng >= 0 ? process.argv[iIng + 1] : null;
const PORTA = 4198;
const BASE = urlExterna ?? `http://127.0.0.1:${PORTA}`;

const ENV = ".env.local";
const BAK = ".env.local.portao-bak";
let movido = false;
let filho = null;
/** Caminho do banco quando o portão sobe o próprio servidor. */
let bancoDoTeste = null;

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
      LOCAL_DB_PATH: (bancoDoTeste = join(tmp, "catalog.sqlite")),
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

/**
 * O laço central do usuário público: ele pluga a pasta dele e espera ver os
 * mockups. Sem esta checagem o portão anterior media só LEITURA de catálogo, e
 * a escrita (que é a primeira coisa que a pessoa faz) ficava sem cobertura.
 */
console.log("\n--- o laço central: plugar pasta e ver o mockup ---");
if (!pastaIngest) {
  console.log("  PULADO (rode com --ingest \"<pasta com PSD>\" para verificar)");
} else if (!existsSync(pastaIngest)) {
  console.log(`FALHA pasta não existe: ${pastaIngest}`);
  falhas++;
} else {
  const ESTUDIO = "Portão Offline";

  /**
   * Aponta o acervo para a pasta que vai ser ingerida, que é o que o usuário
   * faz de verdade: ele adiciona a pasta dele e ingere dela.
   *
   * Sem isto o portão configurava uma pasta de teste inventada e ingeria de
   * OUTRO lugar; aí o caminho saía absoluto (corretamente, porque o arquivo não
   * mora em raiz nenhuma) e o portão acusava um defeito que não existia.
   */
  await fetch(`${BASE}/api/config`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ psdDirs: [pastaIngest] }),
  });

  const rs = await fetch(`${BASE}/api/ingest-folder/scan?path=${encodeURIComponent(pastaIngest)}`);
  console.log(`${rs.ok ? "OK   " : "FALHA"} scan               ${rs.status}`);
  if (!rs.ok) falhas++;
  else {
    const { items = [] } = await rs.json();
    const arquivos = items
      .filter((i) => i.verdict !== "trash")
      .map((i) => ({ name: i.name, path: i.path, ext: i.ext, sizeBytes: i.sizeBytes, studio: ESTUDIO }));

    const rc = await fetch(`${BASE}/api/ingest-folder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folderPath: pastaIngest, files: arquivos, studio: ESTUDIO }),
    });
    console.log(`${rc.ok ? "OK   " : "FALHA"} commit             ${rc.status}`);
    if (!rc.ok) falhas++;

    await new Promise((r) => setTimeout(r, 1500));
    const grid = await (await fetch(`${BASE}/api/references?limit=200`)).json();
    const meus = (grid.references ?? []).filter((x) => x.studio === ESTUDIO);
    console.log(`${meus.length ? "OK   " : "FALHA"} o card entra no grid  ${meus.length}`);
    if (!meus.length) falhas++;
    else {
      // O caminho tem de sair PORTÁTIL do ingest. Absoluto prende o registro a
      // esta máquina, e prende calado: noutra letra de drive o acervo encolhe
      // sem erro na tela. Aqui o que volta já vem resolvido, então o sinal é o
      // arquivo existir de verdade no disco.
      const alvo = meus[0];
      const ok = alvo.psdPath ? existsSync(alvo.psdPath) : false;
      console.log(`${ok ? "OK   " : "FALHA"} o PSD resolve no disco  ${alvo.psdPath ?? "(sem psdPath)"}`);
      if (!ok) falhas++;

      /**
       * E o caminho GRAVADO é portátil?
       *
       * A checagem acima não basta, e isso foi medido: sabotando o `paraLocal`
       * para não resolver `{acervo}`, o portão continuou VERDE — porque o
       * `resolver()` cai numa busca por nome dentro das raízes e reencontra o
       * arquivo. A rede de segurança é boa para o usuário e péssima para o
       * portão: ela esconde exatamente o defeito que faz o acervo encolher
       * calado noutra máquina. Só lendo o valor no banco isso aparece.
       */
      if (!bancoDoTeste) {
        console.log("  (portabilidade do caminho: PULADO no modo --url, sem acesso ao banco)");
      } else {
        const db = new DatabaseSync(bancoDoTeste, { readOnly: true });
        const linha = db
          .prepare("SELECT doc FROM community_presets WHERE json_extract(doc,'$.studio') = ?")
          .get(ESTUDIO);
        db.close();
        const gravado = linha ? JSON.parse(linha.doc).psdPath : null;
        const portavel = String(gravado ?? "").startsWith("{acervo}");
        console.log(`${portavel ? "OK   " : "FALHA"} caminho gravado portátil  ${gravado ?? "(nada)"}`);
        if (!portavel) falhas++;
      }
    }
  }
}

/**
 * O render, que é o produto. Sem isto o portão prova que dá para NAVEGAR sem
 * Mongo, e o usuário veio aqui para exportar um PNG.
 *
 * ## Por que teste diferencial, e não "a arte apareceu"
 *
 * Medir se a arte entrou procurando cor saturada ou desvio-padrão **aprova
 * mockup quebrado** — este projeto já pagou por isso: um pôster BRANCO (arte não
 * entrou) pontuou 3,4% porque o grafite da parede tinha vermelho e amarelo,
 * enquanto crachá e copo legítimos deram 2,2%. Cenário colorido é
 * indistinguível de arte, por cor.
 *
 * O diferencial resolve porque o cenário é IDÊNTICO nos dois renders e se
 * cancela: renderiza a mesma face com duas artes distintas e conta o que mudou.
 * Pixel que muda é pixel que a arte controla. Quebrado dá 0,00% — provado
 * sabotando a rota para ignorar a arte recebida: 0,00% e `exit 1`.
 *
 * ## O que este teste NÃO prova, medido
 *
 * Ele responde "a arte entrou?", **não** "a arte entrou no lugar certo?".
 * Mandando um `smartObject` que não casa camada nenhuma, o resultado foi
 * idêntico ao do slot correto (31,45% nos dois) — porque num PSD de UMA face
 * não existe outro lugar para a arte ir. Num mural multi-face o slot errado
 * mudaria o alvo, e este teste continuaria verde.
 *
 * Para essa classe, o que pega é olhar a contact sheet. Está registrado em
 * `AGENTS.md`: o slot é `face.smartObject`, nunca `face.name`.
 */
console.log("\n--- o render, que é o produto ---");
async function quantoMudou(a, b) {
  const sharp = (await import("sharp")).default;
  // Reduz os dois ao mesmo tamanho antes de comparar: a métrica é a FRAÇÃO do
  // quadro que muda, e ela não depende da resolução. Menor também é ordens de
  // grandeza mais barato que varrer 3159x1777 duas vezes.
  const cru = (buf) => sharp(buf).resize(400, 400, { fit: "fill" }).raw().toBuffer({ resolveWithObject: true });
  const [ia, ib] = await Promise.all([cru(a), cru(b)]);
  const ca = ia.info.channels, cb = ib.info.channels;
  if (ia.data.length / ca !== ib.data.length / cb) return null;
  const total = ia.info.width * ia.info.height;
  let mudou = 0;
  for (let i = 0; i < total; i++) {
    const oa = i * ca, ob = i * cb;
    if (
      Math.abs(ia.data[oa] - ib.data[ob]) > 8 ||
      Math.abs(ia.data[oa + 1] - ib.data[ob + 1]) > 8 ||
      Math.abs(ia.data[oa + 2] - ib.data[ob + 2]) > 8
    ) mudou++;
  }
  return (mudou / total) * 100;
}

/** Arte chapada de uma cor só, em PNG, sem depender de arquivo no disco. */
async function arteChapada(r, g, b, lado = 1200) {
  const sharp = (await import("sharp")).default;
  return (await sharp({
    create: { width: lado, height: lado, channels: 3, background: { r, g, b } },
  }).png().toBuffer()).toString("base64");
}

if (!pastaIngest) {
  console.log("  PULADO (o render precisa de um PSD, use --ingest)");
} else {
  const grid = await (await fetch(`${BASE}/api/references?limit=200`)).json();
  const alvo = (grid.references ?? []).find((x) => x.studio === "Portão Offline" && x.psdPath);
  if (!alvo) {
    console.log("FALHA sem PSD ingerido para renderizar");
    falhas++;
  } else {
    const info = await (await fetch(`${BASE}/api/psd-info?name=${encodeURIComponent(alvo.psdFileName)}`)).json();
    // ⚠️ A face vem do `computeFaces` do engine, NUNCA de `meta.smartObjects`:
    // preenchendo todo smart object, a arte pinta o cenário de fundo.
    const face = (info.faces ?? [])[0];
    if (!face) {
      console.log("FALHA o PSD não expôs face editável");
      falhas++;
    } else {
      // ⚠️ E o slot é `face.smartObject`, NUNCA `face.name`: o `name` é rótulo
      // curto de UI e casa o alvo errado, cobrindo a cena inteira. O QA por
      // desvio-padrão APROVA isso; só o diferencial pega.
      const slot = face.smartObject;
      console.log(`  face: "${face.name}" · slot: ${String(slot).slice(0, 60)}`);

      const renderizar = async (b64) => {
        const r = await fetch(`${BASE}/api/render`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ psdPath: alvo.psdPath, preview: true, arts: [{ smartObject: slot, artBase64: b64 }] }),
        });
        if (!r.ok) return { ok: false, status: r.status, msg: (await r.text()).slice(0, 120) };
        // A rota devolve os BYTES da imagem, não JSON (jpeg no preview, png no
        // full). Ler com `.json()` estoura no parser e mostra o erro errado.
        const tipo = r.headers.get("content-type") ?? "";
        if (!tipo.startsWith("image/")) {
          return { ok: false, status: 200, msg: `não veio imagem: ${tipo}` };
        }
        return { ok: true, buf: Buffer.from(await r.arrayBuffer()), tipo };
      };

      const r1 = await renderizar(await arteChapada(255, 0, 0));
      console.log(`${r1.ok ? "OK   " : "FALHA"} render A (vermelho)  ${r1.ok ? `${(r1.buf.length / 1024).toFixed(0)} KB` : `${r1.status} ${r1.msg}`}`);
      if (!r1.ok) falhas++;

      const r2 = await renderizar(await arteChapada(0, 0, 255));
      console.log(`${r2.ok ? "OK   " : "FALHA"} render B (azul)      ${r2.ok ? `${(r2.buf.length / 1024).toFixed(0)} KB` : `${r2.status} ${r2.msg}`}`);
      if (!r2.ok) falhas++;

      if (r1.ok && r2.ok) {
        const pct = await quantoMudou(r1.buf, r2.buf);
        if (pct === null) {
          console.log("  (diferencial: PULADO, não consegui decodificar as imagens)");
        } else {
          // 0,3% é o corte que o `publish-pack` já usa. Quebrado dá 0,00%.
          const entrou = pct > 0.3;
          console.log(`${entrou ? "OK   " : "FALHA"} a arte ENTROU        ${pct.toFixed(2)}% do quadro muda entre as duas artes`);
          if (!entrou) falhas++;
        }
      }
    }
  }
}

await desfazer();
console.log(falhas ? `\n=== PORTÃO VERMELHO: ${falhas} ===` : "\n=== PORTÃO VERDE ===");
process.exit(falhas ? 1 : 0);
