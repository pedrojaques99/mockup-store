/**
 * Seleciona PSDs por vocabulário e cospe a lista JSON que o
 * `brand-mockup-batch --psds` consome. Serve pra estender uma coleção curada
 * com "mais do mesmo clima" sem curar item a item na home.
 *
 * O `catalog-search.ts` tem grupos fixos (OOH, pôster, device, web, retail) e
 * não cobre nicho — este aceita o vocabulário por argumento.
 *
 * Uso:
 *   npx tsx --env-file=.env.local scripts/pick-similar.ts \
 *     --kw "construction,hazard,scaffold,crane" --out lista.json --limit 20 [--square]
 *
 *   --kw <csv>      vocabulário (regex por termo) casado em fileName e folder
 *   --out <path>    JSON de saída (array de filePath)
 *   --limit <n>     máximo de PSDs (default 20)
 *   --square        só face ~1:1 (0.8–1.25) — metade logo/símbolo
 *   --min-aspect    piso do aspect da maior face (default 0)
 *   --max-aspect    teto do aspect da maior face (default 99)
 *   --exclude <csv> trechos de fileName a pular (ex.: já usados noutro lote)
 *   --dry           só lista, não grava
 */
import { MongoClient } from "mongodb";
import { writeFileSync } from "fs";

const A = process.argv.slice(2);
const flag = (k: string, d?: string) => { const i = A.indexOf(`--${k}`); return i !== -1 && A[i + 1] && !A[i + 1].startsWith("--") ? A[i + 1] : d; };
const has = (k: string) => A.includes(`--${k}`);
const die = (m: string): never => { console.error(m); process.exit(1); };

const kws = (flag("kw") || die("--kw <csv> obrigatório")).split(",").map((s) => s.trim()).filter(Boolean);
const outPath = flag("out");
const limit = parseInt(flag("limit", "20")!);
const squareOnly = has("square");
const minAspect = squareOnly ? 0.8 : parseFloat(flag("min-aspect", "0")!);
const maxAspect = squareOnly ? 1.25 : parseFloat(flag("max-aspect", "99")!);
const exclude = (flag("exclude") || "").split(",").map((s) => s.trim()).filter(Boolean);

/** Camadas de apoio do PSD — não são face de arte. */
const LIXO = /sombra|shadow|luz|light|grain|\[boxy\]|base|mesh|textur|reflex/i;

interface SO { name?: string; innerWidth: number; innerHeight: number }

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI!);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB_NAME!);
  const col = db.collection("psd_metadata");

  const rx = kws.join("|");
  const docs = await col
    .find({ $or: [{ fileName: { $regex: rx, $options: "i" } }, { folder: { $regex: rx, $options: "i" } }] })
    .project({ fileName: 1, filePath: 1, folder: 1, smartObjects: 1 })
    .toArray();

  const ok: { fileName: string; filePath: string; folder: string; aspect: number; faces: number }[] = [];
  for (const d of docs) {
    if (!d.filePath) continue;
    if (exclude.some((e) => String(d.fileName).toLowerCase().includes(e.toLowerCase()))) continue;
    // No `psd_metadata` a face é innerWidth/innerHeight (o canvas do smart
    // object), não width/height — estes são as dimensões do PSD inteiro.
    const sos = (d.smartObjects || []).filter((s: SO) => !LIXO.test(s.name || "") && s.innerWidth && s.innerHeight);
    if (!sos.length) continue;
    const maior = sos.reduce((a: SO, b: SO) => a.innerWidth * a.innerHeight >= b.innerWidth * b.innerHeight ? a : b);
    const aspect = maior.innerWidth / maior.innerHeight;
    if (aspect < minAspect || aspect > maxAspect) continue;
    ok.push({ fileName: d.fileName, filePath: String(d.filePath).replace(/\//g, "\\"), folder: d.folder || "", aspect: +aspect.toFixed(2), faces: sos.length });
  }

  const vistos = new Set<string>();
  const final = ok.filter((e) => (vistos.has(e.fileName) ? false : (vistos.add(e.fileName), true))).slice(0, limit);

  console.log(`${docs.length} PSDs no vocabulário · ${ok.length} com face em [${minAspect}–${maxAspect}] · gravando ${final.length}`);
  for (const f of final) console.log(`  aspect ${String(f.aspect).padEnd(5)} ${f.faces}f  ${f.fileName}  (${f.folder})`);
  if (outPath && !has("dry")) {
    writeFileSync(outPath, JSON.stringify(final.map((f) => f.filePath), null, 2));
    console.log(`→ ${outPath}`);
  }
  await client.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
