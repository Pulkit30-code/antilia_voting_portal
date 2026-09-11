import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { AuthenticationError } from "@/lib/auth/errors";
import {
  TieBreakError,
  TieBreakService,
  type TieBreak,
  type TieBreakCandidateResult,
  type TieBreakRepository,
} from "@/lib/tie-breaks/service";

const electionId = "40000000-0000-4000-8000-000000000001";
const tieBreakId = "50000000-0000-4000-8000-000000000001";
const candidateId = "60000000-0000-4000-8000-000000000001";
const baseTieBreak: TieBreak = {
  id: tieBreakId,
  originalElectionId: electionId,
  category: "FOH",
  roundNumber: 1,
  status: "DRAFT",
  openedAt: null,
  closedAt: null,
  createdAt: "2026-09-10T12:00:00.000Z",
  updatedAt: "2026-09-10T12:00:00.000Z",
};

class FakeTieBreakRepository implements TieBreakRepository {
  record = baseTieBreak;
  resultRows: TieBreakCandidateResult[] = [
    { candidateId, name: "Candidate A", voteCount: 6, rank: 1, isLeader: true },
    {
      candidateId: "60000000-0000-4000-8000-000000000002",
      name: "Candidate B",
      voteCount: 4,
      rank: 2,
      isLeader: false,
    },
  ];
  controls: string[] = [];
  createCalled = false;
  submitted: Parameters<TieBreakRepository["submitVote"]> | null = null;
  verificationHash: Uint8Array | null = null;
  rateAllowed = true;

  async list() { return [this.record]; }
  async get() { return this.record; }
  async results() { return this.resultRows; }
  async create() { this.createCalled = true; return this.record; }
  async control(_hash: Uint8Array, _id: string, action: "open" | "close") {
    this.controls.push(action);
    this.record = {
      ...this.record,
      status: action === "open" ? "OPEN" : "CLOSED",
      openedAt: "2026-09-10T12:05:00.000Z",
      closedAt: action === "close" ? "2026-09-10T12:10:00.000Z" : null,
    };
    return this.record;
  }
  async listOpen() {
    return [{
      id: tieBreakId,
      originalElectionId: electionId,
      originalElectionName: "September Service Awards",
      electionMonth: 9,
      electionYear: 2026,
      category: "FOH" as const,
      roundNumber: 1,
      openedAt: "2026-09-10T12:05:00.000Z",
    }];
  }
  async publicCandidates() {
    return [{ id: candidateId, name: "Candidate A", department: "Restaurant", category: "FOH" as const }];
  }
  async consumeRateLimit() { return { allowed: this.rateAllowed, retryAfterSeconds: 600 }; }
  async verifyHod(_id: string, _input: { name: string; mobileNumber: string; department: string }, hash: Uint8Array) {
    this.verificationHash = hash;
    return {
      status: "VERIFIED" as const,
      tieBreakId,
      category: "FOH" as const,
      expiresAt: "2026-09-10T12:15:00.000Z",
    };
  }
  async submitVote(...parameters: Parameters<TieBreakRepository["submitVote"]>) {
    this.submitted = parameters;
    return "70000000-0000-4000-8000-000000000001";
  }
}

function roleVerifier(role: "HR" | "SYSTEM" | null) {
  return {
    async requireRole(_token: string | undefined, required: "HR" | "SYSTEM") {
      if (!role) throw new AuthenticationError("UNAUTHENTICATED", "Authentication required");
      if (role === "HR" && required === "SYSTEM") {
        throw new AuthenticationError("FORBIDDEN", "Forbidden");
      }
      return {
        sessionId: "session",
        adminPrincipalId: "admin",
        role,
        expiresAt: "2099-01-01T00:00:00.000Z",
      };
    },
  };
}

const ipHash = new Uint8Array(32).fill(9);

