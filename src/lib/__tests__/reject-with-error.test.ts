import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, extname } from "path";

/**
 * Guarda de regressão: nenhum `onerror` rejeita com o Event cru.
 *
 * Motivo real, não hipotético. O app tinha **12 ocorrências** de
 * `img.onerror = rej` / `fr.onerror = rej`, que passam o `Event` do DOM direto
 * para `reject()`. Uma rejeição desse tipo chega no overlay do Next e no
 * `toast.error` como `String(event)` — literalmente **"[object Event]"**. É a
 * pior forma de erro possível: acontece, interrompe o fluxo, e não diz o que
 * falhou, onde, nem com qual URL. Um usuário reportou exatamente essa tela.
 *
 * Isto é um PADRÃO, não um valor: `tsc` aceita (`rej` é `(reason?: any) => void`),
 * o ESLint aceita, e nenhum teste de unidade exercita o caminho de falha de uma
 * imagem. Ler a fonte é a única camada que pega.
 *
 * A correção é sempre a mesma: `onerror = () => rej(new Error("… ${url}"))`.
 */

const SRC = "src";

/** `x.onerror = rej` / `= reject` / `= reject;` — a atribuição direta do rejector. */
const BARE_REJECT = /\bon(?:error|abort)\s*=\s*(rej|reject)\b\s*[;,)]/g;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if ([".ts", ".tsx"].includes(extname(name))) out.push(full);
  }
  return out;
}

describe("nenhuma promise rejeita com o Event cru", () => {
  it("todo onerror passa um Error com mensagem", () => {
    const offenders: string[] = [];

    for (const file of walk(SRC)) {
      if (file.includes("__tests__")) continue;
      const src = readFileSync(file, "utf8");
      src.split(/\r?\n/).forEach((line, i) => {
        BARE_REJECT.lastIndex = 0;
        if (BARE_REJECT.test(line)) offenders.push(`${file}:${i + 1} → ${line.trim()}`);
      });
    }

    expect(
      offenders,
      `Rejeitar com o Event cru vira "[object Event]" na tela. Use\n` +
        `  onerror = () => rej(new Error(\`… \${url}\`))\n\n` +
        offenders.join("\n"),
    ).toEqual([]);
  });
});
