/**
 * make-virt-fixture — gera `.tmp/virt-test` para provar que a lista de
 * aprovação é virtualizada.
 *
 *   npx tsx scripts/make-virt-fixture.ts [quantidade]
 *
 * Sem esta pasta, `npm run visual:ingest` PULA a checagem de virtualização e
 * diz isso em voz alta. Com ela, a checagem conta quantas linhas existem no DOM
 * e falha se for a lista inteira.
 *
 * Os arquivos têm de passar pela triagem, senão a tela de revisão nem aparece e
 * o teste morre esperando linha que não vem. Foram três tentativas até acertar:
 *
 *   1. PNGs idênticos  → viram duplicata uns dos outros (`new: 0`)
 *   2. ruído padronizado → o PNG comprime para 2 KB e cai em "arquivo minúsculo"
 *   3. ruído REAL, >= 15 KB e lado >= 240px → passa, que é o que está aqui
 */
import { rmSync, mkdirSync, writeFileSync } from "fs";
import { randomBytes } from "crypto";
import { join } from "path";
import sharp from "sharp";
import { MIN_IMAGE_BYTES, MIN_IMAGE_SIDE } from "../src/lib/ingest-triage";

const QUANTIDADE = Number(process.argv[2]) || 150;
const DIR = join(process.cwd(), ".tmp", "virt-test");

async function main() {
  rmSync(DIR, { recursive: true, force: true });
  mkdirSync(DIR, { recursive: true });

  for (let i = 0; i < QUANTIDADE; i++) {
    // Acima do lado mínimo, e variando para nenhum par sair idêntico.
    const w = MIN_IMAGE_SIDE + 20 + (i % 20);
    const h = MIN_IMAGE_SIDE + 10 + (i % 15);
    // `compressionLevel: 0` sobre ruído real garante o tamanho mínimo.
    const buf = await sharp(randomBytes(w * h * 3), { raw: { width: w, height: h, channels: 3 } })
      .png({ compressionLevel: 0 })
      .toBuffer();
    if (buf.length < MIN_IMAGE_BYTES) {
      throw new Error(`fixture saiu com ${buf.length} bytes, abaixo do mínimo da triagem`);
    }
    writeFileSync(join(DIR, `mock_${String(i).padStart(4, "0")}.png`), buf);
  }

  console.log(`  ${QUANTIDADE} arquivos em ${DIR}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
