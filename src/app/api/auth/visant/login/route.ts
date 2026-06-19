/**
 * GET /api/auth/visant/login?returnTo=/calibrate
 *
 * Gera PKCE + state, salva em cookies temporários (10min), redireciona pro
 * `/oauth/authorize` da Visant. Callback retorna em `/api/auth/visant/callback`.
 */
import { NextRequest, NextResponse } from "next/server";
import { getRegisteredClient, buildAuthorizeUrl, pkcePair, randomState, COOKIE } from "@/lib/visant-user-oauth";

function callbackUrl(req: NextRequest): string {
  // Em prod, set VISANT_OAUTH_REDIRECT_URI; em dev derivamos do request.
  const env = process.env.VISANT_OAUTH_REDIRECT_URI;
  if (env) return env;
  return new URL("/api/auth/visant/callback", req.url).toString();
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const returnTo = searchParams.get("returnTo") || "/";
  const redirectUri = callbackUrl(req);
  try {
    const client = await getRegisteredClient(redirectUri);
    const { verifier, challenge } = pkcePair();
    const state = randomState();
    const url = buildAuthorizeUrl(client, state, challenge, returnTo);
    const res = NextResponse.redirect(url);
    const opts = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: 600 };
    res.cookies.set(COOKIE.PKCE, verifier, opts);
    res.cookies.set(COOKIE.STATE, state, opts);
    return res;
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "login failed" }, { status: 500 });
  }
}
