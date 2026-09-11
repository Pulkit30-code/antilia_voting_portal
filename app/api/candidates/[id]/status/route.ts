import { NextRequest } from "next/server";

import { handleCandidateStatus } from "@/lib/candidates/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: Context) {
  return handleCandidateStatus(request, (await context.params).id);
}
