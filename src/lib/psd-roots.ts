/**
 * Caminho portátil do acervo — `{acervo}/rel` em vez de `Z:/BOXY/Produtos/rel`.
 *
 * O banco guarda hoje caminho absoluto com letra de drive
 * (`Z:/BOXY/Produtos/A5 Paper/A5 Paper Mockup - v1.psd`, conferido nos 3.100
 * docs de `psd_metadata`). Isso amarra o registro a UMA máquina, e amarra de um
 * jeito que não grita: quem montar o mesmo acervo em `Y:` não vê erro nenhum —
 * vê o catálogo **encolhido**, porque o `psd-presence` esconde registro cuja
 * pasta sumiu. Silêncio é o pior modo de falha que este projeto tem.
 *
 * Guardando `{acervo}/rel`, o mesmo registro serve qualquer máquina, e é isso
 * que destrava as três coisas de uma vez: o time recebe o acervo já indexado
 * sem reextrair faces, o público plugga a pasta dele, e o banco pode virar
 * SQLite local porque não sobra nada de máquina-específico dentro dele.
 *
 * ## Regras que não podem sair
 *
 * - **Ler formato antigo SEMPRE funciona.** Existem 9 mil documentos com
 *   caminho absoluto. Migrar não pode ser pré-requisito de nada.
 * - **Raiz mais longa vence.** Com `PSD_DIRS=Z:/BOXY,Z:/BOXY/Produtos`, um
 *   arquivo em `Produtos` pertence a `Produtos`. A raiz curta também casaria, e
 *   aí o mesmo arquivo teria dois nomes portáveis — quebrando a deduplicação.
 * - **Fora de toda raiz continua absoluto**, e é honesto sobre isso
 *   (`isPortable === false`). Inventar uma raiz fictícia produziria um caminho
 *   que não resolve em lugar nenhum.
 */
import { existsSync } from "fs";
import { psdRoots } from "./fs-walk";

/** Prefixo do caminho portátil. `{acervo}` porque `$` e `%` já são shell/env. */
const MARCA = "{acervo}";

export interface RaizAcervo {
  /** Índice estável dentro do `PSD_DIRS` da máquina. */
  indice: number;
  /** Caminho absoluto local, normalizado com `/` e sem barra final. */
  caminho: string;
}

export function normalizar(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "");
}

/**
 * As raízes desta máquina, já podadas de pai/filha pelo `psdRoots`, ordenadas
 * da mais longa para a mais curta — a ordem em que precisam ser testadas.
 */
export function raizes(raw?: string): RaizAcervo[] {
  return psdRoots(raw ?? process.env.PSD_DIRS ?? "")
    .map((caminho, indice) => ({ indice, caminho: normalizar(caminho) }))
    .sort((a, b) => b.caminho.length - a.caminho.length);
}

export function ehPortavel(p: string | undefined): boolean {
  return typeof p === "string" && p.startsWith(MARCA);
}

/**
 * Absoluto → portátil. Devolve o próprio caminho quando ele não mora em raiz
 * nenhuma: melhor um absoluto assumido do que um portátil que mente.
 */
export function paraPortavel(abs: string, raw?: string): string {
  if (!abs) return abs;
  if (ehPortavel(abs)) return abs;
  const alvo = normalizar(abs);
  const alvoLower = alvo.toLowerCase();
  for (const r of raizes(raw)) {
    const prefixo = r.caminho.toLowerCase() + "/";
    if (alvoLower.startsWith(prefixo)) {
      return `${MARCA}/${alvo.slice(r.caminho.length + 1)}`;
    }
  }
  return alvo;
}

/**
 * Portátil → absoluto local. Testa as raízes da máquina em ordem e devolve a
 * primeira em que o arquivo EXISTE; se nenhuma tem, devolve pela primeira raiz,
 * para que o erro subsequente aponte um caminho plausível em vez de `{acervo}/…`
 * cru, que não diz nada a quem lê o log.
 */
export function paraLocal(p: string | undefined, raw?: string): string | undefined {
  if (!p) return p;
  if (!ehPortavel(p)) return normalizar(p);
  const rel = p.slice(MARCA.length + 1);
  const rs = raizes(raw);
  if (!rs.length) return rel;
  for (const r of rs) {
    const tentativa = `${r.caminho}/${rel}`;
    if (existsSync(tentativa)) return tentativa;
  }
  return `${rs[0].caminho}/${rel}`;
}

/**
 * Resolução com rede de segurança, para os registros herdados.
 *
 * O caminho absoluto antigo aponta para a máquina de quem ingeriu. Quando ele
 * não existe aqui, o arquivo quase nunca sumiu — ele está **na outra letra**,
 * ou a pasta foi renomeada. Antes de dar o registro por perdido, procura pelo
 * nome do arquivo dentro das raízes locais, que é exatamente o que o
 * `npm run psd:repoint` faz no banco (e que religou 1.870 registros perdendo
 * zero na limpeza de 05/08/2026). Aqui isso vira leitura, sem escrever nada.
 *
 * `buscarPorNome` é injetado para esta lib não puxar o índice de PSDs (que faz
 * I/O de disco) e continuar testável sem tocar em arquivo.
 */
export function resolver(
  p: string | undefined,
  buscarPorNome?: (nome: string) => string | undefined,
  raw?: string,
): string | undefined {
  const local = paraLocal(p, raw);
  if (!local) return local;
  if (existsSync(local)) return local;
  if (!buscarPorNome) return local;
  const nome = local.slice(local.lastIndexOf("/") + 1);
  if (!nome) return local;
  return buscarPorNome(nome) ?? local;
}
