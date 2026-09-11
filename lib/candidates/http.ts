import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { ADMIN_SESSION_COOKIE } from "@/lib/auth/constants";
import { hasTrustedMutationOrigin, isJsonRequest, noStoreJson } from "@/lib/auth/http";
import {
  CandidateError,
  candidateService,
  type CandidateService,
} from "@/lib/candidates/service";

const uuid = z.uuid();
const category = z.enum(["FOH", "BOH"]);
const candidateBody = z.object({
  electionId: uuid,
  name: z.string(),
  department: z.string(),
  category,
  isActive: z.boolean().optional(),
}).strict();
const statusBody = z.object({ electionId: uuid, isActive: z.boolean() }).strict();
const electionBody = z.object({ electionId: uuid }).strict();

function token(request: NextRequest): string | undefined {
  return request.cookies.get(ADMIN_SESSION_COOKIE)?.value;
}

function failure(error: unknown): NextResponse {
  if (!(error instanceof CandidateError)) {
    return noStoreJson({ error: "Unable to manage candidates." }, 500);
  }
  const status = {
    VALIDATION: 400,
    DUPLICATE: 409,
    LOCKED: 409,
    NOT_FOUND: 404,
    UNAUTHENTICATED: 401,
    FORBIDDEN: 403,
    INTERNAL: 500,
  }[error.code];
  const message = error.code === "INTERNAL" ? "Unable to manage candidates." : error.message;
  return noStoreJson({ error: message }, status);
}

function mutationRequestError(request: Request): NextResponse | null {
  if (!hasTrustedMutationOrigin(request)) return noStoreJson({ error: "Request rejected." }, 403);
  if (!isJsonRequest(request)) return noStoreJson({ error: "Content-Type must be application/json." }, 415);
  return null;
}

export async function handleCandidateList(
  request: NextRequest,
  service: CandidateService = candidateService,
) {
  const parsed = uuid.safeParse(request.nextUrl.searchParams.get("electionId"));
  if (!parsed.success) return noStoreJson({ error: "A valid electionId is required." }, 400);
  try {
    return noStoreJson({ candidates: await service.list(token(request), parsed.data) });
  } catch (error) {
    return failure(error);
  }
}

export async function handleCandidateCreate(
  request: NextRequest,
  service: CandidateService = candidateService,
) {
  const rejected = mutationRequestError(request);
  if (rejected) return rejected;
  const parsed = candidateBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return noStoreJson({ error: "Invalid request." }, 400);
  try {
    return noStoreJson({ candidate: await service.create(token(request), parsed.data) }, 201);
  } catch (error) {
    return failure(error);
  }
}

export async function handleCandidateUpdate(
  request: NextRequest,
  id: string,
  service: CandidateService = candidateService,
) {
  const rejected = mutationRequestError(request);
  if (rejected) return rejected;
  if (!uuid.safeParse(id).success) return noStoreJson({ error: "Invalid candidate id." }, 400);
  const parsed = candidateBody.omit({ isActive: true }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return noStoreJson({ error: "Invalid request." }, 400);
  try {
    return noStoreJson({ candidate: await service.update(token(request), id, parsed.data) });
  } catch (error) {
    return failure(error);
  }
}

export async function handleCandidateStatus(
  request: NextRequest,
  id: string,
  service: CandidateService = candidateService,
) {
  const rejected = mutationRequestError(request);
  if (rejected) return rejected;
  if (!uuid.safeParse(id).success) return noStoreJson({ error: "Invalid candidate id." }, 400);
  const parsed = statusBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return noStoreJson({ error: "Invalid request." }, 400);
  try {
    return noStoreJson({
      candidate: await service.setActive(
        token(request),
        id,
        parsed.data.electionId,
        parsed.data.isActive,
      ),
    });
  } catch (error) {
    return failure(error);
  }
}

export async function handleCandidateRemove(
  request: NextRequest,
  id: string,
  service: CandidateService = candidateService,
) {
  if (!hasTrustedMutationOrigin(request)) return noStoreJson({ error: "Request rejected." }, 403);
  if (!uuid.safeParse(id).success) return noStoreJson({ error: "Invalid candidate id." }, 400);
  const parsed = electionBody.safeParse({ electionId: request.nextUrl.searchParams.get("electionId") });
  if (!parsed.success) return noStoreJson({ error: "A valid electionId is required." }, 400);
  try {
    await service.remove(token(request), id, parsed.data.electionId);
    return noStoreJson({ removed: true });
  } catch (error) {
    return failure(error);
  }
}
