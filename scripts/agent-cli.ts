/**
 * CLI headless do mockup-store — feito pra ser operado por agente (Claude) ou humano.
 * Fala direto com Mongo + Visant + render-server TCP (:4200). Não precisa do Next.
 *
 * Run: npx tsx --env-file=.env.local scripts/agent-cli.ts <cmd> [...]
 *
 * Comandos:
 *   brands                          lista as marcas da Visant conectada
 *   suggest --brand <id> [--limit 20]
 *                                   sugestões brand-aware (só refs com PSD)
 *   faces <psdFileName>             faces editáveis de um PSD (do banco)
 *   render --brand <id> [--count 10] [--out .tmp/batch] [--preview]
 *          [--refs id1,id2] [--search "billboard"] [--art <path|url>]
 *          [--mode contain|cover|stretch] [--bg <hex|none>] [--variant primary|dark|light|icon]
 *                                   batch: escolhe mockups (suggest/refs/search),
 *                                   baixa o logo (ou usa --art), enquadra por face
 *                                   e renderiza tudo via render-server
 *
 * Requisitos: render-server rodando (`npm run render`) e Visant conectada
 * (login pela UI uma vez, ou VISANT_API_KEY no .env.local).
 */
import { createConnection } from "net";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { join, resolve } from "path";

const RENDER_PORT = parseInt(process.env.RENDER_PORT || "4200");

// ── arg parsing ───────────────────────────────────────────────────────────────
const [cmd, ...rest] = process.argv.slice(2);
const positional: string[] = [];
const flags = new Map<string, string>();
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith("--")) {
    const key = rest[i].slice(2);
    const next = rest[i + 1];
    if (next !== undefined && !next.startsWith("--")) { flags.set(key, next); i++; }
    else flags.set(key, "true");
  } else positional.push(rest[i]);
}
const flag = (k: string, def?: string) => flags.get(k) ?? def;

