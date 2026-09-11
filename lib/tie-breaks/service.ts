import "server-only";

import { randomUUID } from "node:crypto";

import { createOpaqueSessionToken, hashSessionToken } from "@/lib/auth/crypto";
import { AuthenticationError } from "@/lib/auth/errors";
import { authService, type AuthService } from "@/lib/auth/service";
import { createAdminClient } from "@/lib/supabase/admin";
import type { HodVerificationInput, VotingCandidate } from "@/lib/voting/service";

export type TieBreakCategory = "FOH" | "BOH";
export type TieBreakStatus = "DRAFT" | "OPEN" | "CLOSED";

export type TieBreak = {
  id: string;
  originalElectionId: string;
  category: TieBreakCategory;
  roundNumber: number;
  status: TieBreakStatus;
  openedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
  candidateCount?: number;
  voteCount?: number;
  tieDetected?: boolean;
  winnerCandidateId?: string | null;
};

export type TieBreakCandidateResult = {
  candidateId: string;
  name: string;
  voteCount: number;
  rank: number;
  isLeader: boolean;
};

export type TieBreakDetail = TieBreak & {
  results: TieBreakCandidateResult[];
  tieDetected: boolean;
  winnerCandidateId: string | null;
};

export type PublicTieBreak = {
  id: string;
  originalElectionId: string;
  originalElectionName: string;
  electionMonth: number;
  electionYear: number;
  category: TieBreakCategory;
  roundNumber: number;
  openedAt: string;
};

export type TieBreakErrorCode =
  | "VALIDATION"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "LOCKED"
  | "NO_TIE"
  | "DUPLICATE"
  | "NOT_VERIFIED"
  | "ALREADY_VOTED"
  | "INVALID_CANDIDATE"
  | "RATE_LIMITED"
  | "INTERNAL";

export class TieBreakError extends Error {
  constructor(
    public readonly code: TieBreakErrorCode,
    message: string,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "TieBreakError";
  }
}

type VerificationRecord = {
  status: "VERIFIED" | "TIE_BREAK_NOT_OPEN" | "HOD_NOT_VERIFIED" | "ALREADY_VOTED";
  tieBreakId: string | null;
  category: TieBreakCategory | null;
  expiresAt: string | null;
};

export interface TieBreakRepository {
  list(tokenHash: Uint8Array, electionId?: string): Promise<TieBreak[]>;
  get(tokenHash: Uint8Array, id: string): Promise<TieBreak | null>;
  results(tokenHash: Uint8Array, id: string): Promise<TieBreakCandidateResult[]>;
  create(tokenHash: Uint8Array, electionId: string, category: TieBreakCategory): Promise<TieBreak>;
  control(tokenHash: Uint8Array, id: string, action: "open" | "close"): Promise<TieBreak>;
  listOpen(): Promise<PublicTieBreak[]>;
  publicCandidates(id: string): Promise<VotingCandidate[]>;
  consumeRateLimit(scope: "VERIFY" | "SUBMIT", ipHash: Uint8Array): Promise<{
    allowed: boolean;
    retryAfterSeconds: number;
  }>;
  verifyHod(
    id: string,
    input: HodVerificationInput,
    tokenHash: Uint8Array,
  ): Promise<VerificationRecord>;
  submitVote(
    tokenHash: Uint8Array,
    tieBreakId: string,
    candidateId: string,
    requestId: string,
    userAgent: string | null,
  ): Promise<string>;
}

type RpcRecord = Record<string, unknown>;

function toBytea(value: Uint8Array): string {
  return `\\x${Buffer.from(value).toString("hex")}`;
}

function rows(value: unknown): RpcRecord[] {
  if (!Array.isArray(value)) throw new TieBreakError("INTERNAL", "Invalid tie-break response");
  return value as RpcRecord[];
}

function first(value: unknown): RpcRecord | null {
  if (Array.isArray(value)) return (value[0] as RpcRecord | undefined) ?? null;
  return value && typeof value === "object" ? value as RpcRecord : null;
}

function text(record: RpcRecord, field: string): string {
  if (typeof record[field] !== "string") throw new TieBreakError("INTERNAL", "Invalid tie-break response");
  return record[field] as string;
}

function nullableText(record: RpcRecord, field: string): string | null {
  const value = record[field];
  if (value !== null && typeof value !== "string") throw new TieBreakError("INTERNAL", "Invalid tie-break response");
  return value as string | null;
}

