import { NextResponse } from "next/server";
import { pollDeviceLogin } from "@/lib/visant-auth";

// GET — um poll do device flow (a UI chama a cada ~5s durante o login)
export async function GET() {
  const result = await pollDeviceLogin();
  return NextResponse.json(result);
}
