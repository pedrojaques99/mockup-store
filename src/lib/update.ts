/**
 * Atualização do app pelo próprio app.
 *
 * O ICP é designer, não quem vive no terminal. Pedir `git pull && npm ci` para
 * essa pessoa é pedir que ela abandone a atualização: o custo não é o comando,
 * é o medo de quebrar o que já funciona. Então o app checa sozinho e atualiza
 * com um clique, e o terminal vira o caminho alternativo, não o principal.
 *
 * Três garantias que fazem a pessoa clicar sem medo, e que valem mais que a
 * feature em si:
 *
 * 1. **O acervo e as chaves não são tocados.** `.env.local`, `config.json` e as
 *    pastas de PSD são ignorados pelo git. Atualizar mexe em código, nunca no
 *    que a pessoa configurou.
 * 2. **Só avança se for fast-forward.** Com alteração local não commitada, a
 *    atualização PARA e explica, em vez de sobrescrever. Perder trabalho alheio
 *    uma vez destrói a confiança no botão para sempre.
 * 3. **Nada roda sem a pessoa mandar.** A checagem é leitura; a atualização
 *    exige clique.
 */
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { join } from "node:path";

const run = promisify(exec);
const RAIZ = process.cwd();

/** `git` roda com timeout: rede fora do ar não pode pendurar a UI. */
async function git(args: string, timeoutMs = 20_000): Promise<string> {
  const { stdout } = await run(`git ${args}`, { cwd: RAIZ, timeout: timeoutMs });
  return stdout.trim();
}

export type EstadoUpdate = {
  /** Falso quando a pasta não é um clone git (baixou o zip, por exemplo). */
  versionavel: boolean;
  atual: string | null;
  atualCurto: string | null;
  remoto: string | null;
  branch: string | null;
  /** Quantos commits o remoto está à frente. 0 = já está em dia. */
  atras: number;
  temNovidade: boolean;
  /** Alteração local não commitada trava o fast-forward. */
  sujo: boolean;
  /** Assuntos dos commits novos, para a pessoa ver o que vem antes de clicar. */
  novidades: string[];
  erro: string | null;
};

const VAZIO: EstadoUpdate = {
  versionavel: false, atual: null, atualCurto: null, remoto: null, branch: null,
  atras: 0, temNovidade: false, sujo: false, novidades: [], erro: null,
};

/**
 * Lê o estado sem escrever nada. Faz `git fetch` (que só baixa refs, não mexe
 * na árvore de trabalho) para saber se há novidade.
 */
export async function estadoUpdate(): Promise<EstadoUpdate> {
  if (!existsSync(join(RAIZ, ".git"))) {
    return { ...VAZIO, erro: "Esta cópia não é um clone git, então não dá para atualizar sozinha." };
  }

  try {
    const branch = await git("rev-parse --abbrev-ref HEAD");
    const atual = await git("rev-parse HEAD");
    const sujo = (await git("status --porcelain")).length > 0;

    // Só refs: não altera nenhum arquivo do disco.
    await git(`fetch origin ${branch} --quiet`, 30_000);

    const remoto = await git(`rev-parse origin/${branch}`);
    const atras = Number(await git(`rev-list --count HEAD..origin/${branch}`)) || 0;

    const novidades = atras
      ? (await git(`log --pretty=format:%s HEAD..origin/${branch} --max-count=8`))
          .split("\n").filter(Boolean)
      : [];

    return {
      versionavel: true,
      atual, atualCurto: atual.slice(0, 7), remoto, branch,
      atras, temNovidade: atras > 0, sujo, novidades, erro: null,
    };
  } catch (e) {
    // Sem rede, sem remoto, git ausente: informa e não quebra a tela.
    return { ...VAZIO, versionavel: true, erro: mensagem(e) };
  }
}

export type ResultadoUpdate = {
  ok: boolean;
  passos: { nome: string; ok: boolean; detalhe?: string }[];
  precisaReiniciar: boolean;
  erro: string | null;
};

/**
 * Aplica a atualização. Só avança em fast-forward, e só reinstala dependência
 * se o `package-lock.json` mudou de verdade — `npm ci` à toa custa minutos e é
 * o que faz a pessoa achar que "atualizar demora".
 */
export async function aplicarUpdate(): Promise<ResultadoUpdate> {
  const passos: ResultadoUpdate["passos"] = [];

  const estado = await estadoUpdate();
  if (estado.erro) return { ok: false, passos, precisaReiniciar: false, erro: estado.erro };
  if (estado.sujo) {
    return {
      ok: false, passos, precisaReiniciar: false,
      erro: "Há alteração local não salva no git. A atualização parou para não sobrescrever o seu trabalho.",
    };
  }
  if (!estado.temNovidade) {
    return { ok: true, passos, precisaReiniciar: false, erro: null };
  }

  try {
    const lockAntes = await hashDoLock();

    await git(`merge --ff-only origin/${estado.branch}`, 60_000);
    passos.push({ nome: "Baixar a nova versão", ok: true, detalhe: `${estado.atras} commit(s)` });

    const lockDepois = await hashDoLock();
    if (lockAntes !== lockDepois) {
      await run("npm ci", { cwd: RAIZ, timeout: 10 * 60_000 });
      passos.push({ nome: "Atualizar dependências", ok: true });
    } else {
      passos.push({ nome: "Dependências", ok: true, detalhe: "sem mudança, pulou" });
    }

    return { ok: true, passos, precisaReiniciar: true, erro: null };
  } catch (e) {
    passos.push({ nome: "Falhou", ok: false, detalhe: mensagem(e) });
    return { ok: false, passos, precisaReiniciar: false, erro: mensagem(e) };
  }
}

async function hashDoLock(): Promise<string> {
  try {
    return await git("hash-object package-lock.json");
  } catch {
    return "";
  }
}

function mensagem(e: unknown): string {
  const t = e instanceof Error ? e.message : String(e);
  // stderr do git vem com ruído de progresso; a primeira linha basta.
  return t.split("\n").find((l) => l.trim()) ?? "Erro desconhecido";
}
