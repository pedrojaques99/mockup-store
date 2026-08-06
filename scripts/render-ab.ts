/**
 * As duas rotas de render de FOTO dão o mesmo pixel? Prova, não opinião.
 *
 * O repo afirma WYSIWYG: "o que a prévia do /calibrate mostra é byte-idêntico ao
 * que a produção renderiza". As duas rotas realmente chamam o mesmo core
 * (`buildBaseComposite` + `applyLooks` de `photo-render-core.ts`), mas comem
 * assets de origens DIFERENTES, e é aí que o WYSIWYG pode ter morrido sem aviso:
 *
 *   A) /api/photo-mockup/<id>/render  → assets PRÉ-ASSADOS em disco
 *      (photo-clean, shadow, shadow-screen, mask, color-cast), quality "hd",
 *      com cache Tier-1 de composite.
 *   B) /api/calibrate/render          → assets extraídos NA HORA da imagem-fonte
 *      (`extractSceneAssets`), com `hd: true` para tirar o downscale de preview
 *      da conta.
 *
 * Se o bake e a extração ao vivo divergirem, a prévia mente e ninguém percebe:
 * o operador calibra olhando uma imagem e entrega outra. Este script manda a
 * MESMA arte, com o MESMO quad, para as duas rotas e mede a diferença pixel a
 * pixel.
 *
 * O que ele NÃO compara, de propósito:
 *   - /api/render → é o caminho de PSD via render-server TCP. Outro domínio de
 *     entrada (PSD, não foto). Comparar seria medir duas coisas diferentes.
 *   - /api/scene/<id>/render → é o Scene Package (`extractScene` → `renderScene`),
 *     medido em `scene-fidelity.ts` e já conhecido como lossy. A ausência de luz
 *     ali não é bug de rota: as camadas chegam baked e a pilha de ajuste se
 *     perdeu na extração.
 *
 * Uso (precisa do dev de pé — ver README; o default é a 4100):
 *   npx tsx scripts/render-ab.ts --amostra 5
 *   npx tsx scripts/render-ab.ts --scenes 01d2e8f6f3544295 --tolerancia 2
 *
 * Saída: .tmp/render-ab/<id>/{a-producao,b-calibrate,diff}.png + placar.
 * Sai 1 se qualquer cena divergir acima da tolerância.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import sharp from "sharp";

const arg = (nome: string, padrao = "") => {
  const i = process.argv.indexOf(`--${nome}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : padrao;
};

const BASE = arg("url", "http://localhost:4100");
/** 1/255 é ruído de arredondamento entre dois caminhos de composição, não blend errado. */
const TOLERANCIA = parseInt(arg("tolerancia", "1"), 10);
const CENAS_DIR = join(process.cwd(), ".tmp", "photo-scenes");
const SAIDA = join(process.cwd(), ".tmp", "render-ab");

interface Analise {
  quad: { tl: Pt; tr: Pt; br: Pt; bl: Pt };
  imageWidth: number;
  imageHeight: number;
  surfaceType?: string;
}
interface Pt { x: number; y: number }

/**
 * Arte diagnóstica determinística. Chapado esconde erro de blend, então a arte
 * tem gradiente (pega deslocamento de curva), grade (pega warp) e chapados
 * saturados (pega despill e material). Gerada por pixel, sem canvas, para os dois
 * lados receberem BYTE IDÊNTICO — arte diferente invalidaria a comparação.
 */
async function arteDiagnostica(w: number, h: number): Promise<string> {
  const px = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      const grade = x % 64 < 2 || y % 64 < 2;
      if (grade) { px[i] = 0; px[i + 1] = 0; px[i + 2] = 0; continue; }
      px[i] = Math.round((x / w) * 255);
      px[i + 1] = Math.round((y / h) * 255);
      px[i + 2] = 128;
    }
  }
  const png = await sharp(px, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
  return png.toString("base64");
}

async function postPng(url: string, body: unknown): Promise<Buffer> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`${r.status} ${txt.slice(0, 160)}`);
  }
  const ct = r.headers.get("content-type") ?? "";
  if (!ct.includes("image")) throw new Error(`resposta não é imagem (${ct})`);
  return Buffer.from(await r.arrayBuffer());
}

