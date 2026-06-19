/**
 * middleware — lê o cookie de identidade Visant (`vauth_uid`) e injeta
 * `x-tenant: visant_<userId>` em todas as rotas. Engine-pai SSoT já lê esse
 * header em `engine-feedback.logFeedback({tenant})` + `loadProfile(tenant)`.
 *
 * Não força auth (o produto roda sem login) — só anota o tenant quando há
 * sessão Visant. Sem cookie → contribui só pro `_global`.
 */
import { NextRequest, NextResponse } from "next/server";

const COOKIE_UID = "vauth_uid";

export function middleware(req: NextRequest) {
  const raw = req.cookies.get(COOKIE_UID)?.value;
  if (!raw) return NextResponse.next();
  let uid: string | undefined;
  try { uid = (JSON.parse(raw) as { id?: string }).id; } catch { /* */ }
  if (!uid) return NextResponse.next();
  // Injeta o header no request encaminhado pras rotas (handlers leem com req.headers.get).
  const headers = new Headers(req.headers);
  headers.set("x-tenant", `visant_${uid}`);
  return NextResponse.next({ request: { headers } });
}

// Roda em todas as rotas API + páginas (cookie é só lido, custo desprezível).
export const config = {
  matcher: ["/api/:path*", "/calibrate", "/photo-mockup"],
};
