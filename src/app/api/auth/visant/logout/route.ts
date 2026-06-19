/** POST/GET /api/auth/visant/logout — limpa cookies, redireciona pra /. */
import { NextRequest, NextResponse } from "next/server";
import { COOKIE } from "@/lib/visant-user-oauth";

function clear(req: NextRequest, target = "/") {
  const res = NextResponse.redirect(new URL(target, req.url));
  for (const k of [COOKIE.AT, COOKIE.RT, COOKIE.UID, COOKIE.PKCE, COOKIE.STATE]) res.cookies.delete(k);
  return res;
}
export async function GET(req: NextRequest) { return clear(req); }
export async function POST(req: NextRequest) { return clear(req); }
