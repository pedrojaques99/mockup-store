import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, extname } from "path";

/**
 * Guarda de regressão: nenhuma classe utilitária inventada.
 *
 * Motivo real, não hipotético. Este repo rodou meses com `animate-in` (22×),
 * `fade-in` (12×), `slide-in-from-*` (10×), `zoom-in-*` (6×), `no-scrollbar`
 * (7×) e `animate-progress-indefinite` (2×) — **nenhuma delas existia em
 * stylesheet nenhum**. Tailwind v4 não traz essas utilities e o plugin nunca foi
 * instalado. Classe é string: nada no `tsc`, no ESLint ou nos testes de unidade
 * olha para ela. O código descrevia uma UI animada e a UI entregue não tinha
 * nenhuma dessas transições; as duas barras de progresso "indeterminadas" eram
 * retângulos parados durante as operações mais longas do produto.
 *
 * O teste lê a FONTE (as classes usadas) contra o CSS que realmente será
 * compilado (`globals.css` + os pacotes que ele importa). É a única camada capaz
 * de pegar esta classe de defeito.
 */

const SRC = "src";
const GLOBALS = "src/app/globals.css";

/** Utilities de animação que a própria Tailwind v4 traz no core. */
const TAILWIND_CORE_ANIMATE = new Set([
  "animate-none",
  "animate-spin",
  "animate-ping",
  "animate-pulse",
  "animate-bounce",
]);

/**
 * Famílias que já causaram o defeito. Deliberadamente estreito: um teste que
 * tentasse validar TODA classe do Tailwind viraria uma reimplementação do
 * compilador e quebraria a cada release.
 */
const GUARDED = /^(animate-[a-z0-9-]+|no-scrollbar|fade-(?:in|out)(?:-[a-z0-9-]+)?|slide-(?:in|out)-[a-z0-9-]+|zoom-(?:in|out)(?:-[a-z0-9-]+)?|spin-(?:in|out)(?:-[a-z0-9-]+)?)$/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    // `__tests__` fica de fora ou este próprio arquivo, que cita as classes na
    // documentação, entraria no levantamento como se fossem uso real.
    if (name === "node_modules" || name === ".next" || name === "__tests__") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if ([".tsx", ".ts", ".jsx", ".js"].includes(extname(name))) out.push(p);
  }
  return out;
}

/** globals.css + o CSS de cada pacote que ele importa. */
function availableCss(): string {
  const globals = readFileSync(GLOBALS, "utf8");
  let css = globals;
  for (const m of globals.matchAll(/@import\s+["']([^"']+)["']/g)) {
    const pkg = m[1];
    if (pkg === "tailwindcss") continue; // core, coberto pela lista acima
    try {
      // Resolve o entry de CSS pelo `exports`/`style`/`main`. O `exports["."]`
      // costuma ser um OBJETO (`{ style: "./dist/x.css" }`), não uma string —
      // tratar só o caso string faz o pacote inteiro ser ignorado em silêncio e
      // o teste acusar como órfã uma classe que existe. Foi o que aconteceu.
      const pkgJson = JSON.parse(readFileSync(`node_modules/${pkg}/package.json`, "utf8"));
      const dot = pkgJson.exports?.["."] ?? pkgJson.exports;
      const entry =
        (typeof dot === "string" ? dot : (dot?.style ?? dot?.default ?? dot?.import)) ??
        pkgJson.style ??
        pkgJson.main;
      if (typeof entry === "string") css += readFileSync(join("node_modules", pkg, entry), "utf8");
    } catch {
      // Pacote sem CSS resolvível não contribui — e então a classe falha o
      // teste, que é exatamente o comportamento desejado.
    }
  }
  return css;
}

/**
 * A classe existe no CSS disponível?
 *
 * `@utility slide-in-from-top-*` cobre `slide-in-from-top-1`, então o teste
 * também testa os prefixos progressivos — senão daria falso negativo em toda
 * utility com valor arbitrário.
 */
function isDeclared(cls: string, css: string): boolean {
  // Declaração exata. O delimitador importa: `@utility fade-in{` e
  // `@utility fade-in ` são a mesma coisa, mas um `includes("@utility fade-in")`
  // solto também casaria com `@utility fade-in-*`, que é OUTRA utility.
  if (new RegExp(`@utility\\s+${escapeRe(cls)}\\s*[{\\s]`).test(css)) return true;
  if (new RegExp(`\\.${escapeRe(cls)}(?![a-zA-Z0-9_-])`).test(css)) return true;

  // Utility gerada por theme variable. Na Tailwind v4 um `--animate-in:` dentro
  // de `@theme` PRODUZ a classe `animate-in` — é assim que a tw-animate-css
  // declara `animate-in`/`animate-out`, e sem esta linha a guarda acusaria como
  // órfã justamente a classe que motivou a guarda.
  if (new RegExp(`--${escapeRe(cls)}\\s*:`).test(css)) return true;

  // Forma coringa da Tailwind v4 (`@utility slide-in-from-top-*` cobre
  // `slide-in-from-top-1`). Só a forma com `-*` conta: aceitar qualquer
  // `@utility <prefixo>-` transformava a guarda num carimbo — `animate-*`
  // existente aprovava `animate-qualquer-coisa-inventada`, e a sonda de
  // regressão passou batido por causa disso.
  const parts = cls.split("-");
  for (let i = parts.length - 1; i > 0; i--) {
    const prefix = parts.slice(0, i).join("-");
    if (new RegExp(`@utility\\s+${escapeRe(prefix)}-\\*`).test(css)) return true;
  }
  return false;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

describe("classes utilitárias customizadas", () => {
  const css = availableCss();
  const used = new Map<string, string[]>();

  for (const file of walk(SRC)) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/[\s"'`{]([a-z][a-z0-9-]{2,})(?=[\s"'`}])/g)) {
      const cls = m[1];
      if (!GUARDED.test(cls)) continue;
      const at = used.get(cls) ?? [];
      at.push(file);
      used.set(cls, at);
    }
  }

  it("encontra as classes de animação em uso (o teste está mesmo olhando)", () => {
    expect(used.size).toBeGreaterThan(3);
  });

  it("toda classe de animação usada existe no CSS compilado", () => {
    const orphans: string[] = [];
    for (const [cls, files] of used) {
      if (TAILWIND_CORE_ANIMATE.has(cls)) continue;
      if (isDeclared(cls, css)) continue;
      orphans.push(`${cls}  ← ${[...new Set(files)].slice(0, 3).join(", ")}`);
    }
    expect(
      orphans,
      `Classes usadas que NÃO existem em stylesheet nenhum (falham em silêncio):\n${orphans.join("\n")}`,
    ).toEqual([]);
  });
});
