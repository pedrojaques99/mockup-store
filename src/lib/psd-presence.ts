/**
 * O catálogo não pode listar mockup cujo PSD o usuário já apagou.
 *
 * O Mongo é um espelho do disco, e o disco muda sem avisar ninguém: apagar uma
 * pasta de PSD deixa o registro para trás, e o registro vira card que abre em
 * erro. Aconteceu de verdade — uma pasta duplicada de 152 GB saiu do Drive e
 * 927 dos 3.100 documentos (30% do catálogo) viraram fantasma no mesmo minuto.
 *
 * Duas medições decidiram o desenho, e vale registrar as duas:
 *
 *   3.000 `existsSync` de ARQUIVO no mount do Drive .... 2.600 ms
 *     357 `existsSync` de PASTA no mesmo acervo ..........  280 ms
 *
 * Verificar arquivo por arquivo é caro demais para o caminho de leitura, e não
 * esquenta com cache do SO. Mas ninguém apaga 927 arquivos um a um: apaga a
 * pasta. Conferir a PASTA custa 10% do preço e pega o caso que existe.
 *
 * O que este módulo NÃO faz: escrever. Sumiço é conclusão de leitura — a poda de
 * verdade no Mongo é `npm run psd:prune`, explícita e com confirmação. Um disco
 * de rede que pisca não pode apagar banco sozinho.
 */

import { existsSync } from "fs";
import { dirname } from "path";
import { psdRoots } from "./fs-walk";

/**
 * Acima disto, some tudo em vez de sumir demais.
 *
 * Se metade do acervo "desapareceu" de uma vez, a hipótese provável não é que o
 * usuário apagou metade do acervo — é que o H: não montou, ou o Drive está
 * sincronizando, ou o PSD_DIRS mudou. Esvaziar a home nesse cenário é o pior
 * desfecho possível: o usuário abre o app e o acervo dele não existe mais.
 * Melhor mostrar card a mais (que falha ao abrir, e o usuário entende) do que
 * mostrar card a menos (e ele achar que perdeu os arquivos).
 */
const TETO_DE_SUMICO = 0.5;

export interface PresencaResultado<T> {
  docs: T[];
  /** Registros descartados por a pasta não existir mais. */
  removidos: number;
  /** As pastas que sumiram, para log e para o script de poda. */
  pastasSumidas: string[];
  /** Raízes do PSD_DIRS inacessíveis: disco fora, não arquivo apagado. */
  raizesOffline: string[];
  /** Verdadeiro quando o teto barrou a filtragem — nada foi removido. */
  abortadoPeloTeto: boolean;
}

interface Opcoes {
  /** Injetável para teste — o default bate no disco. */
  existe?: (p: string) => boolean;
  /** Injetável para teste; default = PSD_DIRS. */
  raizes?: string[];
}

const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
const dentro = (p: string, raiz: string) => {
  const a = norm(p).toLowerCase();
  const b = norm(raiz).toLowerCase();
  return a === b || a.startsWith(b + "/");
};

/**
 * Tira do catálogo os registros cujo PSD não está mais no disco.
 *
 * Registro sem `psdPath` (cena de foto, referência sem arquivo) passa intacto —
 * a ausência de caminho não é ausência de arquivo.
 */
export function filtrarPsdsSumidos<T extends { psdPath?: string }>(
  docs: T[],
  opts: Opcoes = {},
): PresencaResultado<T> {
  const existe = opts.existe ?? existsSync;
  const raizes = opts.raizes ?? psdRoots();

  // Raiz que não responde é disco desmontado. Tudo que mora embaixo dela fica
  // fora de julgamento: não dá para distinguir "apagado" de "inacessível", e o
  // silêncio a favor do usuário é manter o card.
  const raizesOffline = raizes.filter((r) => !existe(r));
  const souOffline = (p: string) => raizesOffline.some((r) => dentro(p, r));

  const cacheDir = new Map<string, boolean>();
  const pastaViva = (dir: string) => {
    const k = dir.toLowerCase();
    let v = cacheDir.get(k);
    if (v === undefined) {
      v = existe(dir);
      cacheDir.set(k, v);
    }
    return v;
  };

  const sumiu = (d: T): boolean => {
    if (!d.psdPath) return false;
    const p = norm(d.psdPath);
    if (souOffline(p)) return false;
    return !pastaViva(dirname(p));
  };

  const comPsd = docs.filter((d) => d.psdPath).length;
  const mortos = docs.filter(sumiu);

  // Teto: melhor um catálogo com fantasma do que um catálogo vazio.
  if (comPsd > 0 && mortos.length / comPsd > TETO_DE_SUMICO) {
    return {
      docs,
      removidos: 0,
      pastasSumidas: [],
      raizesOffline,
      abortadoPeloTeto: true,
    };
  }

  const pastasSumidas = [...new Set(mortos.map((d) => dirname(norm(d.psdPath!))))].sort();
  const vivos = mortos.length ? docs.filter((d) => !mortos.includes(d)) : docs;

  return {
    docs: vivos,
    removidos: mortos.length,
    pastasSumidas,
    raizesOffline,
    abortadoPeloTeto: false,
  };
}

/**
 * Versão exata, arquivo a arquivo — cara (~0,9 ms por arquivo no Drive).
 *
 * Só para o script de poda, que roda sob demanda e precisa de certeza antes de
 * apagar documento: a checagem por pasta acima erra para o caso raro de apagar
 * um PSD solto deixando a pasta em pé.
 */
export function psdsSumidosExato<T extends { psdPath?: string }>(
  docs: T[],
  opts: Opcoes = {},
): { mortos: T[]; raizesOffline: string[] } {
  const existe = opts.existe ?? existsSync;
  const raizes = opts.raizes ?? psdRoots();
  const raizesOffline = raizes.filter((r) => !existe(r));
  const mortos = docs.filter((d) => {
    if (!d.psdPath) return false;
    const p = norm(d.psdPath);
    if (raizesOffline.some((r) => dentro(p, r))) return false;
    return !existe(p);
  });
  return { mortos, raizesOffline };
}
