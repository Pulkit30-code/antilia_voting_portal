import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import {
  handleBallotSubmission,
  handleCandidateList,
  handleHodVerification,
} from "@/lib/voting/http";
import {
  VotingService,
  type CandidateCategory,
  type HodVerificationInput,
  type VotingRepository,
} from "@/lib/voting/service";

const election = {
  id: "40000000-0000-4000-8000-000000000001",
  name: "September Best Employee",
  month: 9,
  year: 2026,
  openedAt: "2026-09-10T10:00:00.000Z",
};
const fohId = "50000000-0000-4000-8000-000000000001";
const bohId = "50000000-0000-4000-8000-000000000002";

class FakeVotingRepository implements VotingRepository {
  openElection = election;
  registeredIdentity: HodVerificationInput | null = null;
  verificationStatus: "VERIFIED" | "ELECTION_NOT_OPEN" | "HOD_NOT_VERIFIED" | "ALREADY_VOTED" = "VERIFIED";
  rateAllowed = true;
  scopes: string[] = [];
  verificationInput: HodVerificationInput | null = null;
  verificationTokenHash: Uint8Array | null = null;
  submitted: Parameters<VotingRepository["submitBallot"]> | null = null;

  async getOpenElection() { return this.openElection; }
  async listCandidates(_electionId: string, category: CandidateCategory) {
    return [{
      id: category === "FOH" ? fohId : bohId,
      name: `${category} Candidate`,
      department: "Test Department",
      category,
    }];
  }
  async consumeRateLimit(scope: "VERIFY" | "SUBMIT") {
    this.scopes.push(scope);
    return { allowed: this.rateAllowed, retryAfterSeconds: this.rateAllowed ? 0 : 600 };
  }
  async verifyHod(input: HodVerificationInput, tokenHash: Uint8Array) {
    this.verificationInput = input;
    this.verificationTokenHash = tokenHash;
    const normalized = (value: string) => value.trim().toLocaleLowerCase();
    const normalizedMobile = (value: string) => value.replace(/\D/g, "");
    const identityMatches = !this.registeredIdentity || (
      normalized(input.name) === normalized(this.registeredIdentity.name)
      && normalizedMobile(input.mobileNumber) === normalizedMobile(this.registeredIdentity.mobileNumber)
      && normalized(input.department) === normalized(this.registeredIdentity.department)
    );
    const status = identityMatches ? this.verificationStatus : "HOD_NOT_VERIFIED";
    return {
      verificationStatus: status,
      election: status === "VERIFIED" ? election : null,
      expiresAt: status === "VERIFIED" ? "2026-09-10T10:10:00.000Z" : null,
    };
  }
  async submitBallot(...parameters: Parameters<VotingRepository["submitBallot"]>) {
    this.submitted = parameters;
    return { ballotId: "60000000-0000-4000-8000-000000000001" };
  }
}

const ipHash = new Uint8Array(32).fill(7);

