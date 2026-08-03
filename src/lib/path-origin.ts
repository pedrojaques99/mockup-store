/**
 * De onde vem um arquivo — e se apagar ele é problema seu ou de outra pessoa.
 *
 * O painel de duplicatas listava caminho cru. Só que `H:/Meu Drive/...` e
 * `H:/.shortcut-targets-by-id/...` parecem a mesma coisa e não são: o segundo é
 * um ATALHO do Google Drive para um arquivo que pertence a outra conta ou a um
 * drive compartilhado. Apagar por ali apaga na origem, para todo mundo — e às
 * vezes nem há permissão, então a remoção falha silenciosamente.
 */

export type OriginKind = "local" | "meu-drive" | "compartilhado";

export interface PathOrigin {
  kind: OriginKind;
  /** Rótulo curto para selo de UI. */
  label: string;
  /** Falso = não é seu para apagar; a UI nunca deve marcar como "Remover". */
  safeToDelete: boolean;
}

const ORIGINS: Record<OriginKind, Omit<PathOrigin, "kind">> = {
  local: { label: "Local", safeToDelete: true },
  "meu-drive": { label: "Meu Drive", safeToDelete: true },
  compartilhado: { label: "Compartilhado", safeToDelete: false },
};

export function pathOrigin(path: string): PathOrigin {
  const p = (path || "").replace(/\\/g, "/").toLowerCase();

  // Atalhos do Drive Desktop: alvo mora fora da sua conta.
  if (p.includes("/.shortcut-targets-by-id/")) return { kind: "compartilhado", ...ORIGINS.compartilhado };
  // Drives compartilhados montados (PT e EN, conforme o idioma do cliente Drive).
  if (/\/(drives compartilhados|shared drives|compartilhados comigo|shared with me)\//.test(p)) {
    return { kind: "compartilhado", ...ORIGINS.compartilhado };
  }
  if (/\/(meu drive|my drive)\//.test(p)) return { kind: "meu-drive", ...ORIGINS["meu-drive"] };

  return { kind: "local", ...ORIGINS.local };
}
