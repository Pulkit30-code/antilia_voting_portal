import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

import { AuthenticationError, PasscodeValidationError } from "@/lib/auth/errors";
import { AuthService } from "@/lib/auth/service";
import type {
  AdminRole,
  AdminSession,
  AuthRepository,
  ChangePasscodeResult,
  CredentialRecord,
} from "@/lib/auth/types";

function digest(value: string): Uint8Array {
  return createHash("sha256").update(value).digest();
}

function key(value: Uint8Array): string {
  return Buffer.from(value).toString("hex");
}

class FakeAuthRepository implements AuthRepository {
  credentials = new Map<AdminRole, CredentialRecord>([
    [
      "HR",
      {
        adminPrincipalId: "00000000-0000-0000-0000-000000000001",
        passwordHash: "hash:correct-hr-passcode",
        hashAlgorithm: "argon2id",
      },
    ],
    [
      "SYSTEM",
      {
        adminPrincipalId: "00000000-0000-0000-0000-000000000002",
        passwordHash: "hash:correct-system-passcode",
        hashAlgorithm: "argon2id",
      },
    ],
  ]);
  attempts = new Map<string, number>();
  failures: Array<{ role: AdminRole; rateLimited: boolean }> = [];
  sessions = new Map<
    string,
    AdminSession & { tokenHash: Uint8Array; revoked: boolean; ipHash: Uint8Array }
  >();
  sequence = 0;

  async getBootstrapStatus() {
    return {
      completed: this.credentials.has("HR") || this.credentials.has("SYSTEM"),
    };
  }

  async bootstrapCredentials(input: {
    hrPasswordHash: string;
    systemPasswordHash: string;
    hashAlgorithm: "argon2id";
  }) {
    if ((await this.getBootstrapStatus()).completed) {
      throw new Error("already bootstrapped");
    }
    this.credentials.set("HR", {
      adminPrincipalId: "00000000-0000-0000-0000-000000000001",
      passwordHash: input.hrPasswordHash,
      hashAlgorithm: input.hashAlgorithm,
    });
    this.credentials.set("SYSTEM", {
      adminPrincipalId: "00000000-0000-0000-0000-000000000002",
      passwordHash: input.systemPasswordHash,
      hashAlgorithm: input.hashAlgorithm,
    });
  }

  async getCredential(role: AdminRole) {
    return this.credentials.get(role) ?? null;
  }

  async beginLoginAttempt(role: AdminRole, ipHash: Uint8Array) {
    const attemptKey = `${role}:${key(ipHash)}`;
    const count = this.attempts.get(attemptKey) ?? 0;
    if (count >= 5) return { allowed: false, retryAfterSeconds: 900 };
    this.attempts.set(attemptKey, count + 1);
    return { allowed: true, retryAfterSeconds: 0 };
  }

  async recordLoginFailure(role: AdminRole, rateLimited: boolean) {
    this.failures.push({ role, rateLimited });
  }

  async createSession(input: {
    role: AdminRole;
    ipHash: Uint8Array;
    tokenHash: Uint8Array;
    expiresAt: string;
    userAgentHash: Uint8Array | null;
  }) {
    this.sequence += 1;
    const credential = this.credentials.get(input.role)!;
    const session: AdminSession & {
      tokenHash: Uint8Array;
      revoked: boolean;
      ipHash: Uint8Array;
    } = {
      sessionId: `session-${this.sequence}`,
      adminPrincipalId: credential.adminPrincipalId,
      role: input.role,
      expiresAt: input.expiresAt,
      tokenHash: input.tokenHash,
      revoked: false,
      ipHash: input.ipHash,
    };
    this.sessions.set(key(input.tokenHash), session);
    this.attempts.delete(`${input.role}:${key(input.ipHash)}`);
    return session;
  }

  async validateSession(tokenHash: Uint8Array) {
    const session = this.sessions.get(key(tokenHash));
    if (!session || session.revoked) return null;
    return session;
  }

  async revokeSession(tokenHash: Uint8Array) {
    const session = this.sessions.get(key(tokenHash));
    if (!session || session.revoked) return false;
    session.revoked = true;
    return true;
  }

  async changePasscode(input: {
    actorTokenHash: Uint8Array;
    targetRole: AdminRole;
    passwordHash: string;
    hashAlgorithm: "argon2id";
  }): Promise<ChangePasscodeResult> {
    const credential = this.credentials.get(input.targetRole)!;
    credential.passwordHash = input.passwordHash;
    let revokedSessionCount = 0;
    for (const session of this.sessions.values()) {
      if (
        session.role === input.targetRole &&
        !session.revoked &&
        (input.targetRole === "HR" || key(session.tokenHash) !== key(input.actorTokenHash))
      ) {
        session.revoked = true;
        revokedSessionCount += 1;
      }
    }
    return {
      revokedSessionCount,
      currentSessionRetained: input.targetRole === "SYSTEM",
    };
  }
}

