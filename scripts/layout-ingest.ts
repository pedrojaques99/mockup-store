/**
 * Layout Ingest — lê uma pasta de criativos e produz um sidecar JSON com o que
 * o pipeline de mockup precisa saber de cada arte. PROTÓTIPO: valida a ideia
 * localmente antes de portar pro ingest do visantlabs-os.
 *
 * A pergunta que ele responde: "posso cortar essa arte, e quanto?"
 * Hoje o batch trata toda arte igual e o `cover` decepa headline (ver
 * PLAN-layout-ingest.md). Margem é medível — não precisa de IA pra isso.
 *
 * Uso:
 *   npx tsx --env-file=.env.local scripts/layout-ingest.ts \
 *     --layouts "<dir>" [--out <file>] [--json]
 *
 * Flags:
 *   --layouts <dir>  pasta com os criativos (png/jpg/webp)
 *   --out <file>     saída (default: <layouts>/_layouts-meta.json)
 *   --json           imprime o JSON no stdout em vez da tabela
 *   --sample <n>     lado máximo da análise em px (default 640; menor = mais rápido)
 *
 * Não reinventa: usa `sharp` (já dependência do render) pra tudo.
 */
import { readdirSync, writeFileSync } from "fs";
import { join } from "path";
import { analyzeLayoutAI, type LayoutKind } from "../src/lib/layout-vision";
import { ocrLayout, safeCropFromBox, closeOcr } from "../src/lib/layout-ocr";

const A = process.argv.slice(2);
const flag = (k: string, def?: string) => { const i = A.indexOf(`--${k}`); return i !== -1 && A[i + 1] && !A[i + 1].startsWith("--") ? A[i + 1] : def; };
const has = (k: string) => A.includes(`--${k}`);
function die(m: string): never { console.error(`✗ ${m}`); process.exit(1); }

const layoutsDir = flag("layouts") || die("--layouts <dir> obrigatório");
const outFile = flag("out") || join(layoutsDir, "_layouts-meta.json");
const SAMPLE = parseInt(flag("sample", "640")!);

/**
 * Teto pro safeCrop quando SÓ o OCR mediu (fundo fotográfico, geometria cega).
 * Sem gabarito, uma leitura parcial passa despercebida e libera corte demais.
 * 20% cobre o caso real observado (a maioria das artes fica em 11–24%) sem
 * apostar num número que ninguém conferiu.
 */
const UNVERIFIED_CROP_CAP = parseFloat(flag("cap", "0.20")!);

/** Tudo que o batch precisa saber de uma arte pra decidir cena e enquadramento. */
export interface LayoutMeta {
  file: string;
  width: number;
  height: number;
  aspect: number;
  /** Cor de fundo dominante da borda (hex) — serve de bg no modo contain. */
  bgHex: string;
  /** Borda é uniforme? Se sim, contain com bgHex fica invisível (full-bleed). */
  bgSolid: boolean;
  /** Margem livre de conteúdo, fração de cada lado. */
  margins: { left: number; right: number; top: number; bottom: number };
  /** Fração TOTAL da largura que dá pra cortar (centrado) sem tocar no conteúdo. */
  maxCropX: number;
  /** Idem na altura. */
  maxCropY: number;
  /** Tolerância segura pro --max-crop desta arte (o menor dos dois eixos). */
  safeCrop: number;
  /** Fonte do safeCrop que vale. */
  source: "geometry" | "vision" | "ocr";
  /** Preenchido com --ocr. Caixa MEDIDA — é esta que manda quando existe. */
  ocr?: {
    textBox: { x0: number; y0: number; x1: number; y1: number } | null;
    text: string;
    words: number;
    meanConfidence: number;
    /** false = leitura parcial/duvidosa; não vira tolerância de corte. */
    trustworthy: boolean;
    safeCrop: number;
  };
  /** Preenchido com --ai. Mantido junto da geometria pra dar pra comparar. */
  vision?: {
    kind: LayoutKind;
    hasText: boolean;
    textBox: { x0: number; y0: number; x1: number; y1: number } | null;
    bleedSafe: boolean;
    description: string;
    confidence: number;
    /** safeCrop derivado da textBox — o que a visão acha, isolado. */
    safeCrop: number;
  };
}

const hex = (r: number, g: number, b: number) =>
  "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

