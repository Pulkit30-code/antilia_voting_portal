import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { fingerprintRequestValue } from "@/lib/auth/crypto";
import { hasTrustedMutationOrigin, isJsonRequest, noStoreJson } from "@/lib/auth/http";
import { getServerEnvironment } from "@/lib/env/server";
import {
  VOTER_SESSION_COOKIE,
  VOTER_SESSION_MAX_AGE_SECONDS,
} from "@/lib/voting/constants";
import {
  VotingError,
  votingService,
  type CandidateCategory,
  type VotingService,
} from "@/lib/voting/service";

type VotingHttpService = Pick<
  VotingService,
  "getOpenElection" | "getCandidates" | "verifyHod" | "submitBallot"
>;

const verifySchema = z.object({
  name: z.string().min(1).max(160),
  mobileNumber: z.string().min(1).max(40),
  department: z.string().min(1).max(160),
}).strict();

const ballotSchema = z.object({
  fohCandidateId: z.uuid(),
  bohCandidateId: z.uuid(),
}).strict();

function clientAddress(request: Request): string {
  const forwarded =
    request.headers.get("x-vercel-forwarded-for") ??
    request.headers.get("x-forwarded-for") ??
    request.headers.get("x-real-ip");
  return forwarded?.split(",", 1)[0]?.trim() || "unavailable";
}

function requestIpHash(request: Request): Uint8Array {
  return fingerprintRequestValue(
    `VOTING\0${clientAddress(request)}`,
    "ip",
    getServerEnvironment().ANTILIA_RATE_LIMIT_PEPPER,
  );
}

function setVoterCookie(response: NextResponse, token: string): void {
  response.cookies.set({
    name: VOTER_SESSION_COOKIE,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: VOTER_SESSION_MAX_AGE_SECONDS,
    path: "/",
    priority: "high",
  });
}

function clearVoterCookie(response: NextResponse): void {
  response.cookies.set({
    name: VOTER_SESSION_COOKIE,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    expires: new Date(0),
    path: "/",
    priority: "high",
  });
}

function errorResponse(error: unknown): NextResponse {
  if (!(error instanceof VotingError)) {
    return noStoreJson({ error: "Unable to complete voting request." }, 500);
  }
  const status = {
    VALIDATION: 400,
    ELECTION_NOT_OPEN: 409,
    HOD_NOT_VERIFIED: 401,
    ALREADY_VOTED: 409,
    INVALID_CANDIDATE: 400,
    RATE_LIMITED: 429,
    INTERNAL: 500,
  }[error.code];
  const response = noStoreJson({
    error: error.code === "INTERNAL" ? "Unable to complete voting request." : error.message,
  }, status);
  if (error.code === "RATE_LIMITED") {
    response.headers.set("Retry-After", String(error.retryAfterSeconds ?? 900));
  }
  return response;
}

export async function handleOpenElection(
  service: VotingHttpService = votingService,
): Promise<NextResponse> {
  try {
    return noStoreJson({ election: await service.getOpenElection() });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleCandidateList(
  category: CandidateCategory,
  service: VotingHttpService = votingService,
): Promise<NextResponse> {
  try {
    return noStoreJson({ candidates: await service.getCandidates(category) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleHodVerification(
  request: NextRequest,
  service: VotingHttpService = votingService,
): Promise<NextResponse> {
  if (!hasTrustedMutationOrigin(request)) return noStoreJson({ error: "Request rejected." }, 403);
  if (!isJsonRequest(request)) {
    return noStoreJson({ error: "Content-Type must be application/json." }, 415);
  }
  const parsed = verifySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return noStoreJson({ error: "HOD not verified" }, 401);
  try {
    const result = await service.verifyHod(parsed.data, requestIpHash(request));
    const response = noStoreJson({
      verified: true,
      election: result.election,
      expiresAt: result.expiresAt,
    });
    setVoterCookie(response, result.token);
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleBallotSubmission(
  request: NextRequest,
  service: VotingHttpService = votingService,
): Promise<NextResponse> {
  if (!hasTrustedMutationOrigin(request)) return noStoreJson({ error: "Request rejected." }, 403);
  if (!isJsonRequest(request)) {
    return noStoreJson({ error: "Content-Type must be application/json." }, 415);
  }
  const parsed = ballotSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return noStoreJson({ error: "Invalid candidate selection" }, 400);
  try {
    const result = await service.submitBallot(
      request.cookies.get(VOTER_SESSION_COOKIE)?.value,
      parsed.data,
      requestIpHash(request),
      request.headers.get("user-agent"),
    );
    const response = noStoreJson({ submitted: true, ballotId: result.ballotId }, 201);
    clearVoterCookie(response);
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
