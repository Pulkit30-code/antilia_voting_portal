import type { NextRequest } from "next/server";

import { handleSession } from "@/lib/auth/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return handleSession(request);
}