async function analyze(path: string, file: string): Promise<LayoutMeta | null> {
  const sharp = (await import("sharp")).default;
  const meta = await sharp(path).metadata();
  if (!meta.width || !meta.height) return null;

  // Analisa numa versão reduzida: margem é proporção, não precisa de full-res.
  const img = sharp(path).resize(SAMPLE, SAMPLE, { fit: "inside", withoutEnlargement: true }).flatten({ background: "#ffffff" });
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels: ch } = info;
  const at = (x: number, y: number) => { const i = (y * w + x) * ch; return [data[i], data[i + 1], data[i + 2]] as const; };

  // 1. Fundo = mediana do anel de borda (robusto a um logo colado no canto).
  const ring: Array<readonly [number, number, number]> = [];
  for (let x = 0; x < w; x++) { ring.push(at(x, 0)); ring.push(at(x, h - 1)); }
  for (let y = 0; y < h; y++) { ring.push(at(0, y)); ring.push(at(w - 1, y)); }
  const med = (arr: number[]) => arr.sort((a, b) => a - b)[Math.floor(arr.length / 2)];
  const bg = [0, 1, 2].map((c) => med(ring.map((p) => p[c]))) as [number, number, number];

  // Borda uniforme? (desvio médio baixo → contain com bgHex passa despercebido)
  const dev = ring.reduce((s, p) => s + Math.abs(p[0] - bg[0]) + Math.abs(p[1] - bg[1]) + Math.abs(p[2] - bg[2]), 0) / (ring.length * 3);
  const bgSolid = dev < 6;

  // 2. Onde mora a TINTA (texto/logo), via energia de borda.
  //    Não dá pra usar "pixel != fundo": essas artes são full-bleed, o fundo é
  //    gradiente granulado e destoa de si mesmo. Mas gradiente tem energia de
  //    borda ~0 e tipografia tem energia alta — é isso que separa os dois.
  const lum = (p: readonly [number, number, number]) => 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
  const EDGE_TOL = 24; // abaixo disso é grão/gradiente, não tipografia
  const colE = new Float64Array(w);
  const rowE = new Float64Array(h);
  let total = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const gx = Math.abs(lum(at(x + 1, y)) - lum(at(x - 1, y)));
      const gy = Math.abs(lum(at(x, y + 1)) - lum(at(x, y - 1)));
      const e = gx + gy;
      if (e <= EDGE_TOL) continue;
      colE[x] += e; rowE[y] += e; total += e;
    }
  }

  // Margem = onde a energia acumulada de cada lado cruza 0.5% do total.
  // Percentil, não min/max: um pixel de ruído solto não pode zerar a margem.
  const EPS = 0.005;
  const edgeFrom = (arr: Float64Array, reverse: boolean) => {
    if (total <= 0) return 0;
    let acc = 0;
    const n = arr.length;
    for (let i = 0; i < n; i++) {
      const idx = reverse ? n - 1 - i : i;
      acc += arr[idx];
      if (acc >= total * EPS) return i / n;
    }
    return 0;
  };

  // Arte sem tipografia (padrão/textura pura) → nada a proteger, corte à vontade
  const margins = total <= 0
    ? { left: 0.5, right: 0.5, top: 0.5, bottom: 0.5 }
    : {
        left: edgeFrom(colE, false),
        right: edgeFrom(colE, true),
        top: edgeFrom(rowE, false),
        bottom: edgeFrom(rowE, true),
      };

  // 3. O `cover` corta centrado → cada lado perde metade do total descartado.
  //    Logo o corte total tolerável é 2× a menor margem daquele eixo.
  const maxCropX = Math.max(0, 2 * Math.min(margins.left, margins.right));
  const maxCropY = Math.max(0, 2 * Math.min(margins.top, margins.bottom));
  const safeCrop = Math.min(maxCropX, maxCropY);

  const out: LayoutMeta = {
    file,
    width: meta.width,
    height: meta.height,
    aspect: meta.width / meta.height,
    bgHex: hex(bg[0], bg[1], bg[2]),
    bgSolid,
    margins,
    maxCropX,
    maxCropY,
    safeCrop,
    source: "geometry",
  };

  const small = await sharp(path).resize(768, 768, { fit: "inside", withoutEnlargement: true }).png().toBuffer();

  // OCR: mede onde o texto está. Roda antes da visão porque é ele que manda no
  // safeCrop — a visão só contribui kind/descrição (na coordenada ela chuta).
  if (has("ocr")) {
    try {
      const r = await ocrLayout(small);
      out.ocr = {
        textBox: r.textBox,
        text: r.text.slice(0, 200),
        words: r.words.length,
        meanConfidence: Math.round(r.meanConfidence),
        trustworthy: r.trustworthy,
        safeCrop: safeCropFromBox(r.textBox),
      };
      // Só assume o comando se a leitura passou no portão. Leitura parcial
      // ("PIE" numa arte cheia de texto) daria 48% de corte livre e decepava
      // o headline que o OCR não leu — o bug original, de novo.
      if (r.textBox && r.trustworthy) {
        out.safeCrop = out.ocr.safeCrop;
        out.source = "ocr";
        if (out.bgSolid) {
          // Fundo chapado: a geometria também mediu de verdade. Discordância
          // significa que alguém errou → fica com o mais cauteloso.
          out.safeCrop = Math.min(out.safeCrop, Math.min(maxCropX, maxCropY));
        } else {
          // Fundo fotográfico: a geometria é cega, então o OCR está sozinho e
          // ninguém o audita. Leitura parcial (pegou o corpo, perdeu o headline)
          // vira permissão generosa — foi o caso do Frame 4784, 41%. Teto.
          out.safeCrop = Math.min(out.safeCrop, UNVERIFIED_CROP_CAP);
        }
      }
    } catch (e) { console.error(`  ! ocr falhou em ${file}: ${(e as Error).message}`); }
  }

  if (!has("ai")) return out;

  // Visão: só pro que ela acerta (kind/descrição). NÃO sobrescreve safeCrop.
  const v = await analyzeLayoutAI(small);
  if (!v) { console.error(`  ! visão falhou em ${file} — mantendo geometria`); return out; }

  // Mesma matemática do cover: crop centrado, cada lado perde metade do total.
  let vSafe = 1;
  if (v.hasText && v.textBox) {
    const mX = Math.min(v.textBox.x0, 1 - v.textBox.x1);
    const mY = Math.min(v.textBox.y0, 1 - v.textBox.y1);
    vSafe = Math.max(0, Math.min(2 * mX, 2 * mY));
  }
  out.vision = { kind: v.kind, hasText: v.hasText, textBox: v.textBox, bleedSafe: v.bleedSafe, description: v.description, confidence: v.confidence, safeCrop: vSafe };

  // A coordenada da visão fica gravada só pra comparação — NUNCA vira oficial
  // (medimos: 20% onde a margem real é 8% → decepa o headline).
  //
  // Mas há um julgamento que só ela resolve: OCR silencioso é ambíguo — pode ser
  // "não há texto" (pode cortar à vontade) ou "o OCR falhou" (não pode cortar
  // nada). Distinguir isso é semântica, não coordenada — e nisso ela acerta.
  const ocrSilent = out.source === "geometry" && (!out.ocr?.textBox || !out.ocr?.trustworthy);
  if (ocrSilent && !v.hasText && v.confidence >= 0.7 && (v.kind === "pattern" || v.kind === "other")) {
    // Padrão/textura sem texto: nada a proteger. Ainda assim respeita o teto —
    // é palavra do modelo, não medição.
    out.safeCrop = UNVERIFIED_CROP_CAP;
    out.source = "vision";
  }
  return out;
}

