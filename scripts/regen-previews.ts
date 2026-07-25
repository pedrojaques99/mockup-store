/**
 * regen-previews — converte os thumbnails legados de `public/photo-previews/` (PNG
 * full-res, gravado quando os pontos de escrita ainda faziam `copyFile` cru do render)
 * pro formato novo: WebP ~640px q80.
 *
 * Contexto do audit de performance (`docs/AUDIT-performance-cache.md`, achado nº1):
 * 130 arquivos somando ~507 MB (média 3,9 MB, pico 17,5 MB) pra um card de grid que a
 * home pede 60 por página. `src/lib/agent-mockup.ts` e a rota de publish já gravam WebP
 * daqui pra frente — este script é o backfill pro que já existe em disco.
 *
 *   npx tsx scripts/regen-previews.ts --dry              # só relata, não escreve nada
 *   npx tsx scripts/regen-previews.ts                    # gera os .webp que faltam
 *   npx tsx scripts/regen-previews.ts --delete-legacy     # + apaga o .png depois de confirmar o .webp
 *
 * Idempotente: se já existe um .webp mais novo que o .png correspondente, pula.
 * Seguro: try/catch por arquivo — 1 falha não derruba o lote.
 */
import { readdir, stat, unlink } from "fs/promises";
import { existsSync } from "fs";
import { join, basename } from "path";
import sharp from "sharp";
import { PREVIEW_MAX_WIDTH, PREVIEW_WEBP_QUALITY } from "../src/lib/agent-mockup";

const DIR = join(process.cwd(), "public", "photo-previews");

const argv = process.argv.slice(2);
const isDry = argv.includes("--dry");
const deleteLegacy = argv.includes("--delete-legacy");

interface FileResult {
  name: string;
  beforeBytes: number;
  afterBytes: number;
  skipped: boolean;
  error?: string;
}

async function main() {
  if (!existsSync(DIR)) {
    console.log(`sem diretório ${DIR} — nada a fazer.`);
    return;
  }

  const entries = await readdir(DIR);
  const pngs = entries.filter((f) => /\.png$/i.test(f));

  if (!pngs.length) {
    console.log("nenhum .png em public/photo-previews/ — já está tudo em WebP.");
    return;
  }

  console.log(`${pngs.length} PNG(s) encontrados em ${DIR}${isDry ? " (--dry, não vai escrever nada)" : ""}`);

  const results: FileResult[] = [];
  let totalBefore = 0;
  let totalAfter = 0;

  for (const name of pngs) {
    const pngPath = join(DIR, name);
    const id = basename(name, ".png");
    const webpPath = join(DIR, `${id}.webp`);

    try {
      const pngStat = await stat(pngPath);
      totalBefore += pngStat.size;

      // Idempotente: já convertido e o .webp é mais novo que o .png → pula.
      if (existsSync(webpPath)) {
        const webpStat = await stat(webpPath);
        if (webpStat.mtimeMs >= pngStat.mtimeMs) {
          totalAfter += webpStat.size;
          results.push({ name, beforeBytes: pngStat.size, afterBytes: webpStat.size, skipped: true });
          continue;
        }
      }

      if (isDry) {
        // --dry não escreve nada em disco, mas roda a conversão de verdade em memória
        // (`.toBuffer()`) pra reportar o ganho MEDIDO, não chutado — a compressão varia
        // bastante conforme a foto (fundo liso comprime muito mais que textura).
        const buf = await sharp(pngPath)
          .resize({ width: PREVIEW_MAX_WIDTH, withoutEnlargement: true })
          .webp({ quality: PREVIEW_WEBP_QUALITY })
          .toBuffer();
        totalAfter += buf.length;
        results.push({ name, beforeBytes: pngStat.size, afterBytes: buf.length, skipped: false });
        continue;
      }

      await sharp(pngPath)
        .resize({ width: PREVIEW_MAX_WIDTH, withoutEnlargement: true })
        .webp({ quality: PREVIEW_WEBP_QUALITY })
        .toFile(webpPath);

      const webpStat = await stat(webpPath);
      totalAfter += webpStat.size;
      results.push({ name, beforeBytes: pngStat.size, afterBytes: webpStat.size, skipped: false });

      if (deleteLegacy) {
        await unlink(pngPath);
      }
    } catch (e: unknown) {
      results.push({ name, beforeBytes: 0, afterBytes: 0, skipped: false, error: e instanceof Error ? e.message : String(e) });
      console.error(`✗ ${name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const ok = results.filter((r) => !r.error);
  const failed = results.filter((r) => r.error);
  const converted = ok.filter((r) => !r.skipped);
  const skipped = ok.filter((r) => r.skipped);

  const mb = (bytes: number) => (bytes / (1024 * 1024)).toFixed(1);

  console.log("");
  console.log(`convertidos: ${converted.length} • pulados (já em WebP): ${skipped.length} • falhas: ${failed.length}`);
  console.log(`antes:  ${mb(totalBefore)} MB`);
  console.log(`depois: ${mb(totalAfter)} MB${isDry ? " (medido em memória, nada gravado)" : ""}`);
  console.log(`ganho:  ${mb(totalBefore - totalAfter)} MB (${totalBefore > 0 ? ((1 - totalAfter / totalBefore) * 100).toFixed(0) : 0}%)`);

  if (isDry) {
    console.log("\n--dry: nada foi escrito. Rode sem --dry pra gerar os .webp de verdade.");
  } else if (!deleteLegacy && converted.length) {
    console.log("\nPNGs legados mantidos (rode com --delete-legacy pra apagá-los depois de conferir os .webp).");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
