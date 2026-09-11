import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { ADMIN_SESSION_COOKIE } from "@/lib/auth/constants";
import { fingerprintRequestValue } from "@/lib/auth/crypto";
import { hasTrustedMutationOrigin, isJsonRequest, noStoreJson } from "@/lib/auth/http";
import { getServerEnvironment } from "@/lib/env/server";
import {
  TieBreakError,
  tieBreakService,
  type TieBreakService,
} from "@/lib/tie-breaks/service";

const uuid = z.uuid();
const createSchema = z.object({ electionId: uuid, category: z.enum(["FOH", "BOH"]) }).strict();
const verifySchema = z.object({
  name: z.string().min(1).max(160),
  mobileNumber: z.string().min(1).max(40),
  department: z.string().min(1).max(160),
}).strict();
const voteSchema = z.object({ candidateId: uuid }).strict();
const TIE_BREAK_SESSION_COOKIE = "antilia_tie_break_session";
const TIE_BREAK_SESSION_SECONDS = 10 * 60;

type TieBreakHttpService = Pick<
  TieBreakService,
  "list" | "get" | "create" | "control" | "openTieBreaks" | "candidates" | "verifyHod" | "submitVote"
>;

function adminToken(request: NextRequest) {
  return request.cookies.get(ADMIN_SESSION_COOKIE)?.value;
}

function clientAddress(request: Request): string {
  const forwarded = request.headers.get("x-vercel-forwarded-for") ??
    request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip");
  return forwarded?.split(",", 1)[0]?.trim() || "unavailable";
}

function ipHash(request: Request): Uint8Array {
  return fingerprintRequestValue(
    `TIE_BREAK\0${clientAddress(request)}`,
    "ip",
    getServerEnvironment().ANTILIA_RATE_LIMIT_PEPPER,
  );
}

function setVoterCookie(response: NextResponse, token: string) {
  response.cookies.set({
    name: TIE_BREAK_SESSION_COOKIE,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: TIE_BREAK_SESSION_SECONDS,
    path: "/",
    priority: "high",
  });
}

function clearVoterCookie(response: NextResponse) {
  response.cookies.set({
    name: TIE_BREAK_SESSION_COOKIE,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    expires: new Date(0),
    path: "/",
    priority: "high",
  });
}

function failure(error: unknown): NextResponse {
  if (!(error instanceof TieBreakError)) {
    return noStoreJson({ error: "Unable to complete tie-break request." }, 500);
  }
  const status = {
    VALIDATION: 400,
    UNAUTHENTICATED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    LOCKED: 409,
    NO_TIE: 409,
    DUPLICATE: 409,
    NOT_VERIFIED: 401,
    ALREADY_VOTED: 409,
    INVALID_CANDIDATE: 400,
    RATE_LIMITED: 429,
    INTERNAL: 500,
  }[error.code];
  const response = noStoreJson({
    error: error.code === "INTERNAL" ? "Unable to complete tie-break request." : error.message,
  }, status);
  if (error.code === "RATE_LIMITED") {
    response.headers.set("Retry-After", String(error.retryAfterSeconds ?? 900));
  }
  return response;
}

function rejectMutation(request: Request): NextResponse | null {
  if (!hasTrustedMutationOrigin(request)) return noStoreJson({ error: "Request rejected." }, 403);
  if (!isJsonRequest(request)) return noStoreJson({ error: "Content-Type must be application/json." }, 415);
  return null;
}

export async function handleTieBreakList(request: NextRequest, service: TieBreakHttpService = tieBreakService) {
  const electionId = request.nextUrl.searchParams.get("electionId") ?? undefined;
  if (electionId && !uuid.safeParse(electionId).success) {
    return noStoreJson({ error: "Invalid election id." }, 400);
  }
  try {
    return noStoreJson({ tieBreaks: await service.list(adminToken(request), electionId) });
  } catch (error) { return failure(error); }
}

export async function handleTieBreakGet(request: NextRequest, id: string, service: TieBreakHttpService = tieBreakService) {
  if (!uuid.safeParse(id).success) return noStoreJson({ error: "Invalid tie-break id." }, 400);
  try {
    return noStoreJson({ tieBreak: await service.get(adminToken(request), id) });
  } catch (error) { return failure(error); }
}

export async function handleTieBreakCreate(request: NextRequest, service: TieBreakHttpService = tieBreakService) {
  const rejected = rejectMutation(request);
  if (rejected) return rejected;
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return noStoreJson({ error: "Invalid request." }, 400);
  try {
    return noStoreJson({
      tieBreak: await service.create(
        adminToken(request), parsed.data.electionId, parsed.data.category,
      ),
    }, 201);
  } catch (error) { return failure(error); }
}

export async function handleTieBreakControl(
  request: NextRequest,
  id: string,
  action: "open" | "close",
  service: TieBreakHttpService = tieBreakService,
) {
  if (!hasTrustedMutationOrigin(request)) return noStoreJson({ error: "Request rejected." }, 403);
  if (!uuid.safeParse(id).success) return noStoreJson({ error: "Invalid tie-break id." }, 400);
  try {
    return noStoreJson({ tieBreak: await service.control(adminToken(request), id, action) });
  } catch (error) { return failure(error); }
}

export async function handlePublicTieBreakCandidates(
  id: string,
  service: TieBreakHttpService = tieBreakService,
) {
  if (!uuid.safeParse(id).success) return noStoreJson({ error: "Invalid tie-break id." }, 400);
  try {
    return noStoreJson({ candidates: await service.candidates(id) });
  } catch (error) { return failure(error); }
}

export async function handleOpenTieBreaks(service: TieBreakHttpService = tieBreakService) {
  try {
    return noStoreJson({ tieBreaks: await service.openTieBreaks() });
  } catch (error) { return failure(error); }
}

export async function handleTieBreakHodVerification(
  request: NextRequest,
  id: string,
  service: TieBreakHttpService = tieBreakService,
) {
  const rejected = rejectMutation(request);
  if (rejected) return rejected;
  if (!uuid.safeParse(id).success) return noStoreJson({ error: "Invalid tie-break id." }, 400);
  const parsed = verifySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return noStoreJson({ error: "HOD not verified" }, 401);
  try {
    const result = await service.verifyHod(id, parsed.data, ipHash(request));
    const response = noStoreJson({
      verified: true,
      tieBreakId: result.tieBreakId,
      category: result.category,
      expiresAt: result.expiresAt,
    });
    setVoterCookie(response, result.token);
    return response;
  } catch (error) { return failure(error); }
}

export async function handleTieBreakVote(
  request: NextRequest,
  id: string,
  service: TieBreakHttpService = tieBreakService,
) {
  const rejected = rejectMutation(request);
  if (rejected) return rejected;
  if (!uuid.safeParse(id).success) return noStoreJson({ error: "Invalid tie-break id." }, 400);
  const parsed = voteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return noStoreJson({ error: "Invalid candidate selection" }, 400);
  try {
    const result = await service.submitVote(
      request.cookies.get(TIE_BREAK_SESSION_COOKIE)?.value,
      id,
      parsed.data.candidateId,
      ipHash(request),
      request.headers.get("user-agent"),
    );
    const response = noStoreJson({ submitted: true, voteId: result.voteId }, 201);
    clearVoterCookie(response);
    return response;
  } catch (error) { return failure(error); }
}
