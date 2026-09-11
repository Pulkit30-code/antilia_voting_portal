import "server-only";

import { hashSessionToken } from "@/lib/auth/crypto";
import { AuthenticationError } from "@/lib/auth/errors";
import { authService, type AuthService } from "@/lib/auth/service";
import { createAdminClient } from "@/lib/supabase/admin";

export type Hod = {
  id: string;
  name: string;
  mobileNumber: string;
  department: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type HodInput = {
  name: string;
  mobileNumber: string;
  department: string;
  isActive?: boolean;
};

export type HodErrorCode =
  | "VALIDATION"
  | "DUPLICATE_MOBILE"
  | "LOCKED"
  | "NOT_FOUND"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "INTERNAL";

export class HodError extends Error {
  constructor(public readonly code: HodErrorCode, message: string) {
    super(message);
    this.name = "HodError";
  }
}

export interface HodRepository {
  list(tokenHash: Uint8Array): Promise<Hod[]>;
  create(tokenHash: Uint8Array, input: Required<HodInput>): Promise<Hod>;
  update(
    tokenHash: Uint8Array,
    id: string,
    input: Omit<Required<HodInput>, "isActive">,
  ): Promise<Hod>;
  setActive(tokenHash: Uint8Array, id: string, isActive: boolean): Promise<Hod>;
  remove(tokenHash: Uint8Array, id: string): Promise<void>;
}

type RpcRecord = Record<string, unknown>;

function toBytea(value: Uint8Array): string {
  return `\\x${Buffer.from(value).toString("hex")}`;
}

function firstRecord(value: unknown): RpcRecord | null {
  if (Array.isArray(value)) return (value[0] as RpcRecord | undefined) ?? null;
  return value && typeof value === "object" ? (value as RpcRecord) : null;
}

function parseHod(value: unknown): Hod {
  const record = firstRecord(value);
  if (!record) throw new HodError("INTERNAL", "HOD operation returned no record");
  const text = (field: string) => {
    const result = record[field];
    if (typeof result !== "string") {
      throw new HodError("INTERNAL", `Invalid HOD ${field}`);
    }
    return result;
  };
  if (typeof record.is_active !== "boolean") {
    throw new HodError("INTERNAL", "Invalid HOD is_active");
  }
  return {
    id: text("id"),
    name: text("name"),
    mobileNumber: text("mobile_number"),
    department: text("department"),
    isActive: record.is_active,
    createdAt: text("created_at"),
    updatedAt: text("updated_at"),
  };
}

function databaseError(code?: string): HodError {
  if (code === "23505") return new HodError("DUPLICATE_MOBILE", "Mobile number already exists");
  if (code === "55000") return new HodError("LOCKED", "HOD is protected by election history or an OPEN election");
  if (code === "P0002") return new HodError("NOT_FOUND", "HOD not found");
  if (code === "42501") return new HodError("FORBIDDEN", "Administrative authorization failed");
  return new HodError("INTERNAL", "HOD database operation failed");
}

class SupabaseHodRepository implements HodRepository {
  private async rpc(name: string, parameters: Record<string, unknown>): Promise<unknown> {
    const { data, error } = await createAdminClient().rpc(name, parameters);
    if (error) throw databaseError(error.code);
    return data;
  }

  async list(tokenHash: Uint8Array): Promise<Hod[]> {
    const data = await this.rpc("antilia_hods_list", {
      p_actor_token_hash: toBytea(tokenHash),
    });
    if (!Array.isArray(data)) throw new HodError("INTERNAL", "Invalid HOD list");
    return data.map(parseHod);
  }

  async create(tokenHash: Uint8Array, input: Required<HodInput>): Promise<Hod> {
    return parseHod(await this.rpc("antilia_hods_create", {
      p_actor_token_hash: toBytea(tokenHash),
      p_name: input.name,
      p_mobile_number: input.mobileNumber,
      p_department: input.department,
      p_is_active: input.isActive,
    }));
  }

  async update(
    tokenHash: Uint8Array,
    id: string,
    input: Omit<Required<HodInput>, "isActive">,
  ): Promise<Hod> {
    return parseHod(await this.rpc("antilia_hods_update", {
      p_actor_token_hash: toBytea(tokenHash),
      p_hod_id: id,
      p_name: input.name,
      p_mobile_number: input.mobileNumber,
      p_department: input.department,
    }));
  }

  async setActive(tokenHash: Uint8Array, id: string, isActive: boolean): Promise<Hod> {
    return parseHod(await this.rpc("antilia_hods_set_active", {
      p_actor_token_hash: toBytea(tokenHash),
      p_hod_id: id,
      p_is_active: isActive,
    }));
  }

  async remove(tokenHash: Uint8Array, id: string): Promise<void> {
    await this.rpc("antilia_hods_remove", {
      p_actor_token_hash: toBytea(tokenHash),
      p_hod_id: id,
    });
  }
}

function requiredText(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > 160) {
    throw new HodError("VALIDATION", `${label} must contain 1 to 160 characters`);
  }
  return normalized;
}

export function normalizeMobileNumber(value: string): string {
  const normalized = value.trim().replace(/^00/, "").replace(/[^0-9]/g, "");
  if (normalized.length < 8 || normalized.length > 15) {
    throw new HodError("VALIDATION", "Mobile number must contain 8 to 15 digits");
  }
  return normalized;
}

function normalizeInput(input: HodInput): Required<HodInput> {
  return {
    name: requiredText(input.name, "Name"),
    mobileNumber: normalizeMobileNumber(input.mobileNumber),
    department: requiredText(input.department, "Department"),
    isActive: input.isActive ?? true,
  };
}

type RoleVerifier = Pick<AuthService, "requireRole">;

export class HodService {
  constructor(
    private readonly repository: HodRepository = new SupabaseHodRepository(),
    private readonly roleVerifier: RoleVerifier = authService,
  ) {}

  private async tokenHash(token: string | undefined): Promise<Uint8Array> {
    try {
      await this.roleVerifier.requireRole(token, "HR");
    } catch (error) {
      if (error instanceof AuthenticationError) {
        throw new HodError(
          error.code === "FORBIDDEN" ? "FORBIDDEN" : "UNAUTHENTICATED",
          error.message,
        );
      }
      throw error;
    }
    return hashSessionToken(token!);
  }

  async list(token: string | undefined): Promise<Hod[]> {
    return this.repository.list(await this.tokenHash(token));
  }

  async create(token: string | undefined, input: HodInput): Promise<Hod> {
    return this.repository.create(await this.tokenHash(token), normalizeInput(input));
  }

  async update(token: string | undefined, id: string, input: Omit<HodInput, "isActive">): Promise<Hod> {
    const normalized = normalizeInput({ ...input, isActive: true });
    return this.repository.update(await this.tokenHash(token), id, {
      name: normalized.name,
      mobileNumber: normalized.mobileNumber,
      department: normalized.department,
    });
  }

  async setActive(token: string | undefined, id: string, isActive: boolean): Promise<Hod> {
    return this.repository.setActive(await this.tokenHash(token), id, isActive);
  }

  async remove(token: string | undefined, id: string): Promise<void> {
    await this.repository.remove(await this.tokenHash(token), id);
  }
}

export const hodService = new HodService();
