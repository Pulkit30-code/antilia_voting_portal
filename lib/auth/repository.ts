import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type {
  AdminRole,
  AdminSession,
  AuthRepository,
  BootstrapStatus,
  ChangePasscodeResult,
  CredentialRecord,
} from "@/lib/auth/types";

type RpcRecord = Record<string, unknown>;

function toBytea(value: Uint8Array): string {
  return `\\x${Buffer.from(value).toString("hex")}`;
}

function firstRecord(value: unknown): RpcRecord | null {
  if (Array.isArray(value)) {
    return (value[0] as RpcRecord | undefined) ?? null;
  }
  return value && typeof value === "object" ? (value as RpcRecord) : null;
}

function stringField(record: RpcRecord, field: string): string {
  const value = record[field];
  if (typeof value !== "string") {
    throw new Error(`Authentication RPC returned an invalid ${field}`);
  }
  return value;
}

function numberField(record: RpcRecord, field: string): number {
  const value = record[field];
  if (typeof value !== "number") {
    throw new Error(`Authentication RPC returned an invalid ${field}`);
  }
  return value;
}

function parseSession(record: RpcRecord): AdminSession {
  const role = stringField(record, "role");
  if (role !== "HR" && role !== "SYSTEM") {
    throw new Error("Authentication RPC returned an invalid role");
  }
  return {
    sessionId: stringField(record, "session_id"),
    adminPrincipalId: stringField(record, "admin_principal_id"),
    role,
    expiresAt: stringField(record, "expires_at"),
  };
}

async function rpc(name: string, parameters: Record<string, unknown>): Promise<unknown> {
  const client = createAdminClient();
  const { data, error } = await client.rpc(name, parameters);
  if (error) {
    throw new Error(`Authentication database operation failed (${error.code})`);
  }
  return data;
}

export class SupabaseAuthRepository implements AuthRepository {
  async getBootstrapStatus(): Promise<BootstrapStatus> {
    const [hrCredential, systemCredential] = await Promise.all([
      this.getCredential("HR"),
      this.getCredential("SYSTEM"),
    ]);
    // Any existing credential closes the setup flow. Bootstrap itself is
    // atomic, so a partial state indicates manual drift that must not be
    // repaired through an unauthenticated endpoint.
    return { completed: Boolean(hrCredential || systemCredential) };
  }

  async bootstrapCredentials(input: {
    hrPasswordHash: string;
    systemPasswordHash: string;
    hashAlgorithm: "argon2id";
  }): Promise<void> {
    await rpc("antilia_auth_bootstrap", {
      p_hr_password_hash: input.hrPasswordHash,
      p_system_password_hash: input.systemPasswordHash,
      p_hash_algorithm: input.hashAlgorithm,
    });
  }

  async getCredential(role: AdminRole): Promise<CredentialRecord | null> {
    const record = firstRecord(
      await rpc("antilia_auth_get_credential", { p_role: role }),
    );
    if (!record) return null;

    const hashAlgorithm = stringField(record, "hash_algorithm");
    if (hashAlgorithm !== "argon2id" && hashAlgorithm !== "bcrypt") {
      throw new Error("Unsupported administrative credential hash algorithm");
    }
    return {
      adminPrincipalId: stringField(record, "admin_principal_id"),
      passwordHash: stringField(record, "password_hash"),
      hashAlgorithm,
    };
  }

  async beginLoginAttempt(role: AdminRole, ipHash: Uint8Array) {
    const record = firstRecord(
      await rpc("antilia_auth_begin_login_attempt", {
        p_role: role,
        p_ip_hash: toBytea(ipHash),
      }),
    );
    if (!record || typeof record.allowed !== "boolean") {
      throw new Error("Authentication rate-limit RPC returned an invalid result");
    }
    return {
      allowed: record.allowed,
      retryAfterSeconds: numberField(record, "retry_after_seconds"),
    };
  }

  async recordLoginFailure(role: AdminRole, rateLimited: boolean): Promise<void> {
    await rpc("antilia_auth_record_login_failure", {
      p_role: role,
      p_rate_limited: rateLimited,
    });
  }

  async createSession(input: {
    role: AdminRole;
    ipHash: Uint8Array;
    tokenHash: Uint8Array;
    expiresAt: string;
    userAgentHash: Uint8Array | null;
  }): Promise<AdminSession> {
    const record = firstRecord(
      await rpc("antilia_auth_create_session", {
        p_role: input.role,
        p_ip_hash: toBytea(input.ipHash),
        p_token_hash: toBytea(input.tokenHash),
        p_expires_at: input.expiresAt,
        p_user_agent_hash: input.userAgentHash
          ? toBytea(input.userAgentHash)
          : null,
      }),
    );
    if (!record) throw new Error("Authentication session was not created");
    return parseSession(record);
  }

  async validateSession(tokenHash: Uint8Array): Promise<AdminSession | null> {
    const record = firstRecord(
      await rpc("antilia_auth_validate_session", {
        p_token_hash: toBytea(tokenHash),
      }),
    );
    return record ? parseSession(record) : null;
  }

  async revokeSession(tokenHash: Uint8Array): Promise<boolean> {
    const result = await rpc("antilia_auth_revoke_session", {
      p_token_hash: toBytea(tokenHash),
    });
    if (typeof result !== "boolean") {
      throw new Error("Authentication logout RPC returned an invalid result");
    }
    return result;
  }

  async changePasscode(input: {
    actorTokenHash: Uint8Array;
    targetRole: AdminRole;
    passwordHash: string;
    hashAlgorithm: "argon2id";
  }): Promise<ChangePasscodeResult> {
    const record = firstRecord(
      await rpc("antilia_auth_change_passcode", {
        p_actor_token_hash: toBytea(input.actorTokenHash),
        p_target_role: input.targetRole,
        p_password_hash: input.passwordHash,
        p_hash_algorithm: input.hashAlgorithm,
      }),
    );
    if (!record || typeof record.current_session_retained !== "boolean") {
      throw new Error("Passcode-change RPC returned an invalid result");
    }
    return {
      revokedSessionCount: numberField(record, "revoked_session_count"),
      currentSessionRetained: record.current_session_retained,
    };
  }
}

export const authRepository: AuthRepository = new SupabaseAuthRepository();
