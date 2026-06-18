"use client";

/**
 * photoSession — persistência **lazy** do ponteiro de sessão do photo-mockup, em
 * IndexedDB (idb-keyval). Guarda a ÚLTIMA cena que o usuário abriu (`uploadId` — a
 * foto já vive no disco do servidor sob esse id) + a sintonia em cima dela
 * (`doc`: sliders, máscaras, quad, aba ativa). A foto em si NÃO entra no IDB; aqui
 * só o ponteiro + o documento do editor.
 *
 * Profissional por quê:
 *  - **Lazy:** gravação com debounce trailing → sem write-storm durante drag de slider.
 *  - **Otimizado:** IndexedDB aguenta MBs de data-URL de máscara — localStorage estouraria
 *    a quota (~5MB) e bloqueia a main thread; IDB é assíncrono e folgado.
 *  - **Resiliente:** toda I/O em try/catch — persistência jamais quebra o editor.
 */
import { get, set, del } from "idb-keyval";
import type { DocState } from "./editorDoc";

const KEY = "boxy:photo-session";
const SCHEMA = 1;
const DEBOUNCE_MS = 1200;

export interface PhotoSession {
  v: number;
  uploadId: string;
  photoUrl: string;
  imgDims: { w: number; h: number };
  tool: string;
  doc: DocState;
  savedAt: number;
}

let timer: ReturnType<typeof setTimeout> | null = null;
let pending: PhotoSession | null = null;

/** Agenda a gravação (trailing debounce). No-op sem `uploadId`. */
export function saveSession(s: Omit<PhotoSession, "v" | "savedAt">): void {
  if (!s.uploadId) return;
  pending = { ...s, v: SCHEMA, savedAt: Date.now() };
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    const payload = pending;
    pending = null;
    timer = null;
    if (payload) set(KEY, payload).catch(() => { /* quota/IDB indisponível → ignora */ });
  }, DEBOUNCE_MS);
}

/** Lê a sessão salva (ou null se ausente/schema antigo/corrompida). */
export async function loadSession(): Promise<PhotoSession | null> {
  try {
    const s = await get<PhotoSession>(KEY);
    if (!s || s.v !== SCHEMA || !s.uploadId || !s.doc) return null;
    return s;
  } catch {
    return null;
  }
}

/** Apaga a sessão (trocar foto / reset). Cancela gravação pendente. */
export async function clearSession(): Promise<void> {
  if (timer) { clearTimeout(timer); timer = null; }
  pending = null;
  try { await del(KEY); } catch { /* ignore */ }
}
