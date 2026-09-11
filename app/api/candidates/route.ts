import { NextRequest } from "next/server";

import { handleCandidateCreate, handleCandidateList } from "@/lib/candidates/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return handleCandidateList(request);
}

export async function POST(request: NextRequest) {
  return handleCandidateCreate(request);
}
