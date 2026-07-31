/**
 * Triagem de ingest — decide, ANTES de escrever no Mongo, o que é novo, o que é
 * duplicata, o que é lixo e o que o acervo já tem.
 *
 * Por que existir: o ingest antigo dedupava com `findOne({ name })` exato e não
 * filtrava nada. "Falling-Cards-Blur" e "Falling Cards Blur (1)" entravam os
 * dois; thumbnails de 4KB viravam card no grid; e o usuário confirmava uma
 * escrita irreversível vendo só duas contagens. Ingest é superfície de trust:
 * decisão às cegas não é decisão.
 *
 * Este módulo é PURO de propósito (nada de fs, nada de Mongo, nada de sharp) —
 * quem lê disco e decodifica pixel é a rota; aqui só entra dado e sai veredito.
 * Mesmo desenho de `search-engine.ts` ⟷ `search-index.ts`.
 */

import { mockupSignature, normalizeName, keepScore } from "./dedup";

export type Verdict = "new" | "duplicate" | "junk" | "exists";

export interface ScanCandidate {
  /** Caminho absoluto normalizado com "/". */
  path: string;
  /** Nome do arquivo SEM extensão (o que o `walkDir` devolve). */
  name: string;
  /** Extensão em minúsculas, com ponto. */
  ext: string;
  sizeBytes: number;
  /** Pasta imediata — vira sugestão de estúdio. */
  folder: string;
  /** dHash perceptual (16 hex) — imagens; ausente em PSD. */
  phash?: string;
  /** md5 dos primeiros 2MB — PSDs, onde perceptual não se aplica. */
  contentHash?: string;
  width?: number;
  height?: number;
}

export interface TriagedItem extends ScanCandidate {
  verdict: Verdict;
  /** Por que este veredito — a UI mostra isto, nunca só a cor. */
  reason?: string;
  /** Chave do grupo de duplicatas (só quando há grupo). */
  groupKey?: string;
  /** O representante do grupo é o único com `verdict: "new"`. */
  isGroupLeader?: boolean;
  /** PSD casado por nome, quando a imagem é a capa de um PSD. */
  psdPath?: string;
  /** Sugestão de estúdio (pasta imediata; a UI deixa editar). */
  studio: string;
}

export interface TriageSummary {
  total: number;
  new: number;
  duplicate: number;
  junk: number;
  exists: number;
  /** Bytes que deixam de entrar por serem duplicata ou lixo. */
  skippedBytes: number;
}

// ─── Lixo ───────────────────────────────────────────────────────────────────

/** Nomes que são sempre lixo de sistema/exportador, independente de tamanho. */
const JUNK_NAME = /^(thumbs?|desktop|\.ds_store|__macosx|icon\r?)$/i;
/** Sufixos de derivado — a versão boa está do lado, com o nome limpo. */
const DERIVED_SUFFIX = /[-_ .](thumb|thumbnail|tn|small|mini|icon|preview|prev|low|lowres|web|screen)$/i;

/** Abaixo disto, uma imagem não é mockup: é ícone ou thumbnail de exportador. */
export const MIN_IMAGE_BYTES = 15 * 1024;
/** Menor lado aceitável. Um "mockup" de 180px não serve nem de thumbnail do grid. */
export const MIN_IMAGE_SIDE = 240;

/**
 * Diz por que o arquivo é lixo, ou `null` se presta.
 * PSD não passa pelas regras de pixel/tamanho — um PSD pequeno ainda é um PSD.
 */
export function junkReason(c: ScanCandidate): string | null {
  if (c.sizeBytes === 0) return "arquivo vazio";
  if (JUNK_NAME.test(c.name)) return "arquivo de sistema";
  if (c.ext === ".psd") return null;

  if (DERIVED_SUFFIX.test(c.name)) return "derivado (thumbnail/preview)";
  if (c.sizeBytes < MIN_IMAGE_BYTES) {
    return `arquivo minúsculo (${Math.round(c.sizeBytes / 1024)} KB)`;
  }
  if (c.width && c.height) {
    const menorLado = Math.min(c.width, c.height);
    if (menorLado < MIN_IMAGE_SIDE) return `resolução baixa (${c.width}×${c.height})`;
  }
  return null;
}

// ─── Duplicata perceptual ───────────────────────────────────────────────────

/**
 * Distância de Hamming entre dois dHash hexadecimais.
 * Compara nibble a nibble em vez de converter para BigInt: 16 lookups numa
 * tabela de 16 entradas contra uma alocação de BigInt por par — e este laço roda
 * O(n²) sobre os líderes de grupo.
 */
const POPCOUNT_NIBBLE = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];

export function hammingHex(a: string, b: string): number {
  if (a.length !== b.length) return Number.MAX_SAFE_INTEGER;
  let dist = 0;
  for (let i = 0; i < a.length; i++) {
    const xor = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    dist += POPCOUNT_NIBBLE[xor];
  }
  return dist;
}

/**
 * Limiar de "é a mesma imagem". 64 bits totais; ≤6 pega re-encode, recompressão
 * e mudança de escala, sem casar dois mockups genuinamente diferentes.
 */
export const PHASH_THRESHOLD = 6;

/** Teto do laço O(n²) — acima disto só o casamento exato vale, e a UI avisa. */
export const NEAR_DUPE_LEADER_CAP = 1500;

