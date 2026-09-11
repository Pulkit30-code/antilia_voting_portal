import type { NextRequest } from "next/server";

import { handleBootstrap } from "@/lib/auth/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return handleBootstrap(request);
}