function number(record: RpcRecord, field: string): number {
  const value = Number(record[field]);
  if (!Number.isFinite(value)) throw new TieBreakError("INTERNAL", "Invalid tie-break response");
  return value;
}

function bool(record: RpcRecord, field: string): boolean {
  if (typeof record[field] !== "boolean") throw new TieBreakError("INTERNAL", "Invalid tie-break response");
  return record[field] as boolean;
}

function parseTieBreak(record: RpcRecord): TieBreak {
  const category = text(record, "category");
  const status = text(record, "status");
  if ((category !== "FOH" && category !== "BOH") ||
      (status !== "DRAFT" && status !== "OPEN" && status !== "CLOSED")) {
    throw new TieBreakError("INTERNAL", "Invalid tie-break response");
  }
  return {
    id: text(record, "id"),
    originalElectionId: text(record, "original_election_id"),
    category,
    roundNumber: number(record, "round_number"),
    status,
    openedAt: nullableText(record, "opened_at"),
    closedAt: nullableText(record, "closed_at"),
    createdAt: text(record, "created_at"),
    updatedAt: text(record, "updated_at"),
    ...(record.candidate_count === undefined ? {} : {
      candidateCount: number(record, "candidate_count"),
      voteCount: number(record, "vote_count"),
      tieDetected: bool(record, "tie_detected"),
      winnerCandidateId: nullableText(record, "winner_candidate_id"),
    }),
  };
}

function databaseError(code?: string, operation: "ADMIN" | "VERIFY" | "VOTE" = "ADMIN") {
  if (code === "P0002") return new TieBreakError("NOT_FOUND", "Tie-break not found");
  if (code === "55000") return new TieBreakError("LOCKED", "Tie-break is not in the required state");
  if (code === "23505") {
    return new TieBreakError(operation === "VOTE" ? "ALREADY_VOTED" : "DUPLICATE",
      operation === "VOTE" ? "Already voted" : "Tie-break already exists");
  }
  if (code === "23514") {
    return new TieBreakError(operation === "ADMIN" ? "NO_TIE" : "INVALID_CANDIDATE",
      operation === "ADMIN" ? "No first-place tie exists" : "Invalid candidate selection");
  }
  if (code === "42501") {
    return new TieBreakError(operation === "ADMIN" ? "FORBIDDEN" : "NOT_VERIFIED",
      operation === "ADMIN" ? "Administrative authorization failed" : "HOD not verified");
  }
  return new TieBreakError("INTERNAL", "Tie-break operation failed");
}

export class SupabaseTieBreakRepository implements TieBreakRepository {
  private async rpc(
    name: string,
    parameters: Record<string, unknown>,
    operation: "ADMIN" | "VERIFY" | "VOTE" = "ADMIN",
  ): Promise<unknown> {
    const { data, error } = await createAdminClient().rpc(name, parameters);
    if (error) throw databaseError(error.code, operation);
    return data;
  }

  async list(tokenHash: Uint8Array, electionId?: string) {
    return rows(await this.rpc("antilia_tie_breaks_list", {
      p_actor_token_hash: toBytea(tokenHash),
      p_election_id: electionId ?? null,
    })).map(parseTieBreak);
  }

  async get(tokenHash: Uint8Array, id: string) {
    const record = first(await this.rpc("antilia_tie_breaks_get", {
      p_actor_token_hash: toBytea(tokenHash), p_tie_break_id: id,
    }));
    return record ? parseTieBreak(record) : null;
  }

  async results(tokenHash: Uint8Array, id: string) {
    return rows(await this.rpc("antilia_tie_breaks_results", {
      p_actor_token_hash: toBytea(tokenHash), p_tie_break_id: id,
    })).map((record) => ({
      candidateId: text(record, "candidate_id"),
      name: text(record, "candidate_name"),
      voteCount: number(record, "vote_count"),
      rank: number(record, "rank"),
      isLeader: bool(record, "is_leader"),
    }));
  }

  async create(tokenHash: Uint8Array, electionId: string, category: TieBreakCategory) {
    const record = first(await this.rpc("antilia_tie_breaks_create", {
      p_actor_token_hash: toBytea(tokenHash), p_election_id: electionId, p_category: category,
    }));
    if (!record) throw new TieBreakError("INTERNAL", "Tie-break was not created");
    return parseTieBreak(record);
  }

  async control(tokenHash: Uint8Array, id: string, action: "open" | "close") {
    const record = first(await this.rpc(`antilia_tie_breaks_${action}`, {
      p_actor_token_hash: toBytea(tokenHash), p_tie_break_id: id,
    }));
    if (!record) throw new TieBreakError("INTERNAL", "Tie-break was not updated");
    return parseTieBreak(record);
  }

