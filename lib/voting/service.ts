import "server-only";

import { randomUUID } from "node:crypto";

import { createOpaqueSessionToken, hashSessionToken } from "@/lib/auth/crypto";
import { createAdminClient } from "@/lib/supabase/admin";

export type CandidateCategory = "FOH" | "BOH";

export type OpenElection = {
  id: string;
  name: string;
  month: number;
  year: number;
  openedAt: string;
};

export type VotingCandidate = {
  id: string;
  name: string;
  department: string;
  category: CandidateCategory;
};

export type HodVerificationInput = {
  name: string;
  mobileNumber: string;
  department: string;
};

export type BallotSelection = {
  fohCandidateId: string;
  bohCandidateId: string;
};

export type VotingErrorCode =
  | "VALIDATION"
  | "ELECTION_NOT_OPEN"
  | "HOD_NOT_VERIFIED"
  | "ALREADY_VOTED"
  | "INVALID_CANDIDATE"
  | "RATE_LIMITED"
  | "INTERNAL";

export class VotingError extends Error {
  constructor(
    public readonly code: VotingErrorCode,
    message: string,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "VotingError";
  }
}

type VerifyRecord = {
  verificationStatus: "VERIFIED" | "ELECTION_NOT_OPEN" | "HOD_NOT_VERIFIED" | "ALREADY_VOTED";
  election: OpenElection | null;
  expiresAt: string | null;
};

export interface VotingRepository {
  getOpenElection(): Promise<OpenElection | null>;
  listCandidates(electionId: string, category: CandidateCategory): Promise<VotingCandidate[]>;
  consumeRateLimit(scope: "VERIFY" | "SUBMIT", ipHash: Uint8Array): Promise<{
    allowed: boolean;
    retryAfterSeconds: number;
  }>;
  verifyHod(input: HodVerificationInput, tokenHash: Uint8Array): Promise<VerifyRecord>;
  submitBallot(
    tokenHash: Uint8Array,
    selection: BallotSelection,
    requestId: string,
    userAgent: string | null,
  ): Promise<{ ballotId: string }>;
}

type RpcRecord = Record<string, unknown>;

function toBytea(value: Uint8Array): string {
  return `\\x${Buffer.from(value).toString("hex")}`;
}

function firstRecord(value: unknown): RpcRecord | null {
  if (Array.isArray(value)) return (value[0] as RpcRecord | undefined) ?? null;
  return value && typeof value === "object" ? value as RpcRecord : null;
}

function text(record: RpcRecord, field: string): string {
  const value = record[field];
  if (typeof value !== "string") throw new VotingError("INTERNAL", "Invalid voting response");
  return value;
}

function number(record: RpcRecord, field: string): number {
  const value = record[field];
  if (typeof value !== "number") throw new VotingError("INTERNAL", "Invalid voting response");
  return value;
}

function databaseError(code?: string): VotingError {
  if (code === "55000") return new VotingError("ELECTION_NOT_OPEN", "Election is not open");
  if (code === "42501") return new VotingError("HOD_NOT_VERIFIED", "HOD not verified");
  if (code === "23505") return new VotingError("ALREADY_VOTED", "Already voted");
  if (code === "23514" || code === "23503") {
    return new VotingError("INVALID_CANDIDATE", "Invalid candidate selection");
  }
  return new VotingError("INTERNAL", "Voting operation failed");
}

