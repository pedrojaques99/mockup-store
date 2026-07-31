import type { FitMode } from "./art-frame";

/**
 * Decide COMO enquadrar a arte na superfície, sozinho.
 *
 * A regra já estava escrita no `AGENTS.md` e no `PLAN-upload-render-ux.md` —
 * *layout (creative full-bleed) = cover; logo = contain + fundo na cor da marca;
 * comp pronta = cover* — e a UI nunca a aplicou: toda arte caía em
 * `DEFAULT_FRAME` (cover, sem fundo). O resultado é o logo do cliente **cortado**
 * nas bordas do billboard, que é o erro mais caro que este produto comete, e o
 * mais silencioso: sai um PNG bonito com a marca decepada.
 *
 * Este módulo é PURO (nada de canvas, nada de DOM) — quem lê pixel é
 * `sampleArtStats`, aqui só entra estatística e sai decisão. Mesmo desenho de
 * `ingest-triage.ts`.
 */

export type ArtKind = "logo" | "layout";

export interface ArtStats {
  width: number;
  height: number;
  /** Fração de pixels com alpha < 250. */
  transparentRatio: number;
  /** Fração dos pixels da BORDA que casam com a cor dominante da borda (0–1). */
  edgeUniformity: number;
  /** Cor dominante da borda, em hex. */
  edgeColorHex: string;
  /** Fração de pixels que diferem da cor da borda — a "tinta" do desenho. */
  inkRatio: number;
  /** SVG/vetor: por definição uma marca, não uma foto. */
  isVector: boolean;
}

export interface FramingDecision {
  kind: ArtKind;
  mode: FitMode;
  /** Cor do letterbox no `contain`. `null` = transparente. */
  bg: string | null;
  /** Frase curta mostrada ao usuário — a decisão nunca é silenciosa. */
  reason: string;
}

/** Acima disto, a arte tem fundo transparente de verdade (não é uma foto). */
export const TRANSPARENT_LOGO_RATIO = 0.25;
/** Borda uniforme acima disto = a arte foi desenhada sobre um fundo chapado. */
export const FLAT_EDGE_RATIO = 0.9;
/** Pouca tinta sobre fundo chapado = marca isolada, não composição. */
export const LOGO_MAX_INK = 0.55;
/** Diferença de proporção que ainda conta como "feita para esta superfície". */
export const ASPECT_TOLERANCE = 0.05;

/**
 * @param soAspect proporção da superfície de destino (largura/altura).
 * @param brandColor cor da marca, quando há marca selecionada — vira o fundo do
 *        `contain`, que é o que faz um logo parecer aplicado em vez de colado.
 */
export function decideFraming(
  stats: ArtStats,
  opts: { soAspect?: number; brandColor?: string | null } = {},
): FramingDecision {
  const { soAspect, brandColor } = opts;
  const artAspect = stats.height ? stats.width / stats.height : 1;

  const flatBackground = stats.edgeUniformity >= FLAT_EDGE_RATIO;
  const transparent = stats.transparentRatio >= TRANSPARENT_LOGO_RATIO;

  // 1. Vetor é marca. Não existe fotografia em SVG.
  if (stats.isVector) {
    return {
      kind: "logo",
      mode: "contain",
      bg: brandColor ?? null,
      reason: "vetor — encaixado inteiro para não cortar a marca",
    };
  }

  // 2. Fundo transparente de verdade.
  if (transparent) {
    return {
      kind: "logo",
      mode: "contain",
      bg: brandColor ?? null,
      reason: "fundo transparente — encaixado inteiro, sem corte",
    };
  }

  // 3. Proporção casa com a superfície ⇒ foi feita PARA ela; `cover` não corta
  //    nada. Este teste vem antes do de fundo chapado de propósito: um layout
  //    full-bleed de fundo sólido (muito comum) cairia em "logo" e ganharia
  //    tarja nas laterais sem necessidade.
  if (soAspect && Math.abs(artAspect - soAspect) / soAspect <= ASPECT_TOLERANCE) {
    return {
      kind: "layout",
      mode: "cover",
      bg: null,
      reason: "proporção casa com a superfície — preenche sem cortar",
    };
  }

  // 4. Fundo chapado + pouca tinta = marca isolada sobre cor sólida. O fundo do
  //    letterbox é a PRÓPRIA cor da arte, então a emenda some.
  if (flatBackground && stats.inkRatio <= LOGO_MAX_INK) {
    return {
      kind: "logo",
      mode: "contain",
      bg: brandColor ?? stats.edgeColorHex,
      reason: brandColor
        ? "marca sobre fundo chapado — encaixada na cor da marca"
        : "marca sobre fundo chapado — encaixada na cor do próprio fundo",
    };
  }

  // 5. O resto é composição: preenche a superfície.
  return {
    kind: "layout",
    mode: "cover",
    bg: null,
    reason: "composição — preenche a superfície inteira",
  };
}

