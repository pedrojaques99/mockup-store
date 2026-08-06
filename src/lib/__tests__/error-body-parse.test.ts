import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, extname } from "path";

/**
 * Guarda de regressão: nenhum caminho de ERRO faz `res.json()` desprotegido.
 *
 * Motivo real, medido em 06/08/2026. O `Gerar PNG` fazia
 *
 *   if (!res.ok) { const err = await res.json(); … }
 *
 * e a resposta de erro veio SEM CORPO — que é o que o Next devolve para qualquer
 * exceção não tratada num route handler. O parse estourou dentro do `try`, e o
 * `catch` de fora pintou na tela **"SyntaxError: Unexpected end of JSON input"**:
 * a mensagem do parser em cima do erro real, que ficou invisível. O usuário foi
 * caçar bug de JSON num problema de tamanho de arte.
 *
 * Isto é um PADRÃO, não um valor. `tsc` aceita (`json()` devolve `Promise<any>`),
 * o ESLint aceita, e nenhum teste de unidade exercita o corpo de erro vazio —
 * justamente porque em desenvolvimento, com tudo de pé, ele quase nunca aparece.
 * Ler a fonte é a única camada que pega.
 *
 * Correção sempre igual, e a ORDEM é metade dela:
 *
 *   if (!r.ok) throw new Error(await readError(r));   // corpo do erro
 *   const d = await r.json();                          // corpo do sucesso
 *
 * `.json()`/`.text()` consomem o corpo: parsear antes do `ok` gasta o do sucesso.
 * `readError` mora em `src/lib/http-error.ts`.
 *
 * `.catch(...)` colado no `.json()` também passa — é o idioma que algumas telas
 * já usavam à mão, e ele resolve o mesmo problema.
 */

const SRC = "src";

/** `if (!x.ok)` na MESMA linha de um `await y.json()` sem `.catch`. */
const NA_MESMA_LINHA = /!\s*\w+\.ok\b[^\n]*\bawait\s+\w+\.json\(\)(?!\s*\.catch)/;
/** `const d = await x.json()` — sem `.catch` — com o `!x.ok` logo abaixo. */
const PARSE_ANTES = /(?:const|let)\s+\w+\s*=\s*\(?\s*await\s+(\w+)\.json\(\)(?!\s*\.catch)/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if ([".ts", ".tsx"].includes(extname(name))) out.push(full);
  }
  return out;
}

describe("caminho de erro não parseia corpo às cegas", () => {
  it("nenhum res.json() desprotegido decide sobre uma resposta que falhou", () => {
    const offenders: string[] = [];

    for (const file of walk(SRC)) {
      if (file.includes("__tests__")) continue;
      const linhas = readFileSync(file, "utf8").split(/\r?\n/);

      linhas.forEach((linha, i) => {
        if (NA_MESMA_LINHA.test(linha)) {
          offenders.push(`${file}:${i + 1} → ${linha.trim()}`);
          return;
        }
        const m = linha.match(PARSE_ANTES);
        if (!m) return;
        /* O parse só é do caminho de erro se o `!ok` vier logo depois. Duas linhas
         * de janela: o `if` costuma estar na seguinte, e às vezes há um comentário
         * no meio. Janela maior começaria a acusar parse legítimo de sucesso. */
        const janela = `${linhas[i + 1] ?? ""}\n${linhas[i + 2] ?? ""}`;
        if (new RegExp(`!\\s*${m[1]}\\.ok\\b`).test(janela)) {
          offenders.push(`${file}:${i + 1} → ${linha.trim()}`);
        }
      });
    }

    expect(
      offenders,
      `Resposta de erro sem corpo faz o parse estourar, e a tela mostra\n` +
        `"SyntaxError: Unexpected end of JSON input" no lugar do motivo. Use:\n\n` +
        `  if (!r.ok) throw new Error(await readError(r));\n` +
        `  const d = await r.json();\n\n` +
        `(readError em src/lib/http-error.ts)\n\n` +
        offenders.join("\n"),
    ).toEqual([]);
  });
});
