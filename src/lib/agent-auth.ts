// Auth bearer dos endpoints /api/agent/v1/* (MOCKUP_STORE_AGENT_KEY).

import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";

/** Retorna uma resposta de erro se não autorizado; null se ok. */
export function requireAgentAuth(req: NextRequest): NextResponse | null {
  const expected = (process.env.MOCKUP_STORE_AGENT_KEY || "").trim();
  if (!expected) {
    return NextResponse.json(
      { error: "API do agente desabilitada — defina MOCKUP_STORE_AGENT_KEY no .env.local" },
      { status: 503 }
    );
  }

  const header = req.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  if (!token || a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  return null;
}