  async listOpen(): Promise<PublicTieBreak[]> {
    const client = createAdminClient();
    const { data: tieBreaks, error } = await client
      .from("tie_breaks")
      .select("id,original_election_id,category,round_number,opened_at")
      .eq("status", "OPEN")
      .order("opened_at", { ascending: true });
    if (error) throw databaseError(error.code);
    if (!tieBreaks?.length) return [];

    const electionIds = [...new Set(tieBreaks.map((item) => item.original_election_id))];
    const { data: elections, error: electionError } = await client
      .from("elections")
      .select("id,name,election_month,election_year")
      .in("id", electionIds);
    if (electionError) throw databaseError(electionError.code);
    const electionById = new Map((elections ?? []).map((item) => [item.id, item]));

    return tieBreaks.map((item) => {
      const election = electionById.get(item.original_election_id);
      if (!election || typeof item.opened_at !== "string" ||
          (item.category !== "FOH" && item.category !== "BOH")) {
        throw new TieBreakError("INTERNAL", "Invalid active tie-break response");
      }
      return {
        id: item.id,
        originalElectionId: item.original_election_id,
        originalElectionName: election.name,
        electionMonth: election.election_month,
        electionYear: election.election_year,
        category: item.category,
        roundNumber: item.round_number,
        openedAt: item.opened_at,
      };
    });
  }

  async publicCandidates(id: string) {
    return rows(await this.rpc("antilia_tie_break_public_candidates", {
      p_tie_break_id: id,
    })).map((record) => ({
      id: text(record, "id"),
      name: text(record, "name"),
      department: text(record, "department"),
      category: text(record, "category") as TieBreakCategory,
    }));
  }

  async consumeRateLimit(scope: "VERIFY" | "SUBMIT", ipHash: Uint8Array) {
    const record = first(await this.rpc("antilia_voting_consume_rate_limit", {
      p_scope: scope, p_ip_hash: toBytea(ipHash),
    }, "VERIFY"));
    if (!record || typeof record.allowed !== "boolean") {
      throw new TieBreakError("INTERNAL", "Invalid rate-limit response");
    }
    return { allowed: record.allowed, retryAfterSeconds: number(record, "retry_after_seconds") };
  }

  async verifyHod(id: string, input: HodVerificationInput, tokenHash: Uint8Array) {
    const record = first(await this.rpc("antilia_tie_break_verify_hod", {
      p_tie_break_id: id,
      p_name: input.name,
      p_mobile_number: input.mobileNumber,
      p_department: input.department,
      p_token_hash: toBytea(tokenHash),
    }, "VERIFY"));
    if (!record) throw new TieBreakError("INTERNAL", "Invalid verification response");
    const status = text(record, "verification_status") as VerificationRecord["status"];
    if (!["VERIFIED", "TIE_BREAK_NOT_OPEN", "HOD_NOT_VERIFIED", "ALREADY_VOTED"].includes(status)) {
      throw new TieBreakError("INTERNAL", "Invalid verification response");
    }
    const categoryValue = nullableText(record, "category");
    return {
      status,
      tieBreakId: nullableText(record, "tie_break_id"),
      category: categoryValue as TieBreakCategory | null,
      expiresAt: nullableText(record, "expires_at"),
    };
  }

  async submitVote(
    tokenHash: Uint8Array,
    tieBreakId: string,
    candidateId: string,
    requestId: string,
    userAgent: string | null,
  ) {
    const data = await this.rpc("antilia_tie_break_submit_verified_vote", {
      p_token_hash: toBytea(tokenHash),
      p_tie_break_id: tieBreakId,
      p_candidate_id: candidateId,
      p_request_id: requestId,
      p_user_agent: userAgent?.slice(0, 1000) ?? null,
    }, "VOTE");
    if (typeof data !== "string") throw new TieBreakError("INTERNAL", "Invalid tie-break vote response");
    return data;
  }
}

type RoleVerifier = Pick<AuthService, "requireRole">;

export class TieBreakService {
  constructor(
    private readonly repository: TieBreakRepository = new SupabaseTieBreakRepository(),
    private readonly roleVerifier: RoleVerifier = authService,
    private readonly tokenFactory: () => string = createOpaqueSessionToken,
    private readonly requestIdFactory: () => string = randomUUID,
  ) {}

