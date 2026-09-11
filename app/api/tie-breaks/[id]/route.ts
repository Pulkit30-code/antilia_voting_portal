import { NextRequest } from "next/server";

import { handleTieBreakGet } from "@/lib/tie-breaks/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handleTieBreakGet(request, (await params).id);
}

