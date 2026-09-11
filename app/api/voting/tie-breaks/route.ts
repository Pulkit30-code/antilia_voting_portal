import { handleOpenTieBreaks } from "@/lib/tie-breaks/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return handleOpenTieBreaks();
}
