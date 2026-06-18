import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("sonner", () => {
  const toast = Object.assign(vi.fn(), {
    loading: vi.fn(() => "tid"),
    success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), dismiss: vi.fn(),
  });
  return { toast };
});

import { toast } from "sonner";
import { runAiOp, getEta, AiOpError } from "../ai-op";

// localStorage não existe no ambiente node do vitest — stub mínimo backed por Map.
function installLocalStorage() {
  const m = new Map<string, string>();
  (globalThis as { localStorage?: Storage }).localStorage = {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null, length: 0,
  } as Storage;
}

/** Promise que rejeita (estilo fetch) quando o signal aborta. */
const abortable = (signal: AbortSignal) =>
  new Promise<never>((_, rej) =>
    signal.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError"))));

beforeEach(() => { vi.clearAllMocks(); installLocalStorage(); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("runAiOp", () => {
  it("sucesso → dispensa o loading e devolve o resultado", async () => {
    const r = await runAiOp("Op", async () => ({ ok: 1 }), { loading: "…" });
    expect(r).toEqual({ ok: 1 });
    expect(toast.dismiss).toHaveBeenCalledWith("tid");
  });

  it("cancelar (ação do toast) → AiOpError.cancelled, sem toast de erro", async () => {
    const p = runAiOp("Op", abortable, { loading: "…", timeoutMs: 99_999 });
    const opts = (toast.loading as ReturnType<typeof vi.fn>).mock.calls[0][1];
    opts.action.onClick();                       // usuário clicou "Cancelar"
    await expect(p).rejects.toMatchObject({ name: "AiOpError", cancelled: true, timedOut: false });
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.info).toHaveBeenCalled();
  });

  it("timeout → AiOpError.timedOut + toast de erro", async () => {
    const p = runAiOp("Op", abortable, { loading: "…", timeoutMs: 1000 });
    // anexa o catch ANTES de avançar o relógio — senão a rejeição fica órfã na janela
    const assertion = expect(p).rejects.toMatchObject({ name: "AiOpError", timedOut: true });
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
    expect(toast.error).toHaveBeenCalled();
  });

  it("falha real → relança o erro original e mostra toast de erro", async () => {
    const p = runAiOp("Op", async () => { throw new Error("boom"); }, { loading: "…" });
    await expect(p).rejects.toThrow("boom");
    await expect(p).rejects.not.toBeInstanceOf(AiOpError);
    expect(toast.error).toHaveBeenCalled();
  });
});

describe("ETA (EWMA persistido)", () => {
  it("null antes de rodar; grava a duração; pondera 0.7/0.3 na 2ª", async () => {
    expect(getEta("E")).toBeNull();
    const p1 = runAiOp("E", (s) => new Promise<string>((res) => { void s; setTimeout(() => res("x"), 2000); }), { loading: "…", timeoutMs: 99_999 });
    await vi.advanceTimersByTimeAsync(2000);
    await p1;
    expect(getEta("E")).toBe(2000);
    const p2 = runAiOp("E", (s) => new Promise<string>((res) => { void s; setTimeout(() => res("x"), 1000); }), { loading: "…", timeoutMs: 99_999 });
    await vi.advanceTimersByTimeAsync(1000);
    await p2;
    expect(getEta("E")).toBe(Math.round(2000 * 0.7 + 1000 * 0.3)); // 1700
  });
});
