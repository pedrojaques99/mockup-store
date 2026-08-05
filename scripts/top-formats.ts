/**
 * Quais N aspects de arte cobrem o maior número de PSDs do catálogo.
 *
 * Não é "os aspects mais comuns" — isso premia formatos redundantes (1.50 e
 * 1.54 servem os mesmos PSDs). É cobertura: escolha gulosa que a cada passo
 * pega o aspect que cobre mais PSDs AINDA descobertos. Responde "com quantos
 * tamanhos de arte eu atendo o catálogo".
 *
 * Uso:
 *   npx tsx --env-file=.env.local scripts/top-formats.ts [--n 10] [--tol 0.06] [--md out.md]
 *
 *   --n <n>     quantos formatos (default 10)
 *   --tol <f>   tolerância relativa de corte aceitável (default 0.06 = 6%)
 *   --min-face  ignora faces menores que isso em px de lado (default 200)
 *   --md <path> grava tabela markdown
 */
import { MongoClient } from "mongodb";
import { writeFileSync } from "fs";

const A = process.argv.slice(2);
const flag = (k: string, d?: string) => { const i = A.indexOf(`--${k}`); return i !== -1 && A[i + 1] && !A[i + 1].startsWith("--") ? A[i + 1] : d; };

const N = parseInt(flag("n", "10")!);
const TOL = parseFloat(flag("tol", "0.06")!);
const MIN_FACE = parseInt(flag("min-face", "200")!);
const mdPath = flag("md");

const LIXO = /sombra|shadow|luz|light|grain|\[boxy\]|base|mesh|textur|reflex/i;

/** Nome humano do aspect, quando bate com um formato conhecido. */
function apelido(a: number): string {
  const conhecidos: [number, string][] = [
    [16 / 9, "16:9"], [9 / 16, "9:16"], [4 / 3, "4:3"], [3 / 4, "3:4"],
    [3 / 2, "3:2"], [2 / 3, "2:3"], [1, "1:1"], [4 / 5, "4:5"], [5 / 4, "5:4"],
    [1 / Math.SQRT2, "A4 retrato"], [Math.SQRT2, "A4 paisagem"],
    [2, "2:1"], [1 / 2, "1:2"], [21 / 9, "21:9"], [1080 / 1920, "story"],
  ];
  for (const [v, nome] of conhecidos) if (Math.abs(a - v) / v <= 0.03) return nome;
  return `${a.toFixed(2)}:1`;
}

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI!);
  await client.connect();
  const col = client.db(process.env.MONGODB_DB_NAME!).collection("psd_metadata");
  const docs = await col.find({}).project({ fileName: 1, smartObjects: 1 }).toArray();

  // aspects por PSD (dedup — um mural com 8 faces iguais conta uma vez)
  const psdAspects: number[][] = [];
  for (const d of docs) {
    const sos = ((d.smartObjects || []) as { name?: string; innerWidth: number; innerHeight: number }[])
      .filter((s) => !LIXO.test(s.name || "") && s.innerWidth >= MIN_FACE && s.innerHeight >= MIN_FACE);
    if (!sos.length) continue;
    psdAspects.push([...new Set(sos.map((s) => +(s.innerWidth / s.innerHeight).toFixed(3)))]);
  }

  // candidatos = todo aspect observado (arredondado) — a resposta sai do dado
  const candidatos = [...new Set(psdAspects.flat().map((a) => +a.toFixed(2)))].filter((a) => a > 0.05 && a < 20);
  const cobre = (cand: number, aspects: number[]) => aspects.some((a) => Math.abs(a - cand) / Math.max(a, cand) <= TOL);

  const restantes = new Set(psdAspects.keys());
  const escolha: { aspect: number; novos: number; acum: number }[] = [];
  for (let passo = 0; passo < N && restantes.size; passo++) {
    let melhor = { cand: 0, ganho: 0 };
    for (const cand of candidatos) {
      let ganho = 0;
      for (const i of restantes) if (cobre(cand, psdAspects[i])) ganho++;
      if (ganho > melhor.ganho) melhor = { cand, ganho };
    }
    if (!melhor.ganho) break;
    for (const i of [...restantes]) if (cobre(melhor.cand, psdAspects[i])) restantes.delete(i);
    escolha.push({ aspect: melhor.cand, novos: melhor.ganho, acum: psdAspects.length - restantes.size });
  }

  const total = psdAspects.length;
  const linhas = ["| # | Aspect | Formato | PSDs novos | Cobertura acumulada |", "|--:|--:|---|--:|--:|"];
  console.log(`${total} PSDs com face útil (≥${MIN_FACE}px), tolerância ${(TOL * 100).toFixed(0)}%\n`);
  escolha.forEach((e, i) => {
    const l = `| ${i + 1} | ${e.aspect} | ${apelido(e.aspect)} | +${e.novos} | ${e.acum} (${((e.acum / total) * 100).toFixed(1)}%) |`;
    linhas.push(l);
    console.log(`${String(i + 1).padStart(2)}. aspect ${String(e.aspect).padEnd(5)} ${apelido(e.aspect).padEnd(12)} +${String(e.novos).padStart(4)} PSDs → ${e.acum} (${((e.acum / total) * 100).toFixed(1)}%)`);
  });
  console.log(`\nsobram ${restantes.size} PSDs (${((restantes.size / total) * 100).toFixed(1)}%) fora dos ${escolha.length} formatos`);

  if (mdPath) { writeFileSync(mdPath, linhas.join("\n") + "\n"); console.log(`→ ${mdPath}`); }
  await client.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
