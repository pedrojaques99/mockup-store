import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock do idb-keyval — sem IndexedDB real no node; só verificamos o contrato (debounce + guardas).
vi.mock("idb-keyval", () => ({
  get: vi.fn(),
  set: vi.fn(() => Promise.resolve()),
  del: vi.fn(() => Promise.resolve()),
}));

import { get, set, del } from "idb-keyval";
import { saveSession, loadSession, clearSession } from "../photoSession";

const DOC = { quad: null } as never; // DocState mínimo — o módulo só serializa, não inspeciona
const base = { uploadId: "0123456789abcdef", photoUrl: "/asset/photo", imgDims: { w: 100, h: 80 }, tool: "render", doc: DOC };

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});
afterEach(async () => {
  await clearSession(); // zera timer/pending do módulo entre testes
  vi.useRealTimers();
});

describe("saveSession", () => {
  it("debounces — uma escrita por rajada, com o último payload", () => {
    saveSession({ ...base, tool: "corners" });
    saveSession({ ...base, tool: "mask" });
    expect(set).not.toHaveBeenCalled();        // ainda nada antes do debounce
    vi.advanceTimersByTime(1200);
    expect(set).toHaveBeenCalledTimes(1);
    const [, payload] = (set as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(payload.tool).toBe("mask");          // venceu o mais recente
    expect(payload.v).toBe(1);
    expect(typeof payload.savedAt).toBe("number");
  });

  it("no-op sem uploadId", () => {
    saveSession({ ...base, uploadId: "" });
    vi.advanceTimersByTime(2000);
    expect(set).not.toHaveBeenCalled();
  });
});

describe("loadSession", () => {
  it("retorna a sessão quando o schema bate", async () => {
    (get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ v: 1, uploadId: "abc", doc: {} });
    expect(await loadSession()).toMatchObject({ uploadId: "abc" });
  });

  it("retorna null em schema antigo / vazio / corrompido", async () => {
    (get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ v: 0, uploadId: "abc", doc: {} });
    expect(await loadSession()).toBeNull();
    (get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);
    expect(await loadSession()).toBeNull();
    (get as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("idb fora"));
    expect(await loadSession()).toBeNull();
  });
});

describe("clearSession", () => {
  it("cancela a gravação pendente e apaga", async () => {
    saveSession(base);          // agenda
    await clearSession();       // cancela antes do debounce
    vi.advanceTimersByTime(2000);
    expect(set).not.toHaveBeenCalled();
    expect(del).toHaveBeenCalled();
  });
});
