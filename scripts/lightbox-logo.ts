/**
 * One-off: renderiza os PSDs de lightbox (fachada luminosa) por NOME com um
 * símbolo 1:1 já padeado pra 9:16. O batch normal não mira cena específica e
 * o --square ignora face 9:16 — daí este script direto.
 *
 * Uso:
 *   npx tsx --env-file=.env.local scripts/lightbox-logo.ts \
 *     --out "<dir>" --art "a.png,b.png" --psd "boxy lightbox mockup vertical 1.psd,vsn_mockup_lightbox_01_thin.psd"
 */
import { MongoClient } from "mongodb";
import { createConnection } from "net";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { join, resolve } from "path";
import { computeFaces } from "@visant/psd-engine";
import { frameArt } from "../src/lib/server-frame";

const RENDER_PORT = parseInt(process.env.RENDER_PORT || "4200");
const A = process.argv.slice(2);
const flag = (k: string, d?: string) => { const i = A.indexOf(`--${k}`); return i !== -1 ? A[i + 1] : d; };
const outDir = flag("out")!;
const arts = flag("art")!.split(",").map((s) => s.trim());
const psds = flag("psd")!.split(",").map((s) => s.trim());
const slug = (s: string) => s.replace(/\.psd$/i, "").replace(/[^a-z0-9]+/gi, "_");

function renderJob(job: Record<string, unknown>) {
  return new Promise<{ ok?: boolean; error?: string }>((res, rej) => {
    const sock = createConnection({ port: RENDER_PORT, host: "127.0.0.1" });
    let buf = "";
    const timer = setTimeout(() => { sock.destroy(); res({ error: "timeout" }); }, 180_000);
    sock.on("connect", () => sock.write(JSON.stringify(job) + "\n"));
    sock.on("data", (c) => { buf += c.toString(); const ls = buf.split("\n"); buf = ls.pop()!; for (const l of ls) if (l.startsWith("{")) { clearTimeout(timer); try { res(JSON.parse(l)); } catch { res({ error: "bad json" }); } sock.destroy(); } });
    sock.on("error", (e) => { clearTimeout(timer); rej(e); });
  });
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  const artTmp = resolve(".tmp/lightbox-art");
  mkdirSync(artTmp, { recursive: true });
  const client = new MongoClient(process.env.MONGODB_URI!);
  await client.connect();
  const col = client.db(process.env.MONGODB_DB_NAME!).collection("psd_metadata");

  let n = 1;
  for (const psdName of psds) {
    const d = await col.findOne({ fileName: psdName });
    if (!d) { console.log(`✗ não achei ${psdName}`); continue; }
    const fp = (d.filePath as string).replace(/\//g, "\\");
    if (!existsSync(fp)) { console.log(`✗ arquivo sumiu ${fp}`); continue; }
    const faces = computeFaces((d.smartObjects || []) as never);
    // face frontal = maior área com aspect vertical (< 0.7)
    const front = faces
      .filter((f: any) => f.innerWidth / f.innerHeight < 0.7)
      .sort((a: any, b: any) => b.innerWidth * b.innerHeight - a.innerWidth * a.innerHeight)[0] || faces[0];

    for (const artPath of arts) {
      const framed = await frameArt(readFileSync(artPath), front.innerWidth, front.innerHeight, { mode: "cover", bg: null });
      const ap = join(artTmp, `${slug(psdName)}-${slug(artPath)}.png`);
      writeFileSync(ap, framed);
      const outFile = join(outDir, `${String(n).padStart(2, "0")}-Lightbox-${slug(psdName)}-${slug(artPath).slice(-8)}.png`);
      const r = await renderJob({ psdPath: fp, replacements: [{ smartObject: (front as any).smartObject, artPath: ap }], outputPath: outFile, hideLayers: [], preview: false });
      if (r.error) console.log(`✗ [${n}] ${psdName} — ${r.error}`);
      else console.log(`✓ [${n}] ${psdName} ← ${artPath.split(/[\\/]/).pop()}`);
      n++;
    }
  }
  await client.close();
  console.log("done");
}
main().catch((e) => { console.error(e); process.exit(1); });
