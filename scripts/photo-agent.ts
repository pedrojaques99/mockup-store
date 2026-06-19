/**
 * photo-agent — adaptador CLI FINO sobre a lib-raiz `src/lib/agent-mockup.ts`.
 * Loop headless de mockups-foto via o core WYSIWYG (= idêntico ao app). LLM-agnóstico:
 * qualquer agente com shell chama. MCP/HTTP serão wrappers da MESMA lib depois.
 *
 *   # listar cenas calibradas disponíveis
 *   npx tsx --env-file=.env.local scripts/photo-agent.ts scenes
 *
 *   # renderizar a arte de uma marca Visant em N cenas
 *   npx tsx --env-file=.env.local scripts/photo-agent.ts render --brand <id> --count 10 --out .tmp/out
 *
 *   # ou arte local/URL, cenas específicas, ajustes de fit
 *   npx tsx scripts/photo-agent.ts render --art ./logo.png --scenes ab..,cd.. --fit contain --padding 0.1
 *
 * Flags: --brand <id> [--variant primary|dark|light|icon] | --art <path|url>
 *        --scenes id1,id2  --surface billboard|poster|...  --count N  --out DIR
 *        --fit contain|cover|stretch  --bg #ffffff  --padding 0.12  --preview  --fresh
 */
import { readFile } from "fs/promises";
import { createPhotoMockups, listPhotoScenes } from "../src/lib/agent-mockup";
import type { FitMode } from "../src/lib/art-frame";

const argv = process.argv.slice(2);
const cmd = argv[0];
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 ? argv[i + 1] : undefined;
};
const has = (name: string) => argv.includes(`--${name}`);

async function resolveArt(): Promise<Buffer> {
  const artArg = flag("art");
  if (artArg) {
    if (/^https?:\/\//.test(artArg)) {
      const r = await fetch(artArg);
      if (!r.ok) throw new Error(`arte URL ${r.status}`);
      return Buffer.from(await r.arrayBuffer());
    }
    return readFile(artArg);
  }
  const brand = flag("brand");
  if (brand) {
    const { getBrandGuideline, pickLogo } = await import("../src/lib/visant");
    const g = await getBrandGuideline(brand);
    const logo = pickLogo(g, flag("variant") as never);
    if (!logo?.url) throw new Error(`marca ${brand} sem logo`);
    const r = await fetch(logo.url);
    if (!r.ok) throw new Error(`logo ${r.status}`);
    console.log(`marca: ${g.name} • logo ${logo.variant}`);
    return Buffer.from(await r.arrayBuffer());
  }
  throw new Error("informe --brand <id> ou --art <path|url>");
}

async function main() {
  if (cmd === "scenes") {
    const scenes = await listPhotoScenes();
    console.log(`${scenes.length} cenas calibradas:\n`);
    for (const s of scenes) {
      console.log(`  ${s.id}  ${s.published ? "[pub]" : "[tmp]"}  ${s.surfaceType.padEnd(10)}  ${s.name}`);
    }
    return;
  }

  if (cmd === "render") {
    const art = await resolveArt();
    let sceneIds = flag("scenes")?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
    if (!sceneIds.length) {
      let scenes = await listPhotoScenes();
      const surface = flag("surface");
      if (surface) scenes = scenes.filter((s) => s.surfaceType === surface);
      sceneIds = scenes.map((s) => s.id);
    }
    const count = flag("count") ? parseInt(flag("count")!, 10) : sceneIds.length;
    sceneIds = sceneIds.slice(0, count);
    if (!sceneIds.length) throw new Error("nenhuma cena selecionada");

    const outDir = flag("out") ?? ".tmp/photo-mockups";
    console.log(`renderizando ${sceneIds.length} mockup(s) → ${outDir}\n`);
    const { results } = await createPhotoMockups({
      art, sceneIds, outDir,
      fit: (flag("fit") as FitMode) ?? "contain",
      bg: flag("bg") ?? null,
      padding: flag("padding") ? parseFloat(flag("padding")!) : undefined,
      quality: has("preview") ? "preview" : "hd",
      fresh: has("fresh"),
      onProgress: (m) => console.log("  " + m),
    });
    const ok = results.filter((r) => r.ok).length;
    console.log(`\n✓ ${ok}/${results.length} • ${outDir}/summary.json`);
    return;
  }

  console.log("uso: photo-agent.ts <scenes|render> [flags] — veja o topo do arquivo");
}

main().catch((e) => { console.error("erro:", e instanceof Error ? e.message : e); process.exit(1); });