// ─── Amostragem (browser) ───────────────────────────────────────────────────

const toHex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;

/**
 * Lê as estatísticas da arte num canvas reduzido.
 *
 * 64px no maior lado: o que se mede aqui é fundo, transparência e proporção —
 * nenhuma dessas coisas melhora com resolução, e um logo de 6000px levaria
 * dezenas de ms num caminho que roda a cada arte solta na tela.
 */
export function sampleArtStats(img: HTMLImageElement, isVector: boolean): ArtStats {
  const W = img.naturalWidth || img.width;
  const H = img.naturalHeight || img.height;
  const scale = Math.min(1, 64 / Math.max(W, H, 1));
  const w = Math.max(1, Math.round(W * scale));
  const h = Math.max(1, Math.round(H * scale));

  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext("2d", { willReadFrequently: true })!;
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);

  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, w, h).data;
  } catch {
    // Canvas contaminado (arte vinda de outra origem sem CORS): sem leitura de
    // pixel, devolve um perfil neutro para cair no caminho "composição".
    return {
      width: W, height: H, transparentRatio: 0, edgeUniformity: 0,
      edgeColorHex: "#ffffff", inkRatio: 1, isVector,
    };
  }

  const at = (x: number, y: number) => (y * w + x) * 4;

  let transparent = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 250) transparent++;

  // Cor dominante da borda — quantizada em blocos de 16 para tolerar ruído de
  // JPEG sem fundir cores que o olho separa.
  const edge: number[] = [];
  for (let x = 0; x < w; x++) { edge.push(at(x, 0)); edge.push(at(x, h - 1)); }
  for (let y = 1; y < h - 1; y++) { edge.push(at(0, y)); edge.push(at(w - 1, y)); }

  const bucket = new Map<string, number>();
  for (const i of edge) {
    const k = `${data[i] >> 4}-${data[i + 1] >> 4}-${data[i + 2] >> 4}`;
    bucket.set(k, (bucket.get(k) ?? 0) + 1);
  }
  let topKey = "", topCount = 0;
  for (const [k, c] of bucket) if (c > topCount) { topKey = k; topCount = c; }
  const [br, bg_, bb] = topKey.split("-").map((n) => (parseInt(n, 10) << 4) + 8);

  // Tinta = pixel visivelmente distante da cor de fundo.
  let ink = 0;
  const total = w * h;
  for (let i = 0; i < data.length; i += 4) {
    const dist = Math.abs(data[i] - br) + Math.abs(data[i + 1] - bg_) + Math.abs(data[i + 2] - bb);
    if (data[i + 3] > 250 && dist > 90) ink++;
  }

  return {
    width: W,
    height: H,
    transparentRatio: transparent / total,
    edgeUniformity: edge.length ? topCount / edge.length : 0,
    edgeColorHex: toHex(br, bg_, bb),
    inkRatio: ink / total,
    isVector,
  };
}
