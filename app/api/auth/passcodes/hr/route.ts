import type { NextRequest } from "next/server";

import { handlePasscodeChange } from "@/lib/auth/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return handlePasscodeChange(request, "HR");
}
