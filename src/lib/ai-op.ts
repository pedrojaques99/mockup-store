"use client";

/**
 * runAiOp — wrapper das operações de IA (upscale, ai-edit, limpar superfície, blend,
 * expandir cena). Resolve o D3 do audit: toda op longa ganha **timeout**, **cancelar**
 * e **ETA**, sem boilerplate repetido em cada handler.
 *
 *  - **Cancelar:** AbortController exposto como ação "Cancelar" no próprio toast de loading
 *    (cancel onde o feedback acontece — sem botão extra no painel).
 *  - **Timeout:** aborta após `timeoutMs` (default 120s) e avisa que demorou demais.
 *  - **ETA:** média móvel (EWMA) da duração por `label`, persistida em localStorage; mostra
 *    "12s · ~30s" no toast pra a espera nunca parecer travada.
 *
 * O helper é dono do toast de loading/cancel/timeout/erro + do ETA. O **sucesso** fica com
 * o caller (mensagens variam: dimensões, material, warning de fallback…), que mostra um
 * toast novo depois de pós-processar o resultado.
 */
import { toast } from "sonner";

/** Erro de uma op de IA — distingue cancelamento do usuário e timeout de falha real. */
export class AiOpError extends Error {
  cancelled: boolean;
  timedOut: boolean;
  constructor(message: string, opts: { cancelled?: boolean; timedOut?: boolean } = {}) {
    super(message);
    this.name = "AiOpError";
    this.cancelled = !!opts.cancelled;
    this.timedOut = !!opts.timedOut;
  }
}

// ── ETA: média móvel da duração por label, persistida ──────────────────────────
const ETA_KEY = "boxy:ai-eta";

function readEtas(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(ETA_KEY) || "{}"); } catch { return {}; }
}
function recordEta(label: string, ms: number): void {
  try {
    const e = readEtas();
    // EWMA — pondera o histórico (0.7) com a amostra nova (0.3); 1ª vez = a própria amostra.
    e[label] = e[label] ? Math.round(e[label] * 0.7 + ms * 0.3) : ms;
    localStorage.setItem(ETA_KEY, JSON.stringify(e));
  } catch { /* ignore */ }
}
/** ETA conhecido (ms) pro label, ou null se nunca rodou. */
export function getEta(label: string): number | null {
  const v = readEtas()[label];
  return typeof v === "number" && v > 0 ? v : null;
}

function fmtWait(elapsedMs: number, etaMs: number | null): string {
  const s = Math.floor(elapsedMs / 1000);
  if (etaMs && etaMs > 1500) return `${s}s · ~${Math.round(etaMs / 1000)}s`;
  return `${s}s`;
}

export interface RunAiOpts {
  /** Mensagem do toast de loading (ex.: "Aumentando resolução…"). */
  loading: string;
  /** Aborta a op depois de N ms (default 120000). */
  timeoutMs?: number;
}

/**
 * Roda `fn(signal)` com toast de loading (ETA + Cancelar) e timeout. Em sucesso, dispensa
 * o toast e devolve o resultado (o caller mostra o sucesso). Em cancel/timeout/erro, avisa
 * no toast e relança (AiOpError pra cancel/timeout; o erro original pra falha real).
 */
export async function runAiOp<T>(
  label: string,
  fn: (signal: AbortSignal) => Promise<T>,
  opts: RunAiOpts,
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const controller = new AbortController();
  const t0 = Date.now();
  const eta = getEta(label);
  let timedOut = false;

  const render = () =>
    toast.loading(opts.loading, {
      id: tId,
      description: fmtWait(Date.now() - t0, eta),
      duration: Infinity,
      action: { label: "Cancelar", onClick: () => controller.abort() },
    });

  const tId = toast.loading(opts.loading, {
    description: fmtWait(0, eta),
    duration: Infinity,
    action: { label: "Cancelar", onClick: () => controller.abort() },
  });
  const iv = setInterval(render, 500);
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);

  try {
    const r = await fn(controller.signal);
    recordEta(label, Date.now() - t0);
    toast.dismiss(tId); // sucesso é do caller — só dispensa o loading
    return r;
  } catch (e) {
    if (controller.signal.aborted) {
      if (timedOut) {
        toast.error(`"${label}" demorou demais e foi cancelada.`, { id: tId, duration: 5000 });
        throw new AiOpError(`${label}: timeout`, { timedOut: true });
      }
      toast.info(`"${label}" cancelada.`, { id: tId, duration: 2500 });
      throw new AiOpError(`${label}: cancelada`, { cancelled: true });
    }
    const msg = (e as { message?: string })?.message ?? `falha em ${label}`;
    toast.error(msg, { id: tId, duration: 5000 });
    throw e;
  } finally {
    clearInterval(iv);
    clearTimeout(timer);
  }
}
