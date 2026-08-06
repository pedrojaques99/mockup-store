import { describe, it, expect, vi, afterEach } from "vitest";
import { existsSync } from "fs";
import {
  paraPortavel,
  paraLocal,
  ehPortavel,
  raizes,
  resolver,
  normalizar,
} from "../psd-roots";

vi.mock("fs", () => ({ existsSync: vi.fn(() => false) }));
const mockExists = vi.mocked(existsSync);

afterEach(() => {
  mockExists.mockReset();
  mockExists.mockReturnValue(false);
});

const DIRS = "Z:/BOXY/Produtos,H:/Acervo";

describe("normalizar", () => {
  it("troca barra invertida e come a barra final", () => {
    expect(normalizar("Z:\\BOXY\\Produtos\\")).toBe("Z:/BOXY/Produtos");
  });
});

describe("raizes", () => {
  it("vem da mais longa para a mais curta — a ordem em que precisam ser testadas", () => {
    const r = raizes("H:/Acervo,Z:/BOXY/Produtos");
    expect(r.map((x) => x.caminho)).toEqual(["Z:/BOXY/Produtos", "H:/Acervo"]);
  });
});

describe("paraPortavel", () => {
  it("troca a raiz pela marca", () => {
    expect(paraPortavel("Z:/BOXY/Produtos/A5 Paper/A5 Paper Mockup - v1.psd", DIRS)).toBe(
      "{acervo}/A5 Paper/A5 Paper Mockup - v1.psd",
    );
  });

  it("aceita barra invertida do Windows", () => {
    expect(paraPortavel("Z:\\BOXY\\Produtos\\Sub\\x.psd", DIRS)).toBe("{acervo}/Sub/x.psd");
  });

  it("casa a raiz ignorando caixa — o Windows nao diferencia", () => {
    expect(paraPortavel("z:/boxy/produtos/x.psd", DIRS)).toBe("{acervo}/x.psd");
  });

  /**
   * Declarar pai E filha e o caso real (o `PSD_DIRS` desta maquina ja teve os
   * dois, e foi assim que TODO arquivo virou copia de si mesmo na deteccao de
   * duplicatas). Quem resolve e o `psdRoots`, que poda a filha: sobra `Z:/BOXY`,
   * e o relativo nasce a partir dele — nao a partir de `Produtos`.
   *
   * Sem a poda, o mesmo arquivo teria dois caminhos portateis conforme a ordem
   * do `PSD_DIRS`, e a deduplicacao por caminho passaria a CRIAR duplicata.
   */
  it("com pai e filha declaradas, o pai poda a filha e o relativo nasce dele", () => {
    const dirs = "Z:/BOXY,Z:/BOXY/Produtos";
    expect(paraPortavel("Z:/BOXY/Produtos/x.psd", dirs)).toBe("{acervo}/Produtos/x.psd");
  });

  /** Raizes irmas: cada arquivo casa a sua, e o relativo e relativo a ela. */
  it("com raizes irmas, cada arquivo casa a sua", () => {
    expect(paraPortavel("Z:/BOXY/Produtos/a.psd", DIRS)).toBe("{acervo}/a.psd");
    expect(paraPortavel("H:/Acervo/b.psd", DIRS)).toBe("{acervo}/b.psd");
  });

  it("fora de toda raiz continua absoluto, sem inventar raiz", () => {
    expect(paraPortavel("D:/Outro/x.psd", DIRS)).toBe("D:/Outro/x.psd");
  });

  it("e idempotente — portavel entra, portavel sai", () => {
    expect(paraPortavel("{acervo}/x.psd", DIRS)).toBe("{acervo}/x.psd");
  });

  it("nao casa raiz por prefixo parcial de nome de pasta", () => {
    // "Z:/BOXY/ProdutosVelhos" NAO e filho de "Z:/BOXY/Produtos"
    expect(paraPortavel("Z:/BOXY/ProdutosVelhos/x.psd", DIRS)).toBe(
      "Z:/BOXY/ProdutosVelhos/x.psd",
    );
  });
});

describe("paraLocal", () => {
  it("devolve a raiz onde o arquivo EXISTE, nao a primeira da lista", () => {
    mockExists.mockImplementation((p) => String(p) === "H:/Acervo/x.psd");
    expect(paraLocal("{acervo}/x.psd", DIRS)).toBe("H:/Acervo/x.psd");
  });

  it("sem achar em nenhuma, usa a primeira raiz — caminho plausivel no log", () => {
    expect(paraLocal("{acervo}/x.psd", DIRS)).toBe("Z:/BOXY/Produtos/x.psd");
  });

  /**
   * A garantia que permite nao migrar os 9 mil docs herdados: absoluto entra,
   * absoluto sai, sem passar por raiz nenhuma.
   */
  it("caminho absoluto antigo passa intocado", () => {
    expect(paraLocal("Z:/BOXY/Produtos/x.psd", DIRS)).toBe("Z:/BOXY/Produtos/x.psd");
  });

  it("sem PSD_DIRS devolve o relativo em vez de estourar", () => {
    expect(paraLocal("{acervo}/x.psd", "")).toBe("x.psd");
  });

  it("undefined atravessa", () => {
    expect(paraLocal(undefined, DIRS)).toBeUndefined();
  });
});

describe("ehPortavel", () => {
  it("distingue os dois formatos", () => {
    expect(ehPortavel("{acervo}/x.psd")).toBe(true);
    expect(ehPortavel("Z:/x.psd")).toBe(false);
    expect(ehPortavel(undefined)).toBe(false);
  });
});

describe("resolver", () => {
  it("existindo, nao chama a busca por nome", () => {
    mockExists.mockReturnValue(true);
    const busca = vi.fn();
    expect(resolver("Z:/BOXY/Produtos/x.psd", busca, DIRS)).toBe("Z:/BOXY/Produtos/x.psd");
    expect(busca).not.toHaveBeenCalled();
  });

  /**
   * O registro herdado aponta para a maquina de quem ingeriu. O arquivo quase
   * nunca sumiu: mudou de letra. A busca por nome e a mesma rede do psd:repoint.
   */
  it("nao existindo, cai na busca por nome dentro das raizes locais", () => {
    const busca = vi.fn(() => "H:/Acervo/Sub/x.psd");
    expect(resolver("Y:/Sumida/x.psd", busca, DIRS)).toBe("H:/Acervo/Sub/x.psd");
    expect(busca).toHaveBeenCalledWith("x.psd");
  });

  it("busca sem achar devolve o caminho resolvido, nao undefined", () => {
    expect(resolver("Y:/Sumida/x.psd", () => undefined, DIRS)).toBe("Y:/Sumida/x.psd");
  });

  it("sem funcao de busca, degrada para o caminho local", () => {
    expect(resolver("Y:/Sumida/x.psd", undefined, DIRS)).toBe("Y:/Sumida/x.psd");
  });
});
