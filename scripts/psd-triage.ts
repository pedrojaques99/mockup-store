/**
 * Triagem de licença do acervo de PSD — o que pode ser distribuído e o que não.
 *
 * O acervo tem milhares de arquivos de proveniência misturada (feitos aqui,
 * comprados, vindos de terceiro). Antes de publicar qualquer PSD como "plugável
 * por padrão" no app de desktop, alguém precisa dizer de quem é cada um — e
 * ninguém vai carimbar 3.500 arquivos.
 *
 * A saída é que proveniência é homogênea por PASTA, não por arquivo: uma pasta
 * inteira veio da mesma fonte. Então o carimbo é por pasta, e o arquivo herda.
 *
 * Duas decisões que vieram de dor conhecida neste repo:
 *
 * 1. O default é `desconhecido`, e `desconhecido` NÃO distribui. O erro caro
 *    aqui é o silencioso — um PSD de terceiro entrar no pack por omissão e a
 *    conta chegar depois. Nada entra sem alguém ter dito que sim.
 *
 * 2. Todo write no `data/psd-license.json` é MERGE. O mesmo arquivo já vai ser
 *    editado à mão, por este script e por rodadas futuras; sobrescrever apaga
 *    trabalho humano (foi exatamente assim que o `settings.json` perdeu o
 *    estúdio de seis cenas em produção).
 *
 * Uso:
 *   npx tsx --env-file=.env.local scripts/psd-triage.ts
 *   npx tsx --env-file=.env.local scripts/psd-triage.ts --rescan
 *   npx tsx --env-file=.env.local scripts/psd-triage.ts --set "#3=boxy"
 *   npx tsx --env-file=.env.local scripts/psd-triage.ts --set "H:/Meu Drive/ASSETS VISANT=comprado"
 *   npx tsx --env-file=.env.local scripts/psd-triage.ts --only desconhecido
 *   npx tsx --env-file=.env.local scripts/psd-triage.ts --json
 *
 * O scan do Drive é lento (dezenas de GB em pasta de rede), então ele fica em
 * cache em `.tmp/psd-triage/scan.json`. `--rescan` força reler o disco.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { walkPsds } from "../src/lib/fs-walk";
import { psdRoots } from "../src/lib/fs-walk";
import { pathOrigin } from "../src/lib/path-origin";

// ─── licenças ────────────────────────────────────────────────────────────────

/**
 * `engine` = fixture do @visant/psd-engine (mora no repo, não é produto).
 * `terceiro` cobre tanto "sei que é de outro" quanto "não faço ideia mas não é
 * meu" — os dois têm o mesmo efeito prático: não sai daqui.
 */
const LICENSES = ["boxy", "comprado", "terceiro", "engine", "desconhecido"] as const;
type License = (typeof LICENSES)[number];

/** A única que vira download público. Mantida como lista pra ficar explícito. */
const DISTRIBUIVEIS = new Set<License>(["boxy"]);

const STAMP_FILE = join(process.cwd(), "data", "psd-license.json");
const SCAN_CACHE = join(process.cwd(), ".tmp", "psd-triage", "scan.json");

interface StampEntry {
  license: License;
  note?: string;
  stampedAt: string;
}
interface StampFile {
  version: 1;
  groups: Record<string, StampEntry>;
}

interface ScanFile {
  scannedAt: string;
  roots: string[];
  files: Array<{ path: string; sizeBytes: number }>;
}

interface Group {
  key: string;
  files: number;
  bytes: number;
  samples: string[];
  origin: ReturnType<typeof pathOrigin>;
  license: License;
  /** De qual chave carimbada veio a licença (vazio = ninguém carimbou). */
  herdadaDe: string;
}

