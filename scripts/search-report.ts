/**
 * search-report — o que a busca não está conseguindo responder.
 *
 *   npx tsx scripts/search-report.ts
 *   npx tsx scripts/search-report.ts --json
 *
 * Lê a telemetria de `.tmp/search/` e responde as perguntas que ninguém estava fazendo:
 * quais queries deram ZERO resultado (buraco de vocabulário — candidato a sinônimo novo),
 * quais só resolveram no passe 3 (o dicionário não cobre, o fuzzy salvou), e qual a
 * latência real. O bug do `"t-shirt"` (uma query trazendo 1444 de 1620 itens) só apareceu
 * porque alguém foi medir na mão — este relatório é pra isso não depender de sorte.
 */
import { getSearchStats } from "../src/lib/search-telemetry";

const asJson = process.argv.includes("--json");

const bar = (n: number, max: number, w = 24) =>
  "█".repeat(Math.max(1, Math.round((n / Math.max(1, max)) * w)));

async function main() {
  const s = await getSearchStats();

  if (asJson) {
    console.log(JSON.stringify(s, null, 2));
    return;
  }

  if (!s.total) {
    console.log("Sem telemetria ainda — nenhuma busca registrada em .tmp/search/queries.jsonl");
    console.log("Use o grid (ou bata em /api/references?search=...) e rode de novo.");
    return;
  }

  console.log(`\n  BUSCA — ${s.total} queries registradas\n`);
  console.log(`  latência   p50 ${s.latency.p50}ms · p95 ${s.latency.p95}ms · max ${s.latency.max}ms`);

  const passTotal = Object.values(s.byPass).reduce((a, b) => a + b, 0) || 1;
  const passName: Record<string, string> = {
    "0": "sem resultado",
    "1": "exato/prefixo",
    "2": "fuzzy",
    "3": "fuzzy + OR",
  };
  console.log("\n  ONDE A QUERY RESOLVEU");
  for (const [p, n] of Object.entries(s.byPass).sort()) {
    const pct = Math.round((n / passTotal) * 100);
    console.log(`    ${(passName[p] ?? p).padEnd(16)} ${String(n).padStart(5)}  ${String(pct).padStart(3)}%  ${bar(n, passTotal)}`);
  }
  if ((s.byPass[3] ?? 0) / passTotal > 0.15) {
    console.log("    ⚠ muita query só resolvendo no passe 3 — o dicionário de sinônimos está incompleto");
  }

  if (s.zeroResult.length) {
    console.log("\n  ZERO RESULTADO  (buraco de vocabulário — candidatos a sinônimo)");
    for (const z of s.zeroResult.slice(0, 20)) {
      console.log(`    ${String(z.count).padStart(4)}×  "${z.q}"`);
    }
    console.log("\n    → adicionar em src/lib/search-synonyms.ts (GROUPS) e rodar os testes");
  } else {
    console.log("\n  ZERO RESULTADO  nenhum — toda query achou algo");
  }

  console.log("\n  QUERIES MAIS FREQUENTES");
  for (const q of s.topQueries.slice(0, 15)) {
    console.log(`    ${String(q.count).padStart(4)}×  ${String(q.avgHits).padStart(5)} hits  "${q.q}"`);
  }

  if (s.topClicked.length) {
    console.log("\n  MAIS ABERTOS  (alimenta o boost do ranking)");
    for (const c of s.topClicked.slice(0, 10)) {
      console.log(`    ${String(c.clicks).padStart(4)}×  ${c.id}`);
    }
  }
  console.log("");
}

main().then(
  () => process.exit(0),
  (e) => { console.error(e); process.exit(1); },
);
