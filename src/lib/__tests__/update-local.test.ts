import { describe, it, expect } from "vitest";
import { requisicaoLocal } from "../update";

/**
 * O portão da rota que roda `git merge` e `npm ci`.
 *
 * Ele precisa dizer NÃO para a rede e SIM para a própria máquina. A primeira
 * versão dizia não para os dois: recusava qualquer requisição com
 * `x-forwarded-for`, e o Next põe esse header sozinho — o botão de atualizar
 * nunca funcionou, e o 403 sujava o console de toda visita.
 *
 * Por isso os dois lados estão travados aqui: um teste só do "recusa a rede"
 * teria passado com o bug em pé.
 */
const h = (o: Record<string, string>) => new Headers(o);

describe("requisicaoLocal", () => {
  it("aceita o que o Next dev entrega de verdade (XFF de loopback)", () => {
    // Medido no `next dev`: host + os quatro x-forwarded-*.
    expect(
      requisicaoLocal(
        h({
          host: "localhost:4100",
          "x-forwarded-for": "::1",
          "x-forwarded-host": "localhost:4100",
          "x-forwarded-port": "4100",
          "x-forwarded-proto": "http",
        })
      )
    ).toBe(true);
  });

  it("aceita as formas de loopback", () => {
    for (const xff of ["::1", "127.0.0.1", "::ffff:127.0.0.1", "0:0:0:0:0:0:0:1", "[::1]"]) {
      expect(requisicaoLocal(h({ host: "localhost:4100", "x-forwarded-for": xff }))).toBe(true);
    }
    expect(requisicaoLocal(h({ host: "127.0.0.1:3000" }))).toBe(true);
    expect(requisicaoLocal(h({ host: "[::1]:3000" }))).toBe(true);
  });

  it("recusa quando o cliente ORIGINAL não é local, mesmo com proxy local no fim", () => {
    // O primeiro da lista é quem chamou; o resto são os proxies atravessados.
    expect(
      requisicaoLocal(h({ host: "localhost:4100", "x-forwarded-for": "203.0.113.7, ::1" }))
    ).toBe(false);
    expect(requisicaoLocal(h({ host: "localhost:4100", "x-forwarded-for": "10.0.0.5" }))).toBe(false);
  });

  it("recusa host que não é local", () => {
    expect(requisicaoLocal(h({ host: "mockups.exemplo.com" }))).toBe(false);
    expect(requisicaoLocal(h({ host: "192.168.0.10:4100", "x-forwarded-for": "::1" }))).toBe(false);
    expect(requisicaoLocal(h({}))).toBe(false);
  });

  it("não se deixa enganar por espaço e caixa", () => {
    expect(requisicaoLocal(h({ host: "LOCALHOST:4100", "x-forwarded-for": "  ::1 , 10.0.0.1" }))).toBe(true);
  });
});
