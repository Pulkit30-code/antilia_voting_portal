import "server-only";

import { hashSessionToken } from "@/lib/auth/crypto";
import { AuthenticationError } from "@/lib/auth/errors";
import { authService, type AuthService } from "@/lib/auth/service";
import { createAdminClient } from "@/lib/supabase/admin";

export type ReportCategory = "FOH" | "BOH";

export type CandidateResult = {
  candidateId: string;
  name: string;
  department: string;
  category: ReportCategory;
  isActive: boolean;
  voteCount: number;
  categoryVoteCount: number;
  votePercentage: number;
  rank: number;
  isTiedForFirst: boolean;
  isCurrentLeader: boolean;
};

export type CategoryResult = {
  candidates: CandidateResult[];
  tieDetected: boolean;
  provisionalWinnerCandidateId: string | null;
  finalWinnerCandidateId: string | null;
  winnerCandidateId: string | null;
};

export type ElectionResults = Record<ReportCategory, CategoryResult>;

export type Turnout = {
  electionId: string;
  totalEligibleHods: number;
  completedHods: number;
  pendingHods: number;
  turnoutPercentage: number;
};

export type HodBallot = {
  electionId: string;
  hodId: string;
  hodName: string;
  department: string;
  hasVoted: boolean;
  fohCandidateId: string | null;
  fohCandidateName: string | null;
  bohCandidateId: string | null;
  bohCandidateName: string | null;
  submittedAt: string | null;
};

export type ReportingErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_AVAILABLE"
  | "NOT_FOUND"
  | "INTERNAL";

export class ReportingError extends Error {
  constructor(public readonly code: ReportingErrorCode, message: string) {
    super(message);
    this.name = "ReportingError";
  }
}

type CandidateResultRecord = CandidateResult & {
  electionId: string;
  tieDetected: boolean;
  provisionalWinnerCandidateId: string | null;
  finalWinnerCandidateId: string | null;
};

export interface ReportingRepository {
  candidateResults(tokenHash: Uint8Array, electionId: string): Promise<CandidateResultRecord[]>;
  turnout(tokenHash: Uint8Array, electionId: string): Promise<Turnout | null>;
  hodBallots(tokenHash: Uint8Array, electionId: string): Promise<HodBallot[]>;
}

type RpcRecord = Record<string, unknown>;

function toBytea(value: Uint8Array): string {
  return `\\x${Buffer.from(value).toString("hex")}`;
}

function records(value: unknown): RpcRecord[] {
  if (!Array.isArray(value)) throw new ReportingError("INTERNAL", "Invalid reporting response");
  return value as RpcRecord[];
}

function string(record: RpcRecord, field: string): string {
  const value = record[field];
  if (typeof value !== "string") throw new ReportingError("INTERNAL", "Invalid reporting response");
  return value;
}

function nullableString(record: RpcRecord, field: string): string | null {
  const value = record[field];
  if (value !== null && typeof value !== "string") {
    throw new ReportingError("INTERNAL", "Invalid reporting response");
  }
  return value as string | null;
}

function number(record: RpcRecord, field: string): number {
  const value = record[field];
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) throw new ReportingError("INTERNAL", "Invalid reporting response");
  return parsed;
}

function boolean(record: RpcRecord, field: string): boolean {
  const value = record[field];
  if (typeof value !== "boolean") throw new ReportingError("INTERNAL", "Invalid reporting response");
  return value;
}

function databaseError(code?: string): ReportingError {
  if (code === "42501") return new ReportingError("FORBIDDEN", "Administrative authorization failed");
  if (code === "55000") return new ReportingError("NOT_AVAILABLE", "Results are not available for this election");
  if (code === "P0002") return new ReportingError("NOT_FOUND", "Election not found");
  return new ReportingError("INTERNAL", "Reporting operation failed");
}

export class SupabaseReportingRepository implements ReportingRepository {
  private async rpc(name: string, tokenHash: Uint8Array, electionId: string): Promise<unknown> {
    const { data, error } = await createAdminClient().rpc(name, {
      p_actor_token_hash: toBytea(tokenHash),
      p_election_id: electionId,
    });
    if (error) throw databaseError(error.code);
    return data;
  }

