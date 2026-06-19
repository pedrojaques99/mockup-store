/**
 * engine-feedback — loop retro-alimentativo do engine de detecção/render.
 *
 * **Engine PAI SSoT (multi-tenant)**: quando `MONGODB_URI` está setado, events e
 * profiles vivem em Mongo (`engine_events` append-only + `engine_profiles` por
 * tenant). `loadProfile(tenant)` retorna o profile **mesclado** = `_global` ⊕
 * `tenant` (tenant tem prioridade onde tem amostras suficientes). Resultado:
 *
 *   • A engine-pai aprende com TODOS os usuários (signals agregados, anônimos).
 *   • Cada tenant ainda tem seu próprio profile que sobrepõe quando relevante.
 *   • Sem Mongo (dev local), cai pro filesystem antigo (single-tenant).
 *
 * Privacy: só stats agregados — counts, médias, IoU, sceneHash (sha1 não-reversível).
 * Nunca pixels, prompts ou nomes de arquivos sensíveis.
 *
 * Determinístico, sem ML, sem deps externas além de mongodb (já no projeto).
 * A captura NUNCA quebra o fluxo principal.
 */
import { createHash } from "crypto";
import { readFile, writeFile, mkdir, appendFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { quadIoU, type QuadCorners } from "./key-color-core";

const DIR = join(process.cwd(), "data", "engine-feedback");
const EVENTS = join(DIR, "events.jsonl");
const PROFILE = join(DIR, "engine-profile.json");
const GLOBAL_TENANT = "_global";

const hasMongo = (): boolean => !!process.env.MONGODB_URI && !!process.env.MONGODB_DB_NAME;

export interface FeedbackEvent {
  ts: number;
  /** Identifica de quem é a contribuição. `_global` é o pool partilhado.
   *  Quando ausente, contribui só pro global. */
  tenant?: string;
  sceneHash: string;
  name: string;
  source: "photo-mockup" | "calibrate";
  outcome: "publish" | "save" | "render";
  surfaceType: string;
  method?: string;
  detectorVersion?: number;
  profileVersion?: number;
  auto?: QuadCorners;
  final: QuadCorners;
  iou?: number;
  disp?: { scale?: number; blur?: number };
  material?: { kind?: string; intensity?: number; angle?: number; scale?: number };
  /** Substrato que o humano confirmou (override ou aceitação do detectado).
   *  Fecha o loop: o `rankSubstrates` boosta candidatos consistentes com o histórico. */
  substrate?: string;
}

/** ID estável de uma cena = sha1(bytes da imagem). Torna qualquer output rastreável. */
export async function hashImage(pathOrBuf: string | Buffer): Promise<string> {
  const buf = typeof pathOrBuf === "string" ? await readFile(pathOrBuf) : pathOrBuf;
  return createHash("sha1").update(buf).digest("hex").slice(0, 16);
}

/** Grava um evento de feedback (append-only). Silencioso em erro — nunca quebra o fluxo.
 *  Quando há Mongo, escreve em `engine_events` (collection global, multi-tenant);
 *  senão, append no JSONL local (back-compat single-tenant). */
export async function logFeedback(ev: Omit<FeedbackEvent, "ts">): Promise<void> {
  const iou = ev.iou ?? (ev.auto ? quadIoU(ev.auto, ev.final) : undefined);
  const doc: FeedbackEvent = { ...ev, iou, ts: Date.now() };
  if (hasMongo()) {
    try {
      const { getDb } = await import("./db");
      const db = await getDb();
      await db.collection("engine_events").insertOne(doc as never);
      return;
    } catch { /* fallthrough pro FS */ }
  }
  try {
    if (!existsSync(DIR)) await mkdir(DIR, { recursive: true });
    await appendFile(EVENTS, JSON.stringify(doc) + "\n");
  } catch { /* feedback é best-effort */ }
}

// ── Profile aprendido ────────────────────────────────────────────────────────

export interface CornerBias {
  tl: [number, number]; tr: [number, number]; br: [number, number]; bl: [number, number]; n: number;
}
export interface EngineProfile {
  version: number;
  updatedAt: number;
  samples: number;
  /** Tenant deste profile. `_global` = pool partilhado. */
  tenant?: string;
  /** offset médio (final−auto) por canto, por surfaceType, em px (bias corretivo). */
  bias: Record<string, CornerBias>;
  /** defaults aprendidos por surfaceType (o que humanos mais escolhem). */
  defaults: Record<string, { dispScale?: number; material?: string }>;
  /** Contagem de substratos confirmados — alimenta o prior do `rankSubstrates`. */
  substrateCounts?: Record<string, number>;
  /** IoU médio do detector vs finais aceitos (placar de qualidade). */
  meanIoU?: number;
}

export const DEFAULT_PROFILE: EngineProfile = { version: 0, updatedAt: 0, samples: 0, bias: {}, defaults: {} };

// Cache em memória por tenant. Mongo invalida via `updatedAt` na próxima leitura.
const _cache = new Map<string, { p: EngineProfile; ts: number }>();
const CACHE_TTL_MS = 60_000;

async function loadProfileRaw(tenant: string): Promise<EngineProfile> {
  const cached = _cache.get(tenant);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.p;
  if (hasMongo()) {
    try {
      const { getDb } = await import("./db");
      const db = await getDb();
      const doc = await db.collection<EngineProfile>("engine_profiles").findOne({ tenant });
      const p = doc ?? { ...DEFAULT_PROFILE, tenant };
      _cache.set(tenant, { p, ts: Date.now() });
      return p;
    } catch { /* fallback FS */ }
  }
  if (tenant === GLOBAL_TENANT && existsSync(PROFILE)) {
    try { const p = JSON.parse(await readFile(PROFILE, "utf8")) as EngineProfile; _cache.set(tenant, { p, ts: Date.now() }); return p; } catch { /* */ }
  }
  return { ...DEFAULT_PROFILE, tenant };
}

/** Merge: global como base, tenant sobrepõe onde tem amostras suficientes.
 *  bias por surface: tenant ganha se n≥5; abaixo disso usa global.
 *  defaults: tenant ganha se presente.
 *  substrateCounts: SOMA (global + tenant) — mais sinal = melhor ranking. */
function mergeProfiles(global: EngineProfile, tenant: EngineProfile): EngineProfile {
  const bias: Record<string, CornerBias> = { ...global.bias };
  for (const [st, tb] of Object.entries(tenant.bias)) {
    if (tb.n >= 5) bias[st] = tb;
  }
  const defaults: EngineProfile["defaults"] = { ...global.defaults, ...tenant.defaults };
  const counts: Record<string, number> = { ...(global.substrateCounts ?? {}) };
  for (const [k, n] of Object.entries(tenant.substrateCounts ?? {})) counts[k] = (counts[k] ?? 0) + n;
  return {
    version: Math.max(global.version, tenant.version),
    updatedAt: Math.max(global.updatedAt, tenant.updatedAt),
    samples: global.samples + tenant.samples,
    tenant: tenant.tenant,
    bias, defaults,
    substrateCounts: Object.keys(counts).length ? counts : undefined,
    meanIoU: tenant.meanIoU ?? global.meanIoU,
  };
}

/** Carrega o profile mesclado pra um tenant (default: só global).
 *  - tenant=undefined → só `_global`
 *  - tenant="acme"    → `_global` ⊕ profile do `acme` (tenant override) */
export async function loadProfile(tenant?: string): Promise<EngineProfile> {
  const global = await loadProfileRaw(GLOBAL_TENANT);
  if (!tenant || tenant === GLOBAL_TENANT) return global;
  const t = await loadProfileRaw(tenant);
  return mergeProfiles(global, t);
}

async function saveProfile(p: EngineProfile): Promise<void> {
  const tenant = p.tenant ?? GLOBAL_TENANT;
  if (hasMongo()) {
    try {
      const { getDb } = await import("./db");
      const db = await getDb();
      await db.collection<EngineProfile>("engine_profiles").updateOne(
        { tenant }, { $set: { ...p, tenant } }, { upsert: true },
      );
      _cache.set(tenant, { p, ts: Date.now() });
      return;
    } catch { /* fallback FS */ }
  }
  if (!existsSync(DIR)) await mkdir(DIR, { recursive: true });
  // No FS, só persiste o global (single-tenant)
  if (tenant === GLOBAL_TENANT) await writeFile(PROFILE, JSON.stringify(p, null, 2));
  _cache.set(tenant, { p, ts: Date.now() });
}

/** Aplica o bias aprendido a um quad detectado. Só corrige com amostra suficiente (n≥5). */
export function applyBias(quad: QuadCorners, surfaceType: string, p: EngineProfile): QuadCorners {
  const b = p.bias[surfaceType];
  if (!b || b.n < 5) return quad;
  const adj = (c: QuadCorners["tl"], d: [number, number]) => ({ x: Math.round(c.x + d[0]), y: Math.round(c.y + d[1]) });
  return { tl: adj(quad.tl, b.tl), tr: adj(quad.tr, b.tr), br: adj(quad.br, b.br), bl: adj(quad.bl, b.bl) };
}

async function readEvents(tenant?: string): Promise<FeedbackEvent[]> {
  if (hasMongo()) {
    try {
      const { getDb } = await import("./db");
      const db = await getDb();
      const filter = tenant && tenant !== GLOBAL_TENANT ? { tenant } : {};
      // limit defensivo: 50k eventos. Profiles cobrem o sinal — não precisamos ler 1M.
      const docs = await db.collection<FeedbackEvent>("engine_events")
        .find(filter).sort({ ts: -1 }).limit(50000).toArray();
      return docs;
    } catch { /* fallback FS */ }
  }
  if (!existsSync(EVENTS)) return [];
  const txt = await readFile(EVENTS, "utf8");
  const out: FeedbackEvent[] = [];
  for (const line of txt.split("\n")) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* ignora linha corrompida */ }
  }
  return tenant ? out.filter((e) => e.tenant === tenant) : out;
}

