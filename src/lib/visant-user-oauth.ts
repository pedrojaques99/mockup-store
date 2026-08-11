/**
 * visant-user-oauth — "Sign in with Visant" pro mockup-store (browser flow).
 *
 * OAuth 2.1 + PKCE (Authorization Code), separado do `visant-auth.ts` que é
 * server-to-server (device flow, single-machine). Aqui CADA USUÁRIO tem seus
 * próprios tokens em cookies httpOnly → multi-user real, base do tenant da
 * engine pai SSoT.
 *
 *   1. Dynamic Client Registration na 1ª vez (cacheado em Mongo `oauth_clients`).
 *   2. /login gera PKCE (verifier+challenge) + state, salva em cookies temporários,
 *      redireciona pro `/oauth/authorize`.
 *   3. /callback valida state, troca code por (access_token, refresh_token), salva
 *      cookies httpOnly seguros. Decodifica o JWT pra extrair `sub` (= visant userId).
 *   4. /me retorna o user; /logout limpa.
 *
 * Quando o Boxy implementar VisantProvider no NextAuth, basta copiar este módulo —
 * a API é idiomática (não tem Next-isms; só Web Crypto + fetch).
 */
import { createHash, randomBytes } from "crypto";

const ISSUER = (process.env.VISANT_OAUTH_ISSUER || "https://api.visantlabs.com").replace(/\/$/, "");
const SCOPES = process.env.VISANT_OAUTH_SCOPES || "read write generate";
const CLIENT_NAME = process.env.VISANT_OAUTH_CLIENT_NAME || "Mockup Store";

const ENDPOINTS = {
  authorize: `${ISSUER}/oauth/authorize`,
  token: `${ISSUER}/oauth/token`,
  register: `${ISSUER}/oauth/register`,
  me: `${ISSUER}/api/users/me`,
};

export interface RegisteredClient { clientId: string; clientSecret?: string; redirectUri: string }

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;            // epoch ms
  userId: string;               // JWT `sub`
  email?: string;
  name?: string;
}

// PKCE helpers ──────────────────────────────────────────────────────────────
export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}
export const randomState = () => randomBytes(24).toString("base64url");

/**
 * O `returnTo` do login só pode apontar pra dentro desta loja.
 *
 * `startsWith("/")` NÃO basta: `//evil.com` e `/\evil.com` começam com barra e
 * o `new URL(x, base)` resolve os dois pra outro host — open redirect logo
 * depois do login, com a sessão já quente. Só caminho relativo de UMA barra
 * passa; o resto vira "/".
 */
export function safeReturnTo(returnTo: string | null | undefined): string {
  return typeof returnTo === "string" && /^\/(?![/\\])/.test(returnTo) ? returnTo : "/";
}

// JWT decode (sem verificação — usado só pra extrair `sub`/`email` do access token).
// Não TRUST sem checagem do endpoint /me. Mas serve pra cookie inicial sem round-trip.
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const part = token.split(".")[1]; if (!part) return null;
    const json = Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");
    return JSON.parse(json);
  } catch { return null; }
}

// Dynamic Client Registration ───────────────────────────────────────────────
// Cacheia em Mongo (`oauth_clients` por redirect_uri) ou cai pra env quando sem Mongo.
async function loadClientFromCache(redirectUri: string): Promise<RegisteredClient | null> {
  if (!process.env.MONGODB_URI) return null;
  try {
    const { getDb } = await import("./db");
    const db = await getDb();
    const doc = await db.collection<RegisteredClient & { _id?: unknown }>("oauth_clients").findOne({ redirectUri });
    if (!doc) return null;
    return { clientId: doc.clientId, clientSecret: doc.clientSecret, redirectUri: doc.redirectUri };
  } catch { return null; }
}
async function saveClientToCache(c: RegisteredClient): Promise<void> {
  if (!process.env.MONGODB_URI) return;
  try {
    const { getDb } = await import("./db");
    const db = await getDb();
    await db.collection<RegisteredClient>("oauth_clients").updateOne(
      { redirectUri: c.redirectUri }, { $set: c }, { upsert: true },
    );
  } catch { /* */ }
}