async function main() {
  const files = readdirSync(layoutsDir).filter((f) => /\.(png|jpe?g|webp)$/i.test(f) && !f.startsWith("_"));
  if (!files.length) die(`nenhuma imagem em ${layoutsDir}`);

  const out: LayoutMeta[] = [];
  for (const f of files) {
    const m = await analyze(join(layoutsDir, f), f);
    if (m) out.push(m);
    else console.error(`! ilegível: ${f}`);
  }

  writeFileSync(outFile, JSON.stringify({ generatedFrom: layoutsDir, layouts: out }, null, 2));

  if (has("json")) { console.log(JSON.stringify(out, null, 2)); return; }

  const pct = (n: number) => `${(n * 100).toFixed(0).padStart(3)}%`;
  console.log("arte                                 aspect  kind     geo   ocr   visão  usado  fonte   texto lido");
  console.log("-".repeat(118));
  for (const m of out) {
    console.log(
      `${m.file.slice(0, 35).padEnd(36)} ${m.aspect.toFixed(2).padStart(5)}  ${(m.vision?.kind ?? "-").padEnd(8)} ${pct(Math.min(m.maxCropX, m.maxCropY))} ${m.ocr ? pct(m.ocr.safeCrop) : "    -"}${m.ocr && !m.ocr.trustworthy ? "✗" : " "} ${m.vision ? pct(m.vision.safeCrop) : "    -"}  ${pct(m.safeCrop)}  ${m.source.padEnd(8)}${(m.ocr?.text ?? "").slice(0, 26)}`
    );
  }
  console.log("-".repeat(118));
  const tight = out.filter((m) => m.safeCrop < 0.08).length;
  console.log(`${out.length} artes → ${outFile}`);
  console.log(`${tight} com safeCrop < 8% (não podem ser cortadas)`);

  // Cruzamento contra o único gabarito confiável: artes de fundo chapado, onde
  // a geometria mede a margem de verdade. Método que discordar aqui está errado.
  const truth = out.filter((m) => m.bgSolid);
  if (truth.length) {
    console.log("\ncruzamento (gabarito = geometria em fundo chapado):");
    for (const m of truth) {
      const geo = Math.min(m.maxCropX, m.maxCropY);
      const row = (label: string, v: number | undefined) =>
        v === undefined ? "" : `  ${label}=${pct(v)} Δ=${pct(Math.abs(geo - v))}${Math.abs(geo - v) > 0.1 ? " <<<" : ""}`;
      console.log(`  ${m.file.slice(0, 30).padEnd(31)} geo=${pct(geo)}${row("ocr", m.ocr?.safeCrop)}${row("visão", m.vision?.safeCrop)}`);
    }
  } else {
    console.log("\n(nenhuma arte de fundo chapado — sem gabarito pra cruzar)");
  }
  await closeOcr();
}

main().catch((e) => { console.error(e); process.exit(1); });
