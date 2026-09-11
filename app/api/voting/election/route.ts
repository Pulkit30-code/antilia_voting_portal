import { handleOpenElection } from "@/lib/voting/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return handleOpenElection();
}

