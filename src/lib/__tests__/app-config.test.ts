import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  lerConfig, gravarConfig, invalidarConfig, valorChave, mascarar,
  pastasAcervo, portaRender, aplicarConfigNoProcesso, caminhoConfig, _resetInjecoes,
} from "../app-config";

const dir = mkdtempSync(join(tmpdir(), "boxy-cfg-"));
process.env.APP_CONFIG_PATH = join(dir, "config.json");

const LIMPAR = ["OPENAI_API_KEY", "GEMINI_API_KEY", "PSD_DIRS", "RENDER_PORT"];

beforeEach(() => {
  for (const k of LIMPAR) delete process.env[k];
  if (existsSync(caminhoConfig())) rmSync(caminhoConfig());
  invalidarConfig();
  _resetInjecoes();
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("precedencia: o ambiente vence a config", () => {
  it("com env e config, o env ganha e a origem diz isso", () => {
    gravarConfig({ chaves: { OPENAI_API_KEY: "do-arquivo" } });
    process.env.OPENAI_API_KEY = "do-ambiente";
    invalidarConfig();
    expect(valorChave("OPENAI_API_KEY")).toEqual({ valor: "do-ambiente", origem: "env" });
  });

  it("so config, a config vale", () => {
    gravarConfig({ chaves: { OPENAI_API_KEY: "do-arquivo" } });
    expect(valorChave("OPENAI_API_KEY")).toEqual({ valor: "do-arquivo", origem: "config" });
  });

  it("nenhum dos dois: ausente, sem valor", () => {
    expect(valorChave("OPENAI_API_KEY")).toEqual({ origem: "ausente" });
  });

  /**
   * O env VAZIO nao pode contar como definido: `OPENAI_API_KEY=` no .env.local
   * e o estado normal do arquivo recem-copiado do exemplo. Se contasse, a chave
   * salva no painel ficaria eternamente sobreposta por uma string vazia.
   */
  it("env vazio nao sobrepoe a config", () => {
    gravarConfig({ chaves: { OPENAI_API_KEY: "do-arquivo" } });
    process.env.OPENAI_API_KEY = "   ";
    invalidarConfig();
    expect(valorChave("OPENAI_API_KEY").origem).toBe("config");
  });
});

describe("gravarConfig e MERGE, nunca overwrite", () => {
  /**
   * Regressao com nome: neste projeto, escrita por overwrite num arquivo de
   * SSoT ja apagou o estudio de cenas em producao. Aqui o mesmo mecanismo
   * apagaria a chave que a outra secao do painel acabou de salvar.
   */
  it("gravar uma chave preserva as outras", () => {
    gravarConfig({ chaves: { OPENAI_API_KEY: "a" } });
    gravarConfig({ chaves: { GEMINI_API_KEY: "b" } });
    const cfg = lerConfig();
    expect(cfg.chaves).toEqual({ OPENAI_API_KEY: "a", GEMINI_API_KEY: "b" });
  });

  it("gravar chave preserva as pastas", () => {
    gravarConfig({ psdDirs: ["Z:/A"] });
    gravarConfig({ chaves: { OPENAI_API_KEY: "a" } });
    expect(lerConfig().psdDirs).toEqual(["Z:/A"]);
  });

  it("string vazia APAGA a chave em vez de gravar vazio", () => {
    gravarConfig({ chaves: { OPENAI_API_KEY: "a" } });
    gravarConfig({ chaves: { OPENAI_API_KEY: "" } });
    expect(lerConfig().chaves?.OPENAI_API_KEY).toBeUndefined();
  });

  it("grava JSON legivel no caminho configurado", () => {
    gravarConfig({ renderPort: 4300 });
    expect(JSON.parse(readFileSync(caminhoConfig(), "utf8"))).toMatchObject({ versao: 1, renderPort: 4300 });
  });
});

describe("config ilegivel nao derruba o app", () => {
  it("JSON quebrado cai no padrao em vez de estourar", () => {
    writeFileSync(caminhoConfig(), "{ isto nao e json");
    invalidarConfig();
    expect(lerConfig()).toEqual({ versao: 1 });
  });
});

describe("mascarar", () => {
  it("mostra pontas e esconde o miolo", () => {
    expect(mascarar("sk-proj-abcdefghijklmnop")).toBe("sk-p••••••mnop");
  });

  /** Mostrar 6 de 8 caracteres nao e mascara, e vazamento. */
  it("chave curta vira so pontos", () => {
    expect(mascarar("curta123")).toBe("••••••••");
  });
});

describe("pastas e porta", () => {
  it("PSD_DIRS do env vence e e separado por virgula", () => {
    gravarConfig({ psdDirs: ["Z:/DoArquivo"] });
    process.env.PSD_DIRS = "Z:/A, H:/B";
    invalidarConfig();
    expect(pastasAcervo()).toEqual({ valor: ["Z:/A", "H:/B"], origem: "env" });
  });

  it("sem env, usa a config", () => {
    gravarConfig({ psdDirs: ["Z:/DoArquivo"] });
    expect(pastasAcervo()).toEqual({ valor: ["Z:/DoArquivo"], origem: "config" });
  });

  it("porta cai no padrao 4200 quando ninguem diz", () => {
    expect(portaRender()).toEqual({ valor: 4200, origem: "ausente" });
  });
});

describe("aplicarConfigNoProcesso", () => {
  it("injeta no process.env o que so existe na config", () => {
    gravarConfig({ chaves: { OPENAI_API_KEY: "do-arquivo" }, psdDirs: ["Z:/A", "H:/B"] });
    const { aplicadas } = aplicarConfigNoProcesso();
    expect(process.env.OPENAI_API_KEY).toBe("do-arquivo");
    expect(process.env.PSD_DIRS).toBe("Z:/A,H:/B");
    expect(aplicadas).toContain("OPENAI_API_KEY");
  });

  /** A precedencia tem de sobreviver a injecao — senao o arquivo venceria o env. */
  it("NUNCA sobrescreve o que ja veio do ambiente", () => {
    process.env.OPENAI_API_KEY = "do-ambiente";
    gravarConfig({ chaves: { OPENAI_API_KEY: "do-arquivo" } });
    aplicarConfigNoProcesso();
    expect(process.env.OPENAI_API_KEY).toBe("do-ambiente");
  });

  /**
   * REGRESSAO, pega pelo portao de ship: depois de injetada, a chave do painel
   * ficava indistinguivel de uma variavel real e a origem voltava `env` — a tela
   * dizia "definido no .env.local, o arquivo vence o painel" para uma chave que
   * a pessoa tinha ACABADO de digitar ali. O painel travava sozinho.
   */
  it("chave injetada por nos continua tendo origem 'config'", () => {
    gravarConfig({ chaves: { OPENAI_API_KEY: "do-painel" } });
    aplicarConfigNoProcesso();
    expect(process.env.OPENAI_API_KEY).toBe("do-painel"); // o SDK enxerga
    expect(valorChave("OPENAI_API_KEY").origem).toBe("config"); // a tela nao mente
  });

  it("o mesmo vale para as pastas do acervo", () => {
    gravarConfig({ psdDirs: ["Z:/A"] });
    aplicarConfigNoProcesso();
    expect(pastasAcervo().origem).toBe("config");
  });
});
