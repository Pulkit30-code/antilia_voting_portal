import "server-only";

import { hashSessionToken } from "@/lib/auth/crypto";
import { AuthenticationError } from "@/lib/auth/errors";
import { authService, type AuthService } from "@/lib/auth/service";
import { createAdminClient } from "@/lib/supabase/admin";

export type CandidateCategory = "FOH" | "BOH";

export type Candidate = {
  id: string;
  electionId: string;
  name: string;
  department: string;
  category: CandidateCategory;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CandidateInput = {
  electionId: string;
  name: string;
  department: string;
  category: CandidateCategory;
  isActive?: boolean;
};

export type CandidateErrorCode =
  | "VALIDATION"
  | "DUPLICATE"
  | "LOCKED"
  | "NOT_FOUND"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "INTERNAL";

export class CandidateError extends Error {
  constructor(public readonly code: CandidateErrorCode, message: string) {
    super(message);
    this.name = "CandidateError";
  }
}

export interface CandidateRepository {
  list(tokenHash: Uint8Array, electionId: string): Promise<Candidate[]>;
  create(tokenHash: Uint8Array, input: Required<CandidateInput>): Promise<Candidate>;
  update(
    tokenHash: Uint8Array,
    id: string,
    input: Omit<Required<CandidateInput>, "isActive">,
  ): Promise<Candidate>;
  setActive(
    tokenHash: Uint8Array,
    id: string,
    electionId: string,
    isActive: boolean,
  ): Promise<Candidate>;
  remove(tokenHash: Uint8Array, id: string, electionId: string): Promise<void>;
}

type RpcRecord = Record<string, unknown>;

function toBytea(value: Uint8Array): string {
  return `\\x${Buffer.from(value).toString("hex")}`;
}

function firstRecord(value: unknown): RpcRecord | null {
  if (Array.isArray(value)) return (value[0] as RpcRecord | undefined) ?? null;
  return value && typeof value === "object" ? (value as RpcRecord) : null;
}

function parseCandidate(value: unknown): Candidate {
  const record = firstRecord(value);
  if (!record) throw new CandidateError("INTERNAL", "Candidate operation returned no record");
  const text = (field: string) => {
    const result = record[field];
    if (typeof result !== "string") {
      throw new CandidateError("INTERNAL", `Invalid candidate ${field}`);
    }
    return result;
  };
  const category = text("category");
  if ((category !== "FOH" && category !== "BOH") || typeof record.is_active !== "boolean") {
    throw new CandidateError("INTERNAL", "Invalid candidate record");
  }
  return {
    id: text("id"),
    electionId: text("election_id"),
    name: text("name"),
    department: text("department"),
    category,
    isActive: record.is_active,
    createdAt: text("created_at"),
    updatedAt: text("updated_at"),
  };
}

function databaseError(code?: string): CandidateError {
  if (code === "23505") return new CandidateError("DUPLICATE", "Candidate already exists in this category");
  if (code === "55000" || code === "23503") {
    return new CandidateError("LOCKED", "Candidate changes require an active DRAFT election");
  }
  if (code === "P0002") return new CandidateError("NOT_FOUND", "Candidate not found");
  if (code === "42501") return new CandidateError("FORBIDDEN", "Administrative authorization failed");
  return new CandidateError("INTERNAL", "Candidate database operation failed");
}

class SupabaseCandidateRepository implements CandidateRepository {
  private async rpc(name: string, parameters: Record<string, unknown>): Promise<unknown> {
    const { data, error } = await createAdminClient().rpc(name, parameters);
    if (error) throw databaseError(error.code);
    return data;
  }

  async list(tokenHash: Uint8Array, electionId: string): Promise<Candidate[]> {
    const data = await this.rpc("antilia_candidates_list", {
      p_actor_token_hash: toBytea(tokenHash),
      p_election_id: electionId,
    });
    if (!Array.isArray(data)) throw new CandidateError("INTERNAL", "Invalid candidate list");
    return data.map(parseCandidate);
  }

  async create(tokenHash: Uint8Array, input: Required<CandidateInput>): Promise<Candidate> {
    return parseCandidate(await this.rpc("antilia_candidates_create", {
      p_actor_token_hash: toBytea(tokenHash),
      p_election_id: input.electionId,
      p_name: input.name,
      p_department: input.department,
      p_category: input.category,
      p_is_active: input.isActive,
    }));
  }

  async update(
    tokenHash: Uint8Array,
    id: string,
    input: Omit<Required<CandidateInput>, "isActive">,
  ): Promise<Candidate> {
    return parseCandidate(await this.rpc("antilia_candidates_update", {
      p_actor_token_hash: toBytea(tokenHash),
      p_candidate_id: id,
      p_election_id: input.electionId,
      p_name: input.name,
      p_department: input.department,
      p_category: input.category,
    }));
  }

  async setActive(
    tokenHash: Uint8Array,
    id: string,
    electionId: string,
    isActive: boolean,
  ): Promise<Candidate> {
    return parseCandidate(await this.rpc("antilia_candidates_set_active", {
      p_actor_token_hash: toBytea(tokenHash),
      p_candidate_id: id,
      p_election_id: electionId,
      p_is_active: isActive,
    }));
  }

  async remove(tokenHash: Uint8Array, id: string, electionId: string): Promise<void> {
    await this.rpc("antilia_candidates_remove", {
      p_actor_token_hash: toBytea(tokenHash),
      p_candidate_id: id,
      p_election_id: electionId,
    });
  }
}

function requiredText(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > 160) {
    throw new CandidateError("VALIDATION", `${label} must contain 1 to 160 characters`);
  }
  return normalized;
}

