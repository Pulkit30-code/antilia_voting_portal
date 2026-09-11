import "server-only";

import {
  ADMIN_SESSION_MAX_AGE_SECONDS,
  ADMIN_SESSION_TOKEN_BYTES,
} from "@/lib/auth/constants";
import { createOpaqueSessionToken, hashSessionToken } from "@/lib/auth/crypto";
import {
  AuthenticationError,
  PasscodeValidationError,
} from "@/lib/auth/errors";
import { validatePasscode } from "@/lib/auth/passcode-policy";
import { hashPasscode, verifyPasscode } from "@/lib/auth/password";
import { authRepository } from "@/lib/auth/repository";
import type {
  AdminRole,
  AdminSession,
  AuthRepository,
  BootstrapStatus,
  ChangePasscodeResult,
  LoginRequestContext,
  LoginResult,
} from "@/lib/auth/types";

type AuthServiceDependencies = {
  repository: AuthRepository;
  now: () => Date;
  createToken: () => string;
  hashToken: (token: string) => Uint8Array;
  hashPassword: (passcode: string) => Promise<string>;
  verifyPassword: (
    hash: string,
    algorithm: "argon2id" | "bcrypt",
    passcode: string,
  ) => Promise<boolean>;
};

const defaultDependencies: AuthServiceDependencies = {
  repository: authRepository,
  now: () => new Date(),
  createToken: createOpaqueSessionToken,
  hashToken: hashSessionToken,
  hashPassword: hashPasscode,
  verifyPassword: verifyPasscode,
};

export function roleSatisfies(sessionRole: AdminRole, requiredRole: AdminRole): boolean {
  return sessionRole === "SYSTEM" || sessionRole === requiredRole;
}

export class AuthService {
  constructor(private readonly dependencies: AuthServiceDependencies = defaultDependencies) {}

  async login(
    role: AdminRole,
    passcode: string,
    context: LoginRequestContext,
  ): Promise<LoginResult> {
    const rateLimit = await this.dependencies.repository.beginLoginAttempt(
      role,
      context.ipHash,
    );
    if (!rateLimit.allowed) {
      await this.dependencies.repository.recordLoginFailure(role, true);
      return {
        ok: false,
        reason: "RATE_LIMITED",
        retryAfterSeconds: rateLimit.retryAfterSeconds,
      };
    }

    const credential = await this.dependencies.repository.getCredential(role);
    const valid = credential
      ? await this.dependencies.verifyPassword(
          credential.passwordHash,
          credential.hashAlgorithm,
          passcode,
        )
      : false;

    if (!valid) {
      await this.dependencies.repository.recordLoginFailure(role, false);
      return { ok: false, reason: "INVALID_CREDENTIALS" };
    }

    const token = this.dependencies.createToken();
    const tokenHash = this.dependencies.hashToken(token);
    if (tokenHash.byteLength !== ADMIN_SESSION_TOKEN_BYTES) {
      throw new Error("Session token hash has an invalid length");
    }
    const expiresAt = new Date(
      this.dependencies.now().getTime() + ADMIN_SESSION_MAX_AGE_SECONDS * 1000,
    ).toISOString();
    const session = await this.dependencies.repository.createSession({
      role,
      ipHash: context.ipHash,
      tokenHash,
      expiresAt,
      userAgentHash: context.userAgentHash,
    });
    return { ok: true, token, session };
  }

  async getBootstrapStatus(): Promise<BootstrapStatus> {
    return this.dependencies.repository.getBootstrapStatus();
  }

  async bootstrap(input: {
    hrPasscode: string;
    systemPasscode: string;
  }): Promise<void> {
    const hrValidationError = validatePasscode(input.hrPasscode);
    if (hrValidationError) throw new PasscodeValidationError(hrValidationError);
    const systemValidationError = validatePasscode(input.systemPasscode);
    if (systemValidationError) {
      throw new PasscodeValidationError(systemValidationError);
    }
    if (input.hrPasscode === input.systemPasscode) {
      throw new PasscodeValidationError(
        "HR and SYSTEM passcodes must be different.",
      );
    }

    const status = await this.dependencies.repository.getBootstrapStatus();
    if (status.completed) {
      throw new AuthenticationError(
        "FORBIDDEN",
        "Administrative credentials are already initialized",
      );
    }

    const [hrPasswordHash, systemPasswordHash] = await Promise.all([
      this.dependencies.hashPassword(input.hrPasscode),
      this.dependencies.hashPassword(input.systemPasscode),
    ]);
    await this.dependencies.repository.bootstrapCredentials({
      hrPasswordHash,
      systemPasswordHash,
      hashAlgorithm: "argon2id",
    });
  }

  async getSession(token: string | undefined): Promise<AdminSession | null> {
    if (!token || token.length < 32 || token.length > 128) return null;
    const session = await this.dependencies.repository.validateSession(
      this.dependencies.hashToken(token),
    );
    if (!session || new Date(session.expiresAt).getTime() <= this.dependencies.now().getTime()) {
      return null;
    }
    return session;
  }

  async requireRole(
    token: string | undefined,
    requiredRole: AdminRole,
  ): Promise<AdminSession> {
    const session = await this.getSession(token);
    if (!session) {
      throw new AuthenticationError("UNAUTHENTICATED", "Authentication required");
    }
    if (!roleSatisfies(session.role, requiredRole)) {
      throw new AuthenticationError("FORBIDDEN", "Insufficient administrative role");
    }
    return session;
  }

  async logout(token: string | undefined): Promise<void> {
    if (!token) return;
    await this.dependencies.repository.revokeSession(this.dependencies.hashToken(token));
  }

  async changePasscode(input: {
    token: string | undefined;
    targetRole: AdminRole;
    newPasscode: string;
    currentSystemPasscode?: string;
  }): Promise<ChangePasscodeResult> {
    await this.requireRole(input.token, "SYSTEM");
    const validationError = validatePasscode(input.newPasscode);
    if (validationError) throw new PasscodeValidationError(validationError);

    if (input.targetRole === "SYSTEM") {
      const credential = await this.dependencies.repository.getCredential("SYSTEM");
      const currentPasscodeValid =
        credential && input.currentSystemPasscode
          ? await this.dependencies.verifyPassword(
              credential.passwordHash,
              credential.hashAlgorithm,
              input.currentSystemPasscode,
            )
          : false;
      if (!currentPasscodeValid) {
        throw new AuthenticationError(
          "INVALID_CREDENTIALS",
          "Current SYSTEM credentials are invalid",
        );
      }
    }

    const passwordHash = await this.dependencies.hashPassword(input.newPasscode);
    return this.dependencies.repository.changePasscode({
      actorTokenHash: this.dependencies.hashToken(input.token!),
      targetRole: input.targetRole,
      passwordHash,
      hashAlgorithm: "argon2id",
    });
  }
}

export const authService = new AuthService();
