import { NextRequest } from "next/server";

import { handleTieBreakControl } from "@/lib/tie-breaks/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handleTieBreakControl(request, (await params).id, "open");
}

