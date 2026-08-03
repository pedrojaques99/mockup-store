import { existsSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { psdRoots } from "./fs-walk";

/**
 * Navegação de disco e resolução de link do Drive.
 *
 * O miolo aqui é puro e testável de propósito: as rotas em `api/fs/*` são
 * adaptadores finos por cima. É o mesmo arranjo de `search-engine` ⊕
 * `search-index`.
 */

/** Windows aceita `C:/x` e `C:\x`; o resto do app fala com barra normal. */
export const normalizarCaminho = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "") || "/";

export interface DirEntry {
  nome: string;
  caminho: string;
}

export interface StatResult {
  existe: boolean;
  ehPasta: boolean;
  /** Entradas de primeiro nível. -1 quando não deu para ler. */
  entradas: number;
  /**
   * Arquivos que o Drive mantém só na nuvem. Ler os primeiros bytes deles
   * DISPARA download, e numa pasta de milhares de PSDs isso é a diferença entre
   * minutos e horas — por isso a interface avisa antes de varrer.
   */
  naNuvem: number;
}

/**
 * Atributo do Windows para arquivo "só na nuvem" (FILE_ATTRIBUTE_RECALL_ON_*).
 * O Node expõe em `stat.attributes` só no Windows; onde não existe, o valor é 0
 * e a contagem simplesmente dá zero.
 */
const RECALL_ON_OPEN = 0x00040000;
const RECALL_ON_DATA_ACCESS = 0x00400000;

function ehSoNaNuvem(caminho: string): boolean {
  try {
    const s = statSync(caminho) as unknown as { attributes?: number };
    const attrs = s.attributes ?? 0;
    return (attrs & (RECALL_ON_OPEN | RECALL_ON_DATA_ACCESS)) !== 0;
  } catch {
    return false;
  }
}

export function statCaminho(raw: string): StatResult {
  const p = normalizarCaminho(raw);
  if (!p || !existsSync(p)) return { existe: false, ehPasta: false, entradas: 0, naNuvem: 0 };
  let ehPasta = false;
  try {
    ehPasta = statSync(p).isDirectory();
  } catch {
    return { existe: true, ehPasta: false, entradas: -1, naNuvem: 0 };
  }
  if (!ehPasta) return { existe: true, ehPasta: false, entradas: 0, naNuvem: 0 };
  try {
    const entradas = readdirSync(p, { withFileTypes: true });
    let naNuvem = 0;
    for (const e of entradas) {
      if (e.isFile() && ehSoNaNuvem(join(p, e.name))) naNuvem++;
    }
    return { existe: true, ehPasta: true, entradas: entradas.length, naNuvem };
  } catch {
    return { existe: true, ehPasta: true, entradas: -1, naNuvem: 0 };
  }
}

/** Unidades montadas. Em Windows testa A: a Z:; fora de Windows, a raiz. */
export function listarUnidades(): DirEntry[] {
  if (process.platform !== "win32") return [{ nome: "/", caminho: "/" }];
  const out: DirEntry[] = [];
  for (let i = 67; i <= 90; i++) {
    // Começa no C: — A: e B: são disquete e travam a listagem em algumas máquinas.
    const letra = String.fromCharCode(i);
    const raiz = `${letra}:/`;
    try {
      if (existsSync(raiz)) out.push({ nome: `${letra}:`, caminho: raiz });
    } catch {
      /* unidade sem mídia */
    }
  }
  return out;
}

/** Só diretórios, ordenados, sem os ocultos do sistema. */
export function listarPastas(raw: string): DirEntry[] {
  const p = normalizarCaminho(raw);
  if (!p || p === "/" || !existsSync(p)) return [];
  try {
    return readdirSync(p, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith("$") && !e.name.startsWith("."))
      .map((e) => ({ nome: e.name, caminho: `${p}/${e.name}` }))
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  } catch {
    return [];
  }
}

/** Pai de um caminho, ou null quando já está na raiz da unidade. */
export function pastaPai(raw: string): string | null {
  const p = normalizarCaminho(raw);
  if (!p || p === "/") return null;
  const partes = p.split("/");
  if (partes.length <= 1) return null;
  if (partes.length === 2 && /^[A-Za-z]:$/.test(partes[0])) return null;
  return partes.slice(0, -1).join("/") || null;
}

// ── Google Drive ────────────────────────────────────────────────────────────

/** ID de pasta numa URL do Drive. */
export function extrairIdDrive(url: string): string | null {
  const m = url.match(/\/folders\/([-\w]{20,})/) ?? url.match(/[?&]id=([-\w]{20,})/);
  return m ? m[1] : null;
}

export const ehUrlDrive = (s: string) => /drive\.google\.com/i.test(s);

/**
 * Onde o Drive para computador pode estar montado. Junta as unidades com os
 * pais das raízes de PSD_DIRS, que é onde a montagem real do usuário aparece.
 */
export function mountsDoDrive(): string[] {
  const candidatos = new Set<string>();
  for (const u of listarUnidades()) candidatos.add(u.caminho.replace(/\/$/, ""));
  for (const raiz of psdRoots()) {
    const partes = normalizarCaminho(raiz).split("/");
    for (let i = 1; i < partes.length; i++) candidatos.add(partes.slice(0, i).join("/"));
  }
  const perfil = process.env.USERPROFILE || process.env.HOME;
  if (perfil) candidatos.add(`${normalizarCaminho(perfil)}/Google Drive`);
  return [...candidatos].filter(Boolean);
}

export interface ResolucaoDrive {
  ok: boolean;
  caminho?: string;
  /** Por que não deu, em linguagem de gente. */
  motivo?: string;
}

/**
 * Link do Drive → caminho local, sem OAuth e sem download.
 *
 * Funciona porque o Drive para computador materializa **pasta compartilhada** em
 * `<mount>/.shortcut-targets-by-id/<ID>/<nome>`, e esse `<ID>` é exatamente o que
 * aparece na URL. Pasta do próprio Meu Drive não tem diretório por ID: mora na
 * hierarquia por nome, e sem a API do Drive não há como descobrir o nome nem os
 * pais. Nesse caso a resposta honesta é pedir o caminho local.
 */
export function resolverUrlDrive(url: string): ResolucaoDrive {
  const id = extrairIdDrive(url);
  if (!id) {
    return { ok: false, motivo: "Não achei o ID da pasta nesse link do Drive." };
  }
  for (const mount of mountsDoDrive()) {
    const alvo = `${mount}/.shortcut-targets-by-id/${id}`;
    try {
      if (!existsSync(alvo)) continue;
      const dentro = readdirSync(alvo, { withFileTypes: true }).filter((e) => e.isDirectory());
      // O atalho por ID contém uma única pasta, que é a compartilhada.
      if (dentro.length === 1) return { ok: true, caminho: `${alvo}/${dentro[0].name}` };
      if (dentro.length > 1) return { ok: true, caminho: alvo };
    } catch {
      /* mount sem permissão */
    }
  }
  return {
    ok: false,
    motivo:
      "Esse link não está montado nesta máquina. Link de pasta compartilhada resolve sozinho; " +
      "pasta do seu Meu Drive não, porque o Drive não cria diretório por ID para ela. " +
      "Abra no Drive para computador e cole o caminho local.",
  };
}
