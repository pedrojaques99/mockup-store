import { describe, it, expect } from "vitest";
import { pathOrigin } from "../path-origin";

describe("pathOrigin", () => {
  it("reconhece disco local", () => {
    const o = pathOrigin("Z:/BOXY/Produtos/mockup.psd");
    expect(o.kind).toBe("local");
    expect(o.safeToDelete).toBe(true);
  });

  it("reconhece o Meu Drive do próprio usuário", () => {
    const o = pathOrigin("H:/Meu Drive/ASSETS VISANT/x.psd");
    expect(o.kind).toBe("meu-drive");
    expect(o.safeToDelete).toBe(true);
  });

  it("marca atalho do Drive como compartilhado e NÃO apagável", () => {
    // Apagar por aqui apaga na conta do dono, para todo mundo.
    const o = pathOrigin("H:/.shortcut-targets-by-id/1Dx_uPec/[ MOCKUPS 1.0 ]/a.psd");
    expect(o.kind).toBe("compartilhado");
    expect(o.safeToDelete).toBe(false);
  });

  it("reconhece drive compartilhado montado, em PT e EN", () => {
    expect(pathOrigin("G:/Drives compartilhados/Time/a.psd").kind).toBe("compartilhado");
    expect(pathOrigin("G:/Shared drives/Team/a.psd").kind).toBe("compartilhado");
  });

  it("aceita barra invertida do Windows", () => {
    expect(pathOrigin("H:\\Meu Drive\\ASSETS\\a.psd").kind).toBe("meu-drive");
  });

  it("não quebra com caminho vazio", () => {
    expect(pathOrigin("").kind).toBe("local");
  });
});
