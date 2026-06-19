/**
 * GET /api/auth/me — devolve o user logado (lido do cookie httpOnly `vauth_uid`).
 * Refresh transparente do access token quando expirado (se houver refresh_token).
 */
import { NextRequest, NextResponse } from "next/server";
import { COOKIE, getRegisteredClient, refreshTokens } from "@/lib/visant-user-oauth";

function callbackUrl(req: NextRequest): string {
  const env = process.env.VISANT_OAUTH_REDIRECT_URI;
  if (env) return env;
  return new URL("/api/auth/visant/callback", req.url).toString();
}

export async function GET(req: NextRequest) {
  const uidRaw = req.cookies.get(COOKIE.UID)?.value;
  if (!uidRaw) return NextResponse.json({ user: null });
  try {
    const u = JSON.parse(uidRaw) as { id: string; email?: string; name?: string };
    return NextResponse.json({ user: u });
  } catch {
    // Refresh silencioso se o cookie corrompeu mas há refresh token
    const rt = req.cookies.get(COOKIE.RT)?.value;
    if (!rt) return NextResponse.json({ user: null });
    try {
      const client = await getRegisteredClient(callbackUrl(req));
      const tokens = await refreshTokens(client, rt);
      const res = NextResponse.json({ user: { id: tokens.userId, email: tokens.email, name: tokens.name } });
      const secure = process.env.NODE_ENV === "production";
      res.cookies.set(COOKIE.AT, tokens.accessToken, { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: 3600 });
      if (tokens.refreshToken) res.cookies.set(COOKIE.RT, tokens.refreshToken, { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: 60 * 60 * 24 * 30 });
      res.cookies.set(COOKIE.UID, JSON.stringify({ id: tokens.userId, email: tokens.email, name: tokens.name }), {
        httpOnly: false, sameSite: "lax", secure, path: "/", maxAge: 60 * 60 * 24 * 30,
      });
      return res;
    } catch { return NextResponse.json({ user: null }); }
  }
}
