import { NextRequest } from "next/server";

import {
  handleElectionCancel,
  handleElectionGet,
  handleElectionUpdate,
} from "@/lib/elections/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Context) {
  return handleElectionGet(request, (await context.params).id);
}

export async function PATCH(request: NextRequest, context: Context) {
  return handleElectionUpdate(request, (await context.params).id);
}

export async function DELETE(request: NextRequest, context: Context) {
  return handleElectionCancel(request, (await context.params).id);
}