/**
 * Chave determinística de agrupamento por conteúdo.
 * Imagem → dHash exato. PSD → md5 parcial. Sem nenhum dos dois, cai na
 * assinatura nome+tamanho que o grid já usa (`lib/dedup`), pra não inventar um
 * terceiro conceito de "mesmo mockup" dentro do produto.
 */
export function contentKey(c: ScanCandidate): string {
  if (c.phash) return `p:${c.phash}`;
  if (c.contentHash) return `c:${c.contentHash}`;
  return `n:${mockupSignature(c.name, c.sizeBytes)}`;
}

// ─── Triagem ────────────────────────────────────────────────────────────────

export interface TriageInput {
  candidates: ScanCandidate[];
  /** Assinaturas (`mockupSignature`) do que o acervo JÁ tem. */
  existingSignatures: Set<string>;
  /** Caminhos já ingeridos — casamento forte, vence qualquer heurística. */
  existingPaths: Set<string>;
  /** Detectar quase-duplicatas (dHash próximo), além das idênticas. */
  nearDuplicates?: boolean;
}

/**
 * Ordem dos vereditos, e o porquê de cada precedência:
 *  1. `exists`    — já está no acervo. Nada a decidir.
 *  2. `junk`      — não deveria entrar de jeito nenhum, nem como líder de grupo.
 *  3. `duplicate` — entra um representante; os outros ficam anexados a ele.
 *  4. `new`       — o resto.
 *
 * Lixo vem ANTES de duplicata de propósito: se um grupo tem uma versão boa e
 * três thumbnails, o líder tem de ser a versão boa. Classificar duplicata
 * primeiro elegeria o thumbnail como representante em metade dos casos.
 */
export function triage(input: TriageInput): { items: TriagedItem[]; summary: TriageSummary } {
  const { candidates, existingSignatures, existingPaths, nearDuplicates = true } = input;

  // PSDs indexados por nome normalizado — a imagem "Foo.jpg" ao lado de "Foo.psd"
  // é a capa dele, não um arquivo solto.
  const psdByName = new Map<string, string>();
  for (const c of candidates) {
    if (c.ext === ".psd") psdByName.set(normalizeName(c.name), c.path);
  }

  const items: TriagedItem[] = candidates.map((c) => ({
    ...c,
    verdict: "new" as Verdict,
    studio: c.folder,
    psdPath: c.ext === ".psd" ? c.path : psdByName.get(normalizeName(c.name)),
  }));

  // 1 + 2 — acervo e lixo, item a item.
  for (const it of items) {
    if (existingPaths.has(it.path)) {
      it.verdict = "exists";
      it.reason = "já ingerido";
      continue;
    }
    if (existingSignatures.has(mockupSignature(it.name, it.sizeBytes))) {
      it.verdict = "exists";
      it.reason = "já existe no acervo";
      continue;
    }
    const junk = junkReason(it);
    if (junk) {
      it.verdict = "junk";
      it.reason = junk;
    }
  }

  // 3 — duplicatas entre os que sobraram.
  const pending = items.filter((it) => it.verdict === "new");
  const groups = new Map<string, TriagedItem[]>();
  for (const it of pending) {
    const key = contentKey(it);
    const arr = groups.get(key);
    if (arr) arr.push(it);
    else groups.set(key, [it]);
  }

  // Quase-duplicatas: funde grupos cujos líderes têm dHash a ≤ PHASH_THRESHOLD.
  if (nearDuplicates) {
    const leaders = [...groups.entries()]
      .filter(([k]) => k.startsWith("p:"))
      .map(([key, arr]) => ({ key, phash: arr[0].phash! }));

    if (leaders.length <= NEAR_DUPE_LEADER_CAP) {
      const mergedInto = new Map<string, string>();
      for (let i = 0; i < leaders.length; i++) {
        if (mergedInto.has(leaders[i].key)) continue;
        for (let j = i + 1; j < leaders.length; j++) {
          if (mergedInto.has(leaders[j].key)) continue;
          if (hammingHex(leaders[i].phash, leaders[j].phash) <= PHASH_THRESHOLD) {
            mergedInto.set(leaders[j].key, leaders[i].key);
          }
        }
      }
      for (const [from, to] of mergedInto) {
        const src = groups.get(from);
        const dst = groups.get(to);
        if (!src || !dst) continue;
        dst.push(...src);
        groups.delete(from);
      }
    }
  }

  for (const [key, arr] of groups) {
    if (arr.length < 2) continue;
    // Mesma regra de "qual nome é o bom" que o grid usa pra colapsar duplicado.
    const sorted = [...arr].sort((a, b) => keepScore(a) - keepScore(b));
    const leader = sorted[0];
    leader.groupKey = key;
    leader.isGroupLeader = true;
    leader.reason = `representante de ${arr.length} cópias`;
    for (const other of sorted.slice(1)) {
      other.verdict = "duplicate";
      other.groupKey = key;
      other.isGroupLeader = false;
      other.reason = `cópia de ${leader.name}`;
    }
  }

  const summary: TriageSummary = {
    total: items.length,
    new: 0,
    duplicate: 0,
    junk: 0,
    exists: 0,
    skippedBytes: 0,
  };
  for (const it of items) {
    summary[it.verdict]++;
    if (it.verdict === "duplicate" || it.verdict === "junk") summary.skippedBytes += it.sizeBytes;
  }

  return { items, summary };
}

/** O que vem marcado por padrão: só o que é novo. O default é a estratégia. */
export function defaultSelection(items: TriagedItem[]): Set<string> {
  return new Set(items.filter((i) => i.verdict === "new").map((i) => i.path));
}
