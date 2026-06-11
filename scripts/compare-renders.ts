/**
 * Compara os dois pipelines de render lado a lado:
 *   A) render-server (ag-psd + node-canvas, "na unha") — precisa estar rodando na porta 4200
 *   B) @printmadehq/mockup-generator (MockupSDK / Photopea headless)
 *
 * Uso: bun scripts/compare-renders.ts --psd <caminho.psd> [--art <imagem>] [--smart-object <nome>]
 * Saída: .tmp/compare/<nome-do-psd>/{art,agpsd,sdk}.png + compare.html
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { resolve, join, basename } from "path";
import { createConnection } from "net";
// Mesmo padrão de detecção do render-server (mais amplo que o SO_TARGET de psd-constants)
const SO_PATTERNS = /double.click|your.design|your.image|place.here|smart.object|artwork|design.here|edite|edit.*aqui|\(edite\)|\(editar\)|\[edit/i;

const RENDER_PORT = parseInt(process.env.RENDER_PORT || "4200");

function getArg(name: string, fallback = ""): string {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
}

const psdPath = resolve(getArg("psd"));
if (!psdPath || !existsSync(psdPath)) {
  console.error("Uso: bun scripts/compare-renders.ts --psd <caminho.psd> [--art <imagem>] [--smart-object <nome>]");
  process.exit(1);
}

const outDir = join(process.cwd(), ".tmp", "compare", basename(psdPath).replace(/\.psd$/i, "").replace(/[^\w-]+/g, "_"));
mkdirSync(outDir, { recursive: true });

// ---------- 1. Arte de teste (gerada se não informada) ----------
let artPath = getArg("art");
if (artPath) {
  artPath = resolve(artPath);
} else {
  const sharp = (await import("sharp")).default;
  const svg = `<svg width="2000" height="2000" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#ff3b6b"/><stop offset="0.5" stop-color="#7c3aed"/><stop offset="1" stop-color="#06b6d4"/>
      </linearGradient>
    </defs>
    <rect width="2000" height="2000" fill="url(#g)"/>
    ${Array.from({ length: 11 }, (_, i) => `<line x1="${i * 200}" y1="0" x2="${i * 200}" y2="2000" stroke="white" stroke-opacity="0.35" stroke-width="3"/><line x1="0" y1="${i * 200}" x2="2000" y2="${i * 200}" stroke="white" stroke-opacity="0.35" stroke-width="3"/>`).join("")}
    <circle cx="1000" cy="1000" r="420" fill="none" stroke="white" stroke-width="16"/>
    <circle cx="1000" cy="1000" r="40" fill="white"/>
    <text x="1000" y="780" font-family="Arial" font-size="180" font-weight="bold" fill="white" text-anchor="middle">BOXY</text>
    <text x="1000" y="1380" font-family="Arial" font-size="90" fill="white" text-anchor="middle">COMPARE A/B</text>
    <rect x="40" y="40" width="1920" height="1920" fill="none" stroke="#facc15" stroke-width="20"/>
  </svg>`;
  artPath = join(outDir, "art.png");
  await sharp(Buffer.from(svg)).png().toFile(artPath);
  console.log(`Arte de teste gerada: ${artPath}`);
}

// ---------- 2. Detectar smart object alvo (mesma prioridade do render-server) ----------
const agPsd = await import("ag-psd");
const psdMeta = agPsd.readPsd(readFileSync(psdPath), {
  skipLayerImageData: true,
  skipCompositeImageData: true,
  skipThumbnail: true,
});

interface FlatLayer { name?: string; placedLayer?: unknown; left?: number; right?: number; top?: number; bottom?: number; children?: FlatLayer[] }
function flatten(layers: FlatLayer[]): FlatLayer[] {
  return layers.flatMap((l) => [l, ...(l.children ? flatten(l.children) : [])]);
}
const allLayers = flatten((psdMeta.children as FlatLayer[]) || []);
const smartObjects = allLayers.filter((l) => l.placedLayer);

const requested = getArg("smart-object");
const target =
  (requested && allLayers.find((l) => l.name === requested)) ||
  (requested && allLayers.find((l) => l.name?.toLowerCase().includes(requested.toLowerCase()))) ||
  (smartObjects.length === 1 ? smartObjects[0] : null) ||
  allLayers.find((l) => SO_PATTERNS.test(l.name || "")) ||
  (smartObjects.length > 1
    ? smartObjects.reduce((a, b) => {
        const areaA = ((a.right || 0) - (a.left || 0)) * ((a.bottom || 0) - (a.top || 0));
        const areaB = ((b.right || 0) - (b.left || 0)) * ((b.bottom || 0) - (b.top || 0));
        return areaB > areaA ? b : a;
      })
    : smartObjects[0] || null);

if (!target?.name) {
  console.error(`Nenhum smart object encontrado. Layers: ${allLayers.map((l) => l.name).filter(Boolean).join(", ")}`);
  process.exit(1);
}
const soName = target.name;
console.log(`PSD: ${basename(psdPath)} (${psdMeta.width}x${psdMeta.height}) — smart objects: ${smartObjects.map((s) => `"${s.name}"`).join(", ") || "nenhum"}`);
console.log(`Smart object alvo: "${soName}"\n`);

// ---------- 3. Pipeline A: render-server (na unha) ----------
interface PipeResult { ok: boolean; ms: number; error?: string; file?: string }

function renderViaServer(outputPath: string): Promise<PipeResult> {
  return new Promise((res) => {
    const start = Date.now();
    const socket = createConnection({ port: RENDER_PORT, host: "127.0.0.1" });
    let data = "";
    const timer = setTimeout(() => { socket.destroy(); res({ ok: false, ms: Date.now() - start, error: "timeout 120s" }); }, 120_000);
    socket.on("connect", () => {
      socket.write(JSON.stringify({ psdPath, artPath, outputPath, smartObject: soName, hideLayers: [] }) + "\n");
    });
    socket.on("data", (chunk) => {
      data += chunk.toString();
      let nl: number;
      while ((nl = data.indexOf("\n")) !== -1) {
        const line = data.slice(0, nl);
        data = data.slice(nl + 1);
        if (line.startsWith("progress:")) continue;
        try {
          const r = JSON.parse(line);
          clearTimeout(timer);
          socket.end();
          res(r.ok ? { ok: true, ms: Date.now() - start, file: outputPath } : { ok: false, ms: Date.now() - start, error: r.error });
        } catch {}
      }
    });
    socket.on("error", (err) => { clearTimeout(timer); res({ ok: false, ms: Date.now() - start, error: `render-server indisponível (porta ${RENDER_PORT}): ${err.message}. Suba com: bun scripts/render-server.ts` }); });
  });
}

console.log("— Pipeline A: render-server (ag-psd, na unha)...");
const resultA = await renderViaServer(join(outDir, "agpsd.png"));
console.log(resultA.ok ? `  OK em ${(resultA.ms / 1000).toFixed(1)}s` : `  FALHOU: ${resultA.error}`);

// ---------- 4. Pipeline B: MockupSDK (Photopea headless) ----------
console.log("\n— Pipeline B: mockup-generator (MockupSDK / Photopea headless)...");
let resultB: PipeResult & { initMs?: number };
try {
  const t0 = Date.now();
  const { MockupSDK } = await import("@printmadehq/mockup-generator");
  const sdk = await MockupSDK.create({ mode: "serverless" });
  const initMs = Date.now() - t0;
  const t1 = Date.now();
  const gen = await sdk.generate({
    psd: readFileSync(psdPath),
    replacements: [{ name: soName, image: readFileSync(artPath), fillMode: "fill" }],
    exports: [{ format: "png", quality: 90 }],
  });
  const ms = Date.now() - t1;
  if (gen.exports?.length) {
    const file = join(outDir, "sdk.png");
    writeFileSync(file, Buffer.from(gen.exports[0].buffer));
    resultB = { ok: true, ms, initMs, file };
    console.log(`  OK em ${(ms / 1000).toFixed(1)}s (+ ${(initMs / 1000).toFixed(1)}s de init do SDK/browser)`);
  } else {
    resultB = { ok: false, ms, initMs, error: "SDK não produziu export" };
    console.log(`  FALHOU: sem export`);
  }
  await sdk.cleanup();
} catch (err) {
  resultB = { ok: false, ms: 0, error: err instanceof Error ? err.message : String(err) };
  console.log(`  FALHOU: ${resultB.error}`);
}

// ---------- 5. HTML lado a lado ----------
const block = (title: string, sub: string, r: PipeResult) => r.ok
  ? `<figure><figcaption><b>${title}</b> — ${sub} · <b>${(r.ms / 1000).toFixed(1)}s</b></figcaption><img src="${basename(r.file!)}"></figure>`
  : `<figure><figcaption><b>${title}</b> — ${sub}</figcaption><div class="err">FALHOU: ${r.error}</div></figure>`;

writeFileSync(join(outDir, "compare.html"), `<!doctype html><meta charset="utf-8"><title>Compare: ${basename(psdPath)}</title>
<style>
  body{background:#0a0a0a;color:#eee;font-family:system-ui;margin:24px}
  h1{font-size:16px} .meta{color:#888;font-size:12px;margin-bottom:16px}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
  figure{margin:0} figcaption{font-size:12px;color:#aaa;margin-bottom:6px}
  img{width:100%;border:1px solid #333;border-radius:8px}
  .err{border:1px solid #733;border-radius:8px;padding:24px;color:#f88;font-size:13px}
  .overlay{margin-top:24px} .overlay .stack{position:relative}
  .overlay img{position:absolute;inset:0} .overlay img:first-child{position:relative}
  .overlay img.top{opacity:0;transition:opacity .15s} .overlay .stack:hover img.top{opacity:1}
  .hint{font-size:11px;color:#777}
</style>
<h1>${basename(psdPath)} — smart object "${soName}"</h1>
<div class="meta">${psdMeta.width}×${psdMeta.height}px · arte: ${basename(artPath)}</div>
<div class="grid">
  ${block("A · na unha", "render-server / ag-psd", resultA)}
  ${block("B · mockup-generator", "Photopea headless", resultB)}
</div>
${resultA.ok && resultB.ok ? `<div class="overlay"><p class="hint">Passe o mouse para alternar A → B no mesmo lugar (diferenças “pulam” aos olhos):</p><div class="stack"><img src="agpsd.png"><img class="top" src="sdk.png"></div></div>` : ""}
`);

console.log(`\nResultados em: ${outDir}`);
console.log(`Abra: ${join(outDir, "compare.html")}`);
