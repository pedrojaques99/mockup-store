/**
 * Exporta as dimensões dos smart objects (as "faces") de uma lista de PSDs.
 * É o contrato que o designer precisa pra montar a arte no aspect certo e não
 * depender do `cover` cortar headline.
 *
 * Uso:
 *   npx tsx --env-file=.env.local scripts/so-dimensions.ts \
 *     --psds lista.json[,outra.json] --out faces.json [--md faces.md]
 *
 *   --psds <csv>   arquivos .json com array de caminhos de PSD (os mesmos que
 *                  o `brand-mockup-batch --psds` consome)
 *   --out <path>   JSON de saída
 *   --md <path>    tabela markdown opcional
 */
import { MongoClient } from "mongodb";
import { writeFileSync, readFileSync } from "fs";
import { basename } from "path";

const A = process.argv.slice(2);
const flag = (k: string, d?: string) => { const i = A.indexOf(`--${k}`); return i !== -1 && A[i + 1] && !A[i + 1].startsWith("--") ? A[i + 1] : d; };
const die = (m: string): never => { console.error(m); process.exit(1); };

const psdsArg = flag("psds") || die("--psds <csv de .json> obrigatório");
const outPath = flag("out") || die("--out <path> obrigatório");
const mdPath = flag("md");

const LIXO = /sombra|shadow|luz|light|grain|\[boxy\]|base|mesh|textur|reflex/i;

interface SO { name?: string; path?: string; innerWidth: number; innerHeight: number; hasPerspective?: boolean }
interface Face { psd: string; face: string; w: number; h: number; aspect: number; perspectiva: boolean }

async function main() {
  const paths = psdsArg.split(",").flatMap((f) => JSON.parse(readFileSync(f.trim(), "utf-8")) as string[]);
  const nomes = [...new Set(paths.map((p) => basename(p).replace(/\.psd$/i, "")))];

  const client = new MongoClient(process.env.MONGODB_URI!);
  await client.connect();
  const col = client.db(process.env.MONGODB_DB_NAME!).collection("psd_metadata");
  const docs = await col.find({ fileName: { $in: nomes } }).project({ fileName: 1, smartObjects: 1 }).toArray();

  const faces: Face[] = [];
  for (const d of docs) {
    const sos = ((d.smartObjects || []) as SO[]).filter((s) => !LIXO.test(s.name || "") && s.innerWidth && s.innerHeight);
    sos.forEach((s, i) => {
      faces.push({
        psd: d.fileName,
        // O nome quase sempre é "[DOUBLE CLICK TO EDIT]"; o `path` diferencia
        // as faces de um mural ("Mock 01 > ..."). Cai pro índice se faltar.
        face: (s.path || s.name || `face ${i + 1}`).split(" > ")[0] || `face ${i + 1}`,
        w: s.innerWidth,
        h: s.innerHeight,
        aspect: +(s.innerWidth / s.innerHeight).toFixed(3),
        perspectiva: !!s.hasPerspective,
      });
    });
  }

  faces.sort((a, b) => a.psd.localeCompare(b.psd) || a.face.localeCompare(b.face));
  writeFileSync(outPath, JSON.stringify(faces, null, 2));
  console.log(`${docs.length}/${nomes.length} PSDs encontrados · ${faces.length} faces → ${outPath}`);

  if (mdPath) {
    const linhas = ["| PSD | Face | W | H | Aspect | Perspectiva |", "|---|---|---:|---:|---:|:--:|"];
    for (const f of faces) linhas.push(`| ${f.psd} | ${f.face} | ${f.w} | ${f.h} | ${f.aspect} | ${f.perspectiva ? "sim" : "–"} |`);
    writeFileSync(mdPath, linhas.join("\n") + "\n");
    console.log(`→ ${mdPath}`);
  }

  const faltando = nomes.filter((n) => !docs.some((d) => d.fileName === n));
  if (faltando.length) console.warn(`⚠ sem metadata: ${faltando.join(", ")}`);
  await client.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