const context = { ipHash: digest("ip"), userAgentHash: digest("ua") };
const fixedNow = new Date("2026-09-10T10:00:00.000Z");

function makeService(repository: FakeAuthRepository, tokens: string[] = []) {
  let tokenSequence = 0;
  return new AuthService({
    repository,
    now: () => fixedNow,
    createToken: () => tokens[tokenSequence++] ?? `opaque-token-${tokenSequence}`.padEnd(43, "x"),
    hashToken: digest,
    hashPassword: async (passcode) => `hash:${passcode}`,
    verifyPassword: async (hash, _algorithm, passcode) => hash === `hash:${passcode}`,
  });
}

describe("administrative authentication service", () => {
  let repository: FakeAuthRepository;
  let service: AuthService;

  beforeEach(() => {
    repository = new FakeAuthRepository();
    service = makeService(repository, [
      "opaque-hr-session-token-0000000000000001",
      "opaque-system-session-token-0000000000001",
      "opaque-next-session-token-000000000000002",
      "opaque-last-session-token-000000000000002",
    ]);
  });

  it("creates an HR session for a valid HR passcode", async () => {
    const result = await service.login("HR", "correct-hr-passcode", context);
    expect(result.ok && result.session.role).toBe("HR");
  });

  it("rejects an invalid HR passcode", async () => {
    expect(await service.login("HR", "wrong", context)).toMatchObject({
      ok: false,
      reason: "INVALID_CREDENTIALS",
    });
  });

  it("creates a SYSTEM session for a valid SYSTEM passcode", async () => {
    const result = await service.login("SYSTEM", "correct-system-passcode", context);
    expect(result.ok && result.session.role).toBe("SYSTEM");
  });

  it("rejects an invalid SYSTEM passcode", async () => {
    expect(await service.login("SYSTEM", "wrong", context)).toMatchObject({
      ok: false,
      reason: "INVALID_CREDENTIALS",
    });
  });

  it("does not allow an HR session to pass a SYSTEM check", async () => {
    const login = await service.login("HR", "correct-hr-passcode", context);
    const token = login.ok ? login.token : "";
    await expect(service.requireRole(token, "SYSTEM")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("allows a SYSTEM session to pass a SYSTEM check", async () => {
    const login = await service.login("SYSTEM", "correct-system-passcode", context);
    await expect(
      service.requireRole(login.ok ? login.token : "", "SYSTEM"),
    ).resolves.toMatchObject({ role: "SYSTEM" });
  });

  it("allows a SYSTEM session to use normal HR operations", async () => {
    const login = await service.login("SYSTEM", "correct-system-passcode", context);
    await expect(
      service.requireRole(login.ok ? login.token : "", "HR"),
    ).resolves.toMatchObject({ role: "SYSTEM" });
  });

  it("rejects an unauthenticated request", async () => {
    await expect(service.requireRole(undefined, "HR")).rejects.toBeInstanceOf(
      AuthenticationError,
    );
  });

  it("rejects an expired session even if the repository returns it", async () => {
    const token = "expired-session-token-000000000000000000";
    repository.sessions.set(key(digest(token)), {
      sessionId: "expired",
      adminPrincipalId: "admin",
      role: "HR",
      expiresAt: "2026-09-10T09:59:59.000Z",
      tokenHash: digest(token),
      revoked: false,
      ipHash: context.ipHash,
    });
    expect(await service.getSession(token)).toBeNull();
  });

  it("rejects a revoked session", async () => {
    const login = await service.login("HR", "correct-hr-passcode", context);
    const token = login.ok ? login.token : "";
    await repository.revokeSession(digest(token));
    expect(await service.getSession(token)).toBeNull();
  });

  it("logout invalidates the server-side session", async () => {
    const login = await service.login("HR", "correct-hr-passcode", context);
    const token = login.ok ? login.token : "";
    await service.logout(token);
    expect(await service.getSession(token)).toBeNull();
  });

  it("stores only a token hash and never the raw session token", async () => {
    const login = await service.login("HR", "correct-hr-passcode", context);
    if (!login.ok) throw new Error("Expected successful login");
    expect(repository.sessions.has(login.token)).toBe(false);
    expect(repository.sessions.has(key(digest(login.token)))).toBe(true);
  });

  it("rate-limits the sixth failed attempt", async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(await service.login("HR", "wrong", context)).toMatchObject({
        ok: false,
        reason: "INVALID_CREDENTIALS",
      });
    }
    expect(await service.login("HR", "wrong", context)).toMatchObject({
      ok: false,
      reason: "RATE_LIMITED",
      retryAfterSeconds: 900,
    });
  });

  it("permits a successful login after allowed failures and clears the counter", async () => {
    await service.login("HR", "wrong", context);
    await service.login("HR", "wrong", context);
    expect(await service.login("HR", "correct-hr-passcode", context)).toMatchObject({
      ok: true,
    });
    expect(await service.login("HR", "wrong", context)).toMatchObject({
      reason: "INVALID_CREDENTIALS",
    });
  });

  it("changing the HR passcode invalidates existing HR sessions", async () => {
    const hr = await service.login("HR", "correct-hr-passcode", context);
    const system = await service.login("SYSTEM", "correct-system-passcode", context);
    await service.changePasscode({
      token: system.ok ? system.token : "",
      targetRole: "HR",
      newPasscode: "Quartz!River-2026-HR",
    });
    expect(await service.getSession(hr.ok ? hr.token : "")).toBeNull();
  });

  it("rejects the old HR passcode after a change", async () => {
    const system = await service.login("SYSTEM", "correct-system-passcode", context);
    await service.changePasscode({
      token: system.ok ? system.token : "",
      targetRole: "HR",
      newPasscode: "Quartz!River-2026-HR",
    });
    expect(await service.login("HR", "correct-hr-passcode", context)).toMatchObject({
      reason: "INVALID_CREDENTIALS",
    });
  });

  it("accepts the new HR passcode after a change", async () => {
    const system = await service.login("SYSTEM", "correct-system-passcode", context);
    await service.changePasscode({
      token: system.ok ? system.token : "",
      targetRole: "HR",
      newPasscode: "Quartz!River-2026-HR",
    });
    expect(await service.login("HR", "Quartz!River-2026-HR", context)).toMatchObject({
      ok: true,
    });
  });

  it("SYSTEM passcode change retains the caller and revokes other SYSTEM sessions", async () => {
    const first = await service.login("SYSTEM", "correct-system-passcode", context);
    const second = await service.login("SYSTEM", "correct-system-passcode", context);
    const result = await service.changePasscode({
      token: first.ok ? first.token : "",
      targetRole: "SYSTEM",
      currentSystemPasscode: "correct-system-passcode",
      newPasscode: "Copper!Sky-2026-System",
    });
    expect(result.currentSessionRetained).toBe(true);
    expect(await service.getSession(first.ok ? first.token : "")).not.toBeNull();
    expect(await service.getSession(second.ok ? second.token : "")).toBeNull();
  });

  it("requires current SYSTEM passcode confirmation for a SYSTEM change", async () => {
    const system = await service.login("SYSTEM", "correct-system-passcode", context);
    await expect(
      service.changePasscode({
        token: system.ok ? system.token : "",
        targetRole: "SYSTEM",
        currentSystemPasscode: "wrong",
        newPasscode: "Copper!Sky-2026-System",
      }),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
  });

  it("rejects known-weak replacement passcodes", async () => {
    const system = await service.login("SYSTEM", "correct-system-passcode", context);
    await expect(
      service.changePasscode({
        token: system.ok ? system.token : "",
        targetRole: "HR",
        newPasscode: "password",
      }),
    ).rejects.toBeInstanceOf(PasscodeValidationError);
  });

  it("atomically initializes distinct HR and SYSTEM passcode hashes", async () => {
    repository.credentials.clear();
    await service.bootstrap({
      hrPasscode: "HR-secure-value-42",
      systemPasscode: "SYSTEM-secure-value-84",
    });
    expect(repository.credentials.get("HR")?.passwordHash).toBe(
      "hash:HR-secure-value-42",
    );
    expect(repository.credentials.get("SYSTEM")?.passwordHash).toBe(
      "hash:SYSTEM-secure-value-84",
    );
  });

  it("refuses bootstrap after credentials exist", async () => {
    await expect(
      service.bootstrap({
        hrPasscode: "HR-secure-value-42",
        systemPasscode: "SYSTEM-secure-value-84",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects identical or obvious bootstrap passcodes", async () => {
    repository.credentials.clear();
    await expect(
      service.bootstrap({
        hrPasscode: "abcdefgh",
        systemPasscode: "SYSTEM-secure-value-84",
      }),
    ).rejects.toBeInstanceOf(PasscodeValidationError);
    await expect(
      service.bootstrap({
        hrPasscode: "shared-secure-value",
        systemPasscode: "shared-secure-value",
      }),
    ).rejects.toBeInstanceOf(PasscodeValidationError);
  });
});
