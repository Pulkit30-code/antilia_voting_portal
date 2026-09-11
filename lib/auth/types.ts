export const ADMIN_ROLES = ["HR", "SYSTEM"] as const;

export type AdminRole = (typeof ADMIN_ROLES)[number];

export type AdminSession = {
  sessionId: string;
  adminPrincipalId: string;
  role: AdminRole;
  expiresAt: string;
};

export type CredentialRecord = {
  adminPrincipalId: string;
  passwordHash: string;
  hashAlgorithm: "argon2id" | "bcrypt";
};

export type LoginRequestContext = {
  ipHash: Uint8Array;
  userAgentHash: Uint8Array | null;
};

export type LoginResult =
  | { ok: true; token: string; session: AdminSession }
  | {
      ok: false;
      reason: "INVALID_CREDENTIALS" | "RATE_LIMITED";
      retryAfterSeconds?: number;
    };

export type ChangePasscodeResult = {
  revokedSessionCount: number;
  currentSessionRetained: boolean;
};

export type BootstrapStatus = {
  completed: boolean;
};

export interface AuthRepository {
  getBootstrapStatus(): Promise<BootstrapStatus>;
  bootstrapCredentials(input: {
    hrPasswordHash: string;
    systemPasswordHash: string;
    hashAlgorithm: "argon2id";
  }): Promise<void>;
  getCredential(role: AdminRole): Promise<CredentialRecord | null>;
  beginLoginAttempt(
    role: AdminRole,
    ipHash: Uint8Array,
  ): Promise<{ allowed: boolean; retryAfterSeconds: number }>;
  recordLoginFailure(role: AdminRole, rateLimited: boolean): Promise<void>;
  createSession(input: {
    role: AdminRole;
    ipHash: Uint8Array;
    tokenHash: Uint8Array;
    expiresAt: string;
    userAgentHash: Uint8Array | null;
  }): Promise<AdminSession>;
  validateSession(tokenHash: Uint8Array): Promise<AdminSession | null>;
  revokeSession(tokenHash: Uint8Array): Promise<boolean>;
  changePasscode(input: {
    actorTokenHash: Uint8Array;
    targetRole: AdminRole;
    passwordHash: string;
    hashAlgorithm: "argon2id";
  }): Promise<ChangePasscodeResult>;
}
