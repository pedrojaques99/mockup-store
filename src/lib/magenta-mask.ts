"use client";

/**
 * Detecta/máscara do placeholder MAGENTA (#FF1493) gravado na foto base do
 * mockup-store. Usado pra "limpar a faixa rosa": a máscara (branco = magenta)
 * alimenta o inpaint (FLUX Fill / Visant), que recria a superfície sem o rosa.
 *
 * Key por matiz (robusto a sombra/iluminação na superfície): G é o canal claramente
 * menor e R/B bem maiores — pega magenta brilhante e sombreado, exclui pele/vermelho
 * (que têm B baixo).
 */
function isMagenta(r: number, g: number, b: number): boolean {
  return r - g > 40 && b - g > 18 && r > 80 && b > 50;
}

function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const im = new Image();
    im.crossOrigin = "anonymous";
    im.onload = () => res(im);
    im.onerror = () => rej(new Error(`Não carregou a imagem da cena: ${src}`));
    im.src = src;
  });
}

/** Acha os 4 cantos da região magenta (superfície) → quad default inteligente no
 *  upload, em vez do retângulo genérico 15-85%. Cantos extremos via x±y (bom fit
 *  pra quad convexo em perspectiva). Coords NORMALIZADAS 0..1. null se pouca magenta. */
export async function findMagentaQuad(src: string): Promise<{ tl: LuzPtless; tr: LuzPtless; br: LuzPtless; bl: LuzPtless } | null> {
  try {
    const img = await loadImg(src);
    const S = 360;
    const c = document.createElement("canvas"); c.width = S; c.height = S;
    const ctx = c.getContext("2d")!; ctx.drawImage(img, 0, 0, S, S);
    const d = ctx.getImageData(0, 0, S, S).data;
    let n = 0;
    // tl=min(x+y) tr=max(x-y) br=max(x+y) bl=min(x-y)
    let tl = { s: Infinity, x: 0, y: 0 }, br = { s: -Infinity, x: 0, y: 0 };
    let tr = { s: -Infinity, x: 0, y: 0 }, bl = { s: Infinity, x: 0, y: 0 };
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      if (!isMagenta(d[i], d[i + 1], d[i + 2])) continue;
      n++;
      const sum = x + y, dif = x - y;
      if (sum < tl.s) tl = { s: sum, x, y };
      if (sum > br.s) br = { s: sum, x, y };
      if (dif > tr.s) tr = { s: dif, x, y };
      if (dif < bl.s) bl = { s: dif, x, y };
    }
    if (n / (S * S) < 0.01) return null; // pouca magenta → sem superfície detectável
    const nm = (p: { x: number; y: number }) => ({ x: p.x / S, y: p.y / S });
    return { tl: nm(tl), tr: nm(tr), br: nm(br), bl: nm(bl) };
  } catch { return null; }
}

type LuzPtless = { x: number; y: number };

/** Fração de pixels magenta numa amostra reduzida — pra decidir se mostra o botão. */
export async function detectMagentaRatio(src: string): Promise<number> {
  try {
    const img = await loadImg(src);
    const s = 96;
    const c = document.createElement("canvas"); c.width = s; c.height = s;
    const ctx = c.getContext("2d")!; ctx.drawImage(img, 0, 0, s, s);
    const d = ctx.getImageData(0, 0, s, s).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (isMagenta(d[i], d[i + 1], d[i + 2])) n++;
    return n / (s * s);
  } catch { return 0; }
}

/**
 * Máscara branco-no-preto dos pixels magenta, em resolução nativa, levemente
 * dilatada (blur+threshold) pra cobrir as bordas anti-aliased.
 * @returns data-URL PNG da máscara + fração de pixels magenta.
 */
export async function buildMagentaMask(src: string, w: number, h: number): Promise<{ mask: string; ratio: number }> {
  const img = await loadImg(src);
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(img, 0, 0, w, h);
  const id = ctx.getImageData(0, 0, w, h);
  const d = id.data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (isMagenta(d[i], d[i + 1], d[i + 2])) { d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = 255; n++; }
    else { d[i] = d[i + 1] = d[i + 2] = 0; d[i + 3] = 255; }
  }
  ctx.putImageData(id, 0, 0);

  // Dilata ~3px: blur + threshold num 2º canvas (cresce a região, sela as bordas).
  const out = document.createElement("canvas"); out.width = w; out.height = h;
  const octx = out.getContext("2d")!;
  octx.filter = "blur(3px)";
  octx.drawImage(c, 0, 0);
  octx.filter = "none";
  const od = octx.getImageData(0, 0, w, h);
  const p = od.data;
  for (let i = 0; i < p.length; i += 4) {
    const on = p[i] > 40 ? 255 : 0; // qualquer borrão vira branco → dilatação
    p[i] = p[i + 1] = p[i + 2] = on; p[i + 3] = 255;
  }
  octx.putImageData(od, 0, 0);
  return { mask: out.toDataURL("image/png"), ratio: n / (w * h) };
}
