import { describe, it, expect } from "vitest";
import { readError } from "../http-error";

/** Response falsa: só o que o `readError` toca. */
function res(body: string, status = 500): Response {
  return {
    status,
    text: async () => body,
  } as unknown as Response;
}

describe("readError", () => {
  it("corpo VAZIO devolve o status, nunca estoura", async () => {
    // O caso que produziu "SyntaxError: Unexpected end of JSON input" na tela.
    await expect(readError(res("", 500))).resolves.toBe("HTTP 500");
  });

  it("corpo JSON devolve o campo error", async () => {
    await expect(readError(res(JSON.stringify({ error: "PSD não encontrado" }), 404))).resolves.toBe(
      "PSD não encontrado",
    );
  });

  it("aceita `message` quando não há `error`", async () => {
    await expect(readError(res(JSON.stringify({ message: "sem permissão" }), 403))).resolves.toBe(
      "sem permissão",
    );
  });

  it("texto puro (proxy, gateway) vira a mensagem", async () => {
    await expect(readError(res("upstream timeout", 504))).resolves.toBe("upstream timeout");
  });

  it("HTML NÃO vira mensagem — o status diz mais em menos", async () => {
    const html = "<!DOCTYPE html><html><head><title>Error</title></head><body>…</body></html>";
    await expect(readError(res(html, 502))).resolves.toBe("HTTP 502");
  });

  it("JSON sem campo de mensagem cai no fallback, não no objeto cru", async () => {
    await expect(readError(res(JSON.stringify({ ok: false }), 400), "não deu")).resolves.toBe("não deu");
  });

  it("mensagem gigante é truncada (toast não é log)", async () => {
    const msg = "x".repeat(500);
    await expect(readError(res(JSON.stringify({ error: msg })))).resolves.toHaveLength(200);
  });

  it("`text()` que rejeita não derruba o chamador", async () => {
    const quebrada = { status: 503, text: async () => { throw new Error("stream fechado"); } } as unknown as Response;
    await expect(readError(quebrada)).resolves.toBe("HTTP 503");
  });
});