describe("tie-break backend", () => {
  it("allows SYSTEM to create, open, and close a tie-break", async () => {
    const repository = new FakeTieBreakRepository();
    const service = new TieBreakService(repository, roleVerifier("SYSTEM"));
    await expect(service.create("admin-token", electionId, "FOH")).resolves.toMatchObject({ status: "DRAFT" });
    await expect(service.control("admin-token", tieBreakId, "open")).resolves.toMatchObject({ status: "OPEN" });
    await expect(service.control("admin-token", tieBreakId, "close")).resolves.toMatchObject({
      status: "CLOSED",
      tieDetected: false,
      winnerCandidateId: candidateId,
    });
    expect(repository.controls).toEqual(["open", "close"]);
  });

  it("blocks HR and unauthenticated users from all controls", async () => {
    const hrRepository = new FakeTieBreakRepository();
    const hr = new TieBreakService(hrRepository, roleVerifier("HR"));
    await expect(hr.create("hr-token", electionId, "FOH")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(hr.control("hr-token", tieBreakId, "open")).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(hrRepository.createCalled).toBe(false);
    await expect(new TieBreakService(new FakeTieBreakRepository(), roleVerifier(null))
      .control(undefined, tieBreakId, "close")).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it.each(["HR", "SYSTEM"] as const)("allows %s to list and view status/results", async (role) => {
    const service = new TieBreakService(new FakeTieBreakRepository(), roleVerifier(role));
    await expect(service.list("admin-token", electionId)).resolves.toHaveLength(1);
    await expect(service.get("admin-token", tieBreakId)).resolves.toMatchObject({
      id: tieBreakId,
      results: expect.arrayContaining([expect.objectContaining({ candidateId, rank: 1 })]),
    });
  });

  it("lists active tie-breaks without exposing administrative controls", async () => {
    const service = new TieBreakService(new FakeTieBreakRepository(), roleVerifier(null));
    await expect(service.openTieBreaks()).resolves.toEqual([
      expect.objectContaining({ id: tieBreakId, category: "FOH", originalElectionId: electionId }),
    ]);
  });

  it("reports another tie after close without creating another round", async () => {
    const repository = new FakeTieBreakRepository();
    repository.resultRows = [
      { candidateId, name: "Candidate A", voteCount: 5, rank: 1, isLeader: true },
      {
        candidateId: "60000000-0000-4000-8000-000000000002",
        name: "Candidate B",
        voteCount: 5,
        rank: 1,
        isLeader: true,
      },
    ];
    const result = await new TieBreakService(repository, roleVerifier("SYSTEM"))
      .control("admin-token", tieBreakId, "close");
    expect(result.tieDetected).toBe(true);
    expect(result.winnerCandidateId).toBeNull();
    expect(repository.createCalled).toBe(false);
  });

  it("verifies an eligible HOD with an opaque token hash and submits one scoped vote", async () => {
    const repository = new FakeTieBreakRepository();
    const rawToken = "opaque-tie-break-token";
    const service = new TieBreakService(
      repository,
      roleVerifier(null),
      () => rawToken,
      () => "80000000-0000-4000-8000-000000000001",
    );
    await expect(service.verifyHod(tieBreakId, {
      name: "Test HOD",
      mobileNumber: "+91 98765 43210",
      department: "Finance",
    }, ipHash)).resolves.toMatchObject({ tieBreakId, category: "FOH" });
    expect(Buffer.from(repository.verificationHash!)).toEqual(
      createHash("sha256").update(rawToken).digest(),
    );
    await expect(service.submitVote(rawToken, tieBreakId, candidateId, ipHash, "test-agent"))
      .resolves.toEqual({ voteId: "70000000-0000-4000-8000-000000000001" });
    expect(repository.submitted?.[1]).toBe(tieBreakId);
    expect(repository.submitted?.[2]).toBe(candidateId);
  });

  it("rejects missing voter verification and enforces persistent rate limiting", async () => {
    const repository = new FakeTieBreakRepository();
    const service = new TieBreakService(repository, roleVerifier(null));
    await expect(service.submitVote(undefined, tieBreakId, candidateId, ipHash, null))
      .rejects.toMatchObject({ code: "NOT_VERIFIED" });
    repository.rateAllowed = false;
    await expect(service.verifyHod(tieBreakId, {
      name: "Test HOD", mobileNumber: "+919876543210", department: "Finance",
    }, ipHash)).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });

  it("preserves original votes and delegates all relational validation to Phase 1", () => {
    const migration = readFileSync(path.join(
      process.cwd(), "supabase/migrations/20260910181149_tie_break_backend.sql",
    ), "utf8");
    const phaseOne = readFileSync(path.join(
      process.cwd(), "supabase/migrations/20260910064758_phase_1_voting_architecture.sql",
    ), "utf8");
    expect(migration).toContain("private.initiate_tie_break(");
    expect(migration).toContain("private.set_tie_break_status(");
    expect(migration).toContain("private.submit_tie_break_vote(");
    expect(migration).not.toMatch(/(update|delete from)\s+public\.votes/i);
    expect(phaseOne).toContain("constraint tie_break_votes_hod_key unique (tie_break_id, hod_id)");
    expect(phaseOne).toContain("references public.tie_break_candidates(tie_break_id, candidate_id)");
    expect(migration).toContain("'TIE_BREAK_OPENED'::public.audit_action");
    expect(migration).toContain("'TIE_BREAK_CLOSED'::public.audit_action");
    expect(migration).not.toMatch(/grant execute on function[^;]+to\s+(anon|authenticated)\s*;/i);
  });

  it("maps database duplicate and candidate failures safely", () => {
    expect(new TieBreakError("ALREADY_VOTED", "Already voted").message).toBe("Already voted");
    expect(new TieBreakError("INVALID_CANDIDATE", "Invalid candidate selection").message)
      .toBe("Invalid candidate selection");
  });
});
