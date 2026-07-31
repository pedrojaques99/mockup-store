/**
 * dHash (difference hash) — a impressão digital perceptual usada pela triagem
 * de ingest.
 *
 * Por que dHash e não md5: o acervo está cheio de re-exportações da mesma cena
 * (mesma imagem salva em outra qualidade, outro tamanho, outro formato). Para o
 * md5 são arquivos completamente diferentes; para o olho, é a mesma coisa duas
 * vezes no grid. dHash olha o gradiente horizontal, então sobrevive a resize,
 * recompressão e mudança de formato — que é exatamente o eixo em que estas
 * duplicatas variam.
 *
 * A decodificação é do `sharp` (já dependência do projeto, libvips) — nada de
 * decoder na mão.
 */

import sharp from "sharp";

/** 9 colunas para produzir 8 comparações por linha; 8 linhas ⇒ 64 bits. */
const W = 9;
const H = 8;

export interface HashedImage {
  /** 16 caracteres hex = 64 bits. */
  phash: string;
  width: number;
  height: number;
}

/**
 * Devolve o dHash e as dimensões REAIS (as do arquivo, não as do redimensionado
 * — a triagem usa essas dimensões para reprovar resolução baixa).
 *
 * `failOn: "none"` porque o acervo tem JPEG truncado de sincronização de nuvem:
 * sem isso o sharp lança e o arquivo some do relatório em vez de aparecer como
 * problema. Erro de verdade volta como `null` e a rota trata.
 */
export async function hashImage(path: string): Promise<HashedImage | null> {
  try {
    const img = sharp(path, { failOn: "none", limitInputPixels: 1_000_000_000 });
    const meta = await img.metadata();

    const raw = await img
      .clone()
      .greyscale()
      // `fit: "fill"` de propósito: o hash tem de ignorar a proporção, senão o
      // mesmo mockup exportado em 16:9 e em 4:3 gera hashes sem relação.
      .resize(W, H, { fit: "fill" })
      .raw()
      .toBuffer();

    if (raw.length < W * H) return null;

    let bits = "";
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W - 1; x++) {
        const i = y * W + x;
        bits += raw[i] < raw[i + 1] ? "1" : "0";
      }
    }

    let hex = "";
    for (let i = 0; i < 64; i += 4) {
      hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
    }

    return {
      phash: hex,
      width: meta.width ?? 0,
      height: meta.height ?? 0,
    };
  } catch {
    return null;
  }
}
