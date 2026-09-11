import { NextRequest } from "next/server";

import { handleCandidateRemove, handleCandidateUpdate } from "@/lib/candidates/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: Context) {
  return handleCandidateUpdate(request, (await context.params).id);
}

export async function DELETE(request: NextRequest, context: Context) {
  return handleCandidateRemove(request, (await context.params).id);
}
