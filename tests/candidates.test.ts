import { describe, expect, it } from "vitest";

import { AuthenticationError } from "@/lib/auth/errors";
import {
  CandidateError,
  CandidateService,
  type Candidate,
  type CandidateRepository,
} from "@/lib/candidates/service";

const electionId = "20000000-0000-4000-8000-000000000001";
const candidateId = "30000000-0000-4000-8000-000000000001";
const baseCandidate: Candidate = {
  id: candidateId,
  electionId,
  name: "Test Candidate",
  department: "Test Department",
  category: "FOH",
  isActive: true,
  createdAt: "2026-09-10T10:00:00.000Z",
  updatedAt: "2026-09-10T10:00:00.000Z",
};

class FakeCandidateRepository implements CandidateRepository {
  records = [baseCandidate];
  lastInput: Record<string, unknown> | null = null;
  removed: { id: string; electionId: string } | null = null;

  async list() {
    return this.records;
  }

  async create(
    _tokenHash: Uint8Array,
    input: Parameters<CandidateRepository["create"]>[1],
  ) {
    this.lastInput = input;
    return { ...baseCandidate, ...input };
  }

  async update(
    _tokenHash: Uint8Array,
    id: string,
    input: Parameters<CandidateRepository["update"]>[2],
  ) {
    this.lastInput = input;
    return { ...baseCandidate, ...input, id };
  }

  async setActive(
    _tokenHash: Uint8Array,
    id: string,
    targetElectionId: string,
    isActive: boolean,
  ) {
    this.lastInput = { electionId: targetElectionId, isActive };
    return { ...baseCandidate, id, electionId: targetElectionId, isActive };
  }

  async remove(_tokenHash: Uint8Array, id: string, targetElectionId: string) {
    this.removed = { id, electionId: targetElectionId };
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

describe("candidate management service", () => {
  it("allows HR to list candidates for an election", async () => {
    const service = new CandidateService(new FakeCandidateRepository(), roleVerifier("HR"));
    await expect(service.list("opaque-session-token", electionId)).resolves.toEqual([baseCandidate]);
  });

  it("allows SYSTEM to inherit HR candidate permissions", async () => {
    const service = new CandidateService(new FakeCandidateRepository(), roleVerifier("SYSTEM"));
    await expect(service.list("opaque-session-token", electionId)).resolves.toEqual([baseCandidate]);
  });

  it("rejects unauthenticated candidate access", async () => {
    const service = new CandidateService(new FakeCandidateRepository(), roleVerifier(null));
    await expect(service.list(undefined, electionId)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
  });

  it("adds a normalized candidate to its election", async () => {
    const repository = new FakeCandidateRepository();
    const service = new CandidateService(repository, roleVerifier("HR"));
    await service.create("opaque-session-token", {
      electionId,
      name: "  Test Candidate  ",
      department: " Operations ",
      category: "FOH",
    });
    expect(repository.lastInput).toEqual({
      electionId,
      name: "Test Candidate",
      department: "Operations",
      category: "FOH",
      isActive: true,
    });
  });

  it("edits candidate details and category without moving the election", async () => {
    const repository = new FakeCandidateRepository();
    const service = new CandidateService(repository, roleVerifier("HR"));
    await expect(service.update("opaque-session-token", candidateId, {
      electionId,
      name: "Updated Candidate",
      department: "Kitchen",
      category: "BOH",
    })).resolves.toMatchObject({ electionId, category: "BOH" });
  });

  it("rejects categories outside FOH and BOH", async () => {
    const service = new CandidateService(new FakeCandidateRepository(), roleVerifier("HR"));
    await expect(service.create("opaque-session-token", {
      electionId,
      name: "Invalid Category",
      department: "Operations",
      category: "OTHER" as "FOH",
    })).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("activates and deactivates a candidate", async () => {
    const repository = new FakeCandidateRepository();
    const service = new CandidateService(repository, roleVerifier("HR"));
    await expect(service.setActive("opaque-session-token", candidateId, electionId, false))
      .resolves.toMatchObject({ isActive: false });
    await expect(service.setActive("opaque-session-token", candidateId, electionId, true))
      .resolves.toMatchObject({ isActive: true });
  });

  it("removes a candidate only through the election-scoped operation", async () => {
    const repository = new FakeCandidateRepository();
    const service = new CandidateService(repository, roleVerifier("SYSTEM"));
    await service.remove("opaque-session-token", candidateId, electionId);
    expect(repository.removed).toEqual({ id: candidateId, electionId });
  });

  it("preserves database election-locking errors", async () => {
    const repository = new FakeCandidateRepository();
    repository.setActive = async () => {
      throw new CandidateError("LOCKED", "Candidate changes require a DRAFT election");
    };
    const service = new CandidateService(repository, roleVerifier("HR"));
    await expect(service.setActive("opaque-session-token", candidateId, electionId, false))
      .rejects.toMatchObject({ code: "LOCKED" });
  });
});