export async function getRegisteredClient(redirectUri: string): Promise<RegisteredClient> {
  // Override via env (deploy estático com client_id pré-registrado)
  const envId = process.env.VISANT_OAUTH_CLIENT_ID;
  if (envId) return { clientId: envId, clientSecret: process.env.VISANT_OAUTH_CLIENT_SECRET, redirectUri };
  const cached = await loadClientFromCache(redirectUri);
  if (cached) return cached;
  // Dynamic registration
  const res = await fetch(ENDPOINTS.register, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: CLIENT_NAME,
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none", // public client (PKCE)
      scope: SCOPES,
    }),
  });
  if (!res.ok) throw new Error(`oauth/register HTTP ${res.status}: ${await res.text().catch(() => "")}`);
  const j = await res.json() as { client_id: string; client_secret?: string };
  const c: RegisteredClient = { clientId: j.client_id, clientSecret: j.client_secret, redirectUri };
  await saveClientToCache(c);
  return c;
}

// Authorize URL ─────────────────────────────────────────────────────────────
export function buildAuthorizeUrl(client: RegisteredClient, state: string, challenge: string, returnTo?: string): string {
  const u = new URL(ENDPOINTS.authorize);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", client.clientId);
  u.searchParams.set("redirect_uri", client.redirectUri);
  u.searchParams.set("code_challenge", challenge);
  u.searchParams.set("code_challenge_method", "S256");
  u.searchParams.set("scope", SCOPES);
  u.searchParams.set("state", returnTo ? `${state}|${encodeURIComponent(returnTo)}` : state);
  return u.toString();
}

// Token exchange + refresh ──────────────────────────────────────────────────
async function postToken(body: Record<string, string>, client: RegisteredClient): Promise<TokenSet> {
  const form = new URLSearchParams(body);
  form.set("client_id", client.clientId);
  if (client.clientSecret) form.set("client_secret", client.clientSecret);
  const res = await fetch(ENDPOINTS.token, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  if (!res.ok) throw new Error(`oauth/token HTTP ${res.status}: ${await res.text().catch(() => "")}`);
  const j = await res.json() as { access_token: string; refresh_token?: string; expires_in?: number };
  const payload = decodeJwtPayload(j.access_token) ?? {};
  return {
    accessToken: j.access_token,
    refreshToken: j.refresh_token,
    expiresAt: Date.now() + (j.expires_in ?? 3600) * 1000,
    userId: String(payload.sub ?? payload.userId ?? payload.user_id ?? ""),
    email: typeof payload.email === "string" ? payload.email : undefined,
    name: typeof payload.name === "string" ? payload.name : undefined,
  };
}

export async function exchangeCode(client: RegisteredClient, code: string, verifier: string): Promise<TokenSet> {
  return postToken({ grant_type: "authorization_code", code, redirect_uri: client.redirectUri, code_verifier: verifier }, client);
}
export async function refreshTokens(client: RegisteredClient, refreshToken: string): Promise<TokenSet> {
  return postToken({ grant_type: "refresh_token", refresh_token: refreshToken }, client);
}

// User info ─────────────────────────────────────────────────────────────────
export async function fetchUser(accessToken: string): Promise<{ id: string; email?: string; name?: string } | null> {
  try {
    const r = await fetch(ENDPOINTS.me, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!r.ok) return null;
    const j = await r.json() as { id?: string; _id?: string; userId?: string; email?: string; name?: string };
    const id = j.id ?? j._id ?? j.userId; if (!id) return null;
    return { id: String(id), email: j.email, name: j.name };
  } catch { return null; }
}

// Cookie helpers (Web/Next-friendly — só strings) ───────────────────────────
export const COOKIE = {
  /** access token (httpOnly, secure em prod). expira com o JWT. */
  AT: "vauth_at",
  /** refresh token (httpOnly, secure). longevidade ~30d. */
  RT: "vauth_rt",
  /** userId visível (não-secret) — usado pelo middleware pra setar x-tenant SEM
   *  decodificar JWT em todo request. Não é trust source (só hint pra tenant). */
  UID: "vauth_uid",
  /** pkce verifier + state (cookies temporários, expira em 10min). */
  PKCE: "vauth_pkce",
  STATE: "vauth_state",
};
