/**
 * face-demand — histograma de DEMANDA do acervo: quais aspectos de face os PSDs
 * realmente pedem, e quantas cenas cada formato de arte destrava.
 *
 * Responde "que formato eu devo desenhar?" com dado, não com achismo. Uma arte
 * só serve a uma cena se o `cover` couber dentro do safeCrop dela — então
 * contamos, pra cada aspecto candidato, quantas faces ele atende dentro da
 * tolerância.
 *
 * Uso:
 *   npx tsx --env-file=.env.local scripts/face-demand.ts [--tol 0.15] [--top 12]
 */
import { MongoClient } from "mongodb";
import { existsSync } from "fs";
import { computeFaces } from "@visant/psd-engine";

const A = process.argv.slice(2);
const flag = (k: string, d: string) => { const i = A.indexOf(`--${k}`); return i !== -1 && A[i + 1] ? A[i + 1] : d; };
const TOL = parseFloat(flag("tol", "0.15"));
const TOP = parseInt(flag("top", "12"));
const MAX_FACES = 8;
const SCREEN: [number, number] = [0.4, 0.65];

const PLAN = [
  { label: "billboard", rx: "billboard|outdoor|facade|hoarding|\\bwall\\b", mode: "all" as const },
  { label: "poster", rx: "poster|wild|posters-and-stickers|stand|a-frame|easel", mode: "all" as const },
  { label: "device", rx: "smartphone|screens|\\bipad\\b|tablet|\\biphone\\b|\\bphone\\b", mode: "screen" as const },
  { label: "retail", rx: "t-?shirt|tote|\\bbox\\b|tag|\\bcap\\b|hoodie|\\bmug\\b|bottle|sticker|jersey", mode: "all" as const },
  { label: "signage", rx: "sign|storefront|window|flag|banner", mode: "all" as const },
];

/** Fração do lado maior que o `cover` descarta. */
const cropOf = (art: number, face: number) => { const r = art / face; return r > 1 ? 1 - 1 / r : 1 - r; };

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI!);
  await client.connect();
  const col = client.db(process.env.MONGODB_DB_NAME!).collection("psd_metadata");

  // Coleta o aspecto de toda face renderizável do acervo, por categoria.
  const faces: Array<{ aspect: number; cat: string }> = [];
  for (const c of PLAN) {
    const docs = await col.find({ fileName: { $regex: c.rx, $options: "i" } })
      .project({ filePath: 1, smartObjects: 1 }).toArray();
    for (const d of docs) {
      const fp = (d.filePath as string)?.replace(/\//g, "\\");
      if (!fp || !existsSync(fp)) continue;
      let fs = computeFaces((d.smartObjects || []) as never);
      if (!fs.length) continue;
      if (c.mode === "screen") {
        const p = fs.filter((f) => { const r = f.innerWidth / f.innerHeight; return r >= SCREEN[0] && r <= SCREEN[1]; });
        const pool = p.length ? p : fs;
        fs = [pool.reduce((a, b) => (b.innerWidth * b.innerHeight > a.innerWidth * a.innerHeight ? b : a))];
      } else if (fs.length > MAX_FACES) {
        fs = [...fs].sort((a, b) => b.innerWidth * b.innerHeight - a.innerWidth * a.innerHeight).slice(0, MAX_FACES);
      }
      for (const f of fs) faces.push({ aspect: f.innerWidth / f.innerHeight, cat: c.label });
    }
  }
  await client.close();

  console.log(`${faces.length} faces renderizáveis no acervo\n`);

  // Candidatos = os próprios aspectos observados (a demanda define a oferta).
  // Pra cada um, quantas faces ele atende dentro da tolerância?
  const cands = Array.from(new Set(faces.map((f) => +f.aspect.toFixed(2)))).sort((a, b) => a - b);
  const scored = cands.map((a) => {
    const hit = faces.filter((f) => cropOf(a, f.aspect) <= TOL);
    const byCat: Record<string, number> = {};
    for (const h of hit) byCat[h.cat] = (byCat[h.cat] || 0) + 1;
    return { aspect: a, n: hit.length, byCat };
  }).sort((x, y) => y.n - x.n);

  // Greedy set-cover: cada formato novo é escolhido pelo que ele acrescenta ao
  // que os anteriores JÁ cobrem. Sem isso o topo vira 10 variações do mesmo 1.78.
  const covered = new Set<number>();
  const idx = faces.map((f, i) => i);
  const pick: Array<{ aspect: number; add: number; total: number; byCat: Record<string, number> }> = [];
  for (let k = 0; k < TOP; k++) {
    let best: { aspect: number; add: number; hits: number[] } | null = null;
    for (const c of cands) {
      const hits = idx.filter((i) => !covered.has(i) && cropOf(c, faces[i].aspect) <= TOL);
      if (!best || hits.length > best.add) best = { aspect: c, add: hits.length, hits };
    }
    if (!best || best.add === 0) break;
    best.hits.forEach((i) => covered.add(i));
    const total = faces.filter((f) => cropOf(best!.aspect, f.aspect) <= TOL).length;
    const byCat: Record<string, number> = {};
    for (const i of best.hits) byCat[faces[i].cat] = (byCat[faces[i].cat] || 0) + 1;
    pick.push({ aspect: best.aspect, add: best.add, total, byCat });
  }

  console.log(`FORMATOS QUE MAIS DESTRAVAM CENA (tolerância de corte ${(TOL * 100).toFixed(0)}%)`);
  console.log("cobertura incremental — cada linha acrescenta ao que as de cima já cobrem\n");
  console.log("  aspect  ratio      +novas  total  acumulado  categorias que destrava");
  console.log("  " + "-".repeat(86));
  let acc = 0;
  for (const p of pick) {
    acc += p.add;
    const cats = Object.entries(p.byCat).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(" ");
    console.log(
      `  ${p.aspect.toFixed(2).padStart(5)}  ${ratioName(p.aspect).padEnd(9)} ${String(p.add).padStart(6)}  ${String(p.total).padStart(5)}  ${String(Math.round((acc / faces.length) * 100)).padStart(8)}%  ${cats}`
    );
  }
  console.log(`\n  ${pick.length} formatos cobrem ${Math.round((acc / faces.length) * 100)}% das ${faces.length} faces do acervo.`);
}

/** Nome legível do ratio mais próximo, pra virar artboard no Figma. */
function ratioName(a: number): string {
  const known: Array<[string, number]> = [
    ["9:16", 9 / 16], ["2:3", 2 / 3], ["3:4", 3 / 4], ["4:5", 4 / 5], ["1:1", 1],
    ["5:4", 5 / 4], ["4:3", 4 / 3], ["3:2", 3 / 2], ["16:9", 16 / 9], ["2:1", 2],
    ["21:9", 21 / 9], ["3:1", 3], ["4:1", 4],
  ];
  let best = known[0];
  for (const k of known) if (Math.abs(k[1] - a) < Math.abs(best[1] - a)) best = k;
  return `~${best[0]}`;
}

main().catch((e) => { console.error(e); process.exit(1); });