/** Diferença por canal, com mapa visual do que divergiu. */
async function comparar(a: Buffer, b: Buffer) {
  const ia = sharp(a).ensureAlpha();
  const ib = sharp(b).ensureAlpha();
  const ma = await ia.metadata();
  const mb = await ib.metadata();
  if (ma.width !== mb.width || ma.height !== mb.height) {
    return {
      dimensoesDiferentes: `${ma.width}×${ma.height} vs ${mb.width}×${mb.height}`,
      maxDelta: 255, pctAcima: 100, mediaDelta: 255, diff: null as Buffer | null,
    };
  }
  const w = ma.width!, h = ma.height!;
  const [ra, rb] = await Promise.all([
    ia.raw().toBuffer(),
    ib.raw().toBuffer(),
  ]);
  const diff = Buffer.alloc(w * h * 3);
  let maxDelta = 0, acima = 0, soma = 0;
  const total = w * h;
  for (let p = 0; p < total; p++) {
    const o = p * 4;
    const d = Math.max(
      Math.abs(ra[o] - rb[o]),
      Math.abs(ra[o + 1] - rb[o + 1]),
      Math.abs(ra[o + 2] - rb[o + 2]),
    );
    soma += d;
    if (d > maxDelta) maxDelta = d;
    if (d > TOLERANCIA) acima++;
    const q = p * 3;
    // vermelho onde divergiu, cinza do original onde bateu
    if (d > TOLERANCIA) { diff[q] = 255; diff[q + 1] = 0; diff[q + 2] = 0; }
    else { const g = Math.round(ra[o] * 0.3 + ra[o + 1] * 0.5 + ra[o + 2] * 0.2); diff[q] = diff[q + 1] = diff[q + 2] = g; }
  }
  return {
    dimensoesDiferentes: null as string | null,
    maxDelta,
    pctAcima: (acima / total) * 100,
    mediaDelta: soma / total,
    diff: await sharp(diff, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer(),
  };
}

async function main() {
  const escolhidas = arg("scenes");
  let ids: string[];
  if (escolhidas) ids = escolhidas.split(",").map((s) => s.trim()).filter(Boolean);
  else {
    const n = parseInt(arg("amostra", "5"), 10);
    ids = readdirSync(CENAS_DIR)
      .filter((d) => existsSync(join(CENAS_DIR, d, "analysis.json")) && existsSync(join(CENAS_DIR, d, "photo.png")))
      .slice(0, n);
  }

  console.log(`\n  RENDER A/B — produção × prévia do /calibrate\n  ${BASE}  ·  tolerância ${TOLERANCIA}/255\n`);
  mkdirSync(SAIDA, { recursive: true });

  let divergentes = 0;
  const placar: string[] = [];

  for (const id of ids) {
    const dir = join(CENAS_DIR, id);
    const analise: Analise = JSON.parse(readFileSync(join(dir, "analysis.json"), "utf-8"));
    process.stdout.write(`  ${id}  `);

    try {
      // Arte no tamanho da face, gerada UMA vez e enviada idêntica aos dois lados.
      const d = (p: Pt, q: Pt) => Math.hypot(p.x - q.x, p.y - q.y);
      const aw = Math.max(1, Math.round((d(analise.quad.tl, analise.quad.tr) + d(analise.quad.bl, analise.quad.br)) / 2));
      const ah = Math.max(1, Math.round((d(analise.quad.tl, analise.quad.bl) + d(analise.quad.tr, analise.quad.br)) / 2));
      const artBase64 = await arteDiagnostica(aw, ah);

      const [a, b] = await Promise.all([
        postPng(`${BASE}/api/photo-mockup/${id}/render`, { artBase64 }),
        postPng(`${BASE}/api/calibrate/render`, {
          name: "photo.png",
          dir,
          quad: analise.quad,
          surfaceType: analise.surfaceType ?? "billboard",
          artBase64,
          // hd: tira o downscale de preview da conta. Sem isso a comparação
          // mediria redimensionamento, não pipeline.
          hd: true,
          preview: false,
        }),
      ]);

      const cmp = await comparar(a, b);
      const destino = join(SAIDA, id);
      mkdirSync(destino, { recursive: true });
      writeFileSync(join(destino, "a-producao.png"), a);
      writeFileSync(join(destino, "b-calibrate.png"), b);
      if (cmp.diff) writeFileSync(join(destino, "diff.png"), cmp.diff);

      if (cmp.dimensoesDiferentes) {
        divergentes++;
        console.log(`DIMENSÃO DIFERENTE  ${cmp.dimensoesDiferentes}`);
        placar.push(`${id}  dimensão ${cmp.dimensoesDiferentes}`);
      } else if (cmp.pctAcima > 0) {
        divergentes++;
        console.log(`DIVERGE  max ${cmp.maxDelta}/255 · ${cmp.pctAcima.toFixed(2)}% dos pixels · média ${cmp.mediaDelta.toFixed(2)}`);
        placar.push(`${id}  max ${cmp.maxDelta}  ${cmp.pctAcima.toFixed(2)}%`);
      } else {
        console.log(`ok  (max ${cmp.maxDelta}/255 dentro da tolerância)`);
      }
    } catch (e) {
      divergentes++;
      console.log(`ERRO  ${e instanceof Error ? e.message : String(e)}`);
      placar.push(`${id}  erro`);
    }
  }

  console.log(`\n  ${ids.length - divergentes}/${ids.length} pixel-idênticas dentro de ${TOLERANCIA}/255`);
  if (placar.length) {
    console.log("\n  divergências:");
    for (const l of placar) console.log(`    ${l}`);
    console.log(`\n  imagens em ${SAIDA} — ABRA o diff.png antes de concluir qualquer coisa.`);
  }
  process.exit(divergentes ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
