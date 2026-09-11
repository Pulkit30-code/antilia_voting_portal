import { NextRequest } from "next/server";

import { handleTieBreakVote } from "@/lib/tie-breaks/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handleTieBreakVote(request, (await params).id);
}