  async candidateResults(tokenHash: Uint8Array, electionId: string) {
    return records(await this.rpc("antilia_reporting_candidate_results", tokenHash, electionId))
      .map((record): CandidateResultRecord => {
        const category = string(record, "category");
        if (category !== "FOH" && category !== "BOH") {
          throw new ReportingError("INTERNAL", "Invalid reporting response");
        }
        return {
          electionId: string(record, "election_id"),
          candidateId: string(record, "candidate_id"),
          name: string(record, "candidate_name"),
          department: string(record, "department"),
          category,
          isActive: boolean(record, "is_active"),
          voteCount: number(record, "vote_count"),
          categoryVoteCount: number(record, "category_vote_count"),
          votePercentage: number(record, "vote_percentage"),
          rank: number(record, "category_rank"),
          isTiedForFirst: boolean(record, "is_tied_for_first"),
          isCurrentLeader: boolean(record, "is_current_leader"),
          tieDetected: boolean(record, "tie_detected"),
          provisionalWinnerCandidateId: nullableString(record, "provisional_winner_candidate_id"),
          finalWinnerCandidateId: nullableString(record, "final_winner_candidate_id"),
        };
      });
  }

  async turnout(tokenHash: Uint8Array, electionId: string): Promise<Turnout | null> {
    const rows = records(await this.rpc("antilia_reporting_turnout", tokenHash, electionId));
    const record = rows[0];
    if (!record) return null;
    return {
      electionId: string(record, "election_id"),
      totalEligibleHods: number(record, "eligible_hod_count"),
      completedHods: number(record, "completed_hod_count"),
      pendingHods: number(record, "pending_hod_count"),
      turnoutPercentage: number(record, "turnout_percentage"),
    };
  }

  async hodBallots(tokenHash: Uint8Array, electionId: string): Promise<HodBallot[]> {
    return records(await this.rpc("antilia_reporting_hod_ballots", tokenHash, electionId))
      .map((record) => ({
        electionId: string(record, "election_id"),
        hodId: string(record, "hod_id"),
        hodName: string(record, "hod_name"),
        department: string(record, "hod_department"),
        hasVoted: boolean(record, "has_voted"),
        fohCandidateId: nullableString(record, "foh_candidate_id"),
        fohCandidateName: nullableString(record, "foh_candidate_name"),
        bohCandidateId: nullableString(record, "boh_candidate_id"),
        bohCandidateName: nullableString(record, "boh_candidate_name"),
        submittedAt: nullableString(record, "ballot_submitted_at"),
      }));
  }
}

type RoleVerifier = Pick<AuthService, "requireRole">;

export class ReportingService {
  constructor(
    private readonly repository: ReportingRepository = new SupabaseReportingRepository(),
    private readonly roleVerifier: RoleVerifier = authService,
  ) {}

  private async tokenHash(token: string | undefined): Promise<Uint8Array> {
    try {
      await this.roleVerifier.requireRole(token, "HR");
      return hashSessionToken(token!);
    } catch (error) {
      if (error instanceof AuthenticationError) {
        throw new ReportingError(
          error.code === "FORBIDDEN" ? "FORBIDDEN" : "UNAUTHENTICATED",
          error.message,
        );
      }
      throw error;
    }
  }

  async results(token: string | undefined, electionId: string): Promise<ElectionResults> {
    const rows = await this.repository.candidateResults(await this.tokenHash(token), electionId);
    const empty = (): CategoryResult => ({
      candidates: [],
      tieDetected: false,
      provisionalWinnerCandidateId: null,
      finalWinnerCandidateId: null,
      winnerCandidateId: null,
    });
    const result: ElectionResults = { FOH: empty(), BOH: empty() };
    for (const category of ["FOH", "BOH"] as const) {
      const categoryRows = rows.filter((row) => row.category === category);
      const first = categoryRows[0];
      if (!first) continue;
      result[category] = {
        candidates: categoryRows.map((row) => ({
          candidateId: row.candidateId,
          name: row.name,
          department: row.department,
          category: row.category,
          isActive: row.isActive,
          voteCount: row.voteCount,
          categoryVoteCount: row.categoryVoteCount,
          votePercentage: row.votePercentage,
          rank: row.rank,
          isTiedForFirst: row.isTiedForFirst,
          isCurrentLeader: row.isCurrentLeader,
        })),
        tieDetected: first.tieDetected,
        provisionalWinnerCandidateId: first.provisionalWinnerCandidateId,
        finalWinnerCandidateId: first.finalWinnerCandidateId,
        winnerCandidateId: first.finalWinnerCandidateId ?? first.provisionalWinnerCandidateId,
      };
    }
    return result;
  }

  async turnout(token: string | undefined, electionId: string): Promise<Turnout> {
    const turnout = await this.repository.turnout(await this.tokenHash(token), electionId);
    if (!turnout) throw new ReportingError("NOT_FOUND", "Election turnout not found");
    return turnout;
  }

  async hodBallots(token: string | undefined, electionId: string): Promise<HodBallot[]> {
    return this.repository.hodBallots(await this.tokenHash(token), electionId);
  }
}

export const reportingService = new ReportingService();
