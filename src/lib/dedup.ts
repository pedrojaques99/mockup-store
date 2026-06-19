// Detecção de mockups duplicados na galeria (itens do Mongo, não arquivos de
// disco — pra dedup de PSD físico veja /api/duplicates).
//
// Assinatura = nome normalizado + tamanho do PSD (decisão do usuário): junta
// variações como "Falling Cards Blur" / "Falling-Cards-Blur",
// "Full Boxes" / "Full-Boxes", "Falling Cards 02 (1)/(2)" — sem casar mockups
// genuinamente diferentes.

export interface DedupRef {
  name: string;
  psdSizeBytes?: number;
}

/** Normaliza o nome: sem acento, extensão, "-preview", "média" e "(n)". */
export function normalizeName(name: string): string {
  return (name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\.(psd|psb|png|jpe?g|tiff?|gif|webp)$/i, "")
    .replace(/[-_\s]*preview\b/gi, "")
    .replace(/\bm[eé]dia\b/gi, "")
    .replace(/\(\s*\d+\s*\)/g, "")
    .replace(/[-_\s]+/g, " ")
    .trim();
}

/**
 * Chave de agrupamento: nome normalizado + bucket de tamanho (KB). Tamanho
 * ausente vira bucket 0 — só agrupa com outro também-sem-tamanho (conservador).
 */
export function mockupSignature(name: string, psdSizeBytes?: number): string {
  const sizeBucket = psdSizeBytes ? Math.round(psdSizeBytes / 1024) : 0;
  return `${normalizeName(name)}::${sizeBucket}`;
}

/** Menor score = representante preferido (nome mais "limpo"). */
export function keepScore(ref: DedupRef): number {
  const n = (ref.name || "").toLowerCase();
  let score = 0;
  if (/\(\s*\d+\s*\)/.test(n)) score += 20; // "(1)", "(2)"
  if (/[-_]/.test(n)) score += 5; // prefere separado por espaço
  if (/preview/.test(n)) score += 8;
  score += n.length * 0.01; // desempate: nome mais curto
  return score;
}

/**
 * Colapsa duplicados preservando a ordem de aparição. Retorna a lista filtrada
 * (um representante por assinatura) e quantos foram ocultados.
 */
export function dedupeRefs<T extends DedupRef>(refs: T[]): { kept: T[]; hidden: number } {
  const bySig = new Map<string, T>();
  const order: string[] = [];
  for (const r of refs) {
    const sig = mockupSignature(r.name, r.psdSizeBytes);
    const cur = bySig.get(sig);
    if (!cur) {
      bySig.set(sig, r);
      order.push(sig);
    } else if (keepScore(r) < keepScore(cur)) {
      bySig.set(sig, r);
    }
  }
  const kept = order.map((s) => bySig.get(s)!);
  return { kept, hidden: refs.length - kept.length };
}
