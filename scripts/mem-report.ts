/**
 * mem-report — "por que o app está pesado?", respondido com número.
 *
 * Lê `/api/diag/memory` do servidor que estiver de pé e separa as três coisas
 * que o Gerenciador de Tarefas mistura num número só:
 *
 *   heapUsado  → objeto JS vivo (é aqui que vazamento aparece)
 *   external   → Buffer/ArrayBuffer (imagem decodificada, cache do bundler)
 *   rss        → a marca d'água do processo, que o V8 quase nunca devolve ao SO
 *
 * O achado que motivou o script: o dev server chega a 1,4 GB e o MESMO app em
 * produção fica em ~300 MB. Antes de caçar vazamento, confira em qual dos dois
 * você está olhando.
 *
 *   npm run perf:memory -- --url http://localhost:4100
 *   npm run perf:memory -- --url http://localhost:4100 --carga   (mede sob uso)
 */
const arg = (n: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > -1 ? process.argv[i + 1] : undefined;
};

const BASE = (arg("url") || "http://localhost:4100").replace(/\/$/, "");
const comCarga = process.argv.includes("--carga");

interface Diag {
  processo: {
    rssMB: number; heapUsadoMB: number; heapTotalMB: number;
    externalMB: number; arrayBuffersMB: number; uptimeMin: number;
  };
  catalogo: Record<string, unknown>;
}

async function ler(): Promise<Diag> {
  const r = await fetch(`${BASE}/api/diag/memory`);
  if (r.status === 404) {
    console.error(
      `\n  /api/diag/memory devolveu 404.\n` +
      `  A rota é fechada em produção de propósito (forma de memória é dado de\n` +
      `  infraestrutura). Em produção, meça de fora — o RSS do processo basta.\n`
    );
    process.exit(1);
  }
  if (!r.ok) throw new Error(`HTTP ${r.status} em ${BASE}`);
  return r.json();
}

function linha(rotulo: string, p: Diag["processo"]) {
  console.log(
    `  ${rotulo.padEnd(16)} rss ${String(p.rssMB).padStart(7)} MB` +
    `   heap ${String(p.heapUsadoMB).padStart(6)}/${String(p.heapTotalMB).padEnd(6)}` +
    `   external ${String(p.externalMB).padStart(6)} MB`
  );
}

async function main() {
  console.log(`\n  MEMÓRIA — ${BASE}\n`);
  const antes = await ler();
  linha("agora", antes.processo);
  console.log(`\n  no ar há ${antes.processo.uptimeMin} min`);
  console.log(`  catálogo: ${JSON.stringify(antes.catalogo)}`);

  if (comCarga) {
    console.log(`\n  aplicando carga (8 páginas + 8 buscas)...`);
    for (let p = 1; p <= 8; p++) await fetch(`${BASE}/api/references?page=${p}&limit=60&has_psd=true`).then((r) => r.json());
    for (const q of ["billboard", "poster", "neon", "outdoor", "camiseta", "mug", "livro", "caneca"]) {
      await fetch(`${BASE}/api/references?search=${q}&limit=60`).then((r) => r.json());
    }
    const depois = await ler();
    linha("depois", depois.processo);
    const dHeap = Math.round((depois.processo.heapUsadoMB - antes.processo.heapUsadoMB) * 10) / 10;
    const dRss = Math.round((depois.processo.rssMB - antes.processo.rssMB) * 10) / 10;
    console.log(`\n  delta: heap ${dHeap >= 0 ? "+" : ""}${dHeap} MB · rss ${dRss >= 0 ? "+" : ""}${dRss} MB`);
    console.log(
      dHeap > 100
        ? `  heap subiu muito para 16 requests. Se isto for um dev server, é o bundler;\n` +
          `  se for produção, vale um heap snapshot.`
        : `  crescimento dentro do esperado para o volume de requests.`
    );
  }
  console.log("");
}

main().catch((e) => { console.error(e); process.exit(1); });
