/**
 * Poda os registros de PSD que não existem mais no disco.
 *
 * O catálogo já esconde esses registros na leitura (`src/lib/psd-presence.ts`),
 * então a home fica certa sozinha. Isto aqui é a limpeza de verdade, no Mongo —
 * e é manual de propósito: um disco de rede que pisca não pode apagar banco.
 *
 * Uso:
 *   npm run psd:prune                 # dry-run: mostra o que sairia
 *   npm run psd:prune -- --apply      # apaga
 *   npm run psd:prune -- --rapido     # confere por PASTA (10x mais rápido, pega deleção em massa)
 *
 * O default é a checagem EXATA (arquivo a arquivo, ~0,9 ms cada no Drive):
 * apagar documento pede certeza, e a checagem por pasta erra o caso do PSD
 * solto removido de uma pasta que continua em pé.
 *
 * Antes de podar, considere reindexar: se o arquivo mudou de lugar em vez de
 * sumir, o certo é `ONLY_NEW=1 npx tsx --env-file=.env.local scripts/scan-psds.ts`
 * primeiro — senão você apaga o registro e perde as faces já extraídas.
 */

import { MongoClient } from "mongodb";
import { filtrarPsdsSumidos, psdsSumidosExato } from "../src/lib/psd-presence";

const APLICAR = process.argv.includes("--apply");
const RAPIDO = process.argv.includes("--rapido");

interface DocPsd {
  _id: unknown;
  id?: string;
  name?: string;
  psdPath?: string;
  filePath?: string;
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("MONGODB_URI ausente. Rode via `npm run psd:prune` (carrega o .env.local).");
    process.exit(1);
  }

  const cli = new MongoClient(uri);
  await cli.connect();
  const db = cli.db(process.env.MONGODB_DB_NAME || "mockup_store");

  // As duas coleções que guardam caminho de PSD, com o nome do campo de cada uma.
  const ALVOS = [
    { col: "psd_metadata", campo: "filePath" as const },
    { col: "community_presets", campo: "psdPath" as const },
  ];

  let totalMortos = 0;

  for (const { col, campo } of ALVOS) {
    const colecao = db.collection(col);
    const rows = (await colecao
      .find({ [campo]: { $exists: true, $ne: null } }, { projection: { [campo]: 1, id: 1, name: 1 } })
      .toArray()) as unknown as DocPsd[];

    // Normaliza pro shape que o módulo de presença entende (`psdPath`).
    const docs = rows.map((r) => ({ ...r, psdPath: (r as never as Record<string, string>)[campo] }));

    let mortos: typeof docs;
    let raizesOffline: string[];

    if (RAPIDO) {
      const r = filtrarPsdsSumidos(docs);
      if (r.abortadoPeloTeto) {
        console.error(
          `\n  ${col}: mais da metade dos caminhos sumiu de uma vez.\n` +
            `  Isso quase sempre é disco fora do ar, não deleção. Nada foi tocado.\n` +
            `  Confira se o PSD_DIRS está montado e rode de novo.`,
        );
        continue;
      }
      const vivos = new Set(r.docs);
      mortos = docs.filter((d) => !vivos.has(d));
      raizesOffline = r.raizesOffline;
    } else {
      const r = psdsSumidosExato(docs);
      mortos = r.mortos;
      raizesOffline = r.raizesOffline;
    }

    if (raizesOffline.length) {
      console.warn(`  ! raiz inacessível, ignorada: ${raizesOffline.join(", ")}`);
    }

    console.log(`\n  ${col}: ${rows.length} com caminho, ${mortos.length} sem arquivo no disco`);

    // Agrupa por pasta: 927 linhas de caminho não se lê, 1 linha por pasta se lê.
    const porPasta = new Map<string, number>();
    for (const d of mortos) {
      const dir = d.psdPath!.replace(/\\/g, "/").split("/").slice(0, -1).join("/");
      porPasta.set(dir, (porPasta.get(dir) ?? 0) + 1);
    }
    for (const [dir, n] of [...porPasta.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
      console.log(`      ${String(n).padStart(5)}  ${dir}`);
    }
    if (porPasta.size > 15) console.log(`      ... e mais ${porPasta.size - 15} pasta(s)`);

    totalMortos += mortos.length;

    if (APLICAR && mortos.length) {
      const res = await colecao.deleteMany({ _id: { $in: mortos.map((d) => d._id) } as never });
      console.log(`      apagados: ${res.deletedCount}`);
    }
  }

  await cli.close();

  console.log("");
  if (!APLICAR && totalMortos) {
    console.log(`  DRY-RUN — nada foi apagado. Rode com --apply para valer.`);
  } else if (!totalMortos) {
    console.log(`  Nada a podar: todo registro tem arquivo no disco.`);
  }
  console.log("");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
