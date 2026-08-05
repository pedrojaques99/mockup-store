import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, extname } from "path";
import { ACC, ACC2, ACC_RGB, ACC2_RGB, INK } from "@/lib/brand";

/**
 * Guarda de regressão: a marca BOXY® não se desfaz em pedaços.
 *
 * Motivo real, não hipotético. Quando o app trocou o acento genérico pela paleta
 * da BOXY, os ~141 usos que passavam por TOKEN (`bg-acc2`, `text-acc`…) mudaram
 * de graça — e os 11 que estavam chapados em canvas NÃO. `ctx.strokeStyle` e
 * `style={{ }}` só falam hex, então cada tool (Luz, Crop, Pen, Segment, Zoom,
 * Brush) tinha o seu literal, sozinho no seu arquivo. O resultado é o pior tipo
 * de defeito visual: a tela fica MEIO pintada, cada pedaço parece intencional, e
 * ninguém percebe porque nada quebra.
 *
 * Duas invariantes, as duas capazes de pegar isso sozinhas:
 *   1. `lib/brand.ts` e o `@theme` de `globals.css` são espelho. Um valor que
 *      mude só de um lado cria dois donos para a mesma decisão.
 *   2. Nenhum acento APOSENTADO sobrevive em src. Se voltar, é regressão.
 */

const SRC = "src";
const GLOBALS = "src/app/globals.css";

/** Hex dos acentos que o app já usou e abandonou ao adotar a paleta da BOXY. */
const RETIRED = [
  { hex: "#3df27e", what: "verde genérico (antigo --color-acc2)" },
  { hex: "#22d3ee", what: "ciano (antigo --color-acc)" },
  { hex: "#67e8f9", what: "ciano claro (alça da caneta)" },
  { hex: "#f5f4f0", what: "off-white genérico (antigo --color-ink)" },
];

/** Os mesmos, na forma "r,g,b" — como aparecem dentro de `rgba(...)` e de tints. */
const RETIRED_RGB = ["61,242,126", "34,211,238", "103,232,249"];

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if ([".ts", ".tsx"].includes(extname(p))) out.push(p);
  }
  return out;
}

/** Lê um custom property do bloco `@theme` do globals.css. */
function themeVar(css: string, name: string): string | null {
  const m = css.match(new RegExp(`--color-${name}\\s*:\\s*([^;]+);`));
  return m ? m[1].trim().toLowerCase() : null;
}

describe("tokens da marca BOXY", () => {
  const css = readFileSync(GLOBALS, "utf8");

  it("lib/brand.ts espelha o @theme de globals.css", () => {
    expect(themeVar(css, "acc")).toBe(ACC);
    expect(themeVar(css, "acc2")).toBe(ACC2);
    expect(themeVar(css, "ink")).toBe(INK);
  });

  it("as formas RGB batem com os hex correspondentes", () => {
    const toRgb = (hex: string) =>
      [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(",");
    expect(ACC_RGB).toBe(toRgb(ACC));
    expect(ACC2_RGB).toBe(toRgb(ACC2));
  });

  it("nenhum acento aposentado sobrevive em src", () => {
    /* Fora da varredura: `__tests__`. Fixture legitimamente carrega hex que por
     * acaso coincide com um acento aposentado — `art-classify.test.ts` usa
     * `#f5f4f0` como a cor da BORDA de uma arte sendo classificada, e isso não
     * tem nada a ver com a paleta da UI. Guarda que grita em dado de teste vira
     * guarda que alguém desliga. */
    const files = walk(SRC).filter((f) => !f.includes("__tests__"));
    const offenders: string[] = [];

    for (const file of files) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        // Linha de comentário é documentação: pode nomear a cor antiga.
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
        for (const { hex, what } of RETIRED) {
          if (line.toLowerCase().includes(hex)) {
            offenders.push(`${file}:${i + 1} — ${hex} (${what})`);
          }
        }
        for (const rgb of RETIRED_RGB) {
          if (line.replace(/\s+/g, "").includes(rgb)) {
            offenders.push(`${file}:${i + 1} — rgb ${rgb} aposentado`);
          }
        }
      });
    }

    expect(offenders, `acento fora da paleta BOXY:\n  ${offenders.join("\n  ")}`).toEqual([]);
  });

  it("o logo é ARQUIVO, nunca vetor redesenhado no componente", () => {
    /* Regra de marca, e já foi quebrada aqui uma vez: a primeira versão do
     * `BoxyMark` compunha o símbolo na mão — um `<rect>` com o raio que eu
     * escolhi e a estrela transladada/escalada até "bater no olho". Bater no
     * olho não é a marca: vira uma variante não-autorizada que depois vaza para
     * peça impressa. O componente só pode APONTAR para o arquivo oficial. */
    const mark = readFileSync("src/components/BoxyMark.tsx", "utf8");

    expect(mark, "BoxyMark não pode conter vetor inline — use o arquivo oficial")
      .not.toMatch(/<path\s|<rect\s|<circle\s|<polygon\s/);

    const refs = [...mark.matchAll(/src="(\/brand\/[^"]+)"/g)].map((m) => m[1]);
    expect(refs.length, "BoxyMark deve referenciar arquivo de /brand").toBeGreaterThan(0);

    for (const ref of refs) {
      const onDisk = join("public", ref.replace(/^\//, ""));
      expect(
        () => readFileSync(onDisk),
        `${ref} é referenciado mas não existe em public/`,
      ).not.toThrow();
    }
  });

  it("o verde da BOXY é claro — quem escrever texto branco em cima erra", () => {
    // Não é gosto: relative luminance alta ⇒ branco em cima reprova em contraste.
    const lin = (c: number) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    const lum = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    };
    const contrast = (a: number, b: number) =>
      (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

    const white = lum("#ffffff");
    const near_black = lum("#161616");

    // Branco sobre o verde BOXY reprova; quase-preto passa com folga.
    expect(contrast(lum(ACC2), white)).toBeLessThan(3);
    expect(contrast(lum(ACC2), near_black)).toBeGreaterThan(4.5);
  });
});
