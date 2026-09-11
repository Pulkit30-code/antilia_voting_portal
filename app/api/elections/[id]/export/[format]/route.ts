import { NextRequest } from "next/server";

import { handleElectionExport } from "@/lib/reporting/export-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; format: string }> },
) {
  const { id, format } = await params;
  return handleElectionExport(request, id, format);
}
