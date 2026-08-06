/**
 * Seed do acervo — exporta o catálogo para um arquivo portátil e importa numa
 * máquina qualquer, sem reindexar PSD nenhum.
 *
 *   npx tsx --env-file=.env.local scripts/catalog-seed.ts export [--out <arq>]
 *   npx tsx scripts/catalog-seed.ts import [--from <arq>] [--acervo <pasta>]
 *   npx tsx scripts/catalog-seed.ts status
 *
 * ## Por que não basta "cada um roda o scan"
 *
 * Reindexar não é copiar linha: é **abrir cada PSD** para extrair faces e smart
 * objects. É a parte cara do catálogo, e é a única que não dá para recalcular
 * de graça. O seed carrega esse trabalho já feito.
 *
 * ## Por que não basta compartilhar o Mongo
 *
 * O que está gravado lá é `Z:/BOXY/Produtos/…` — caminho absoluto, com letra de
 * drive. Numa máquina que monta o mesmo acervo em `Y:`, esses registros apontam
 * para o nada, e o `psd-presence` os esconde: o acervo **encolhe sem erro na
 * tela**. O export converte para `{acervo}/…` (ver `psd-roots.ts`) e o import
 * reata com a pasta local. É a mesma mudança que faz o app funcionar para o
 * público, usada aqui para o time.
 */
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import { gzipSync, gunzipSync } from "zlib";
import { dirname, join } from "path";
import { paraPortavel, ehPortavel, raizes } from "../src/lib/psd-roots";
import { bancoLocal, caminhoDoBanco } from "../src/lib/store-sqlite";

