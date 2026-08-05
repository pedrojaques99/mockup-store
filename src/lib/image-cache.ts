/**
 * image-cache — normaliza a FONTE das imagens do catálogo.
 *
 * Por que existe, já que o Next tem otimizador próprio: o otimizador resolve a
 * saída (variante por breakpoint, WebP/AVIF, cache em disco), mas para produzir
 * cada variante ele BUSCA A FONTE e a carrega inteira em memória
 * (`Buffer.concat` em `fetchInternalImage`). Metade do acervo mora no Google
 * Drive e tem PNG de 13 MB usado como thumbnail de card — medido: 12 cards do
 * grid somavam 26,6 MB de fonte para entregar 119 KB de imagem ao browser.
 *
 * Aqui a fonte vira um derivado pequeno, gravado uma vez em disco local. O
 * otimizador continua fazendo o trabalho dele; só que sobre ~150 KB locais em
 * vez de 13 MB pela rede. Isto NÃO duplica o cache do Next — são camadas
 * diferentes: esta normaliza a entrada, aquela produz as saídas.
 *
 * Chave do cache = caminho + mtime + tamanho + largura pedida. Arquivo trocado
 * no disco muda o mtime, muda a chave, e o derivado velho simplesmente deixa de
 * ser referenciado — nunca serve conteúdo defasado.
 */
import { createHash } from "crypto";
import { mkdir, rename, stat, writeFile, readFile } from "fs/promises";
import { existsSync } from "fs";
import { join, extname } from "path";
import sharp from "sharp";

/** Só imagem. A rota antiga caía em `application/octet-stream` para qualquer
 *  extensão, o que transformava `?path=` num leitor de arquivo arbitrário. */
export const EXT_IMAGEM = new Set([".jpg", ".jpeg", ".png", ".webp", ".avif", ".gif", ".tif", ".tiff", ".bmp"]);

/** Lado maior do derivado quando ninguém pede largura. Acima disto o card não
 *  ganha nitidez — o maior thumbnail do grid é 450px de CSS, e o otimizador
 *  ainda serve retina em cima deste arquivo. */
const LADO_PADRAO = 1600;

const CACHE_DIR = join(process.cwd(), ".tmp", "img-cache");

/**
 * Trava de concorrência. Sem ela, os 60 cards da primeira dobra disparam 60
 * decodificações simultâneas; um PNG de 13 MB custa largura×altura×4 bytes
 * descomprimido, então o pico de memória é o produto disso pelo paralelismo.
 * Quatro por vez satura o disco/CPU sem transformar o servidor num balão.
 */
const LIMITE = 4;
let emVoo = 0;
const fila: (() => void)[] = [];

async function comLimite<T>(fn: () => Promise<T>): Promise<T> {
  if (emVoo >= LIMITE) await new Promise<void>((r) => fila.push(r));
  emVoo++;
  try {
    return await fn();
  } finally {
    emVoo--;
    fila.shift()?.();
  }
}

// libvips guarda blocos e arquivos abertos entre operações. O default (50 MB)
// é generoso para um processo que também roda Next, Mongo e o engine de render.
sharp.cache({ memory: 32, files: 20, items: 50 });
// Uma thread por operação: o paralelismo já é controlado por `comLimite`, e o
// pool default (nº de núcleos) multiplicava o pico de memória por 16 nesta máquina.
sharp.concurrency(2);

export interface Derivado {
  arquivo: string;
  etag: string;
  /** `true` quando o derivado já existia — o request não tocou no arquivo original. */
  doCache: boolean;
}

function chave(caminho: string, mtimeMs: number, bytes: number, largura: number) {
  return createHash("sha1")
    .update(`${caminho}|${mtimeMs}|${bytes}|w${largura}|v1`)
    .digest("hex");
}

/**
 * Devolve o caminho de um WebP derivado do arquivo, gerando-o se preciso.
 * `largura` ausente ⇒ `LADO_PADRAO`. Nunca amplia (`withoutEnlargement`): uma
 * thumbnail de 200px não vira 1600px de pixel inventado.
 */
export async function derivado(caminho: string, largura?: number): Promise<Derivado> {
  const st = await stat(caminho);
  const w = Math.max(16, Math.min(largura || LADO_PADRAO, 4096));
  const h = chave(caminho, st.mtimeMs, st.size, w);
  // Dois níveis de diretório: 65 mil arquivos numa pasta só é patológico no NTFS.
  const dir = join(CACHE_DIR, h.slice(0, 2));
  const destino = join(dir, `${h}.webp`);

  if (existsSync(destino)) return { arquivo: destino, etag: h, doCache: true };

  await comLimite(async () => {
    // Reconfere depois da fila: outro request pode ter gerado enquanto esperávamos.
    if (existsSync(destino)) return;
    await mkdir(dir, { recursive: true });
    const parcial = `${destino}.${process.pid}.tmp`;
    const buf = await sharp(caminho, { failOn: "none", limitInputPixels: 300_000_000 })
      // `rotate()` sem argumento aplica a orientação do EXIF — sem isto, foto de
      // celular sai deitada no card e certa no Photoshop.
      .rotate()
      .resize({ width: w, withoutEnlargement: true })
      .webp({ quality: 80, effort: 4 })
      .toBuffer();
    await writeFile(parcial, buf);
    // Rename é atômico no mesmo volume: ninguém lê um arquivo pela metade.
    await rename(parcial, destino);
  });

  return { arquivo: destino, etag: h, doCache: false };
}

export async function lerDerivado(d: Derivado) {
  return readFile(d.arquivo);
}

export function extensaoValida(caminho: string) {
  return EXT_IMAGEM.has(extname(caminho).toLowerCase());
}