// ─── args ────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const flag = (nome: string) => argv.includes(`--${nome}`);
const valor = (nome: string, padrao?: string) => {
  const i = argv.indexOf(`--${nome}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : padrao;
};
/** `--set` é repetível: dá pra carimbar várias pastas numa rodada só. */
const sets = argv.reduce<string[]>((acc, a, i) => {
  if (a === "--set" && argv[i + 1]) acc.push(argv[i + 1]);
  return acc;
}, []);

const DEPTH = Math.max(0, parseInt(valor("depth", "2")!, 10) || 0);
const ONLY = valor("only");
const JSON_OUT = flag("json");
const RESCAN = flag("rescan");

// ─── scan ────────────────────────────────────────────────────────────────────

function scan(): ScanFile {
  const roots = psdRoots();
  if (!roots.length) {
    console.error("PSD_DIRS vazio. Rode com --env-file=.env.local, ou exporte PSD_DIRS.");
    process.exit(1);
  }

  if (!RESCAN && existsSync(SCAN_CACHE)) {
    const cached = JSON.parse(readFileSync(SCAN_CACHE, "utf8")) as ScanFile;
    // Cache de outra configuração de PSD_DIRS é cache errado, não cache velho.
    if (JSON.stringify(cached.roots) === JSON.stringify(roots)) return cached;
  }

  const files: ScanFile["files"] = [];
  for (const root of roots) {
    if (!existsSync(root)) {
      console.error(`  ! raiz ausente, pulada: ${root}`);
      continue;
    }
    process.stderr.write(`  lendo ${root} ... `);
    const found = walkPsds(root);
    process.stderr.write(`${found.length} psd\n`);
    for (const f of found) files.push({ path: f.path, sizeBytes: f.sizeBytes });
  }

  const out: ScanFile = { scannedAt: new Date().toISOString(), roots, files };
  mkdirSync(dirname(SCAN_CACHE), { recursive: true });
  writeFileSync(SCAN_CACHE, JSON.stringify(out));
  return out;
}

// ─── carimbos ────────────────────────────────────────────────────────────────

function lerCarimbos(): StampFile {
  if (!existsSync(STAMP_FILE)) return { version: 1, groups: {} };
  try {
    const raw = JSON.parse(readFileSync(STAMP_FILE, "utf8")) as Partial<StampFile>;
    return { version: 1, groups: raw.groups ?? {} };
  } catch (e) {
    // Arquivo corrompido: parar. Continuar com `{}` reescreveria por cima e
    // apagaria todo o carimbo já feito — o pior desfecho possível aqui.
    console.error(`data/psd-license.json ilegível (${(e as Error).message}). Conserte ou renomeie antes de continuar.`);
    process.exit(1);
  }
}

function gravarCarimbos(atual: StampFile, novos: Record<string, StampEntry>) {
  const merged: StampFile = { version: 1, groups: { ...atual.groups, ...novos } };
  mkdirSync(dirname(STAMP_FILE), { recursive: true });
  writeFileSync(STAMP_FILE, JSON.stringify(merged, null, 2) + "\n");
}

/**
 * A licença de um grupo é a do prefixo carimbado mais LONGO que o contém.
 *
 * É o que faz `--set "<raiz>=comprado"` valer pra raiz inteira e ainda permitir
 * abrir exceção numa subpasta depois, sem desfazer o carimbo de cima.
 */
function licencaDe(key: string, stamps: StampFile): { license: License; herdadaDe: string } {
  const alvo = key.toLowerCase();
  let melhor = "";
  for (const k of Object.keys(stamps.groups)) {
    const low = k.toLowerCase();
    if ((alvo === low || alvo.startsWith(low + "/")) && low.length > melhor.length) melhor = k;
  }
  if (!melhor) return { license: "desconhecido", herdadaDe: "" };
  return { license: stamps.groups[melhor].license, herdadaDe: melhor };
}

// ─── agrupamento ─────────────────────────────────────────────────────────────

function agrupar(scanned: ScanFile, stamps: StampFile): Group[] {
  const porChave = new Map<string, { files: number; bytes: number; samples: string[] }>();

  for (const f of scanned.files) {
    const root = scanned.roots.find(
      (r) => f.path.toLowerCase() === r.toLowerCase() || f.path.toLowerCase().startsWith(r.toLowerCase() + "/"),
    );
    if (!root) continue;

    const rel = f.path.slice(root.length + 1);
    const segs = rel.split("/");
    const dirSegs = segs.slice(0, -1); // tira o nome do arquivo
    const key = [root, ...dirSegs.slice(0, DEPTH)].join("/");

    const g = porChave.get(key) ?? { files: 0, bytes: 0, samples: [] };
    g.files++;
    g.bytes += f.sizeBytes;
    if (g.samples.length < 3) g.samples.push(segs[segs.length - 1].replace(/\.psd$/i, ""));
    porChave.set(key, g);
  }

  return [...porChave.entries()]
    .map(([key, g]) => ({
      key,
      ...g,
      origin: pathOrigin(key),
      ...licencaDe(key, stamps),
    }))
    .sort((a, b) => b.bytes - a.bytes);
}

// ─── saída ───────────────────────────────────────────────────────────────────

const gb = (b: number) => (b / 1024 ** 3).toFixed(1) + " GB";
const pad = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s.padEnd(n));

function encurtar(key: string, roots: string[]): string {
  for (const r of roots) {
    if (key.toLowerCase().startsWith(r.toLowerCase())) {
      const resto = key.slice(r.length).replace(/^\//, "");
      const nomeRaiz = r.split("/").filter(Boolean).pop() || r;
      return resto ? `${nomeRaiz}/${resto}` : nomeRaiz;
    }
  }
  return key;
}

function relatorio(groups: Group[], scanned: ScanFile) {
  const vis = ONLY ? groups.filter((g) => g.license === ONLY) : groups;

  console.log("");
  console.log(
    `  ${pad("#", 6)}${pad("licença", 16)}${pad("psd", 7)}${pad("tam.", 10)}${pad("origem", 15)}pasta`,
  );
  console.log("  " + "─".repeat(110));

  vis.forEach((g) => {
    // O índice é sempre o da lista COMPLETA, para `--set "#n"` continuar valendo
    // quando você estiver olhando um recorte com `--only`.
    const idx = groups.indexOf(g);
    // Herdado aparece diferente de carimbado direto: senão você acha que
    // conferiu esta pasta quando na verdade conferiu a mãe dela.
    const herdado = g.herdadaDe && g.herdadaDe.toLowerCase() !== g.key.toLowerCase();
    const marca = g.license === "desconhecido" ? "?" : DISTRIBUIVEIS.has(g.license) ? "+" : "-";
    const lic = `${marca} ${g.license}${herdado ? "*" : ""}`;
    console.log(
      `  ${pad("#" + idx, 6)}${pad(lic, 16)}${pad(String(g.files), 7)}${pad(gb(g.bytes), 10)}${pad(g.origin.label, 15)}${encurtar(g.key, scanned.roots)}`,
    );
    if (g.samples.length) console.log(`  ${" ".repeat(54)}${g.samples.join(" · ")}`);
  });

  console.log("");
  console.log("  * = herdado da pasta mãe   + = distribuível   - = não sai daqui   ? = ninguém carimbou");
  console.log("");

  // Placar. É o número que decide se dá pra montar o pack.
  const porLic = new Map<License, { files: number; bytes: number }>();
  for (const g of groups) {
    const acc = porLic.get(g.license) ?? { files: 0, bytes: 0 };
    acc.files += g.files;
    acc.bytes += g.bytes;
    porLic.set(g.license, acc);
  }
  for (const l of LICENSES) {
    const acc = porLic.get(l);
    if (acc) console.log(`  ${pad(l, 16)}${pad(String(acc.files) + " psd", 12)}${gb(acc.bytes)}`);
  }

  const dist = groups.filter((g) => DISTRIBUIVEIS.has(g.license));
  const distFiles = dist.reduce((n, g) => n + g.files, 0);
  const distBytes = dist.reduce((n, g) => n + g.bytes, 0);
  const pend = porLic.get("desconhecido");

  console.log("");
  console.log(`  DISTRIBUÍVEL HOJE: ${distFiles} psd, ${gb(distBytes)} em ${dist.length} pasta(s)`);
  if (pend) {
    console.log(`  FALTA CARIMBAR:    ${pend.files} psd, ${gb(pend.bytes)}`);
    console.log("");
    console.log(`  Carimbe pelo índice:  --set "#0=boxy"   (repetível na mesma rodada)`);
    console.log(`  ou pelo caminho:      --set "H:/Meu Drive/ASSETS VISANT=comprado"`);
  }
  console.log("");
  console.log(`  scan de ${new Date(scanned.scannedAt).toLocaleString("pt-BR")} — --rescan pra reler o disco`);
}

// ─── main ────────────────────────────────────────────────────────────────────

function main() {
  const stamps = lerCarimbos();
  const scanned = scan();
  let groups = agrupar(scanned, stamps);

  if (sets.length) {
    const novos: Record<string, StampEntry> = {};
    for (const spec of sets) {
      const eq = spec.lastIndexOf("=");
      if (eq < 0) {
        console.error(`--set inválido: "${spec}" (esperado "<pasta|#idx>=<licença>")`);
        process.exit(1);
      }
      const alvo = spec.slice(0, eq).trim();
      const lic = spec.slice(eq + 1).trim() as License;
      if (!LICENSES.includes(lic)) {
        console.error(`licença desconhecida: "${lic}". Use: ${LICENSES.join(" | ")}`);
        process.exit(1);
      }

      let key: string | undefined;
      if (alvo.startsWith("#")) {
        key = groups[parseInt(alvo.slice(1), 10)]?.key;
        if (!key) {
          console.error(`índice fora da lista: ${alvo}`);
          process.exit(1);
        }
      } else {
        const norm = alvo.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
        // Casa com grupo exato OU com qualquer prefixo de caminho — carimbar uma
        // raiz inteira precisa funcionar mesmo que ela não seja um grupo listado.
        key = groups.find((g) => g.key.toLowerCase() === norm)?.key;
        if (!key && groups.some((g) => g.key.toLowerCase().startsWith(norm + "/"))) key = alvo.replace(/\\/g, "/").replace(/\/+$/, "");
        if (!key) {
          console.error(`nenhuma pasta casa com "${alvo}".`);
          const perto = groups.filter((g) => g.key.toLowerCase().includes(norm.split("/").pop() || "")).slice(0, 5);
          if (perto.length) {
            console.error("  quis dizer:");
            for (const p of perto) console.error(`    ${p.key}`);
          }
          process.exit(1);
        }
      }

      novos[key] = { license: lic, stampedAt: new Date().toISOString() };
      console.log(`  carimbado ${lic.padEnd(12)} ${key}`);
    }
    gravarCarimbos(stamps, novos);
    // Reagrupa com os carimbos novos pra o relatório já refletir a rodada.
    groups = agrupar(scanned, lerCarimbos());
  }

  if (JSON_OUT) {
    console.log(JSON.stringify({ groups, scannedAt: scanned.scannedAt }, null, 2));
    return;
  }
  relatorio(groups, scanned);
}

main();
