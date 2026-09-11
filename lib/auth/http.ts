import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_MAX_AGE_SECONDS,
} from "@/lib/auth/constants";
import { fingerprintRequestValue } from "@/lib/auth/crypto";
import {
  AuthenticationError,
  PasscodeValidationError,
} from "@/lib/auth/errors";
import { authService, type AuthService } from "@/lib/auth/service";
import type { AdminRole, LoginRequestContext } from "@/lib/auth/types";
import { getServerEnvironment } from "@/lib/env/server";
import { isSetupModeEnabled } from "@/lib/auth/setup-mode";

const loginBodySchema = z.object({
  passcode: z.string().min(1).max(256),
});

const passcodeChangeBodySchema = z.object({
  newPasscode: z.string().min(1).max(256),
  currentSystemPasscode: z.string().min(1).max(256).optional(),
});

const bootstrapBodySchema = z.object({
  hrPasscode: z.string().min(1).max(256),
  systemPasscode: z.string().min(1).max(256),
});

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0, must-revalidate",
  Expires: "0",
  Pragma: "no-cache",
  Vary: "Cookie",
} as const;

export function noStoreJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE_HEADERS });
}

export function isJsonRequest(request: Request): boolean {
  return request.headers
    .get("content-type")
    ?.toLowerCase()
    .startsWith("application/json") ?? false;
}

export function hasTrustedMutationOrigin(request: Request): boolean {
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;

  const origin = request.headers.get("origin");
  if (!origin) return true;

  const host =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!host) return false;

  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function clientAddress(request: Request): string {
  const forwarded =
    request.headers.get("x-vercel-forwarded-for") ??
    request.headers.get("x-forwarded-for") ??
    request.headers.get("x-real-ip");
  return forwarded?.split(",", 1)[0]?.trim() || "unavailable";
}

export function requestContext(
  request: Request,
  role: AdminRole,
): LoginRequestContext {
  const { ANTILIA_RATE_LIMIT_PEPPER } = getServerEnvironment();
  const userAgent = request.headers.get("user-agent");
  return {
    ipHash: fingerprintRequestValue(
      `${role}\0${clientAddress(request)}`,
      "ip",
      ANTILIA_RATE_LIMIT_PEPPER,
    ),
    userAgentHash: userAgent
      ? fingerprintRequestValue(
          userAgent,
          "user-agent",
          ANTILIA_RATE_LIMIT_PEPPER,
        )
      : null,
  };
}

function setSessionCookie(response: NextResponse, token: string): void {
  response.cookies.set({
    name: ADMIN_SESSION_COOKIE,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: ADMIN_SESSION_MAX_AGE_SECONDS,
    path: "/",
    priority: "high",
  });
}

function clearSessionCookie(response: NextResponse): void {
  response.cookies.set({
    name: ADMIN_SESSION_COOKIE,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    expires: new Date(0),
    path: "/",
    priority: "high",
  });
}

function tokenFromRequest(request: NextRequest): string | undefined {
  return request.cookies.get(ADMIN_SESSION_COOKIE)?.value;
}

export async function handleLogin(
  request: NextRequest,
  role: AdminRole,
  service: AuthService = authService,
): Promise<NextResponse> {
  if (!hasTrustedMutationOrigin(request)) {
    return noStoreJson({ error: "Request rejected." }, 403);
  }
  if (!isJsonRequest(request)) {
    return noStoreJson({ error: "Content-Type must be application/json." }, 415);
  }

  const parsed = loginBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return noStoreJson({ error: "Invalid credentials." }, 401);
  }

  try {
    const result = await service.login(
      role,
      parsed.data.passcode,
      requestContext(request, role),
    );
    if (!result.ok) {
      if (result.reason === "RATE_LIMITED") {
        const response = noStoreJson(
          { error: "Too many attempts. Try again later." },
          429,
        );
        response.headers.set(
          "Retry-After",
          String(result.retryAfterSeconds ?? 900),
        );
        return response;
      }
      return noStoreJson({ error: "Invalid credentials." }, 401);
    }

    const response = noStoreJson({
      authenticated: true,
      role: result.session.role,
      expiresAt: result.session.expiresAt,
    });
    setSessionCookie(response, result.token);
    return response;
  } catch {
    return noStoreJson({ error: "Unable to complete authentication." }, 500);
  }
}

