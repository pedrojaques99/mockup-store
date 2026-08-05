import { describe, it, expect } from "vitest";
import { filtrarPsdsSumidos, psdsSumidosExato } from "../psd-presence";

/** Disco falso: só existe o que estiver nesta lista (comparação sem caso). */
const disco = (...caminhos: string[]) => {
  const set = new Set(caminhos.map((c) => c.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase()));
  return (p: string) => set.has(p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase());
};

const RAIZ = "H:/Acervo";
const doc = (id: string, psdPath?: string) => ({ id, psdPath });

describe("filtrarPsdsSumidos", () => {
  it("esconde o registro cuja pasta sumiu e mantém o resto", () => {
    const docs = [
      doc("viva", `${RAIZ}/Boa/a.psd`),
      doc("morta", `${RAIZ}/Apagada/b.psd`),
      doc("viva2", `${RAIZ}/Boa/c.psd`),
    ];
    const r = filtrarPsdsSumidos(docs, {
      raizes: [RAIZ],
      existe: disco(RAIZ, `${RAIZ}/Boa`),
    });

    expect(r.docs.map((d) => d.id)).toEqual(["viva", "viva2"]);
    expect(r.removidos).toBe(1);
    expect(r.pastasSumidas).toEqual([`${RAIZ}/Apagada`]);
    expect(r.abortadoPeloTeto).toBe(false);
  });

  it("registro sem psdPath passa intacto — cena de foto não tem arquivo", () => {
    const docs = [doc("cena"), doc("psd", `${RAIZ}/Boa/a.psd`)];
    const r = filtrarPsdsSumidos(docs, { raizes: [RAIZ], existe: disco(RAIZ, `${RAIZ}/Boa`) });
    expect(r.docs.map((d) => d.id)).toEqual(["cena", "psd"]);
    expect(r.removidos).toBe(0);
  });

  it("raiz inacessível é disco desmontado, não deleção: nada some", () => {
    // O H: não montou. TODO caminho embaixo dele falha o existsSync, e sem esta
    // regra a home abriria vazia — o pior desfecho possível.
    const docs = [doc("a", `${RAIZ}/X/a.psd`), doc("b", `${RAIZ}/Y/b.psd`)];
    const r = filtrarPsdsSumidos(docs, { raizes: [RAIZ], existe: disco(/* nada */) });

    expect(r.docs).toHaveLength(2);
    expect(r.removidos).toBe(0);
    expect(r.raizesOffline).toEqual([RAIZ]);
  });

  it("acima do teto de 50% não esconde nada, mesmo com a raiz de pé", () => {
    // Raiz responde, mas 3 de 4 pastas sumiram de uma vez. Sincronia do Drive
    // em curso é muito mais provável do que o usuário ter apagado 75% do acervo.
    const docs = [
      doc("a", `${RAIZ}/1/a.psd`),
      doc("b", `${RAIZ}/2/b.psd`),
      doc("c", `${RAIZ}/3/c.psd`),
      doc("d", `${RAIZ}/4/d.psd`),
    ];
    const r = filtrarPsdsSumidos(docs, { raizes: [RAIZ], existe: disco(RAIZ, `${RAIZ}/4`) });

    expect(r.docs).toHaveLength(4);
    expect(r.removidos).toBe(0);
    expect(r.abortadoPeloTeto).toBe(true);
  });

  it("exatamente no teto ainda filtra — o corte é acima de 50%", () => {
    const docs = [doc("a", `${RAIZ}/1/a.psd`), doc("b", `${RAIZ}/2/b.psd`)];
    const r = filtrarPsdsSumidos(docs, { raizes: [RAIZ], existe: disco(RAIZ, `${RAIZ}/2`) });
    expect(r.removidos).toBe(1);
    expect(r.abortadoPeloTeto).toBe(false);
  });

  it("cena de foto não entra na conta do teto", () => {
    // 1 PSD morto de 2 PSDs = 50%, não 1 de 5. Se as cenas contassem, o teto
    // ficaria frouxo justo no acervo que tem muita cena e pouco PSD.
    const docs = [
      doc("cena1"), doc("cena2"), doc("cena3"),
      doc("vivo", `${RAIZ}/Boa/a.psd`),
      doc("morto", `${RAIZ}/Ida/b.psd`),
    ];
    const r = filtrarPsdsSumidos(docs, { raizes: [RAIZ], existe: disco(RAIZ, `${RAIZ}/Boa`) });
    expect(r.removidos).toBe(1);
    expect(r.docs.map((d) => d.id)).toEqual(["cena1", "cena2", "cena3", "vivo"]);
  });

  it("aceita barra invertida do Windows nos dois lados", () => {
    const docs = [doc("a", "H:\\Acervo\\Boa\\a.psd"), doc("b", "H:\\Acervo\\Ida\\b.psd")];
    const r = filtrarPsdsSumidos(docs, { raizes: ["H:\\Acervo"], existe: disco(RAIZ, `${RAIZ}/Boa`) });
    expect(r.docs.map((d) => d.id)).toEqual(["a"]);
  });

  it("uma raiz offline não protege caminho de outra raiz que está de pé", () => {
    const docs = [doc("offline", "H:/Fora/x.psd"), doc("apagado", "Z:/Local/Ida/y.psd")];
    const r = filtrarPsdsSumidos(docs, {
      raizes: ["H:/Fora", "Z:/Local"],
      existe: disco("Z:/Local"),
    });
    expect(r.raizesOffline).toEqual(["H:/Fora"]);
    expect(r.docs.map((d) => d.id)).toEqual(["offline"]);
  });

  it("não chama o disco duas vezes pela mesma pasta", () => {
    const vistos: string[] = [];
    const base = disco(RAIZ, `${RAIZ}/Boa`);
    filtrarPsdsSumidos(
      [doc("a", `${RAIZ}/Boa/a.psd`), doc("b", `${RAIZ}/Boa/b.psd`), doc("c", `${RAIZ}/Boa/c.psd`)],
      { raizes: [RAIZ], existe: (p) => (vistos.push(p), base(p)) },
    );
    // 1 pela raiz + 1 pela pasta. Os 3 arquivos compartilham a mesma pasta, e é
    // esse cache que faz a checagem custar 280 ms em vez de 2.600 ms.
    expect(vistos.filter((p) => p === `${RAIZ}/Boa`)).toHaveLength(1);
  });
});

describe("psdsSumidosExato", () => {
  it("pega o arquivo apagado sozinho, com a pasta ainda de pé", () => {
    const docs = [doc("fica", `${RAIZ}/Boa/a.psd`), doc("sai", `${RAIZ}/Boa/b.psd`)];
    const { mortos } = psdsSumidosExato(docs, {
      raizes: [RAIZ],
      existe: disco(RAIZ, `${RAIZ}/Boa`, `${RAIZ}/Boa/a.psd`),
    });
    expect(mortos.map((d) => d.id)).toEqual(["sai"]);
  });

  it("também respeita raiz offline", () => {
    const docs = [doc("a", `${RAIZ}/Boa/a.psd`)];
    const { mortos, raizesOffline } = psdsSumidosExato(docs, { raizes: [RAIZ], existe: disco() });
    expect(mortos).toHaveLength(0);
    expect(raizesOffline).toEqual([RAIZ]);
  });
});
