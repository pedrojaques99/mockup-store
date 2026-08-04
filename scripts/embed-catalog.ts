/**
 * embed-catalog — constrói/atualiza o cache de vetores do catálogo (`.tmp/search/embeddings.jsonl`).
 *
 * A camada densa da busca ("engenharia" achar canteiro e capacete) precisa de um vetor por
 * doc. Isto é o passo offline que os produz. É incremental por hash: rodar de novo depois
 * de ingerir 20 mockups novos custa 20 embeddings, não o acervo inteiro. Trocar o modelo
 * (`EMBEDDINGS_MODEL`) muda o fingerprint e re-embeda tudo — de propósito.
 *
 *   npx tsx --env-file=.env.local scripts/embed-catalog.ts
 *   npx tsx --env-file=.env.local scripts/embed-catalog.ts --force      # ignora o hash
 *   npx tsx --env-file=.env.local scripts/embed-catalog.ts --limit 500  # amostra, pra medir custo
 *
 * Sempre `npx tsx`, nunca `bun`: o catálogo passa pelo Mongo, e o bun não resolve
 * `mongodb+srv` no Windows.
 */
import { searchRefs, type SearchDoc } from "../src/lib/search-index";
import { ensureEmbeddings, semanticStats } from "../src/lib/semantic-index";
import { getEmbeddingsConfig } from "../src/lib/embeddings";

const argv = process.argv.slice(2);
const force = argv.includes("--force");
const limitArg = argv.indexOf("--limit");
const limit = limitArg >= 0 ? Number(argv[limitArg + 1]) : 0;

/** O catálogo só sai paginado (`searchRefs` teto de 200 por página) — junta tudo aqui. */
async function loadAllDocs(max: number): Promise<SearchDoc[]> {
  const out: SearchDoc[] = [];
  const seen = new Set<string>();
  for (let page = 1; ; page++) {
    const res = await searchRefs({ page, limit: 200, sort: "name" });
    for (const doc of res.references) {
      if (seen.has(doc.id)) continue;
      seen.add(doc.id);
      out.push(doc);
    }
    if (page >= res.pages || !res.references.length) break;
    if (max && out.length >= max) break;
  }
  return max ? out.slice(0, max) : out;
}

async function main() {
  const config = getEmbeddingsConfig();
  if (!config) {
    console.error(
      "embeddings desligados: defina EMBEDDINGS_API_KEY (ou OPENAI_API_KEY / NVIDIA_API_KEY) no .env.local.\n" +
        "Sem chave o produto não regride — a busca segue léxica — mas não há o que indexar aqui.",
    );
    process.exit(1);
  }
  console.log(`provedor: ${config.provider} · modelo: ${config.model} · dims: ${config.dims ?? "nativo"}`);

  const t0 = Date.now();
  const docs = await loadAllDocs(limit);
  console.log(`catálogo: ${docs.length} docs (${((Date.now() - t0) / 1000).toFixed(1)}s)`);

  let last = -1;
  const res = await ensureEmbeddings(docs, {
    force,
    onProgress: (done, total) => {
      if (!total) return;
      const pct = Math.floor((done / total) * 100);
      if (pct === last) return;
      last = pct;
      process.stdout.write(`\rembedando ${done}/${total} (${pct}%)   `);
    },
  });
  process.stdout.write("\n");

  const stats = await semanticStats();
  console.log(
    `novos: ${res.embedded} · reaproveitados do cache: ${res.cached}\n` +
      `vetores no disco: ${stats.vectors} · dims: ${stats.dims ?? "?"} · ${((Date.now() - t0) / 1000).toFixed(1)}s`,
  );
  if (res.embedded === 0 && res.cached === 0) {
    console.warn("nenhum vetor gravado — provedor fora do ar? confira a chave e o baseURL.");
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
