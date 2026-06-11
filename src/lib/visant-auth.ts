// "Login as Visant" — OAuth 2.1 Device Flow (RFC 8628) contra api.visantlabs.com.
// Resolução de credencial: VISANT_API_KEY (env) → tokens OAuth salvos (com refresh
// rotativo) → credencial do CLI Visant (~/.visant/credentials.json).

import { readFile, writeFile, mkdir, unlink } from "fs/promises";
import { homedir } from "os";
import { join } from "path";

const OAUTH_BASE = (process.env.VISANT_API_URL || "https://api.visantlabs.com/api").replace(
  /\/api\/?$/,
  ""
);
const DEVICE_CODE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
const SCOPES = "read write generate";

const AUTH_DIR = join(homedir(), ".visant");
const AUTH_FILE = join(AUTH_DIR, "mockup-store-auth.json");
const CLI_CREDENTIALS_FILE = join(AUTH_DIR, "credentials.json");

// Renova o access token 5 min antes de expirar
const EXPIRY_MARGIN_MS = 5 * 60 * 1000;

interface StoredAuth {
  clientId: string;
  accessToken?: string;
  accessTokenExpiresAt?: number;
  refreshToken?: string;
}

interface PendingDeviceFlow {
  deviceCode: string;
  clientId: string;
  verificationUriComplete: string;
  intervalSec: number;
  expiresAt: number;
}

let pendingFlow: PendingDeviceFlow | null = null;
let refreshing: Promise<string | null> | null = null;

async function readAuthFile(): Promise<StoredAuth | null> {
  try {
    return JSON.parse(await readFile(AUTH_FILE, "utf-8")) as StoredAuth;
  } catch {
    return null;
  }
}

async function writeAuthFile(auth: StoredAuth): Promise<void> {
  await mkdir(AUTH_DIR, { recursive: true });
  await writeFile(AUTH_FILE, JSON.stringify(auth, null, 2), "utf-8");
}

async function readCliApiKey(): Promise<string | null> {
  try {
    const raw = JSON.parse(await readFile(CLI_CREDENTIALS_FILE, "utf-8"));
    return raw.apiKey || null;
  } catch {
    return null;
  }
}

async function oauthPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${OAUTH_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string; error_description?: string };
  if (!res.ok) {
    const err = new Error(data.error_description || data.error || `HTTP ${res.status}`);
    (err as Error & { oauthError?: string }).oauthError = data.error;
    throw err;
  }
  return data;
}

async function ensureClientId(): Promise<string> {
  const stored = await readAuthFile();
  if (stored?.clientId) return stored.clientId;

  const reg = await oauthPost<{ client_id: string }>("/oauth/register", {
    client_name: "Mockup Store (local)",
    redirect_uris: ["urn:ietf:wg:oauth:2.0:oob"],
    grant_types: [DEVICE_CODE_GRANT, "refresh_token"],
  });
  await writeAuthFile({ ...(stored || {}), clientId: reg.client_id });
  return reg.client_id;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

async function saveTokens(clientId: string, t: TokenResponse): Promise<void> {
  await writeAuthFile({
    clientId,
    accessToken: t.access_token,
    accessTokenExpiresAt: Date.now() + t.expires_in * 1000,
    refreshToken: t.refresh_token,
  });
}

/** Inicia o device flow. Retorna o link que o usuário abre para aprovar. */
export async function startDeviceLogin(): Promise<{
  verificationUriComplete: string;
  expiresInSec: number;
}> {
  const clientId = await ensureClientId();
  const d = await oauthPost<{
    device_code: string;
    verification_uri_complete: string;
    expires_in: number;
    interval: number;
  }>("/oauth/device/code", { client_id: clientId, scope: SCOPES });

  pendingFlow = {
    deviceCode: d.device_code,
    clientId,
    verificationUriComplete: d.verification_uri_complete,
    intervalSec: d.interval || 5,
    expiresAt: Date.now() + d.expires_in * 1000,
  };
  return {
    verificationUriComplete: d.verification_uri_complete,
    expiresInSec: d.expires_in,
  };
}

export type DevicePollResult =
  | { status: "authorized" }
  | { status: "pending" }
  | { status: "error"; message: string };

/** Um poll do device flow. Chamar a cada ~5s a partir da UI. */
export async function pollDeviceLogin(): Promise<DevicePollResult> {
  if (!pendingFlow) return { status: "error", message: "Nenhum login em andamento" };
  if (Date.now() > pendingFlow.expiresAt) {
    pendingFlow = null;
    return { status: "error", message: "Login expirou — tente novamente" };
  }

  try {
    const t = await oauthPost<TokenResponse>("/oauth/token", {
      grant_type: DEVICE_CODE_GRANT,
      device_code: pendingFlow.deviceCode,
      client_id: pendingFlow.clientId,
    });
    await saveTokens(pendingFlow.clientId, t);
    pendingFlow = null;
    return { status: "authorized" };
  } catch (err) {
    const code = (err as Error & { oauthError?: string }).oauthError;
    if (code === "authorization_pending" || code === "slow_down") {
      return { status: "pending" };
    }
    pendingFlow = null;
    return { status: "error", message: (err as Error).message };
  }
}

async function refreshAccessToken(stored: StoredAuth): Promise<string | null> {
  if (!stored.refreshToken) return null;
  // Evita refresh concorrente (o refresh token é rotacionado a cada uso)
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      const t = await oauthPost<TokenResponse>("/oauth/token", {
        grant_type: "refresh_token",
        refresh_token: stored.refreshToken,
        client_id: stored.clientId,
      });
      await saveTokens(stored.clientId, t);
      return t.access_token;
    } catch {
      // Refresh inválido/expirado — limpa para forçar novo login
      await writeAuthFile({ clientId: stored.clientId });
      return null;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

/** Token para chamadas à Visant API, na ordem: env → OAuth (com refresh) → CLI. */
export async function getAccessToken(): Promise<string | null> {
  const envKey = (process.env.VISANT_API_KEY || "").trim();
  if (envKey) return envKey;

  const stored = await readAuthFile();
  if (stored?.accessToken) {
    if ((stored.accessTokenExpiresAt || 0) - EXPIRY_MARGIN_MS > Date.now()) {
      return stored.accessToken;
    }
    const refreshed = await refreshAccessToken(stored);
    if (refreshed) return refreshed;
  } else if (stored?.refreshToken) {
    const refreshed = await refreshAccessToken(stored);
    if (refreshed) return refreshed;
  }

  return readCliApiKey();
}

export type AuthMethod = "env" | "oauth" | "cli" | null;

export async function getAuthStatus(): Promise<{ connected: boolean; method: AuthMethod }> {
  if ((process.env.VISANT_API_KEY || "").trim()) return { connected: true, method: "env" };
  const stored = await readAuthFile();
  if (stored?.accessToken || stored?.refreshToken) {
    // Considera conectado se conseguir um token válido (refresh incluso)
    const token = await getAccessToken();
    if (token) return { connected: true, method: "oauth" };
  }
  if (await readCliApiKey()) return { connected: true, method: "cli" };
  return { connected: false, method: null };
}

export async function logout(): Promise<void> {
  pendingFlow = null;
  const stored = await readAuthFile();
  if (stored?.clientId) {
    // Mantém o clientId registrado; apaga só os tokens
    await writeAuthFile({ clientId: stored.clientId });
  } else {
    await unlink(AUTH_FILE).catch(() => {});
  }
}
