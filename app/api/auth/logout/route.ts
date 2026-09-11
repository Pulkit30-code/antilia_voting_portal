import type { NextRequest } from "next/server";

import { handleLogout } from "@/lib/auth/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return handleLogout(request);
}
