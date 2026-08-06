/**
 * Mede o contraste de rótulos claros sobre um render e diz qual scrim (véu
 * escuro) é preciso pra cada um passar no WCAG AA.
 *
 * Existe porque "esse texto tá ilegível" é opinião até virar razão de contraste.
 *
 * Uso:
 *   npx tsx --env-file=.env.local scripts/contrast-guard.ts \
 *     --img render.png --chips chips.json [--fg EEEEEE] [--alvo 4.5]
 *
 *   --chips <path>  JSON [{nome, rx, ry, rw, rh}] com posição RELATIVA (0-1)
 *   --fg <hex>      cor do texto (default EEEEEE)
 *   --alvo <n>      razão de contraste desejada (default 4.5 = WCAG AA)
 *   --scrim <hex>   cor do véu (default 1A1B1F)
 */
import sharp from "sharp";
import { readFileSync } from "fs";

const A = process.argv.slice(2);
const flag = (k: string, d?: string) => { const i = A.indexOf(`--${k}`); return i !== -1 && A[i + 1] && !A[i + 1].startsWith("--") ? A[i + 1] : d; };
const die = (m: string): never => { console.error(m); process.exit(1); };

const imgPath = flag("img") || die("--img obrigatório");
const chipsPath = flag("chips") || die("--chips obrigatório");
const fgHex = (flag("fg", "EEEEEE")!).replace("#", "");
const alvo = parseFloat(flag("alvo", "4.5")!);
const scrimHex = (flag("scrim", "1A1B1F")!).replace("#", "");

const hex2rgb = (h: string) => [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
/** Luminância relativa WCAG. */
const lum = ([r, g, b]: number[]) => {
  const c = [r, g, b].map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const razao = (a: number[], b: number[]) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
/** Composita o scrim com opacidade alpha sobre a cor de fundo. */
const comScrim = (bg: number[], scrim: number[], alpha: number) => bg.map((v, i) => v * (1 - alpha) + scrim[i] * alpha);

async function main() {
  const chips: { nome: string; rx: number; ry: number; rw: number; rh: number }[] = JSON.parse(readFileSync(chipsPath, "utf-8"));
  const img = sharp(imgPath).removeAlpha();
  const { width: W, height: H } = await img.metadata();
  const fg = hex2rgb(fgHex), scrim = hex2rgb(scrimHex);

  console.log(`${imgPath} ${W}×${H} · texto #${fgHex} · alvo ${alvo}:1 · scrim #${scrimHex}\n`);
  console.log("rótulo            fundo médio   contraste   veredito   scrim mínimo");
  console.log("-".repeat(74));

  let piorScrim = 0;
  for (const c of chips) {
    const left = Math.max(0, Math.round(c.rx * W!));
    const top = Math.max(0, Math.round(c.ry * H!));
    const w = Math.max(1, Math.min(Math.round(c.rw * W!), W! - left));
    const h = Math.max(1, Math.min(Math.round(c.rh * H!), H! - top));
    const { data, info } = await sharp(imgPath).removeAlpha().extract({ left, top, width: w, height: h }).raw().toBuffer({ resolveWithObject: true });
    const n = info.width * info.height;
    const bg = [0, 1, 2].map((ch) => { let s = 0; for (let i = 0; i < n; i++) s += data[i * info.channels + ch]; return s / n; });

    const r0 = razao(fg, bg);
    // menor alpha (passo 0.05) que leva o contraste ao alvo
    let precisa = 0;
    if (r0 < alvo) { for (let a = 0.05; a <= 1.001; a += 0.05) { if (razao(fg, comScrim(bg, scrim, a)) >= alvo) { precisa = +a.toFixed(2); break; } } }
    piorScrim = Math.max(piorScrim, precisa);
    const ok = r0 >= alvo;
    console.log(`${c.nome.padEnd(16)} ${bg.map((v) => Math.round(v)).join(",").padEnd(13)} ${r0.toFixed(2).padStart(6)}:1   ${(ok ? "passa" : "FALHA").padEnd(9)} ${precisa ? `${(precisa * 100).toFixed(0)}%` : "—"}`);
  }
  console.log("-".repeat(74));
  console.log(piorScrim
    ? `→ scrim uniforme de ${(piorScrim * 100).toFixed(0)}% em #${scrimHex} faz todos passarem em ${alvo}:1`
    : `→ todos já passam em ${alvo}:1, nenhum scrim necessário`);
}
main().catch((e) => { console.error(e); process.exit(1); });
