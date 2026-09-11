import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { ADMIN_SESSION_COOKIE } from "@/lib/auth/constants";
import { noStoreJson } from "@/lib/auth/http";
import {
  ReportingError,
  reportingService,
  type ReportingService,
} from "@/lib/reporting/service";

const uuid = z.uuid();
type ReportingHttpService = Pick<ReportingService, "results" | "turnout" | "hodBallots">;

function token(request: NextRequest): string | undefined {
  return request.cookies.get(ADMIN_SESSION_COOKIE)?.value;
}

function failure(error: unknown): NextResponse {
  if (!(error instanceof ReportingError)) {
    return noStoreJson({ error: "Unable to load election reporting." }, 500);
  }
  const status = {
    UNAUTHENTICATED: 401,
    FORBIDDEN: 403,
    NOT_AVAILABLE: 409,
    NOT_FOUND: 404,
    INTERNAL: 500,
  }[error.code];
  return noStoreJson({
    error: error.code === "INTERNAL" ? "Unable to load election reporting." : error.message,
  }, status);
}

function invalidElectionId(id: string): NextResponse | null {
  return uuid.safeParse(id).success
    ? null
    : noStoreJson({ error: "Invalid election id." }, 400);
}

export async function handleElectionResults(
  request: NextRequest,
  electionId: string,
  service: ReportingHttpService = reportingService,
) {
  const invalid = invalidElectionId(electionId);
  if (invalid) return invalid;
  try {
    return noStoreJson({ results: await service.results(token(request), electionId) });
  } catch (error) {
    return failure(error);
  }
}

export async function handleElectionTurnout(
  request: NextRequest,
  electionId: string,
  service: ReportingHttpService = reportingService,
) {
  const invalid = invalidElectionId(electionId);
  if (invalid) return invalid;
  try {
    return noStoreJson({ turnout: await service.turnout(token(request), electionId) });
  } catch (error) {
    return failure(error);
  }
}

export async function handleElectionHodBallots(
  request: NextRequest,
  electionId: string,
  service: ReportingHttpService = reportingService,
) {
  const invalid = invalidElectionId(electionId);
  if (invalid) return invalid;
  try {
    return noStoreJson({ hods: await service.hodBallots(token(request), electionId) });
  } catch (error) {
    return failure(error);
  }
}