function normalizeInput(input: CandidateInput): Required<CandidateInput> {
  if (input.category !== "FOH" && input.category !== "BOH") {
    throw new CandidateError("VALIDATION", "Category must be FOH or BOH");
  }
  return {
    electionId: input.electionId,
    name: requiredText(input.name, "Name"),
    department: requiredText(input.department, "Department"),
    category: input.category,
    isActive: input.isActive ?? true,
  };
}

type RoleVerifier = Pick<AuthService, "requireRole">;

export class CandidateService {
  constructor(
    private readonly repository: CandidateRepository = new SupabaseCandidateRepository(),
    private readonly roleVerifier: RoleVerifier = authService,
  ) {}

  private async tokenHash(token: string | undefined): Promise<Uint8Array> {
    try {
      await this.roleVerifier.requireRole(token, "HR");
    } catch (error) {
      if (error instanceof AuthenticationError) {
        throw new CandidateError(
          error.code === "FORBIDDEN" ? "FORBIDDEN" : "UNAUTHENTICATED",
          error.message,
        );
      }
      throw error;
    }
    return hashSessionToken(token!);
  }

  async list(token: string | undefined, electionId: string): Promise<Candidate[]> {
    return this.repository.list(await this.tokenHash(token), electionId);
  }

  async create(token: string | undefined, input: CandidateInput): Promise<Candidate> {
    const tokenHash = await this.tokenHash(token);
    return this.repository.create(tokenHash, normalizeInput(input));
  }

  async update(
    token: string | undefined,
    id: string,
    input: Omit<CandidateInput, "isActive">,
  ): Promise<Candidate> {
    const tokenHash = await this.tokenHash(token);
    const normalized = normalizeInput({ ...input, isActive: true });
    return this.repository.update(tokenHash, id, {
      electionId: normalized.electionId,
      name: normalized.name,
      department: normalized.department,
      category: normalized.category,
    });
  }

  async setActive(
    token: string | undefined,
    id: string,
    electionId: string,
    isActive: boolean,
  ): Promise<Candidate> {
    return this.repository.setActive(await this.tokenHash(token), id, electionId, isActive);
  }

  async remove(token: string | undefined, id: string, electionId: string): Promise<void> {
    await this.repository.remove(await this.tokenHash(token), id, electionId);
  }
}

export const candidateService = new CandidateService();
