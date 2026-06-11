/**
 * Prepara artes quadradas tight do logo Soccer248 pra mockups 1:1.
 * Pra cada source: trim do bg uniforme → recompõe o ícone centrado num quadrado
 * com respiro. Saída em .tmp/soccer248-logo-art/.
 * Run: npx tsx scripts/prep-logo-squares.ts
 */
import { mkdirSync } from "fs";
import { resolve } from "path";

const LOGO = "H:/Meu Drive/@Clientes VSN/Soccer248/Logo";
const OUT = resolve(".tmp/soccer248-logo-art");
const SQ = 1600;

// source, cor de fundo do quadrado, fração que o ícone ocupa
// inner alto = ícone preenche a face (cover), pouca margem
const JOBS = [
  { src: `${LOGO}/5.png`, name: "logo-yellow-on-navy.png", bg: { r: 13, g: 26, b: 43 }, inner: 0.92 },
  { src: `${LOGO}/10.png`, name: "logo-navy-on-yellow.png", bg: { r: 246, g: 246, b: 166 }, inner: 0.92 },
  { src: `${LOGO}/11.png`, name: "logo-appicon.png", bg: { r: 13, g: 26, b: 43 }, inner: 0.99 },
];

async function main() {
  const sharp = (await import("sharp")).default;
  mkdirSync(OUT, { recursive: true });
  for (const j of JOBS) {
    // 1. trim do bg → bbox do ícone
    const trimmed = await sharp(j.src).trim({ threshold: 10 }).png().toBuffer();
    const m = await sharp(trimmed).metadata();
    const innerPx = Math.round(SQ * j.inner);
    // 2. redimensiona o ícone pra caber no inner (contain, sem distorcer)
    const icon = await sharp(trimmed).resize(innerPx, innerPx, { fit: "inside" }).png().toBuffer();
    const im = await sharp(icon).metadata();
    // 3. compõe centrado no quadrado da cor da marca
    await sharp({ create: { width: SQ, height: SQ, channels: 4, background: j.bg } })
      .composite([{ input: icon, left: Math.round((SQ - (im.width || innerPx)) / 2), top: Math.round((SQ - (im.height || innerPx)) / 2) }])
      .png()
      .toFile(`${OUT}/${j.name}`);
    console.log(`✓ ${j.name} (ícone ${m.width}x${m.height} → ${im.width}x${im.height} em ${SQ})`);
  }
  console.log(`\nartes em ${OUT}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
