/**
 * Religa registros cujo PSD MUDOU DE LUGAR — em vez de apagá-los.
 *
 * O caso que motivou: uma pasta duplicada de 152 GB saiu do Drive e 927 docs
 * ficaram com `filePath` apontando para o nada. Mas os arquivos não sumiram —
 * existem, byte a byte iguais, na cópia que ficou. Apagar esses registros
 * (`psd:prune`) jogaria fora as faces e smart objects já extraídos, e reindexar
 * NÃO os traria de volta: o `ONLY_NEW` do `scan-psds` pula por `fileName`, e
 * `fileName` tem índice único — o doc morto bloqueia a reinserção do vivo.
 *
 * Então a operação certa é apontar o registro para o arquivo sobrevivente. Um
 * campo, sem abrir um PSD sequer: segundos em vez de horas.
 *
 * Roda ANTES do `psd:prune`. O que sobrar sem candidato aí sim é poda.
 *
 * Uso:
 *   npm run psd:repoint                # dry-run
 *   npm run psd:repoint -- --apply
 */

import { MongoClient } from "mongodb";
import { existsSync } from "fs";
import { basename, extname } from "path";
import { psdRoots, walkPsds } from "../src/lib/fs-walk";

const APLICAR = process.argv.includes("--apply");

interface Candidato {
  path: string;
  sizeBytes: number;
}

/** Índice do que EXISTE hoje no disco, por nome-base minúsculo. */
function indexarDisco(): Map<string, Candidato[]> {
  const idx = new Map<string, Candidato[]>();
  for (const raiz of psdRoots()) {
    if (!existsSync(raiz)) {
      console.warn(`  ! raiz inacessível, ignorada: ${raiz}`);
      continue;
    }
    process.stderr.write(`  lendo ${raiz} ... `);
    const found = walkPsds(raiz);
    process.stderr.write(`${found.length} psd\n`);
    for (const f of found) {
      const k = basename(f.path, extname(f.path)).toLowerCase();
      const lista = idx.get(k) ?? [];
      lista.push({ path: f.path, sizeBytes: f.sizeBytes });
      idx.set(k, lista);
    }
  }
  return idx;
}

/**
 * Escolhe o substituto: mesmo tamanho ganha (é a mesma cópia), e no empate vence
 * o caminho mais curto — a mesma convenção que o `scan-psds` usa pra desempatar.
 */