export class SupabaseVotingRepository implements VotingRepository {
  async getOpenElection(): Promise<OpenElection | null> {
    const { data, error } = await createAdminClient()
      .from("elections")
      .select("id,name,election_month,election_year,opened_at")
      .eq("status", "OPEN")
      .is("deleted_at", null)
      .order("opened_at", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw databaseError(error.code);
    if (!data) return null;
    if (typeof data.opened_at !== "string") throw new VotingError("INTERNAL", "Invalid election response");
    return {
      id: data.id,
      name: data.name,
      month: data.election_month,
      year: data.election_year,
      openedAt: data.opened_at,
    };
  }

  async listCandidates(electionId: string, category: CandidateCategory): Promise<VotingCandidate[]> {
    const { data, error } = await createAdminClient()
      .from("candidates")
      .select("id,name,department,category")
      .eq("election_id", electionId)
      .eq("category", category)
      .eq("is_active", true)
      .order("name", { ascending: true });
    if (error) throw databaseError(error.code);
    return (data ?? []).map((candidate) => ({
      id: candidate.id,
      name: candidate.name,
      department: candidate.department,
      category: candidate.category as CandidateCategory,
    }));
  }

  async consumeRateLimit(scope: "VERIFY" | "SUBMIT", ipHash: Uint8Array) {
    const { data, error } = await createAdminClient().rpc(
      "antilia_voting_consume_rate_limit",
      { p_scope: scope, p_ip_hash: toBytea(ipHash) },
    );
    if (error) throw databaseError(error.code);
    const record = firstRecord(data);
    if (!record || typeof record.allowed !== "boolean") {
      throw new VotingError("INTERNAL", "Invalid rate-limit response");
    }
    return {
      allowed: record.allowed,
      retryAfterSeconds: number(record, "retry_after_seconds"),
    };
  }

  async verifyHod(input: HodVerificationInput, tokenHash: Uint8Array): Promise<VerifyRecord> {
    const { data, error } = await createAdminClient().rpc("antilia_voting_verify_hod", {
      p_name: input.name,
      p_mobile_number: input.mobileNumber,
      p_department: input.department,
      p_token_hash: toBytea(tokenHash),
    });
    if (error) throw databaseError(error.code);
    const record = firstRecord(data);
    if (!record) throw new VotingError("INTERNAL", "Invalid verification response");
    const status = text(record, "verification_status") as VerifyRecord["verificationStatus"];
    if (!["VERIFIED", "ELECTION_NOT_OPEN", "HOD_NOT_VERIFIED", "ALREADY_VOTED"].includes(status)) {
      throw new VotingError("INTERNAL", "Invalid verification response");
    }
    const election = record.election_id === null ? null : {
      id: text(record, "election_id"),
      name: text(record, "election_name"),
      month: number(record, "election_month"),
      year: number(record, "election_year"),
      openedAt: text(record, "opened_at"),
    };
    return {
      verificationStatus: status,
      election,
      expiresAt: typeof record.expires_at === "string" ? record.expires_at : null,
    };
  }

  async submitBallot(
    tokenHash: Uint8Array,
    selection: BallotSelection,
    requestId: string,
    userAgent: string | null,
  ): Promise<{ ballotId: string }> {
    const { data, error } = await createAdminClient().rpc(
      "antilia_voting_submit_verified_ballot",
      {
        p_token_hash: toBytea(tokenHash),
        p_foh_candidate_id: selection.fohCandidateId,
        p_boh_candidate_id: selection.bohCandidateId,
        p_request_id: requestId,
        p_user_agent: userAgent?.slice(0, 1000) ?? null,
      },
    );
    if (error) throw databaseError(error.code);
    const record = firstRecord(data);
    if (!record) throw new VotingError("INTERNAL", "Invalid ballot response");
    return { ballotId: text(record, "ballot_id") };
  }
}

function normalizeVerificationInput(input: HodVerificationInput): HodVerificationInput {
  const name = input.name.trim();
  const department = input.department.trim();
  const mobileNumber = input.mobileNumber.trim();
  const normalizedMobile = mobileNumber.replace(/^00/, "").replace(/[^0-9]/g, "");
  if (name.length < 1 || name.length > 160 || department.length < 1 || department.length > 160) {
    throw new VotingError("VALIDATION", "HOD not verified");
  }
  if (normalizedMobile.length < 8 || normalizedMobile.length > 15) {
    throw new VotingError("VALIDATION", "HOD not verified");
  }
  return { name, mobileNumber, department };
}

export class VotingService {
  constructor(
    private readonly repository: VotingRepository = new SupabaseVotingRepository(),
    private readonly tokenFactory: () => string = createOpaqueSessionToken,
    private readonly requestIdFactory: () => string = randomUUID,
  ) {}

  async getOpenElection(): Promise<OpenElection> {
    const election = await this.repository.getOpenElection();
    if (!election) throw new VotingError("ELECTION_NOT_OPEN", "Election is not open");
    return election;
  }

  async getCandidates(category: CandidateCategory): Promise<VotingCandidate[]> {
    const election = await this.getOpenElection();
    return this.repository.listCandidates(election.id, category);
  }

  private async enforceRateLimit(scope: "VERIFY" | "SUBMIT", ipHash: Uint8Array): Promise<void> {
    const result = await this.repository.consumeRateLimit(scope, ipHash);
    if (!result.allowed) {
      throw new VotingError(
        "RATE_LIMITED",
        "Too many attempts. Try again later.",
        result.retryAfterSeconds,
      );
    }
  }

  async verifyHod(input: HodVerificationInput, ipHash: Uint8Array) {
    await this.enforceRateLimit("VERIFY", ipHash);
    const token = this.tokenFactory();
    const result = await this.repository.verifyHod(
      normalizeVerificationInput(input),
      hashSessionToken(token),
    );
    if (result.verificationStatus === "ELECTION_NOT_OPEN") {
      throw new VotingError("ELECTION_NOT_OPEN", "Election is not open");
    }
    if (result.verificationStatus === "HOD_NOT_VERIFIED") {
      throw new VotingError("HOD_NOT_VERIFIED", "HOD not verified");
    }
    if (result.verificationStatus === "ALREADY_VOTED") {
      throw new VotingError("ALREADY_VOTED", "Already voted");
    }
    if (!result.election || !result.expiresAt) {
      throw new VotingError("INTERNAL", "Invalid verification response");
    }
    return { token, election: result.election, expiresAt: result.expiresAt };
  }

  async submitBallot(
    token: string | undefined,
    selection: BallotSelection,
    ipHash: Uint8Array,
    userAgent: string | null,
  ): Promise<{ ballotId: string }> {
    await this.enforceRateLimit("SUBMIT", ipHash);
    if (!token) throw new VotingError("HOD_NOT_VERIFIED", "HOD not verified");
    if (selection.fohCandidateId === selection.bohCandidateId) {
      throw new VotingError("INVALID_CANDIDATE", "Invalid candidate selection");
    }
    return this.repository.submitBallot(
      hashSessionToken(token),
      selection,
      this.requestIdFactory(),
      userAgent,
    );
  }
}

export const votingService = new VotingService();
