import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  normalizarCaminho,
  extrairIdDrive,
  ehUrlDrive,
  pastaPai,
  listarPastas,
  statCaminho,
  resolverUrlDrive,
} from "../fs-browse";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const DIR = join(tmpdir(), "mockup-store-browse-" + process.pid).replace(/\\/g, "/");

beforeAll(() => {
  mkdirSync(join(DIR, "Layouts"), { recursive: true });
  mkdirSync(join(DIR, "Logos"), { recursive: true });
  mkdirSync(join(DIR, ".oculta"), { recursive: true });
  writeFileSync(join(DIR, "a.psd"), "");
});

afterAll(() => {
  rmSync(DIR, { recursive: true, force: true });
});

describe("normalizarCaminho", () => {
  it("troca barra invertida e tira a barra final", () => {
    expect(normalizarCaminho("Z:\\BOXY\\Produtos\\")).toBe("Z:/BOXY/Produtos");
  });
});

describe("pastaPai", () => {
  it("sobe um nível", () => {
    expect(pastaPai("Z:/BOXY/Produtos")).toBe("Z:/BOXY");
  });

  it("para na raiz da unidade", () => {
    expect(pastaPai("Z:/")).toBeNull();
    expect(pastaPai("Z:")).toBeNull();
  });
});

describe("listarPastas", () => {
  it("devolve só diretórios, ordenados, sem ocultos", () => {
    const nomes = listarPastas(DIR).map((d) => d.nome);
    expect(nomes).toEqual(["Layouts", "Logos"]);
  });

  it("pasta inexistente devolve vazio em vez de estourar", () => {
    expect(listarPastas(join(DIR, "nao-existe"))).toEqual([]);
  });
});

describe("statCaminho", () => {
  it("reconhece pasta e conta as entradas", () => {
    const r = statCaminho(DIR);
    expect(r.existe).toBe(true);
    expect(r.ehPasta).toBe(true);
    expect(r.entradas).toBe(4);
  });

  it("reconhece arquivo como não-pasta", () => {
    const r = statCaminho(join(DIR, "a.psd"));
    expect(r.existe).toBe(true);
    expect(r.ehPasta).toBe(false);
  });

  it("caminho inexistente não estoura", () => {
    expect(statCaminho(join(DIR, "nada")).existe).toBe(false);
  });
});

describe("extrairIdDrive", () => {
  it("pega o ID da URL de pasta", () => {
    expect(
      extrairIdDrive("https://drive.google.com/drive/folders/1Dx_uPec62b4ddACJYlRsdWqQlHyfMhPY"),
    ).toBe("1Dx_uPec62b4ddACJYlRsdWqQlHyfMhPY");
  });

  it("pega o ID com parâmetros na frente", () => {
    expect(
      extrairIdDrive(
        "https://drive.google.com/drive/folders/1Dx_uPec62b4ddACJYlRsdWqQlHyfMhPY?usp=sharing",
      ),
    ).toBe("1Dx_uPec62b4ddACJYlRsdWqQlHyfMhPY");
  });

  it("pega o ID no formato ?id=", () => {
    expect(extrairIdDrive("https://drive.google.com/open?id=1Dx_uPec62b4ddACJYlRsdWqQ")).toBe(
      "1Dx_uPec62b4ddACJYlRsdWqQ",
    );
  });

  it("devolve null quando não há ID", () => {
    expect(extrairIdDrive("https://drive.google.com/drive/my-drive")).toBeNull();
    expect(extrairIdDrive("Z:/BOXY/Produtos")).toBeNull();
  });
});

describe("ehUrlDrive", () => {
  it("separa link do Drive de caminho local", () => {
    expect(ehUrlDrive("https://drive.google.com/drive/folders/abc")).toBe(true);
    expect(ehUrlDrive("Z:/BOXY/Produtos")).toBe(false);
  });
});

describe("resolverUrlDrive", () => {
  it("explica quando o link não tem ID, em vez de falhar mudo", () => {
    const r = resolverUrlDrive("https://drive.google.com/drive/my-drive");
    expect(r.ok).toBe(false);
    expect(r.motivo).toMatch(/ID/i);
  });

  it("diz o que fazer quando o ID não está montado nesta máquina", () => {
    const r = resolverUrlDrive("https://drive.google.com/drive/folders/naoMontado1234567890xyz");
    expect(r.ok).toBe(false);
    expect(r.motivo).toMatch(/caminho local/i);
  });
});
