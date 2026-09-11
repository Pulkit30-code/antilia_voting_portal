import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { ADMIN_SESSION_COOKIE } from "@/lib/auth/constants";
import { hasTrustedMutationOrigin, isJsonRequest, noStoreJson } from "@/lib/auth/http";
import {
  ElectionError,
  electionService,
  type ElectionService,
  type ElectionSystemAction,
} from "@/lib/elections/service";

const uuid = z.uuid();
const electionBody = z.object({
  name: z.string(),
  month: z.number().int(),
  year: z.number().int(),
}).strict();

function token(request: NextRequest): string | undefined {
  return request.cookies.get(ADMIN_SESSION_COOKIE)?.value;
}

function failure(error: unknown): NextResponse {
  if (!(error instanceof ElectionError)) {
    return noStoreJson({ error: "Unable to manage elections." }, 500);
  }
  const status = {
    VALIDATION: 400,
    DUPLICATE_MONTH: 409,
    LOCKED: 409,
    NOT_FOUND: 404,
    UNAUTHENTICATED: 401,
    FORBIDDEN: 403,
    INTERNAL: 500,
  }[error.code];
  const message = error.code === "INTERNAL" ? "Unable to manage elections." : error.message;
  return noStoreJson({ error: message }, status);
}

function mutationRequestError(request: Request): NextResponse | null {
  if (!hasTrustedMutationOrigin(request)) return noStoreJson({ error: "Request rejected." }, 403);
  if (!isJsonRequest(request)) return noStoreJson({ error: "Content-Type must be application/json." }, 415);
  return null;
}

export async function handleElectionList(
  request: NextRequest,
  service: ElectionService = electionService,
) {
  try {
    return noStoreJson({ elections: await service.list(token(request)) });
  } catch (error) {
    return failure(error);
  }
}

export async function handleElectionGet(
  request: NextRequest,
  id: string,
  service: ElectionService = electionService,
) {
  if (!uuid.safeParse(id).success) return noStoreJson({ error: "Invalid election id." }, 400);
  try {
    return noStoreJson({ election: await service.get(token(request), id) });
  } catch (error) {
    return failure(error);
  }
}

export async function handleElectionCreate(
  request: NextRequest,
  service: ElectionService = electionService,
) {
  const rejected = mutationRequestError(request);
  if (rejected) return rejected;
  const parsed = electionBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return noStoreJson({ error: "Invalid request." }, 400);
  try {
    return noStoreJson({ election: await service.create(token(request), parsed.data) }, 201);
  } catch (error) {
    return failure(error);
  }
}

export async function handleElectionUpdate(
  request: NextRequest,
  id: string,
  service: ElectionService = electionService,
) {
  const rejected = mutationRequestError(request);
  if (rejected) return rejected;
  if (!uuid.safeParse(id).success) return noStoreJson({ error: "Invalid election id." }, 400);
  const parsed = electionBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return noStoreJson({ error: "Invalid request." }, 400);
  try {
    return noStoreJson({ election: await service.update(token(request), id, parsed.data) });
  } catch (error) {
    return failure(error);
  }
}

export async function handleElectionCancel(
  request: NextRequest,
  id: string,
  service: ElectionService = electionService,
) {
  if (!hasTrustedMutationOrigin(request)) return noStoreJson({ error: "Request rejected." }, 403);
  if (!uuid.safeParse(id).success) return noStoreJson({ error: "Invalid election id." }, 400);
  try {
    await service.cancel(token(request), id);
    return noStoreJson({ cancelled: true });
  } catch (error) {
    return failure(error);
  }
}

export async function handleElectionSystemAction(
  request: NextRequest,
  id: string,
  action: ElectionSystemAction,
  service: ElectionService = electionService,
) {
  if (!hasTrustedMutationOrigin(request)) return noStoreJson({ error: "Request rejected." }, 403);
  if (!uuid.safeParse(id).success) return noStoreJson({ error: "Invalid election details" }, 400);
  try {
    return noStoreJson({ election: await service.systemAction(token(request), id, action) });
  } catch (error) {
    return failure(error);
  }
}
