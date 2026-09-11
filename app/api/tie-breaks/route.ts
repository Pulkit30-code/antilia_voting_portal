import { NextRequest } from "next/server";

import { handleTieBreakCreate, handleTieBreakList } from "@/lib/tie-breaks/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) { return handleTieBreakList(request); }
export async function POST(request: NextRequest) { return handleTieBreakCreate(request); }

