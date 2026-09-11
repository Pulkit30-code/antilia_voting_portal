import { NextRequest } from "next/server";

import { handleBallotSubmission } from "@/lib/voting/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return handleBallotSubmission(request);
}