const ok = (s: string) => `\x1b[32m${s}\x1b[0m`;
const off = (s: string) => `\x1b[90m${s}\x1b[0m`;
const warn = (s: string) => `\x1b[33m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;

const SEED_PADRAO = join(process.cwd(), "data", "catalog-seed.json.gz");
const COLECOES = ["community_presets", "psd_metadata"] as const;
/** Campos que carregam caminho de arquivo e precisam virar portáteis. */
const CAMPOS_CAMINHO = ["psdPath", "filePath", "sourcePath"] as const;

interface Seed {
  versao: 1;
  geradoEm: string;
  raizes: string[];
  colecoes: Record<string, Record<string, unknown>[]>;
}

function arg(nome: string): string | undefined {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function portabilizar(doc: Record<string, unknown>): Record<string, unknown> {
  const saida = { ...doc };
  delete saida._id; // ObjectId do Mongo não atravessa e não serve para nada aqui.
  for (const campo of CAMPOS_CAMINHO) {
    const v = saida[campo];
    if (typeof v === "string" && v) saida[campo] = paraPortavel(v);
  }
  return saida;
}

async function exportar() {
  const { MongoClient } = await import("mongodb");
  const uri = process.env.MONGODB_URI;
  const nome = process.env.MONGODB_DB_NAME;
  if (!uri || !nome) {
    console.error(
      `\n  ${warn("✗")} export lê do Mongo e falta MONGODB_URI/MONGODB_DB_NAME.` +
        `\n    Rode com --env-file=.env.local numa máquina que tenha o banco.\n`,
    );
    process.exit(1);
  }
  const rs = raizes();
  if (!rs.length) {
    console.error(
      `\n  ${warn("✗")} PSD_DIRS vazio — sem raiz, todo caminho sairia absoluto` +
        `\n    e o seed não serviria em outra máquina. Configure PSD_DIRS e repita.\n`,
    );
    process.exit(1);
  }

  const cliente = new MongoClient(uri);
  await cliente.connect();
  const db = cliente.db(nome);

  const seed: Seed = {
    versao: 1,
    geradoEm: new Date().toISOString(),
    raizes: rs.map((r) => r.caminho),
    colecoes: {},
  };

  let portateis = 0;
  let absolutos = 0;
  for (const col of COLECOES) {
    const docs = await db.collection(col).find({}).toArray();
    seed.colecoes[col] = docs.map((d) => {
      const p = portabilizar(d as Record<string, unknown>);
      for (const campo of CAMPOS_CAMINHO) {
        const v = p[campo];
        if (typeof v === "string" && v) (ehPortavel(v) ? portateis++ : absolutos++);
      }
      return p;
    });
    console.log(`  ${ok("✓")} ${col.padEnd(20)} ${docs.length} docs`);
  }
  await cliente.close();

  const destino = arg("out") ?? SEED_PADRAO;
  mkdirSync(dirname(destino), { recursive: true });
  const bytes = gzipSync(Buffer.from(JSON.stringify(seed)));
  writeFileSync(destino, bytes);

  console.log(
    `\n  ${ok("✓")} ${destino}  ${off(`(${(bytes.length / 1024 / 1024).toFixed(1)} MB)`)}` +
      `\n  ${ok("✓")} ${portateis} caminhos portáteis`,
  );
  if (absolutos) {
    console.log(
      `  ${warn("!")} ${absolutos} caminhos ficaram ABSOLUTOS — moram fora do PSD_DIRS.` +
        `\n    Eles só vão resolver numa máquina com a mesma letra de drive.`,
    );
  }
  console.log(`\n  Próximo passo na máquina do time: ${bold("npm run seed:import")}\n`);
}

function importar() {
  const origem = arg("from") ?? SEED_PADRAO;
  if (!existsSync(origem)) {
    console.error(
      `\n  ${warn("✗")} seed não encontrado: ${origem}` +
        `\n    Peça o arquivo a quem rodou \`npm run seed:export\` e ponha em data/.\n`,
    );
    process.exit(1);
  }
  const acervo = arg("acervo") ?? process.env.PSD_DIRS ?? "";
  if (!acervo.trim()) {
    console.error(
      `\n  ${warn("✗")} sem acervo: passe --acervo "<pasta>" ou defina PSD_DIRS.` +
        `\n    É a pasta onde OS SEUS PSDs moram — o seed reata os registros com ela.\n`,
    );
    process.exit(1);
  }

  const seed = JSON.parse(gunzipSync(readFileSync(origem)).toString()) as Seed;
  if (seed.versao !== 1) {
    console.error(`\n  ${warn("✗")} seed versão ${seed.versao}, este script lê a 1.\n`);
    process.exit(1);
  }

  const db = bancoLocal();
  let total = 0;
  for (const col of COLECOES) {
    const docs = seed.colecoes[col] ?? [];
    for (const d of docs) {
      // `insertOne` do driver local é INSERT OR REPLACE — reimportar é idempotente.
      void db.collection(col).insertOne(d);
      total++;
    }
    console.log(`  ${ok("✓")} ${col.padEnd(20)} ${docs.length} docs`);
  }

  console.log(
    `\n  ${ok("✓")} ${total} registros em ${caminhoDoBanco()}` +
      `\n  ${off(`acervo local: ${acervo}`)}` +
      `\n  ${off(`gerado em ${seed.geradoEm} a partir de ${seed.raizes.join(", ")}`)}` +
      `\n\n  Próximo passo: ${bold("npm run dev")}\n`,
  );
}

function status() {
  const db = bancoLocal();
  console.log(`\n  ${bold("catálogo local")} ${off(caminhoDoBanco())}\n`);
  for (const col of COLECOES) {
    void db
      .collection(col)
      .countDocuments({})
      .then((n) => console.log(`  ${n ? ok("●") : off("○")} ${col.padEnd(20)} ${n} docs`));
  }
  const rs = raizes();
  console.log(
    `\n  ${rs.length ? ok("●") : off("○")} acervo: ${rs.map((r) => r.caminho).join(", ") || "(PSD_DIRS vazio)"}\n`,
  );
}

const comando = process.argv[2];
const acoes: Record<string, () => void | Promise<void>> = { export: exportar, import: importar, status };
const acao = acoes[comando ?? ""];
if (!acao) {
  console.log(
    `\n  ${bold("catalog-seed")} — leva o acervo já indexado para outra máquina\n` +
      `\n    export   Mongo → arquivo portátil (caminhos viram {acervo}/…)` +
      `\n    import   arquivo → catálogo local, reatando com a SUA pasta` +
      `\n    status   o que já está no catálogo local\n`,
  );
  process.exit(1);
}
void Promise.resolve(acao()).catch((e) => {
  console.error(`\n  ${warn("✗")} ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
