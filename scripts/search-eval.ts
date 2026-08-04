/**
 * search-eval — quanto a camada densa realmente acrescenta.
 *
 * "Ficou mais inteligente" é opinião até alguém medir. Este script roda o MESMO conjunto
 * de queries de vibe duas vezes — só léxico (MiniSearch + sinônimos) e híbrido (com a
 * fusão RRF dos embeddings) — e imprime os dois lado a lado.
 *
 *   npx tsx --env-file=.env.local scripts/search-eval.ts
 *   npx tsx --env-file=.env.local scripts/search-eval.ts --q "engenharia,vibe industrial"
 *
 * O que ele mede é RECALL BRUTO por query (quantos resultados, e quais os 5 primeiros),
 * não relevância julgada: o acervo não tem gabarito rotulado, e inventar um seria medir a
 * própria opinião. Query com 0 no léxico e >0 no híbrido é o caso que a feature existe
 * para resolver; query que PIORA é sinal de fusão mal calibrada e vale investigar.
 */
import { buildIndex, runSearch, type SearchDoc } from "../src/lib/search-engine";
import { semanticRank, semanticStats } from "../src/lib/semantic-index";
import { searchRefs } from "../src/lib/search-index";

/** Queries de contexto — o tipo de coisa que ninguém escreve como tag. */
const DEFAULT_QUERIES = [
  "engenharia",
  "obra",
  "clima de startup",
  "loja de rua",
  "vibe minimalista",
  "academia",
  "restaurante",
  "hospital",
  "moda praia",
  "escritorio corporativo",
  "festival de musica",
  "imobiliaria",
];

async function loadCatalog(): Promise<SearchDoc[]> {
  const out: SearchDoc[] = [];
  for (let page = 1; page <= 200; page++) {
    const r = await searchRefs({ page, limit: 200, sort: "name" });
    out.push(...(r.references as SearchDoc[]));
    if (page >= r.pages) break;
  }
  return out;
}

async function main() {
  const argQ = process.argv.includes("--q")
    ? process.argv[process.argv.indexOf("--q") + 1].split(",").map((s) => s.trim()).filter(Boolean)
    : null;
  const queries = argQ?.length ? argQ : DEFAULT_QUERIES;

  const stats = await semanticStats();
  console.log(
    stats.enabled
      ? `densa: ${stats.model} · ${stats.vectors} vetores · ${stats.dims} dims`
      : "densa: DESLIGADA (sem chave/provedor) — o comparativo vai sair idêntico dos dois lados",
  );

  const docs = await loadCatalog();
  const mini = buildIndex(docs);
  const byId = new Map(docs.map((d) => [d.id, d]));
  console.log(`catálogo: ${docs.length} docs\n`);

  let gained = 0;
  let rescued = 0;

  for (const q of queries) {
    const lex = runSearch(docs, mini, { search: q, limit: 200 });
    const dense = (await semanticRank(q, { k: 120 })) ?? [];
    const hyb = runSearch(docs, mini, { search: q, limit: 200 }, undefined, dense);

    const delta = hyb.total - lex.total;
    if (delta > 0) gained++;
    if (lex.total === 0 && hyb.total > 0) rescued++;

    const top = hyb.references.slice(0, 5).map((d) => d.name).join(" · ");
    const flag = lex.total === 0 && hyb.total > 0 ? "RESGATE" : delta < 0 ? "PIOROU" : delta > 0 ? "+" : "=";
    console.log(
      `${flag.padEnd(8)} "${q}" — léxico ${String(lex.total).padStart(4)} → híbrido ${String(hyb.total).padStart(4)} (passe ${hyb.pass})`,
    );
    console.log(`         top5: ${top || "(vazio)"}`);
    // Quem entrou APENAS pela camada densa: é o vocabulário que falta nos sinônimos.
    const onlyDense = hyb.references
      .filter((d) => !lex.references.some((l) => l.id === d.id))
      .slice(0, 3)
      .map((d) => `${d.name} [${d.tags.slice(0, 3).join(",")}]`);
    if (onlyDense.length) console.log(`         só na densa: ${onlyDense.join(" · ")}`);
    void byId;
  }

  console.log(
    `\n${gained}/${queries.length} queries ganharam resultado · ${rescued} saíram do ZERO`,
  );
  if (!stats.enabled) {
    console.log("rode `npm run search:embed` com EMBEDDINGS_* configurado para medir de verdade.");
  }
}

// `process.exit` explícito: o catálogo abre conexão com o Mongo, e o driver segura o
// event loop de pé — sem isto o script imprime tudo e simplesmente não termina.
main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
