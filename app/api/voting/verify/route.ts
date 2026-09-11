import { NextRequest } from "next/server";

import { handleHodVerification } from "@/lib/voting/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return handleHodVerification(request);
}

