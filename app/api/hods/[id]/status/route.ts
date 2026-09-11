import { NextRequest } from "next/server";

import { handleHodStatus } from "@/lib/hods/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: Context) {
  return handleHodStatus(request, (await context.params).id);
}