describe("public HOD voting service", () => {
  it("loads only the current OPEN election and requested candidate category", async () => {
    const repository = new FakeVotingRepository();
    const service = new VotingService(repository);
    await expect(service.getOpenElection()).resolves.toEqual(election);
    await expect(service.getCandidates("FOH")).resolves.toEqual([
      expect.objectContaining({ id: fohId, category: "FOH" }),
    ]);
    await expect(service.getCandidates("BOH")).resolves.toEqual([
      expect.objectContaining({ id: bohId, category: "BOH" }),
    ]);
  });

  it("rejects voting lookup when no election is OPEN", async () => {
    const repository = new FakeVotingRepository();
    repository.openElection = null as never;
    await expect(new VotingService(repository).getOpenElection())
      .rejects.toMatchObject({ code: "ELECTION_NOT_OPEN" });
  });

  it("verifies all three HOD fields and stores only the token hash", async () => {
    const repository = new FakeVotingRepository();
    const rawToken = "opaque-voter-token";
    const service = new VotingService(repository, () => rawToken);
    const result = await service.verifyHod({
      name: "  Test HOD  ",
      mobileNumber: "+91 98765 43210",
      department: "  Finance  ",
    }, ipHash);
    expect(result.token).toBe(rawToken);
    expect(repository.verificationInput).toEqual({
      name: "Test HOD",
      mobileNumber: "+91 98765 43210",
      department: "Finance",
    });
    expect(Buffer.from(repository.verificationTokenHash!)).toEqual(
      createHash("sha256").update(rawToken).digest(),
    );
    expect(Buffer.from(repository.verificationTokenHash!).toString()).not.toContain(rawToken);
  });

  it("accepts the registered department with safe casing/space normalization and rejects a wrong department", async () => {
    const repository = new FakeVotingRepository();
    repository.registeredIdentity = {
      name: "Test HOD",
      mobileNumber: "+919876543210",
      department: "Finance",
    };
    const service = new VotingService(repository, () => "opaque-voter-token");

    await expect(service.verifyHod({
      name: "  test hod  ",
      mobileNumber: "+91 98765 43210",
      department: "  fINANce  ",
    }, ipHash)).resolves.toMatchObject({ election });
    expect(repository.verificationInput?.department).toBe("fINANce");

    await expect(service.verifyHod({
      name: "Test HOD",
      mobileNumber: "+919876543210",
      department: "Unrelated Department",
    }, ipHash)).rejects.toMatchObject({ code: "HOD_NOT_VERIFIED" });
  });

  it.each([
    ["HOD_NOT_VERIFIED", "HOD_NOT_VERIFIED"],
    ["ALREADY_VOTED", "ALREADY_VOTED"],
    ["ELECTION_NOT_OPEN", "ELECTION_NOT_OPEN"],
  ] as const)("returns a safe %s verification failure", async (status, code) => {
    const repository = new FakeVotingRepository();
    repository.verificationStatus = status;
    await expect(new VotingService(repository).verifyHod({
      name: "Test HOD",
      mobileNumber: "+919876543210",
      department: "Finance",
    }, ipHash)).rejects.toMatchObject({ code });
  });

  it("submits FOH and BOH together through one atomic repository call", async () => {
    const repository = new FakeVotingRepository();
    const service = new VotingService(
      repository,
      () => "unused",
      () => "70000000-0000-4000-8000-000000000001",
    );
    await expect(service.submitBallot(
      "opaque-voter-token",
      { fohCandidateId: fohId, bohCandidateId: bohId },
      ipHash,
      "test-agent",
    )).resolves.toEqual({ ballotId: "60000000-0000-4000-8000-000000000001" });
    expect(repository.submitted?.[1]).toEqual({
      fohCandidateId: fohId,
      bohCandidateId: bohId,
    });
    expect(repository.scopes).toEqual(["SUBMIT"]);
  });

  it("rejects an unverified session and duplicate-category selection", async () => {
    const service = new VotingService(new FakeVotingRepository());
    await expect(service.submitBallot(undefined, {
      fohCandidateId: fohId,
      bohCandidateId: bohId,
    }, ipHash, null)).rejects.toMatchObject({ code: "HOD_NOT_VERIFIED" });
    await expect(service.submitBallot("token", {
      fohCandidateId: fohId,
      bohCandidateId: fohId,
    }, ipHash, null)).rejects.toMatchObject({ code: "INVALID_CANDIDATE" });
  });

  it("rate-limits verification before attempting identity lookup", async () => {
    const repository = new FakeVotingRepository();
    repository.rateAllowed = false;
    await expect(new VotingService(repository).verifyHod({
      name: "Test HOD",
      mobileNumber: "+919876543210",
      department: "Finance",
    }, ipHash)).rejects.toMatchObject({ code: "RATE_LIMITED", retryAfterSeconds: 600 });
    expect(repository.verificationInput).toBeNull();
  });

  it("migration preserves the existing atomic ballot and blocks browser execution", () => {
    const sql = readFileSync(path.join(
      process.cwd(),
      "supabase/migrations/20260910175204_public_hod_voting_api.sql",
    ), "utf8");
    expect(sql).toContain("from private.submit_ballot(");
    expect(sql).toContain("from public, anon, authenticated");
    expect(sql).toContain("where h.is_active");
    expect(sql).toContain("and eh.is_active");
    expect(sql).toContain("and eh.is_approved");
    expect(sql).toContain("lower(btrim(eh.department_snapshot)) = lower(btrim(p_department))");
    expect(sql).not.toMatch(/grant execute[\s\S]*to anon/i);
    expect(sql).not.toMatch(/grant (select|insert|update|delete)[\s\S]*to anon/i);
  });

  it("renders department as free text without publishing registered department options", () => {
    const source = readFileSync(path.join(process.cwd(), "components/public-voting-portal.tsx"), "utf8");
    expect(source).toContain('label="Department"');
    expect(source).toContain('placeholder="Enter your registered department"');
    expect(source).not.toContain('<Select\n                    id="department"');
    expect(source).not.toContain("const departments =");
    expect(source).not.toContain("otherDepartment");
  });
});

describe("public voting HTTP boundary", () => {
  const fakeService = {
    async getOpenElection() { return election; },
    async getCandidates(category: CandidateCategory) {
      return [{ id: category === "FOH" ? fohId : bohId, name: "Candidate", department: "Department", category }];
    },
    async verifyHod() {
      return { token: "opaque-voter-token", election, expiresAt: "2026-09-10T10:10:00.000Z" };
    },
    async submitBallot() { return { ballotId: "60000000-0000-4000-8000-000000000001" }; },
  };

  it("returns no HOD PII and sets a secure HttpOnly verification cookie", async () => {
    const request = new NextRequest("https://portal.example/api/voting/verify", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://portal.example", host: "portal.example" },
      body: JSON.stringify({ name: "Secret Name", mobileNumber: "+919876543210", department: "Secret Department" }),
    });
    const response = await handleHodVerification(request, fakeService);
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("antilia_voter_session=opaque-voter-token");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(body).not.toContain("Secret Name");
    expect(body).not.toContain("9876543210");
    expect(body).not.toContain("Secret Department");
  });

  it("loads category-specific candidates without HOD, vote, result, or admin fields", async () => {
    const response = await handleCandidateList("FOH", fakeService);
    const body = await response.json();
    expect(body.candidates).toEqual([{ id: fohId, name: "Candidate", department: "Department", category: "FOH" }]);
    expect(JSON.stringify(body)).not.toMatch(/mobile|hod|vote|result|admin/i);
  });

  it("rejects cross-origin ballot mutation", async () => {
    const request = new NextRequest("https://portal.example/api/voting/ballot", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://attacker.example",
        host: "portal.example",
        cookie: "antilia_voter_session=opaque-voter-token",
      },
      body: JSON.stringify({ fohCandidateId: fohId, bohCandidateId: bohId }),
    });
    const response = await handleBallotSubmission(request, fakeService);
    expect(response.status).toBe(403);
  });
});