function die(msg: string): never {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

// ── render via TCP ────────────────────────────────────────────────────────────
function renderJob(job: Record<string, unknown>, onStep?: (s: string, d?: string) => void) {
  return new Promise<{ ok?: boolean; error?: string; durationMs?: number }>((resolvePromise, reject) => {
    const sock = createConnection({ port: RENDER_PORT, host: "127.0.0.1" });
    let buf = "";
    const timer = setTimeout(() => { sock.destroy(); resolvePromise({ error: "timeout" }); }, 120_000);
    sock.on("connect", () => sock.write(JSON.stringify(job) + "\n"));
    sock.on("data", (chunk) => {
      buf += chunk.toString();
      const lines = buf.split("\n");
      buf = lines.pop()!;
      for (const line of lines) {
        if (line.startsWith("progress:")) {
          try { const ev = JSON.parse(line.slice(9)); onStep?.(ev.step, ev.detail); } catch {}
        } else if (line.startsWith("{")) {
          clearTimeout(timer);
          try { resolvePromise(JSON.parse(line)); } catch { resolvePromise({ error: "bad json" }); }
          sock.destroy();
        }
      }
    });
    sock.on("error", (err) => { clearTimeout(timer); reject(new Error(`render-server indisponível (:${RENDER_PORT}): ${err.message} — rode \`npm run render\``)); });
  });
}

const slug = (s: string) => s.replace(/[^\wÀ-ɏ-]+/g, "_").replace(/_+/g, "_").slice(0, 60);

// ── comandos ──────────────────────────────────────────────────────────────────
async function cmdBrands() {
  const { listBrandGuidelines } = await import("../src/lib/visant");
  const brands = await listBrandGuidelines();
  if (!brands.length) { console.log("Nenhuma marca encontrada."); return; }
  for (const b of brands) {
    console.log(`${b.id}  ${b.name}  (${b.colors?.length || 0} cores${b.logoUrl ? ", logo ✓" : ""})`);
  }
}

async function cmdSuggest() {
  const brandId = flag("brand") || die("--brand <id> obrigatório (veja `brands`)");
  const limit = parseInt(flag("limit", "20")!);
  const { suggestForBrand } = await import("../src/lib/suggest-core");
  const result = await suggestForBrand(brandId, { limit, onlyPsd: true });
  console.log(`Marca: ${result.brand.name} — ${result.suggestions.length} sugestões (de ${result.total} refs)`);
  for (const s of result.suggestions) {
    console.log(`${s.ref.id}  [${s.score.toFixed(2)}]  ${s.ref.name}  (${s.ref.studio || "?"})  ${s.reasons.slice(0, 3).join(", ")}`);
  }
}

async function cmdFaces() {
  const fileName = positional[0] || die("uso: faces <psdFileName>");
  const { getDb } = await import("../src/lib/db");
  const { computeFaces } = await import("../src/lib/psd-faces");
  const db = await getDb();
  const meta = await db.collection("psd_metadata").findOne({ fileName });
  if (!meta) die(`psd_metadata não tem "${fileName}"`);
  for (const f of computeFaces(meta!.smartObjects || [])) {
    console.log(`"${f.name}"  →  smartObject: "${f.smartObject}"  ${f.innerWidth}×${f.innerHeight}px  (${f.linkedCount} SO vinculados)`);
  }
}

interface RenderTarget { id: string; name: string; studio?: string; psdPath: string }

async function pickTargets(count: number): Promise<{ targets: RenderTarget[]; brandName?: string }> {
  const { getDb } = await import("../src/lib/db");
  const db = await getDb();

  // --refs explícitos
  const refsFlag = flag("refs");
  if (refsFlag) {
    const ids = refsFlag.split(",").map((s) => s.trim()).filter(Boolean);
    const docs = await db.collection("community_presets")
      .find({ id: { $in: ids }, category: "reference" })
      .project({ id: 1, name: 1, studio: 1, psdPath: 1, psdFileName: 1 }).toArray();
    return { targets: await resolvePsds(docs) };
  }

  // --search por nome
  const search = flag("search");
  if (search) {
    const docs = await db.collection("community_presets")
      .find({ category: "reference", psdPath: { $exists: true, $nin: [null, ""] }, name: { $regex: search, $options: "i" } })
      .project({ id: 1, name: 1, studio: 1, psdPath: 1, psdFileName: 1 })
      .limit(count * 2).toArray();
    return { targets: (await resolvePsds(docs)).slice(0, count) };
  }

  // default: sugestões brand-aware
  const brandId = flag("brand") || die("informe --brand <id>, --refs ou --search");
  const { suggestForBrand } = await import("../src/lib/suggest-core");
  const result = await suggestForBrand(brandId, { limit: count * 2, onlyPsd: true });
  const docs = result.suggestions.map((s) => ({
    id: s.ref.id, name: s.ref.name, studio: s.ref.studio,
    psdPath: s.ref.psdPath, psdFileName: s.ref.psdFileName,
  }));
  return { targets: (await resolvePsds(docs)).slice(0, count), brandName: result.brand.name };
}

async function resolvePsds(docs: Array<Record<string, unknown>>): Promise<RenderTarget[]> {
  const { findPsdForRef } = await import("../src/lib/psd-index");
  const out: RenderTarget[] = [];
  for (const d of docs) {
    let psdPath = (d.psdPath as string) || "";
    if (!psdPath) {
      const found = findPsdForRef((d.psdFileName as string) || (d.name as string), d.studio as string | undefined);
      if (found) psdPath = found.path;
    }
    if (psdPath && existsSync(psdPath)) {
      out.push({ id: d.id as string, name: d.name as string, studio: d.studio as string | undefined, psdPath });
    }
  }
  return out;
}

async function cmdRender() {
  const count = parseInt(flag("count", "10")!);
  const outDir = resolve(flag("out", ".tmp/batch")!);
  const preview = flags.has("preview");
  const bgFlag = flag("bg", "#ffffff")!;
  const bg = bgFlag === "none" ? null : bgFlag;

  // 1. Arte: --art (path/url) ou logo da marca
  let artBuffer: Buffer;
  let isLogo = false;
  const artFlag = flag("art");
  if (artFlag) {
    if (/^https?:\/\//.test(artFlag)) {
      const res = await fetch(artFlag);
      if (!res.ok) die(`falha ao baixar arte: HTTP ${res.status}`);
      artBuffer = Buffer.from(await res.arrayBuffer());
    } else {
      if (!existsSync(artFlag)) die(`arte não encontrada: ${artFlag}`);
      artBuffer = readFileSync(artFlag);
    }
  } else {
    const brandId = flag("brand") || die("informe --art ou --brand (pro logo)");
    const { getBrandGuideline, pickLogo } = await import("../src/lib/visant");
    const guideline = await getBrandGuideline(brandId);
    const logo = pickLogo(guideline, flag("variant") as never);
    if (!logo?.url) die("marca sem logo cadastrado — use --art");
    console.log(`Logo: ${logo.variant}${logo.label ? ` (${logo.label})` : ""}`);
    const res = await fetch(logo.url);
    if (!res.ok) die(`falha ao baixar logo: HTTP ${res.status}`);
    artBuffer = Buffer.from(await res.arrayBuffer());
    isLogo = true;
  }
  const mode = (flag("mode") || (isLogo ? "contain" : "cover")) as "contain" | "cover" | "stretch";
  const padding = parseFloat(flag("padding", isLogo ? "0.12" : "0")!);

  // 2. Mockups alvo
  const { targets, brandName } = await pickTargets(count);
  if (!targets.length) die("nenhum mockup com PSD encontrado pros critérios");
  console.log(`${targets.length} mockups${brandName ? ` pra marca ${brandName}` : ""} → ${outDir}\n`);

  mkdirSync(outDir, { recursive: true });
  const artDir = join(outDir, ".art");
  mkdirSync(artDir, { recursive: true });

  const { getDb } = await import("../src/lib/db");
  const { computeFaces } = await import("../src/lib/psd-faces");
  const { frameArt } = await import("../src/lib/server-frame");
  const db = await getDb();

  // 3. Renderiza sequencial (o render-server é fila única)
  const results: Array<{ name: string; file?: string; ms?: number; error?: string }> = [];
  for (const [i, t] of targets.entries()) {
    const label = `[${i + 1}/${targets.length}] ${t.name}`;
    const psdName = t.psdPath.split(/[\\/]/).pop()!.replace(/\.psd$/i, "");
    const meta = await db.collection("psd_metadata").findOne({ fileName: psdName });
    const faces = computeFaces(meta?.smartObjects || []);

    // arte enquadrada por face (cada face tem aspect próprio)
    const replacements: Array<{ smartObject?: string; artPath: string }> = [];
    if (faces.length) {
      for (const [fi, f] of faces.entries()) {
        const framed = f.innerWidth && f.innerHeight
          ? await frameArt(artBuffer, f.innerWidth, f.innerHeight, { mode, bg, padding })
          : artBuffer;
        const artPath = join(artDir, `${slug(psdName)}-${fi}.png`);
        writeFileSync(artPath, framed);
        replacements.push({ smartObject: f.smartObject, artPath });
      }
    } else {
      const artPath = join(artDir, `${slug(psdName)}-0.png`);
      writeFileSync(artPath, artBuffer);
      replacements.push({ smartObject: "Your design", artPath });
    }

    const outFile = join(outDir, `${String(i + 1).padStart(2, "0")}-${slug(t.name)}.${preview ? "jpg" : "png"}`);
    const t0 = Date.now();
    try {
      const r = await renderJob(
        { psdPath: t.psdPath, replacements, outputPath: outFile, hideLayers: [], preview: preview ? 1400 : false },
        (step, detail) => { if (step === "warning" || step === "error") console.log(`   ⚠ ${step}: ${detail}`); }
      );
      if (r.error) {
        console.log(`✗ ${label} — ${r.error}`);
        results.push({ name: t.name, error: r.error });
      } else {
        const ms = Date.now() - t0;
        console.log(`✓ ${label} — ${(ms / 1000).toFixed(1)}s — ${faces.length || 1} face(s)`);
        results.push({ name: t.name, file: outFile, ms });
      }
    } catch (err) {
      console.log(`✗ ${label} — ${(err as Error).message}`);
      results.push({ name: t.name, error: (err as Error).message });
    }
  }

  // 4. Resumo
  const ok = results.filter((r) => r.file);
  writeFileSync(join(outDir, "summary.json"), JSON.stringify({ brandName, mode, bg, results }, null, 2));
  console.log(`\n${ok.length}/${results.length} renderizados em ${outDir}`);
  if (ok.length < results.length) {
    for (const r of results.filter((x) => x.error)) console.log(`  falhou: ${r.name} — ${r.error}`);
  }
}

// ── main ──────────────────────────────────────────────────────────────────────
const commands: Record<string, () => Promise<void>> = {
  brands: cmdBrands,
  suggest: cmdSuggest,
  faces: cmdFaces,
  render: cmdRender,
};

const run = commands[cmd];
if (!run) {
  console.log("Comandos: brands | suggest --brand <id> | faces <psdFileName> | render --brand <id> [--count N] [--out dir] [--preview]");
  process.exit(cmd ? 1 : 0);
}
run().then(() => process.exit(0)).catch((e) => die(String(e?.message || e)));
