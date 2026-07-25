/**
 * scene-doctor — auditoria de saúde do acervo de cenas.
 *
 *   npx tsx --env-file=.env.local scripts/scene-doctor.ts
 *   npx tsx --env-file=.env.local scripts/scene-doctor.ts --fix
 *
 * Busca boa não compensa catálogo sujo. Este script acha os problemas de DADO que fazem
 * a cena sumir do grid ou aparecer errada:
 *
 *  · cena sem `studio` → cai em "Local"/"Photo Scene" e some do filtro por estúdio
 *  · doc do Mongo divergindo do `settings.json` → o arquivo é o SSoT, o Mongo é espelho
 *    (publishes antigos gravavam `studio: "Photo Scene"` chapado)
 *  · thumbnail faltando → card sem imagem no grid
 *  · thumbnail `.png` legado gigante → 3,9 MB de média por card (ver regen-previews.ts)
 *  · nomes duplicados → o grid só disfarça com "Esconder Duplicados"
 *
 * `--fix` só faz a correção SEGURA: alinhar o `studio`/`tags` do Mongo ao `settings.json`
 * (na direção do SSoT). NUNCA inventa estúdio pra cena que não tem — isso é decisão
 * humana, e o script te dá o comando pronto pra fazer.
 */
import { existsSync, statSync } from "fs";
import { join } from "path";
import { listPhotoScenes } from "../src/lib/agent-mockup";

const FIX = process.argv.includes("--fix");
const PREVIEW_DIR = join(process.cwd(), "public", "photo-previews");
/** Acima disso o thumbnail é o render full-res disfarçado de card. */
const FAT_PREVIEW_BYTES = 400_000;

function previewOf(id: string): { path: string; bytes: number; legacy: boolean } | null {
  for (const ext of ["webp", "png"] as const) {
    const p = join(PREVIEW_DIR, `${id}.${ext}`);
    if (existsSync(p)) return { path: p, bytes: statSync(p).size, legacy: ext === "png" };
  }
  return null;
}

const mb = (b: number) => `${(b / 1024 / 1024).toFixed(1)} MB`;

async function main() {
  const scenes = await listPhotoScenes();
  console.log(`\n  SCENE DOCTOR — ${scenes.length} cenas\n`);

  const semEstudio = scenes.filter((s) => !s.studio);
  const semPreview: string[] = [];
  const gordos: { id: string; bytes: number }[] = [];
  const porNome = new Map<string, string[]>();

  for (const s of scenes) {
    const p = previewOf(s.id);
    if (!p) semPreview.push(s.id);
    else if (p.legacy && p.bytes > FAT_PREVIEW_BYTES) gordos.push({ id: s.id, bytes: p.bytes });
    const nome = s.name.replace(/\.[^.]+$/, "");
    porNome.set(nome, [...(porNome.get(nome) ?? []), s.id]);
  }
  const duplicados = [...porNome.entries()].filter(([, ids]) => ids.length > 1);

  // --- estúdio ausente
  if (semEstudio.length) {
    const pub = semEstudio.filter((s) => s.published);
    console.log(`  ⚠ ${semEstudio.length} cena(s) SEM ESTÚDIO (${pub.length} já publicada(s))`);
    for (const s of pub.slice(0, 20)) console.log(`      ${s.id}  ${s.name}`);
    if (pub.length) {
      console.log("\n    → estúdio é decisão humana, o script não inventa. Comando pronto:");
      console.log(`      npx tsx scripts/photo-agent.ts tag --scenes "${pub.slice(0, 20).map((s) => s.id).join(",")}" --studio "SUA MARCA"`);
    }
  } else {
    console.log("  ✓ toda cena tem estúdio");
  }

  // --- divergência Mongo × settings.json
  console.log("");
  let divergentes: { id: string; mongo: string; arquivo: string }[] = [];
  try {
    const { getDb } = await import("../src/lib/db");
    const db = await getDb();
    const col = db.collection("community_presets");
    const docs = await col.find({ type: "photo" }, { projection: { id: 1, studio: 1, photoSceneId: 1 } }).toArray();
    const byId = new Map(scenes.map((s) => [s.id, s]));

    for (const d of docs) {
      const s = byId.get((d.photoSceneId as string) ?? (d.id as string));
      if (!s?.studio) continue;
      if (d.studio !== s.studio) divergentes.push({ id: s.id, mongo: String(d.studio), arquivo: s.studio });
    }

    if (divergentes.length) {
      console.log(`  ⚠ ${divergentes.length} doc(s) do Mongo divergindo do settings.json (o arquivo é o SSoT)`);
      for (const d of divergentes.slice(0, 20)) console.log(`      ${d.id}  mongo="${d.mongo}"  arquivo="${d.arquivo}"`);
      if (FIX) {
        for (const d of divergentes) {
          await col.updateOne({ $or: [{ id: d.id }, { photoSceneId: d.id }] }, { $set: { studio: d.arquivo } });
        }
        console.log(`    ✓ ${divergentes.length} doc(s) alinhado(s) ao settings.json`);
      } else {
        console.log("    → rode com --fix pra alinhar o Mongo ao arquivo");
      }
    } else {
      console.log("  ✓ Mongo e settings.json de acordo");
    }
  } catch (e) {
    console.log(`  · Mongo indisponível — pulando checagem de divergência (${e instanceof Error ? e.message : e})`);
    divergentes = [];
  }

  // --- thumbnails
  console.log("");
  if (semPreview.length) {
    console.log(`  ⚠ ${semPreview.length} cena(s) SEM THUMBNAIL (card vazio no grid)`);
    for (const id of semPreview.slice(0, 10)) console.log(`      ${id}`);
    console.log("    → npx tsx scripts/photo-agent.ts previews --art <logo>");
  } else {
    console.log("  ✓ toda cena tem thumbnail");
  }

  if (gordos.length) {
    const total = gordos.reduce((a, g) => a + g.bytes, 0);
    console.log(`\n  ⚠ ${gordos.length} thumbnail(s) .png legado grande — ${mb(total)} no total`);
    console.log("    → npx tsx scripts/regen-previews.ts --dry   (depois --delete-legacy)");
  }

  // --- duplicados
  console.log("");
  if (duplicados.length) {
    console.log(`  ⚠ ${duplicados.length} nome(s) duplicado(s) — o grid só disfarça com "Esconder Duplicados"`);
    for (const [nome, ids] of duplicados.slice(0, 10)) console.log(`      "${nome}" × ${ids.length}`);
    console.log("    → npx tsx scripts/photo-agent.ts dedupe [--apply]");
  } else {
    console.log("  ✓ sem nomes duplicados");
  }

  const problemas = semEstudio.length + divergentes.length + semPreview.length + gordos.length + duplicados.length;
  console.log(`\n  ${problemas ? `${problemas} problema(s) encontrado(s)` : "acervo limpo"}\n`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
