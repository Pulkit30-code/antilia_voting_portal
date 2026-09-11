import type { NextRequest } from "next/server";

import { handleLogin } from "@/lib/auth/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return handleLogin(request, "SYSTEM");
}
