import { NextRequest } from "next/server";

import { handleElectionHodBallots } from "@/lib/reporting/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return handleElectionHodBallots(request, (await params).id);
}