const median = (a: number[]) => { if (!a.length) return undefined; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const mode = (a: string[]) => { if (!a.length) return undefined; const m: Record<string, number> = {}; let best = a[0], bn = 0; for (const v of a) { m[v] = (m[v] || 0) + 1; if (m[v] > bn) { bn = m[v]; best = v; } } return best; };

/**
 * Reagrega o profile de UM tenant (default: `_global` = TODO o histórico).
 *
 * Pattern recomendado após cada save/publish:
 *   `relearn(tenant).catch(() => {}); relearn().catch(() => {});`
 *
 * Engine pai aprende sempre; tenant-específico aprende em paralelo, sem bloquear.
 */
export async function relearn(tenant: string = GLOBAL_TENANT): Promise<EngineProfile> {
  const events = await readEvents(tenant === GLOBAL_TENANT ? undefined : tenant);
  const prev = await loadProfileRaw(tenant);

  const bias: Record<string, CornerBias> = {};
  const disp: Record<string, number[]> = {};
  const mat: Record<string, string[]> = {};
  const subs: Record<string, number> = {};
  const ious: number[] = [];

  for (const ev of events) {
    const st = ev.surfaceType || "other";
    if (ev.auto && ev.final) {
      const b = (bias[st] ??= { tl: [0, 0], tr: [0, 0], br: [0, 0], bl: [0, 0], n: 0 });
      (["tl", "tr", "br", "bl"] as const).forEach((k) => { b[k][0] += ev.final[k].x - ev.auto![k].x; b[k][1] += ev.final[k].y - ev.auto![k].y; });
      b.n++;
    }
    if (typeof ev.iou === "number") ious.push(ev.iou);
    if (ev.disp?.scale != null) (disp[st] ??= []).push(ev.disp.scale);
    if (ev.material?.kind && ev.material.kind !== "none") (mat[st] ??= []).push(ev.material.kind);
    if (ev.substrate) subs[ev.substrate] = (subs[ev.substrate] || 0) + 1;
  }

  // média dos offsets por canto
  for (const st of Object.keys(bias)) {
    const b = bias[st];
    (["tl", "tr", "br", "bl"] as const).forEach((k) => { b[k][0] = +(b[k][0] / b.n).toFixed(1); b[k][1] = +(b[k][1] / b.n).toFixed(1); });
  }

  const defaults: EngineProfile["defaults"] = {};
  for (const st of new Set([...Object.keys(disp), ...Object.keys(mat)])) {
    defaults[st] = { dispScale: median(disp[st] || []), material: mode(mat[st] || []) };
  }

  const profile: EngineProfile = {
    version: prev.version + 1,
    updatedAt: Date.now(),
    samples: events.length,
    tenant,
    bias, defaults,
    substrateCounts: Object.keys(subs).length ? subs : undefined,
    meanIoU: ious.length ? +(ious.reduce((s, v) => s + v, 0) / ious.length).toFixed(4) : undefined,
  };
  await saveProfile(profile);
  return profile;
}

/** Resumo público pra UI mostrar transparência ("engine vN.M • S samples"). */
export interface EngineStats {
  global: { version: number; samples: number; meanIoU?: number };
  tenant?: { name: string; version: number; samples: number; meanIoU?: number };
}
export async function engineStats(tenant?: string): Promise<EngineStats> {
  const g = await loadProfileRaw(GLOBAL_TENANT);
  const out: EngineStats = { global: { version: g.version, samples: g.samples, meanIoU: g.meanIoU } };
  if (tenant && tenant !== GLOBAL_TENANT) {
    const t = await loadProfileRaw(tenant);
    out.tenant = { name: tenant, version: t.version, samples: t.samples, meanIoU: t.meanIoU };
  }
  return out;
}
