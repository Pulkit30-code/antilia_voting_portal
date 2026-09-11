import { NextRequest } from "next/server";

import { handleHodRemove, handleHodUpdate } from "@/lib/hods/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: Context) {
  return handleHodUpdate(request, (await context.params).id);
}

export async function DELETE(request: NextRequest, context: Context) {
  return handleHodRemove(request, (await context.params).id);
}
