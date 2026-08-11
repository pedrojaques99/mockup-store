/**
 * GET /api/auth/visant/callback?code=...&state=...
 *
 * Valida state (CSRF), recupera o PKCE verifier do cookie, troca code por
 * tokens. Grava cookies httpOnly (`vauth_at`, `vauth_rt`, `vauth_uid`) e
 * redireciona pro `returnTo` original (embutido no state).
 */
import { NextRequest, NextResponse } from "next/server";
import { getRegisteredClient, exchangeCode, fetchUser, safeReturnTo, COOKIE } from "@/lib/visant-user-oauth";

function callbackUrl(req: NextRequest): string {
  const env = process.env.VISANT_OAUTH_REDIRECT_URI;
  if (env) return env;
  return new URL("/api/auth/visant/callback", req.url).toString();
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const stateParam = searchParams.get("state") || "";
  if (!code) return NextResponse.json({ error: "missing code" }, { status: 400 });

  const expected = req.cookies.get(COOKIE.STATE)?.value;
  const verifier = req.cookies.get(COOKIE.PKCE)?.value;
  const [stateOnly, returnEnc = ""] = stateParam.split("|");
  if (!expected || stateOnly !== expected) return NextResponse.json({ error: "state mismatch" }, { status: 400 });
  if (!verifier) return NextResponse.json({ error: "pkce verifier missing" }, { status: 400 });
  const returnTo = returnEnc ? decodeURIComponent(returnEnc) : "/";

  try {
    const client = await getRegisteredClient(callbackUrl(req));
    const tokens = await exchangeCode(client, code, verifier);

    // Best-effort: completa userId/email via /api/users/me se JWT não trouxer.
    let uid = tokens.userId, email = tokens.email, name = tokens.name;
    if (!uid) {
      const u = await fetchUser(tokens.accessToken);
      if (u) { uid = u.id; email = u.email; name = u.name; }
    }
    if (!uid) return NextResponse.json({ error: "could not resolve user id" }, { status: 500 });

    // Guard em `visant-user-oauth.ts` (SSoT, testado): `startsWith("/")` deixa
    // passar `//evil.com`, que resolve pra outro host.
    const target = new URL(safeReturnTo(returnTo), req.url).toString();
    const res = NextResponse.redirect(target);
    const secure = process.env.NODE_ENV === "production";
    const atTtl = Math.max(60, Math.floor((tokens.expiresAt - Date.now()) / 1000));
    res.cookies.set(COOKIE.AT, tokens.accessToken, { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: atTtl });
    if (tokens.refreshToken) {
      res.cookies.set(COOKIE.RT, tokens.refreshToken, { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: 60 * 60 * 24 * 30 });
    }
    // UID é cookie LIDO pelo middleware/cliente — não-secret, contém só o user id.
    res.cookies.set(COOKIE.UID, JSON.stringify({ id: uid, email, name }), {
      httpOnly: false, sameSite: "lax", secure, path: "/", maxAge: 60 * 60 * 24 * 30,
    });
    res.cookies.delete(COOKIE.PKCE);
    res.cookies.delete(COOKIE.STATE);
    return res;
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "callback failed" }, { status: 500 });
  }
}