  private async adminTokenHash(token: string | undefined, role: "HR" | "SYSTEM") {
    try {
      await this.roleVerifier.requireRole(token, role);
      return hashSessionToken(token!);
    } catch (error) {
      if (error instanceof AuthenticationError) {
        throw new TieBreakError(
          error.code === "FORBIDDEN" ? "FORBIDDEN" : "UNAUTHENTICATED",
          error.message,
        );
      }
      throw error;
    }
  }

  async list(token: string | undefined, electionId?: string) {
    return this.repository.list(await this.adminTokenHash(token, "HR"), electionId);
  }

  async get(token: string | undefined, id: string): Promise<TieBreakDetail> {
    const tokenHash = await this.adminTokenHash(token, "HR");
    const tieBreak = await this.repository.get(tokenHash, id);
    if (!tieBreak) throw new TieBreakError("NOT_FOUND", "Tie-break not found");
    const results = await this.repository.results(tokenHash, id);
    const leaders = results.filter((result) => result.rank === 1);
    return {
      ...tieBreak,
      results,
      tieDetected: tieBreak.status === "CLOSED" && leaders.length > 1,
      winnerCandidateId: tieBreak.status === "CLOSED" && leaders.length === 1
        ? leaders[0].candidateId
        : null,
    };
  }

  async create(token: string | undefined, electionId: string, category: TieBreakCategory) {
    return this.repository.create(
      await this.adminTokenHash(token, "SYSTEM"), electionId, category,
    );
  }

  async control(token: string | undefined, id: string, action: "open" | "close") {
    const tokenHash = await this.adminTokenHash(token, "SYSTEM");
    await this.repository.control(tokenHash, id, action);
    const tieBreak = await this.repository.get(tokenHash, id);
    if (!tieBreak) throw new TieBreakError("NOT_FOUND", "Tie-break not found");
    const results = await this.repository.results(tokenHash, id);
    const leaders = results.filter((result) => result.rank === 1);
    return {
      ...tieBreak,
      results,
      tieDetected: tieBreak.status === "CLOSED" && leaders.length > 1,
      winnerCandidateId: tieBreak.status === "CLOSED" && leaders.length === 1
        ? leaders[0].candidateId
        : null,
    };
  }

  async candidates(id: string) {
    return this.repository.publicCandidates(id);
  }

  async openTieBreaks() {
    return this.repository.listOpen();
  }

  private async rateLimit(scope: "VERIFY" | "SUBMIT", ipHash: Uint8Array) {
    const result = await this.repository.consumeRateLimit(scope, ipHash);
    if (!result.allowed) {
      throw new TieBreakError("RATE_LIMITED", "Too many attempts. Try again later.", result.retryAfterSeconds);
    }
  }

  async verifyHod(id: string, input: HodVerificationInput, ipHash: Uint8Array) {
    await this.rateLimit("VERIFY", ipHash);
    const normalized = {
      name: input.name.trim(),
      mobileNumber: input.mobileNumber.trim(),
      department: input.department.trim(),
    };
    if (!normalized.name || !normalized.mobileNumber || !normalized.department) {
      throw new TieBreakError("NOT_VERIFIED", "HOD not verified");
    }
    const token = this.tokenFactory();
    const result = await this.repository.verifyHod(id, normalized, hashSessionToken(token));
    if (result.status === "TIE_BREAK_NOT_OPEN") throw new TieBreakError("LOCKED", "Tie-break is not open");
    if (result.status === "HOD_NOT_VERIFIED") throw new TieBreakError("NOT_VERIFIED", "HOD not verified");
    if (result.status === "ALREADY_VOTED") throw new TieBreakError("ALREADY_VOTED", "Already voted");
    if (!result.tieBreakId || !result.category || !result.expiresAt) {
      throw new TieBreakError("INTERNAL", "Invalid verification response");
    }
    return { token, tieBreakId: result.tieBreakId, category: result.category, expiresAt: result.expiresAt };
  }

  async submitVote(
    token: string | undefined,
    tieBreakId: string,
    candidateId: string,
    ipHash: Uint8Array,
    userAgent: string | null,
  ) {
    await this.rateLimit("SUBMIT", ipHash);
    if (!token) throw new TieBreakError("NOT_VERIFIED", "HOD not verified");
    return {
      voteId: await this.repository.submitVote(
        hashSessionToken(token), tieBreakId, candidateId, this.requestIdFactory(), userAgent,
      ),
    };
  }
}

export const tieBreakService = new TieBreakService();
