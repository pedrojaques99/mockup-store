/**
 * engine-learn — reagrega o histórico de feedback (data/engine-feedback/events.jsonl)
 * num engine-profile.json novo (bias por canto/superfície + defaults + IoU médio).
 *
 * Roda fire-and-forget a cada aceite; este script é o gatilho manual / de cron:
 *   bun scripts/engine-learn.ts
 *   npx tsx scripts/engine-learn.ts
 * Cron (consolidar nightly): use /schedule apontando pra este comando.
 */
import { relearn } from "../src/lib/engine-feedback";

async function main() {
  const p = await relearn();
  console.log(`\n🧠 engine-profile v${p.version}  ·  ${p.samples} eventos  ·  IoU médio ${p.meanIoU != null ? (p.meanIoU * 100).toFixed(1) + "%" : "—"}\n`);

  const surfaces = new Set([...Object.keys(p.bias), ...Object.keys(p.defaults)]);
  if (!surfaces.size) { console.log("  (sem amostras ainda — calibre/publique mockups pra alimentar)"); return; }

  for (const st of surfaces) {
    const b = p.bias[st], d = p.defaults[st];
    const biasStr = b ? `bias n=${b.n} tl(${b.tl}) tr(${b.tr}) br(${b.br}) bl(${b.bl})` : "bias —";
    const defStr = d ? `defaults disp=${d.dispScale ?? "—"} material=${d.material ?? "—"}` : "";
    console.log(`  ${st.padEnd(12)} ${biasStr}  ${defStr}`);
  }
  console.log("");
}

main().catch((e) => { console.error(e); process.exit(1); });
