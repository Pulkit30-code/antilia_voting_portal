import "server-only";

import { hashSessionToken } from "@/lib/auth/crypto";
import { AuthenticationError } from "@/lib/auth/errors";
import { authService, type AuthService } from "@/lib/auth/service";
import { createAdminClient } from "@/lib/supabase/admin";

export type ElectionStatus = "DRAFT" | "OPEN" | "CLOSED";

export type Election = {
  id: string;
  name: string;
  month: number;
  year: number;
  status: ElectionStatus;
  openedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ElectionInput = { name: string; month: number; year: number };
export type ElectionSystemAction = "start" | "close" | "reopen" | "reset";

export type ElectionErrorCode =
  | "VALIDATION"
  | "DUPLICATE_MONTH"
  | "LOCKED"
  | "NOT_FOUND"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "INTERNAL";

export class ElectionError extends Error {
  constructor(public readonly code: ElectionErrorCode, message: string) {
    super(message);
    this.name = "ElectionError";
  }
}

export interface ElectionRepository {
  list(tokenHash: Uint8Array): Promise<Election[]>;
  get(tokenHash: Uint8Array, id: string): Promise<Election | null>;
  create(tokenHash: Uint8Array, input: ElectionInput): Promise<Election>;
  update(tokenHash: Uint8Array, id: string, input: ElectionInput): Promise<Election>;
  cancel(tokenHash: Uint8Array, id: string): Promise<void>;
  systemAction(
    tokenHash: Uint8Array,
    id: string,
    action: ElectionSystemAction,
  ): Promise<Election>;
}

type RpcRecord = Record<string, unknown>;

function toBytea(value: Uint8Array): string {
  return `\\x${Buffer.from(value).toString("hex")}`;
}

function firstRecord(value: unknown): RpcRecord | null {
  if (Array.isArray(value)) return (value[0] as RpcRecord | undefined) ?? null;
  return value && typeof value === "object" ? (value as RpcRecord) : null;
}

function parseElection(value: unknown): Election {
  const record = firstRecord(value);
  if (!record) throw new ElectionError("INTERNAL", "Election operation returned no record");
  const text = (field: string) => {
    const result = record[field];
    if (typeof result !== "string") throw new ElectionError("INTERNAL", `Invalid election ${field}`);
    return result;
  };
  const number = (field: string) => {
    const result = record[field];
    if (typeof result !== "number") throw new ElectionError("INTERNAL", `Invalid election ${field}`);
    return result;
  };
  const nullableText = (field: string) => {
    const result = record[field];
    if (result !== null && typeof result !== "string") {
      throw new ElectionError("INTERNAL", `Invalid election ${field}`);
    }
    return result as string | null;
  };
  const status = text("status");
  if (status !== "DRAFT" && status !== "OPEN" && status !== "CLOSED") {
    throw new ElectionError("INTERNAL", "Invalid election status");
  }
  return {
    id: text("id"),
    name: text("name"),
    month: number("election_month"),
    year: number("election_year"),
    status,
    openedAt: nullableText("opened_at"),
    closedAt: nullableText("closed_at"),
    createdAt: text("created_at"),
    updatedAt: text("updated_at"),
  };
}

function databaseError(code?: string): ElectionError {
  if (code === "23505") return new ElectionError("DUPLICATE_MONTH", "An election already exists for this month and year");
  if (code === "55000") return new ElectionError("LOCKED", "Election is not editable or cancellable");
  if (code === "23514" || code === "22003") return new ElectionError("VALIDATION", "Invalid election details");
  if (code === "P0002") return new ElectionError("NOT_FOUND", "Election not found");
  if (code === "42501") return new ElectionError("FORBIDDEN", "Administrative authorization failed");
  return new ElectionError("INTERNAL", "Election database operation failed");
}

class SupabaseElectionRepository implements ElectionRepository {
  private async rpc(name: string, parameters: Record<string, unknown>): Promise<unknown> {
    const { data, error } = await createAdminClient().rpc(name, parameters);
    if (error) throw databaseError(error.code);
    return data;
  }

  async list(tokenHash: Uint8Array): Promise<Election[]> {
    const data = await this.rpc("antilia_elections_list", {
      p_actor_token_hash: toBytea(tokenHash),
    });
    if (!Array.isArray(data)) throw new ElectionError("INTERNAL", "Invalid election list");
    return data.map(parseElection);
  }

  async get(tokenHash: Uint8Array, id: string): Promise<Election | null> {
    const data = await this.rpc("antilia_elections_get", {
      p_actor_token_hash: toBytea(tokenHash),
      p_election_id: id,
    });
    return firstRecord(data) ? parseElection(data) : null;
  }

  async create(tokenHash: Uint8Array, input: ElectionInput): Promise<Election> {
    return parseElection(await this.rpc("antilia_elections_create", {
      p_actor_token_hash: toBytea(tokenHash),
      p_name: input.name,
      p_month: input.month,
      p_year: input.year,
    }));
  }

  async update(tokenHash: Uint8Array, id: string, input: ElectionInput): Promise<Election> {
    return parseElection(await this.rpc("antilia_elections_update", {
      p_actor_token_hash: toBytea(tokenHash),
      p_election_id: id,
      p_name: input.name,
      p_month: input.month,
      p_year: input.year,
    }));
  }

  async cancel(tokenHash: Uint8Array, id: string): Promise<void> {
    await this.rpc("antilia_elections_cancel", {
      p_actor_token_hash: toBytea(tokenHash),
      p_election_id: id,
    });
  }

  async systemAction(
    tokenHash: Uint8Array,
    id: string,
    action: ElectionSystemAction,
  ): Promise<Election> {
    return parseElection(await this.rpc(`antilia_elections_${action}`, {
      p_actor_token_hash: toBytea(tokenHash),
      p_election_id: id,
    }));
  }
}

function normalizeInput(input: ElectionInput): ElectionInput {
  const name = input.name.trim();
  if (name.length < 1 || name.length > 200) {
    throw new ElectionError("VALIDATION", "Name must contain 1 to 200 characters");
  }
  if (!Number.isInteger(input.month) || input.month < 1 || input.month > 12) {
    throw new ElectionError("VALIDATION", "Month must be between 1 and 12");
  }
  if (!Number.isInteger(input.year) || input.year < 2000 || input.year > 2200) {
    throw new ElectionError("VALIDATION", "Year must be between 2000 and 2200");
  }
  return { name, month: input.month, year: input.year };
}

type RoleVerifier = Pick<AuthService, "requireRole">;

export class ElectionService {
  constructor(
    private readonly repository: ElectionRepository = new SupabaseElectionRepository(),
    private readonly roleVerifier: RoleVerifier = authService,
  ) {}

  private async tokenHash(token: string | undefined): Promise<Uint8Array> {
    try {
      await this.roleVerifier.requireRole(token, "HR");
    } catch (error) {
      if (error instanceof AuthenticationError) {
        throw new ElectionError(
          error.code === "FORBIDDEN" ? "FORBIDDEN" : "UNAUTHENTICATED",
          error.message,
        );
      }
      throw error;
    }
    return hashSessionToken(token!);
  }

  async list(token: string | undefined): Promise<Election[]> {
    return this.repository.list(await this.tokenHash(token));
  }

  async get(token: string | undefined, id: string): Promise<Election> {
    const election = await this.repository.get(await this.tokenHash(token), id);
    if (!election) throw new ElectionError("NOT_FOUND", "Election not found");
    return election;
  }

  async create(token: string | undefined, input: ElectionInput): Promise<Election> {
    const tokenHash = await this.tokenHash(token);
    return this.repository.create(tokenHash, normalizeInput(input));
  }

  async update(token: string | undefined, id: string, input: ElectionInput): Promise<Election> {
    const tokenHash = await this.tokenHash(token);
    return this.repository.update(tokenHash, id, normalizeInput(input));
  }

  async cancel(token: string | undefined, id: string): Promise<void> {
    await this.repository.cancel(await this.tokenHash(token), id);
  }

  async systemAction(
    token: string | undefined,
    id: string,
    action: ElectionSystemAction,
  ): Promise<Election> {
    let tokenHash: Uint8Array;
    try {
      await this.roleVerifier.requireRole(token, "SYSTEM");
      tokenHash = hashSessionToken(token!);
    } catch (error) {
      if (error instanceof AuthenticationError) {
        throw new ElectionError(
          error.code === "FORBIDDEN" ? "FORBIDDEN" : "UNAUTHENTICATED",
          error.message,
        );
      }
      throw error;
    }
    return this.repository.systemAction(tokenHash, id, action);
  }
}

export const electionService = new ElectionService();
