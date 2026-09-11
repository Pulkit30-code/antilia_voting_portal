import { NextRequest } from "next/server";

import { handleElectionTurnout } from "@/lib/reporting/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return handleElectionTurnout(request, (await params).id);
}

