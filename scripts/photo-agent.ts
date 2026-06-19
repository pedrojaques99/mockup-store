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
import { readFile, writeFile, rm } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import sharp from "sharp";
import { createPhotoMockups, listPhotoScenes, resolveSceneDir, finalizeFolder } from "../src/lib/agent-mockup";
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

  if (cmd === "gallery") {
    const scenes = (await listPhotoScenes()).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    const counts = new Map<string, number>();
    for (const s of scenes) counts.set(s.name, (counts.get(s.name) ?? 0) + 1);

    // thumbnail por cena (cover 200×134) — base64 p/ HTML + buffer p/ montagem
    const cell = { w: 200, h: 134, pad: 6, label: 26 };
    const thumbs: { s: typeof scenes[number]; b64: string; buf: Buffer | null }[] = [];
    for (const s of scenes) {
      const dir = resolveSceneDir(s.id);
      let buf: Buffer | null = null;
      if (dir) {
        const src = existsSync(join(dir, "photo-clean.png")) ? join(dir, "photo-clean.png")
          : existsSync(join(dir, "photo.png")) ? join(dir, "photo.png") : null;
        if (src) { try { buf = await sharp(src).resize(cell.w, cell.h, { fit: "cover" }).jpeg({ quality: 70 }).toBuffer(); } catch { /* */ } }
      }
      thumbs.push({ s, b64: buf ? buf.toString("base64") : "", buf });
    }

    // montagem PNG (grid 8 col) — pra ver aqui no chat
    const cols = 8, rows = Math.ceil(thumbs.length / cols);
    const cw = cell.w + cell.pad, ch = cell.h + cell.pad;
    const composites: { input: Buffer; left: number; top: number }[] = [];
    thumbs.forEach((t, i) => {
      if (t.buf) composites.push({ input: t.buf, left: (i % cols) * cw + cell.pad, top: Math.floor(i / cols) * ch + cell.pad });
    });
    const montage = await sharp({ create: { width: cols * cw + cell.pad, height: rows * ch + cell.pad, channels: 4, background: { r: 24, g: 24, b: 27, alpha: 1 } } })
      .composite(composites).png().toBuffer();
    const montagePath = join(process.cwd(), ".tmp", "scene-gallery.png");
    await writeFile(montagePath, montage);

    // HTML agrupado por nome (duplicadas juntas, com contagem)
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
    let html = `<!doctype html><meta charset=utf8><title>Cenas — ${scenes.length}</title><style>body{background:#18181b;color:#e4e4e7;font:13px system-ui;margin:0;padding:16px}h1{font-size:15px}.grp{margin:18px 0 6px;font-weight:700;color:#fafafa}.dup{color:#f59e0b}.grid{display:flex;flex-wrap:wrap;gap:10px}.card{width:200px;background:#27272a;border-radius:8px;overflow:hidden;border:1px solid #3f3f46}.card img{width:200px;height:134px;object-fit:cover;display:block;background:#000}.m{padding:6px 8px;font-family:ui-monospace,monospace;font-size:11px}.id{color:#a1a1aa;user-select:all;cursor:text}.b{display:inline-block;font-size:10px;padding:1px 5px;border-radius:4px;margin-right:4px}.pub{background:#15803d}.tmp{background:#525252}</style>`;
    html += `<h1>${scenes.length} cenas no store — duplicadas em <span class=dup>laranja</span>. Selecione o id (clique 1×) p/ copiar e apagar.</h1>`;
    let lastName = "";
    for (const t of thumbs) {
      const c = counts.get(t.s.name)!;
      if (t.s.name !== lastName) {
        if (lastName) html += `</div>`;
        html += `<div class="grp ${c > 1 ? "dup" : ""}">${esc(t.s.name)} ${c > 1 ? `— ${c}× DUPLICADA` : ""}</div><div class=grid>`;
        lastName = t.s.name;
      }
      html += `<div class=card>${t.b64 ? `<img src="data:image/jpeg;base64,${t.b64}">` : `<div style="height:134px;background:#000"></div>`}<div class=m><span class="b ${t.s.published ? "pub" : "tmp"}">${t.s.published ? "PUB" : "TMP"}</span>${esc(t.s.surfaceType)}<br><span class=id>${t.s.id}</span></div></div>`;
    }
    html += `</div>`;
    const htmlPath = join(process.cwd(), ".tmp", "scene-gallery.html");
    await writeFile(htmlPath, html);

    const dupNames = [...counts.entries()].filter(([, c]) => c > 1);
    const dupTotal = dupNames.reduce((a, [, c]) => a + (c - 1), 0);
    console.log(`${scenes.length} cenas • ${dupNames.length} nomes duplicados (${dupTotal} cópias extras)`);
    console.log(`HTML: ${htmlPath}`);
    console.log(`PNG:  ${montagePath}`);
    return;
  }

  if (cmd === "finalize") {
    const dir = flag("dir") ?? "Render/New Mockups";
    const only = flag("only")?.split(",").map((s) => s.trim()).filter(Boolean);
    console.log(`finalizando cenas de ${dir}${only ? ` (filtro: ${only.join(",")})` : ""}\n`);
    const results = await finalizeFolder(dir, { only });
    for (const r of results) console.log(`  ${r.ok ? "✓" : "✗"} ${r.filename}${r.ok ? `  → ${r.id}` : `  (${r.error})`}`);
    const ok = results.filter((r) => r.ok).length;
    console.log(`\n✓ ${ok}/${results.length} finalizadas`);
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

  if (cmd === "delete") {
    const ids = argv.slice(1).filter((a) => /^[a-f0-9]{16}$/.test(a));
    if (!ids.length) throw new Error("uso: delete <id> [<id>...] (16-hex)");
    for (const id of ids) {
      const dir = resolveSceneDir(id);
      if (!dir) { console.log(`= ${id} não encontrada`); continue; }
      await rm(dir, { recursive: true, force: true });
      console.log(`✗ apagada ${id}  (${dir})`);
    }
    return;
  }

  if (cmd === "dedupe") {
    const apply = has("apply");
    const scenes = await listPhotoScenes();
    const byName = new Map<string, typeof scenes>();
    for (const s of scenes) { const a = byName.get(s.name) ?? []; a.push(s); byName.set(s.name, a); }
    const toDelete: { id: string; name: string }[] = [];
    for (const [name, group] of byName) {
      if (group.length < 2) continue;
      // keeper: publicada > mais assets (pipeline novo) > primeira
      const scored = await Promise.all(group.map(async (s) => {
        const dir = resolveSceneDir(s.id);
        let assets = 0;
        if (dir) for (const f of ["color-cast.png", "shadow-screen.png", "occluder.png", "reflection-mask.png", "settings.json"]) if (existsSync(join(dir, f))) assets++;
        return { s, score: (s.published ? 100 : 0) + assets };
      }));
      scored.sort((a, b) => b.score - a.score);
      for (const { s } of scored.slice(1)) toDelete.push({ id: s.id, name });
    }
    console.log(`${toDelete.length} cópias extras ${apply ? "APAGANDO" : "(dry-run — use --apply pra apagar)"}:`);
    for (const d of toDelete) console.log(`  ${apply ? "✗" : "-"} ${d.id}  ${d.name}`);
    if (apply) for (const d of toDelete) { const dir = resolveSceneDir(d.id); if (dir) await rm(dir, { recursive: true, force: true }); }
    return;
  }

  console.log("uso: photo-agent.ts <scenes|gallery|render|delete|dedupe> [flags] — veja o topo do arquivo");
}

main().catch((e) => { console.error("erro:", e instanceof Error ? e.message : e); process.exit(1); });