function escolher(
  cands: Candidato[],
  tamanhoConhecido?: number,
): { cand: Candidato; porTamanho: boolean; ambiguo: boolean } | undefined {
  if (!cands.length) return undefined;
  const mesmos = tamanhoConhecido ? cands.filter((c) => c.sizeBytes === tamanhoConhecido) : [];
  const pool = mesmos.length ? mesmos : cands;
  return {
    cand: [...pool].sort((a, b) => a.path.length - b.path.length)[0],
    porTamanho: mesmos.length > 0,
    // Só-nome COM vários candidatos é o único caso em que dá pra religar errado:
    // dois PSDs diferentes chamados "01.psd" em pastas diferentes.
    ambiguo: !mesmos.length && cands.length > 1,
  };
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("MONGODB_URI ausente. Rode via `npm run psd:repoint`.");
    process.exit(1);
  }

  const disco = indexarDisco();
  if (!disco.size) {
    console.error("Nenhum PSD encontrado no disco — abortando para não religar nada errado.");
    process.exit(1);
  }

  const cli = new MongoClient(uri);
  await cli.connect();
  const db = cli.db(process.env.MONGODB_DB_NAME || "mockup_store");

  // `psd_metadata` primeiro, e de propósito: ele tem `sizeBytes` (desempata o
  // nome repetido) e `fileName` com índice único. Depois de corrigido, ele vira
  // a fonte de verdade pra segunda coleção, que não precisa adivinhar nada.
  const ALVOS = [
    { col: "psd_metadata", campo: "filePath", tamanho: "sizeBytes" },
    { col: "community_presets", campo: "psdPath", tamanho: "__sem_tamanho__" },
  ] as const;

  for (const { col, campo, tamanho } of ALVOS) {
    const colecao = db.collection(col);
    const rows = await colecao
      .find({ [campo]: { $exists: true, $ne: null } }, { projection: { [campo]: 1, [tamanho]: 1, name: 1 } })
      .toArray();

    const mortos = rows.filter((r) => {
      const p = r[campo] as string;
      return p && !existsSync(p);
    });

    const religar: Array<{ _id: unknown; de: string; para: string }> = [];
    const semCandidato: string[] = [];
    const ambiguos: string[] = [];
    let porTamanho = 0;

    // Mapa de verdade montado na passada anterior: fileName -> filePath já correto.
    // Vale só para `community_presets`, que não guarda tamanho para desempatar.
    const porNomeCanonico =
      col === "community_presets"
        ? new Map(
            (
              await db
                .collection("psd_metadata")
                .find({}, { projection: { fileName: 1, filePath: 1 } })
                .toArray()
            )
              .filter((d) => d.filePath && existsSync(d.filePath as string))
              .map((d) => [
                String(d.fileName).replace(/\.psd$/i, "").toLowerCase(),
                d.filePath as string,
              ]),
          )
        : null;

    for (const r of mortos) {
      const antigo = r[campo] as string;
      const k = basename(antigo.replace(/\\/g, "/"), extname(antigo)).toLowerCase();

      // Caminho exato: o `psd_metadata` (índice único por fileName) já sabe onde
      // o arquivo está. Nada de casar por nome contra o disco quando existe
      // resposta autoritativa.
      const canonico = porNomeCanonico?.get(k);
      if (canonico) {
        religar.push({ _id: r._id, de: antigo, para: canonico });
        porTamanho++; // veio da fonte de verdade, não de palpite
        continue;
      }

      const novo = escolher(disco.get(k) ?? [], r[tamanho] as number | undefined);
      if (!novo) {
        semCandidato.push(antigo);
        continue;
      }
      // Ambíguo não se religa no automático: é o único jeito de apontar o
      // registro pro PSD errado, e o erro sairia calado num render meses depois.
      if (novo.ambiguo) {
        ambiguos.push(antigo);
        continue;
      }
      if (novo.porTamanho) porTamanho++;
      religar.push({ _id: r._id, de: antigo, para: novo.cand.path });
    }

    console.log(`\n  ${col}: ${rows.length} com caminho, ${mortos.length} sem arquivo`);
    const rotulo = col === "community_presets" ? "resolvidos pelo psd_metadata" : "com tamanho conferido";
    console.log(`      religáveis: ${religar.length}  (${porTamanho} ${rotulo}, ${religar.length - porTamanho} só por nome, sem outro candidato)`);
    console.log(`      ambíguos (2+ candidatos, sem tamanho): ${ambiguos.length} — deixados como estão`);
    console.log(`      sem candidato (sumiu de verdade):      ${semCandidato.length}`);
    for (const p of ambiguos.slice(0, 8)) console.log(`      [ambíguo] ${p}`);

    for (const r of religar.slice(0, 3)) {
      console.log(`\n      de:   ${r.de}`);
      console.log(`      para: ${r.para}`);
    }
    if (religar.length > 3) console.log(`\n      ... e mais ${religar.length - 3}`);
    for (const p of semCandidato.slice(0, 8)) console.log(`      [poda] ${p}`);

    if (APLICAR && religar.length) {
      const ops = religar.map((r) => ({
        updateOne: { filter: { _id: r._id as never }, update: { $set: { [campo]: r.para } } },
      }));
      const res = await colecao.bulkWrite(ops);
      console.log(`\n      religados: ${res.modifiedCount}`);
    }
  }

  await cli.close();
  console.log("");
  if (!APLICAR) console.log("  DRY-RUN — nada foi escrito. Rode com --apply para valer.\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
