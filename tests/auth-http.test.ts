import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

import { ADMIN_SESSION_COOKIE } from "@/lib/auth/constants";
import {
  handleBootstrap,
  handleLogin,
  handleLogout,
  handlePasscodeChange,
  handleSession,
  hasTrustedMutationOrigin,
  noStoreJson,
} from "@/lib/auth/http";
import type { AuthService } from "@/lib/auth/service";

function request(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    origin?: string;
    cookie?: string;
    contentType?: string;
  } = {},
) {
  const headers = new Headers({
    host: "portal.example.test",
    "user-agent": "vitest",
    "x-forwarded-for": "192.0.2.8",
  });
  if (options.origin) headers.set("origin", options.origin);
  if (options.cookie) headers.set("cookie", options.cookie);
  if (options.body !== undefined) {
    headers.set("content-type", options.contentType ?? "application/json");
  }
  return new NextRequest(`https://portal.example.test${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

function serviceStub(overrides: Partial<AuthService> = {}): AuthService {
  return {
    login: vi.fn().mockResolvedValue({
      ok: true,
      token: "opaque-session-token-without-role-markers-00001",
      session: {
        sessionId: "session-id",
        adminPrincipalId: "admin-id",
        role: "HR",
        expiresAt: "2026-09-10T18:00:00.000Z",
      },
    }),
    getSession: vi.fn().mockResolvedValue({
      sessionId: "session-id",
      adminPrincipalId: "admin-id",
      role: "HR",
      expiresAt: "2026-09-10T18:00:00.000Z",
    }),
    logout: vi.fn().mockResolvedValue(undefined),
    changePasscode: vi.fn().mockResolvedValue({
      revokedSessionCount: 2,
      currentSessionRetained: false,
    }),
    bootstrap: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as AuthService;
}

describe("authentication HTTP boundary", () => {
  it("sets a secure opaque HttpOnly session cookie after login", async () => {
    const response = await handleLogin(
      request("/api/auth/hr/login", {
        method: "POST",
        origin: "https://portal.example.test",
        body: { passcode: "correct passcode" },
      }),
      "HR",
      serviceStub(),
    );
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`${ADMIN_SESSION_COOKIE}=opaque-session-token`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=lax");
    expect(cookie).toContain("Path=/");
    expect(cookie).not.toMatch(/hr|system/i);
  });

  it("never returns a password hash or Supabase secret from login", async () => {
    const response = await handleLogin(
      request("/api/auth/system/login", {
        method: "POST",
        body: { passcode: "correct passcode" },
      }),
      "SYSTEM",
      serviceStub({
        login: vi.fn().mockResolvedValue({
          ok: true,
          token: "opaque-session-token-without-role-markers-00001",
          session: {
            sessionId: "session-id",
            adminPrincipalId: "admin-id",
            role: "SYSTEM",
            expiresAt: "2026-09-10T18:00:00.000Z",
          },
        }),
      }),
    );
    const body = await response.text();
    expect(body).not.toContain("passwordHash");
    expect(body).not.toContain("hash_algorithm");
    expect(body).not.toContain(process.env.SUPABASE_SECRET_KEY!);
  });

  it("returns only minimal current-session fields", async () => {
    const response = await handleSession(
      request("/api/auth/session", {
        cookie: `${ADMIN_SESSION_COOKIE}=raw-browser-token`,
      }),
      serviceStub(),
    );
    expect(await response.json()).toEqual({
      authenticated: true,
      role: "HR",
      expiresAt: "2026-09-10T18:00:00.000Z",
    });
  });

  it("returns a generic invalid-credentials response", async () => {
    const response = await handleLogin(
      request("/api/auth/hr/login", {
        method: "POST",
        body: { passcode: "wrong" },
      }),
      "HR",
      serviceStub({
        login: vi.fn().mockResolvedValue({
          ok: false,
          reason: "INVALID_CREDENTIALS",
        }),
      }),
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Invalid credentials." });
  });

  it("rejects a non-JSON login body", async () => {
    const response = await handleLogin(
      request("/api/auth/hr/login", {
        method: "POST",
        body: { passcode: "value" },
        contentType: "text/plain",
      }),
      "HR",
      serviceStub(),
    );
    expect(response.status).toBe(415);
  });

  it("rejects an obviously cross-origin administrative mutation", async () => {
    const crossOrigin = request("/api/auth/passcodes/hr", {
      method: "POST",
      origin: "https://attacker.example",
      body: { newPasscode: "long-enough-passcode" },
    });
    expect(hasTrustedMutationOrigin(crossOrigin)).toBe(false);
    const response = await handlePasscodeChange(
      crossOrigin,
      "HR",
      serviceStub(),
    );
    expect(response.status).toBe(403);
  });

  it("invalidates the database session and clears the cookie on logout", async () => {
    const service = serviceStub();
    const response = await handleLogout(
      request("/api/auth/logout", {
        method: "POST",
        origin: "https://portal.example.test",
        cookie: `${ADMIN_SESSION_COOKIE}=raw-browser-token`,
      }),
      service,
    );
    expect(service.logout).toHaveBeenCalledWith("raw-browser-token");
    expect(response.headers.get("set-cookie")).toContain(
      `${ADMIN_SESSION_COOKIE}=;`,
    );
  });

  it("marks authentication responses private and non-cacheable", () => {
    const response = noStoreJson({ ok: true });
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("cache-control")).toContain("private");
    expect(response.headers.get("pragma")).toBe("no-cache");
  });

  it("does not leak stack traces or internal errors", async () => {
    const response = await handleLogin(
      request("/api/auth/hr/login", {
        method: "POST",
        body: { passcode: "anything" },
      }),
      "HR",
      serviceStub({ login: vi.fn().mockRejectedValue(new Error("database secret")) }),
    );
    expect(response.status).toBe(500);
    const body = await response.text();
    expect(body).not.toContain("database secret");
    expect(body).not.toContain("stack");
  });

  it("allows bootstrap only in development and returns no credentials", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const service = serviceStub();
    const response = await handleBootstrap(
      request("/api/auth/bootstrap", {
        method: "POST",
        origin: "https://portal.example.test",
        body: {
          hrPasscode: "HR-secure-value-42",
          systemPasscode: "SYSTEM-secure-value-84",
        },
      }),
      service,
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ initialized: true });
    expect(service.bootstrap).toHaveBeenCalledOnce();
    vi.unstubAllEnvs();
  });

  it("hides bootstrap outside development", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const service = serviceStub();
    const response = await handleBootstrap(
      request("/api/auth/bootstrap", {
        method: "POST",
        body: {
          hrPasscode: "HR-secure-value-42",
          systemPasscode: "SYSTEM-secure-value-84",
        },
      }),
      service,
    );
    expect(response.status).toBe(404);
    expect(service.bootstrap).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });
});
