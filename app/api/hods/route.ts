import { NextRequest } from "next/server";

import { handleHodCreate, handleHodList } from "@/lib/hods/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return handleHodList(request);
}

export async function POST(request: NextRequest) {
  return handleHodCreate(request);
}
