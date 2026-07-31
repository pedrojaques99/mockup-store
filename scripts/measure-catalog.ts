/** Mede onde vai o tempo do buildCatalog — sem palpite. */
import { getDb } from "../src/lib/db";
import { listPhotoScenes } from "../src/lib/agent-mockup";
import { findPsdForRef } from "../src/lib/psd-index";

const t = (label: string, t0: number) => console.log(`${label.padEnd(28)} ${String(Date.now() - t0).padStart(6)}ms`);

(async () => {
  let t0 = Date.now();
  const db = await getDb();
  t("conectar Mongo", t0);

  t0 = Date.now();
  const rows = await db.collection("community_presets").find(
    { category: "reference", isAdminCurated: true },
    { projection: { id: 1, name: 1, studio: 1, description: 1, referenceImageUrl: 1, dimensions: 1, tags: 1, psdFileName: 1, psdPath: 1, smartObjectName: 1, soInnerWidth: 1, soInnerHeight: 1, type: 1, photoSceneId: 1 } },
  ).limit(20_000).toArray();
  t(`query Mongo (${rows.length} docs)`, t0);

  t0 = Date.now();
  const scenes = await listPhotoScenes().catch(() => []);
  t(`listPhotoScenes (${scenes.length})`, t0);

  const { getAllPsds } = await import("../src/lib/psd-index");
  t0 = Date.now();
  const n = getAllPsds().length;
  t(`walk + index (${n} PSDs)`, t0);

  for (const pass of [1, 2]) {
    t0 = Date.now();
    let semPath = 0, achou = 0;
    for (const r of rows) if (!r.psdPath) {
      semPath++;
      if (findPsdForRef((r.psdFileName as string) || (r.name as string), r.studio as string)) achou++;
    }
    t(`findPsdForRef passe ${pass} (${semPath} refs, ${achou} achados)`, t0);
  }

  process.exit(0);
})();