export async function handleSession(
  request: NextRequest,
  service: AuthService = authService,
): Promise<NextResponse> {
  try {
    const session = await service.getSession(tokenFromRequest(request));
    if (!session) return noStoreJson({ authenticated: false }, 401);
    return noStoreJson({
      authenticated: true,
      role: session.role,
      expiresAt: session.expiresAt,
    });
  } catch {
    return noStoreJson({ authenticated: false }, 401);
  }
}

export async function handleLogout(
  request: NextRequest,
  service: AuthService = authService,
): Promise<NextResponse> {
  if (!hasTrustedMutationOrigin(request)) {
    return noStoreJson({ error: "Request rejected." }, 403);
  }
  try {
    await service.logout(tokenFromRequest(request));
    const response = noStoreJson({ authenticated: false });
    clearSessionCookie(response);
    return response;
  } catch {
    return noStoreJson({ error: "Unable to complete logout." }, 500);
  }
}

export async function handlePasscodeChange(
  request: NextRequest,
  targetRole: AdminRole,
  service: AuthService = authService,
): Promise<NextResponse> {
  if (!hasTrustedMutationOrigin(request)) {
    return noStoreJson({ error: "Request rejected." }, 403);
  }
  if (!isJsonRequest(request)) {
    return noStoreJson({ error: "Content-Type must be application/json." }, 415);
  }

  const parsed = passcodeChangeBodySchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) return noStoreJson({ error: "Invalid request." }, 400);

  try {
    const result = await service.changePasscode({
      token: tokenFromRequest(request),
      targetRole,
      newPasscode: parsed.data.newPasscode,
      currentSystemPasscode: parsed.data.currentSystemPasscode,
    });
    return noStoreJson({
      changed: true,
      revokedSessionCount: result.revokedSessionCount,
      currentSessionRetained: result.currentSessionRetained,
    });
  } catch (error) {
    if (error instanceof PasscodeValidationError) {
      return noStoreJson({ error: error.message }, 400);
    }
    if (error instanceof AuthenticationError) {
      if (error.code === "INVALID_CREDENTIALS" && targetRole === "SYSTEM") {
        return noStoreJson(
          { error: "Current SYSTEM passcode is incorrect." },
          401,
        );
      }
      return noStoreJson(
        { error: error.code === "FORBIDDEN" ? "Forbidden." : "Unauthorized." },
        error.code === "FORBIDDEN" ? 403 : 401,
      );
    }
    return noStoreJson({ error: "Unable to change passcode." }, 500);
  }
}

export async function handleBootstrap(
  request: NextRequest,
  service: AuthService = authService,
): Promise<NextResponse> {
  if (!isSetupModeEnabled()) {
    return noStoreJson({ error: "Not found." }, 404);
  }
  if (!hasTrustedMutationOrigin(request)) {
    return noStoreJson({ error: "Request rejected." }, 403);
  }
  if (!isJsonRequest(request)) {
    return noStoreJson({ error: "Content-Type must be application/json." }, 415);
  }

  const parsed = bootstrapBodySchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) return noStoreJson({ error: "Invalid request." }, 400);

  try {
    await service.bootstrap(parsed.data);
    return noStoreJson({ initialized: true }, 201);
  } catch (error) {
    if (error instanceof PasscodeValidationError) {
      return noStoreJson({ error: error.message }, 400);
    }
    if (error instanceof AuthenticationError) {
      return noStoreJson({ error: "Setup has already been completed." }, 409);
    }
    return noStoreJson({ error: "Unable to initialize access." }, 500);
  }
}
