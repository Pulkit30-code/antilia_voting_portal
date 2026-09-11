import { handlePublicTieBreakCandidates } from "@/lib/tie-breaks/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handlePublicTieBreakCandidates((await params).id);
}

