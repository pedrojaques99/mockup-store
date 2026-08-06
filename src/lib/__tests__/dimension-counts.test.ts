import { describe, it, expect } from "vitest";
import { ordenar } from "../dimension-counts";

const linha = (dim: string, value: string, count: number) => ({ dim, value, count });

describe("ordenar", () => {
  it("contagem maior vem primeiro", () => {
    const r = ordenar([linha("a", "x", 1), linha("a", "y", 9), linha("a", "z", 5)]);
    expect(r.map((x) => x.value)).toEqual(["y", "z", "x"]);
  });

  /**
   * A REGRA QUE CUSTOU MEDIÇÃO. Sem desempate, o `$sort` do Mongo devolve
   * empate em ordem arbitraria e o corte no teto pega uns e larga outros: eram
   * 132 valores de cauda entrando num driver e nao no outro.
   */
  it("empate desempata pelo valor, de forma estavel", () => {
    const r = ordenar([linha("a", "c", 1), linha("a", "a", 1), linha("a", "b", 1)]);
    expect(r.map((x) => x.value)).toEqual(["a", "b", "c"]);
  });

  /**
   * E o desempate e por CODIGO, nao por `localeCompare`, para casar com o
   * `$sort` do Mongo (que ordena string por byte). Com `localeCompare` ainda
   * sobravam 104 divergencias, porque maiuscula e minuscula se misturam numa
   * regra e nao na outra. Aqui a maiuscula vem antes, como no Mongo.
   */
  it("desempate e por codigo (byte), nao por regra de idioma", () => {
    const r = ordenar([linha("a", "banana", 1), linha("a", "Banana", 1)]);
    expect(r.map((x) => x.value)).toEqual(["Banana", "banana"]);
    // A prova de que as duas regras discordam mesmo: se fosse localeCompare,
    // "banana" viria primeiro em pt-BR.
    expect("banana".localeCompare("Banana")).toBeLessThan(0);
  });

  it("corta no teto de 2000", () => {
    const muitas = Array.from({ length: 2500 }, (_, i) => linha("a", `v${i}`, 1));
    expect(ordenar(muitas)).toHaveLength(2000);
  });
});
