import { NextResponse } from "next/server";
import { getAuthStatus, startDeviceLogin, logout } from "@/lib/visant-auth";

// GET — status da conexão com a Visant
export async function GET() {
  try {
    const status = await getAuthStatus();
    return NextResponse.json(status);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// POST — inicia o device flow; retorna o link de aprovação
export async function POST() {
  try {
    const flow = await startDeviceLogin();
    return NextResponse.json(flow);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}

// DELETE — desconecta (apaga tokens locais)
export async function DELETE() {
  await logout();
  return NextResponse.json({ ok: true });
}
