import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { ADMIN_SESSION_COOKIE } from "@/lib/auth/constants";
import { hasTrustedMutationOrigin, isJsonRequest, noStoreJson } from "@/lib/auth/http";
import { HodError, hodService, type HodService } from "@/lib/hods/service";

const hodBody = z.object({
  name: z.string(),
  mobileNumber: z.string(),
  department: z.string(),
  isActive: z.boolean().optional(),
}).strict();

const statusBody = z.object({ isActive: z.boolean() }).strict();

function token(request: NextRequest): string | undefined {
  return request.cookies.get(ADMIN_SESSION_COOKIE)?.value;
}

function failure(error: unknown): NextResponse {
  if (!(error instanceof HodError)) return noStoreJson({ error: "Unable to manage HODs." }, 500);
  const status = {
    VALIDATION: 400,
    DUPLICATE_MOBILE: 409,
    LOCKED: 409,
    NOT_FOUND: 404,
    UNAUTHENTICATED: 401,
    FORBIDDEN: 403,
    INTERNAL: 500,
  }[error.code];
  const message = error.code === "INTERNAL" ? "Unable to manage HODs." : error.message;
  return noStoreJson({ error: message }, status);
}

function mutationRequestError(request: Request): NextResponse | null {
  if (!hasTrustedMutationOrigin(request)) return noStoreJson({ error: "Request rejected." }, 403);
  if (!isJsonRequest(request)) return noStoreJson({ error: "Content-Type must be application/json." }, 415);
  return null;
}

export async function handleHodList(request: NextRequest, service: HodService = hodService) {
  try {
    return noStoreJson({ hods: await service.list(token(request)) });
  } catch (error) {
    return failure(error);
  }
}

export async function handleHodCreate(request: NextRequest, service: HodService = hodService) {
  const rejected = mutationRequestError(request);
  if (rejected) return rejected;
  const parsed = hodBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return noStoreJson({ error: "Invalid request." }, 400);
  try {
    return noStoreJson({ hod: await service.create(token(request), parsed.data) }, 201);
  } catch (error) {
    return failure(error);
  }
}

export async function handleHodUpdate(
  request: NextRequest,
  id: string,
  service: HodService = hodService,
) {
  const rejected = mutationRequestError(request);
  if (rejected) return rejected;
  const parsed = hodBody.omit({ isActive: true }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return noStoreJson({ error: "Invalid request." }, 400);
  try {
    return noStoreJson({ hod: await service.update(token(request), id, parsed.data) });
  } catch (error) {
    return failure(error);
  }
}

export async function handleHodStatus(
  request: NextRequest,
  id: string,
  service: HodService = hodService,
) {
  const rejected = mutationRequestError(request);
  if (rejected) return rejected;
  const parsed = statusBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return noStoreJson({ error: "Invalid request." }, 400);
  try {
    return noStoreJson({ hod: await service.setActive(token(request), id, parsed.data.isActive) });
  } catch (error) {
    return failure(error);
  }
}

export async function handleHodRemove(
  request: NextRequest,
  id: string,
  service: HodService = hodService,
) {
  if (!hasTrustedMutationOrigin(request)) return noStoreJson({ error: "Request rejected." }, 403);
  try {
    await service.remove(token(request), id);
    return noStoreJson({ removed: true });
  } catch (error) {
    return failure(error);
  }
}
