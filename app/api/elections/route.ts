import { NextRequest } from "next/server";

import { handleElectionCreate, handleElectionList } from "@/lib/elections/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return handleElectionList(request);
}

export async function POST(request: NextRequest) {
  return handleElectionCreate(request);
}
