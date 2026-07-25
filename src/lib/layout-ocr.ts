/**
 * layout-ocr — responde "ONDE está o texto?" por medição, não por estimativa.
 *
 * Por que OCR e não VLM: testamos pedir a bounding box ao modelo de visão
 * (claude-haiku, ver layout-vision.ts). Ele devolve caixas grudadas em
 * 0.10/0.90 — priors genéricos, não medição — e ainda com confidence 0.95.
 * Confiantemente errado é pior que inútil: numa arte com margem real de 8% ele
 * respondeu 20%, o que decepa o headline exatamente como o bug que queremos
 * consertar. OCR devolve caixa de palavra medida em pixel.
 *
 * O VLM segue útil pro que ele acerta (kind/descrição) — só não pra coordenada.
 */
import { createWorker, type Worker } from "tesseract.js";

export interface OcrWord {
  text: string;
  confidence: number;
  /** Normalizado 0..1 sobre a imagem analisada. */
  box: { x0: number; y0: number; x1: number; y1: number };
}

export interface LayoutOcrResult {
  words: OcrWord[];
  /** União das caixas de palavra aceitas. null = nenhum texto encontrado. */
  textBox: { x0: number; y0: number; x1: number; y1: number } | null;
  /** Texto concatenado — serve de `placement.text`. */
  text: string;
  /** Confiança média das palavras aceitas (0-100). */
  meanConfidence: number;
  /**
   * A leitura é confiável o bastante pra virar tolerância de corte?
   * Leitura PARCIAL é o risco real: se o OCR pega só um fragmento ("PIE"), a
   * caixa sai pequena e o safeCrop generoso — decepando o headline que ele não
   * leu. Na dúvida, reprova: perder uma cena boa custa menos que entregar
   * mockup com texto cortado.
   */
  trustworthy: boolean;
}

/** Descarta lixo de OCR: confiança baixa, símbolo solto, ruído de textura. */
const MIN_CONF = 60;
const isNoise = (t: string) => t.trim().length < 2 || !/[\p{L}\p{N}]/u.test(t);

let workerPromise: Promise<Worker> | null = null;
/** Worker é caro (carrega o modelo). Reusa entre imagens do mesmo lote. */
async function getWorker(): Promise<Worker> {
  if (!workerPromise) workerPromise = createWorker("por+eng");
  return workerPromise;
}

export async function closeOcr(): Promise<void> {
  if (!workerPromise) return;
  const w = await workerPromise;
  await w.terminate();
  workerPromise = null;
}

/**
 * Prepara a arte pro OCR. Tesseract foi treinado em documento — texto preto,
 * fundo branco, ~300dpi. Nossas artes são o oposto: display type claro sobre
 * gradiente escuro, em 768px. Sem isso a leitura falha por contraste local,
 * não por ilegibilidade (medido: cobertura 12/30 sem preparo).
 *
 * - greyscale + normalise: estica o histograma, separa tinta do fundo
 * - 2× de upscale: dá corpo de glifo suficiente pro engine
 * - sem binarizar: threshold global destrói texto sobre gradiente (o fundo
 *   atravessa o limiar no meio da palavra)
 */
async function prepForOcr(img: Buffer, invert: boolean): Promise<{ buf: Buffer; w: number; h: number }> {
  const sharp = (await import("sharp")).default;
  const m = await sharp(img).metadata();
  const w = (m.width || 768) * 2;
  const h = (m.height || 768) * 2;
  let p = sharp(img).resize(w, h, { kernel: "lanczos3" }).greyscale().normalise();
  if (invert) p = p.negate();
  return { buf: await p.png().toBuffer(), w, h };
}

/** Uma passada de OCR sobre um buffer já preparado. */
async function runOcr(buf: Buffer, w: number, h: number): Promise<OcrWord[]> {
  const worker = await getWorker();
  const { data } = await worker.recognize(buf, {}, { blocks: true });
  const words: OcrWord[] = [];
  type TWord = { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } };
  const blocks = (data as unknown as { blocks?: Array<{ paragraphs?: Array<{ lines?: Array<{ words?: TWord[] }> }> }> }).blocks ?? [];
  for (const b of blocks) {
    for (const p of b.paragraphs ?? []) {
      for (const l of p.lines ?? []) {
        for (const wd of l.words ?? []) {
          if (wd.confidence < MIN_CONF || isNoise(wd.text)) continue;
          words.push({
            text: wd.text,
            confidence: wd.confidence,
            box: { x0: wd.bbox.x0 / w, y0: wd.bbox.y0 / h, x1: wd.bbox.x1 / w, y1: wd.bbox.y1 / h },
          });
        }
      }
    }
  }
  return words;
}

/** Mais texto lido vence; empate desempata por confiança. */
const scoreRead = (ws: OcrWord[]) =>
  ws.reduce((s, w) => s + w.text.length, 0) * 100 + ws.reduce((s, w) => s + w.confidence, 0);

/**
 * Roda OCR e devolve as palavras + a união das caixas.
 * `img` deve ser um PNG/JPEG buffer já em resolução de análise.
 */
export async function ocrLayout(img: Buffer): Promise<LayoutOcrResult> {
  // Duas polaridades: metade dessas artes é texto claro sobre fundo escuro, e o
  // tesseract espera o contrário. Roda as duas e fica com a leitura mais rica —
  // é a diferença entre ler o headline e não achar texto nenhum.
  const [normal, inverted] = await Promise.all([prepForOcr(img, false), prepForOcr(img, true)]);
  const [wN, wI] = [await runOcr(normal.buf, normal.w, normal.h), await runOcr(inverted.buf, inverted.w, inverted.h)];
  const words = scoreRead(wI) > scoreRead(wN) ? wI : wN;

  if (!words.length) return { words: [], textBox: null, text: "", meanConfidence: 0, trustworthy: false };

  const textBox = words.reduce(
    (acc, w) => ({
      x0: Math.min(acc.x0, w.box.x0),
      y0: Math.min(acc.y0, w.box.y0),
      x1: Math.max(acc.x1, w.box.x1),
      y1: Math.max(acc.y1, w.box.y1),
    }),
    { x0: 1, y0: 1, x1: 0, y1: 0 }
  );

  const meanConfidence = words.reduce((s, w) => s + w.confidence, 0) / words.length;
  const letters = words.map((w) => w.text).join("").length;
  // Uma palavra solta ou leitura curta = quase sempre fragmento, não a peça toda.
  const trustworthy = words.length >= 2 && meanConfidence >= 70 && letters >= 6;

  return { words, textBox, text: words.map((w) => w.text).join(" "), meanConfidence, trustworthy };
}

/**
 * Corte tolerável a partir de uma caixa protegida. O `cover` corta centrado,
 * então cada lado perde metade do total descartado — daí o 2×.
 */
export function safeCropFromBox(box: { x0: number; y0: number; x1: number; y1: number } | null): number {
  if (!box) return 1; // nada a proteger → corte à vontade
  const mX = Math.min(box.x0, 1 - box.x1);
  const mY = Math.min(box.y0, 1 - box.y1);
  return Math.max(0, Math.min(2 * mX, 2 * mY));
}
