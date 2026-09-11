import { NextRequest } from "next/server";

import { handleElectionSystemAction } from "@/lib/elections/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Context) {
  return handleElectionSystemAction(request, (await context.params).id, "close");
}
