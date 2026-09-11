import { readFileSync } from "node:fs";
import path from "node:path";

import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { AuthenticationError } from "@/lib/auth/errors";
import { handleElectionResults } from "@/lib/reporting/http";
import {
  ReportingService,
  type ReportingRepository,
} from "@/lib/reporting/service";

const electionId = "40000000-0000-4000-8000-000000000001";

class FakeReportingRepository implements ReportingRepository {
  calls = 0;

  async candidateResults() {
    this.calls += 1;
    return [
      {
        electionId,
        candidateId: "50000000-0000-4000-8000-000000000001",
        name: "FOH Leader A",
        department: "Restaurant",
        category: "FOH" as const,
        isActive: true,
        voteCount: 4,
        categoryVoteCount: 10,
        votePercentage: 40,
        rank: 1,
        isTiedForFirst: true,
        isCurrentLeader: true,
        tieDetected: true,
        provisionalWinnerCandidateId: null,
        finalWinnerCandidateId: null,
      },
      {
        electionId,
        candidateId: "50000000-0000-4000-8000-000000000002",
        name: "FOH Leader B",
        department: "Front Office",
        category: "FOH" as const,
        isActive: true,
        voteCount: 4,
        categoryVoteCount: 10,
        votePercentage: 40,
        rank: 1,
        isTiedForFirst: true,
        isCurrentLeader: true,
        tieDetected: true,
        provisionalWinnerCandidateId: null,
        finalWinnerCandidateId: null,
      },
      {
        electionId,
        candidateId: "50000000-0000-4000-8000-000000000003",
        name: "BOH Winner",
        department: "Kitchen",
        category: "BOH" as const,
        isActive: true,
        voteCount: 6,
        categoryVoteCount: 10,
        votePercentage: 60,
        rank: 1,
        isTiedForFirst: false,
        isCurrentLeader: true,
        tieDetected: false,
        provisionalWinnerCandidateId: "50000000-0000-4000-8000-000000000003",
        finalWinnerCandidateId: null,
      },
    ];
  }

  async turnout() {
    this.calls += 1;
    return {
      electionId,
      totalEligibleHods: 10,
      completedHods: 8,
      pendingHods: 2,
      turnoutPercentage: 80,
    };
  }

  async hodBallots() {
    this.calls += 1;
    return [
      {
        electionId,
        hodId: "60000000-0000-4000-8000-000000000001",
        hodName: "Test HOD",
        department: "Finance",
        hasVoted: true,
        fohCandidateId: "50000000-0000-4000-8000-000000000001",
        fohCandidateName: "FOH Leader A",
        bohCandidateId: "50000000-0000-4000-8000-000000000003",
        bohCandidateName: "BOH Winner",
        submittedAt: "2026-09-10T10:05:00.000Z",
      },
      {
        electionId,
        hodId: "60000000-0000-4000-8000-000000000002",
        hodName: "Pending HOD",
        department: "Sales",
        hasVoted: false,
        fohCandidateId: null,
        fohCandidateName: null,
        bohCandidateId: null,
        bohCandidateName: null,
        submittedAt: null,
      },
    ];
  }
}

function roleVerifier(role: "HR" | "SYSTEM" | null) {
  return {
    async requireRole() {
      if (!role) throw new AuthenticationError("UNAUTHENTICATED", "Authentication required");
      return {
        sessionId: "session",
        adminPrincipalId: "admin",
        role,
        expiresAt: "2099-01-01T00:00:00.000Z",
      };
    },
  };
}

describe("results and turnout backend", () => {
  it.each(["HR", "SYSTEM"] as const)("allows %s to load FOH and BOH results", async (role) => {
    const results = await new ReportingService(
      new FakeReportingRepository(),
      roleVerifier(role),
    ).results("opaque-admin-token", electionId);
    expect(results.FOH.candidates).toHaveLength(2);
    expect(results.FOH.tieDetected).toBe(true);
    expect(results.FOH.winnerCandidateId).toBeNull();
    expect(results.FOH.candidates[0]).toMatchObject({ rank: 1, votePercentage: 40 });
    expect(results.BOH.candidates).toHaveLength(1);
    expect(results.BOH.tieDetected).toBe(false);
    expect(results.BOH.winnerCandidateId).toBe("50000000-0000-4000-8000-000000000003");
    expect(results.BOH.candidates[0]).toMatchObject({ rank: 1, voteCount: 6, votePercentage: 60 });
  });

  it("returns completed, pending, and turnout totals", async () => {
    const turnout = await new ReportingService(
      new FakeReportingRepository(),
      roleVerifier("HR"),
    ).turnout("opaque-admin-token", electionId);
    expect(turnout).toEqual({
      electionId,
      totalEligibleHods: 10,
      completedHods: 8,
      pendingHods: 2,
      turnoutPercentage: 80,
    });
  });

  it("returns voted/pending HODs and individual FOH/BOH choices", async () => {
    const ballots = await new ReportingService(
      new FakeReportingRepository(),
      roleVerifier("SYSTEM"),
    ).hodBallots("opaque-admin-token", electionId);
    expect(ballots[0]).toMatchObject({
      hasVoted: true,
      fohCandidateName: "FOH Leader A",
      bohCandidateName: "BOH Winner",
    });
    expect(ballots[1]).toMatchObject({
      hasVoted: false,
      fohCandidateName: null,
      bohCandidateName: null,
    });
  });

  it("rejects unauthenticated reporting before any database call", async () => {
    const repository = new FakeReportingRepository();
    await expect(new ReportingService(repository, roleVerifier(null))
      .results(undefined, electionId)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(repository.calls).toBe(0);
  });

  it("public HTTP requests cannot retrieve results and responses are never cached", async () => {
    const repository = new FakeReportingRepository();
    const service = new ReportingService(repository, roleVerifier(null));
    const response = await handleElectionResults(
      new NextRequest(`https://portal.example/api/elections/${electionId}/results`),
      electionId,
      service,
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(repository.calls).toBe(0);
  });

  it("uses only existing private reporting views and blocks browser RPC execution", () => {
    const sql = readFileSync(path.join(
      process.cwd(),
      "supabase/migrations/20260910180154_results_turnout_backend.sql",
    ), "utf8");
    expect(sql).toContain("from private.candidate_results cr");
    expect(sql).toContain("left join private.category_outcomes co");
    expect(sql).toContain("from private.election_turnout et");
    expect(sql).toContain("from private.hod_ballots hb");
    expect(sql).toContain("array['HR', 'SYSTEM']::public.admin_role[]");
    expect(sql).not.toMatch(/grant execute on function[^;]+to\s+(anon|authenticated)\s*;/i);
  });
});
