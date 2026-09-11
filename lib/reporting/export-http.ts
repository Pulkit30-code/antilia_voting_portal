import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { ADMIN_SESSION_COOKIE } from "@/lib/auth/constants";
import { ElectionError, electionService, type ElectionService } from "@/lib/elections/service";
import {
  createElectionExport,
  exportFilename,
  exportMimeType,
  type ExportFormat,
} from "@/lib/reporting/export";
import { ReportingError, reportingService, type ReportingService } from "@/lib/reporting/service";

const uuid = z.uuid();
const formats = new Set<ExportFormat>(["csv", "xlsx", "pdf"]);

type ExportElectionService = Pick<ElectionService, "get">;
type ExportReportingService = Pick<ReportingService, "results" | "turnout" | "hodBallots">;

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0, must-revalidate",
  Expires: "0",
  Pragma: "no-cache",
  Vary: "Cookie",
} as const;

function errorResponse(error: unknown): NextResponse {
  if (error instanceof ReportingError || error instanceof ElectionError) {
    const status = {
      UNAUTHENTICATED: 401,
      FORBIDDEN: 403,
      NOT_FOUND: 404,
      NOT_AVAILABLE: 409,
      VALIDATION: 400,
      DUPLICATE_MONTH: 409,
      LOCKED: 409,
      INTERNAL: 500,
    }[error.code];
    return NextResponse.json(
      { error: status === 500 ? "Unable to export election results." : error.message },
      { status, headers: NO_STORE_HEADERS },
    );
  }
  return NextResponse.json(
    { error: "Unable to export election results." },
    { status: 500, headers: NO_STORE_HEADERS },
  );
}

export async function handleElectionExport(
  request: NextRequest,
  electionId: string,
  requestedFormat: string,
  elections: ExportElectionService = electionService,
  reporting: ExportReportingService = reportingService,
): Promise<NextResponse> {
  if (!uuid.safeParse(electionId).success) {
    return NextResponse.json({ error: "Invalid election id." }, { status: 400, headers: NO_STORE_HEADERS });
  }
  if (!formats.has(requestedFormat as ExportFormat)) {
    return NextResponse.json({ error: "Unsupported export format." }, { status: 400, headers: NO_STORE_HEADERS });
  }

  const format = requestedFormat as ExportFormat;
  const token = request.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  try {
    const [election, results, turnout, ballots] = await Promise.all([
      elections.get(token, electionId),
      reporting.results(token, electionId),
      reporting.turnout(token, electionId),
      reporting.hodBallots(token, electionId),
    ]);
    const bytes = await createElectionExport({ election, results, turnout, ballots }, format);
    const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    return new NextResponse(body, {
      headers: {
        ...NO_STORE_HEADERS,
        "Content-Type": exportMimeType(format),
        "Content-Disposition": `attachment; filename="${exportFilename(election, format)}"`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
