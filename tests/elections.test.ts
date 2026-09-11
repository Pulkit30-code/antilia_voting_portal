import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { AuthenticationError } from "@/lib/auth/errors";
import {
  ElectionError,
  ElectionService,
  mapElectionDatabaseError,
  type Election,
  type ElectionRepository,
} from "@/lib/elections/service";
import { handleElectionSystemAction } from "@/lib/elections/http";

const electionId = "40000000-0000-4000-8000-000000000001";
const baseElection: Election = {
  id: electionId,
  name: "September 2026 Best Employee",
  month: 9,
  year: 2026,
  status: "DRAFT",
  openedAt: null,
  closedAt: null,
  createdAt: "2026-09-10T10:00:00.000Z",
  updatedAt: "2026-09-10T10:00:00.000Z",
};

class FakeElectionRepository implements ElectionRepository {
  records = [{ ...baseElection }];
  lastInput: Record<string, unknown> | null = null;
  cancelledId: string | null = null;
  actions: string[] = [];

  async list() {
    return this.records;
  }

  async get(_tokenHash: Uint8Array, id: string) {
    return id === electionId ? baseElection : null;
  }

  async create(_tokenHash: Uint8Array, input: Parameters<ElectionRepository["create"]>[1]) {
    this.lastInput = input;
    return { ...baseElection, ...input };
  }

  async update(
    _tokenHash: Uint8Array,
    id: string,
    input: Parameters<ElectionRepository["update"]>[2],
  ) {
    this.lastInput = input;
    return { ...baseElection, ...input, id };
  }

  async cancel(_tokenHash: Uint8Array, id: string) {
    this.cancelledId = id;
  }

  async systemAction(
    _tokenHash: Uint8Array,
    id: string,
    action: "start" | "close" | "reopen" | "reset",
  ) {
    this.actions.push(action);
    const current = this.records[0];
    const expected = action === "start" ? "DRAFT" : action === "close" ? "OPEN" : "CLOSED";
    if (action !== "reset" && current.status !== expected) {
      throw new ElectionError("LOCKED", `Election is not in ${expected} status`);
    }
    if (action === "reset") {
      return { ...baseElection, id: `${id}-replacement`, status: "DRAFT" as const };
    }
    const changed = {
      ...current,
      id,
      status: action === "close" ? "CLOSED" as const : "OPEN" as const,
      openedAt: action === "start" ? "2026-09-11T10:00:00.000Z" : current.openedAt,
      closedAt: action === "close" ? "2026-09-11T11:00:00.000Z" : null,
    };
    this.records[0] = changed;
    return changed;
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

describe("monthly election management service", () => {
  it("allows HR to list and view elections", async () => {
    const service = new ElectionService(new FakeElectionRepository(), roleVerifier("HR"));
    await expect(service.list("opaque-session-token")).resolves.toEqual([baseElection]);
    await expect(service.get("opaque-session-token", electionId)).resolves.toEqual(baseElection);
  });

  it("allows SYSTEM to inherit HR election permissions", async () => {
    const service = new ElectionService(new FakeElectionRepository(), roleVerifier("SYSTEM"));
    await expect(service.list("opaque-session-token")).resolves.toEqual([baseElection]);
  });

  it("rejects unauthenticated election access", async () => {
    const service = new ElectionService(new FakeElectionRepository(), roleVerifier(null));
    await expect(service.list(undefined)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("creates a normalized monthly election that remains DRAFT", async () => {
    const repository = new FakeElectionRepository();
    const service = new ElectionService(repository, roleVerifier("HR"));
    const election = await service.create("opaque-session-token", {
      name: "  September 2026 Best Employee  ",
      month: 9,
      year: 2026,
    });
    expect(repository.lastInput).toEqual({
      name: "September 2026 Best Employee",
      month: 9,
      year: 2026,
    });
    expect(election.status).toBe("DRAFT");
  });

  it("validates month and year before creation", async () => {
    const service = new ElectionService(new FakeElectionRepository(), roleVerifier("HR"));
    await expect(service.create("opaque-session-token", {
      name: "Invalid election",
      month: 13,
      year: 2026,
    })).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("edits DRAFT election details", async () => {
    const service = new ElectionService(new FakeElectionRepository(), roleVerifier("HR"));
    await expect(service.update("opaque-session-token", electionId, {
      name: "Updated Election",
      month: 10,
      year: 2026,
    })).resolves.toMatchObject({ name: "Updated Election", month: 10, status: "DRAFT" });
  });

  it("preserves database duplicate month/year protection", async () => {
    const repository = new FakeElectionRepository();
    repository.create = async () => {
      throw new ElectionError("DUPLICATE_MONTH", "Election already exists");
    };
    const service = new ElectionService(repository, roleVerifier("HR"));
    await expect(service.create("opaque-session-token", {
      name: "Duplicate",
      month: 9,
      year: 2026,
    })).rejects.toMatchObject({ code: "DUPLICATE_MONTH" });
  });

  it("preserves database locks for non-DRAFT edits", async () => {
    const repository = new FakeElectionRepository();
    repository.update = async () => {
      throw new ElectionError("LOCKED", "Election is not editable");
    };
    const service = new ElectionService(repository, roleVerifier("HR"));
    await expect(service.update("opaque-session-token", electionId, {
      name: "Locked",
      month: 9,
      year: 2026,
    })).rejects.toMatchObject({ code: "LOCKED" });
  });

  it("cancels through the protected soft-delete operation", async () => {
    const repository = new FakeElectionRepository();
    const service = new ElectionService(repository, roleVerifier("SYSTEM"));
    await service.cancel("opaque-session-token", electionId);
    expect(repository.cancelledId).toBe(electionId);
  });

  it("allows SYSTEM to start, close, reopen, and reset an election", async () => {
    const repository = new FakeElectionRepository();
    const service = new ElectionService(repository, roleVerifier("SYSTEM"));
    await expect(service.systemAction("opaque-session-token", electionId, "start"))
      .resolves.toMatchObject({ status: "OPEN" });
    await expect(service.systemAction("opaque-session-token", electionId, "close"))
      .resolves.toMatchObject({ status: "CLOSED" });
    await expect(service.systemAction("opaque-session-token", electionId, "reopen"))
      .resolves.toMatchObject({ status: "OPEN" });
    await expect(service.systemAction("opaque-session-token", electionId, "reset"))
      .resolves.toMatchObject({ status: "DRAFT" });
    expect(repository.actions).toEqual(["start", "close", "reopen", "reset"]);
  });

  it("opens a valid DRAFT election and sets opened_at", async () => {
    const service = new ElectionService(new FakeElectionRepository(), roleVerifier("SYSTEM"));
    const election = await service.systemAction("opaque-session-token", electionId, "start");
    expect(election.status).toBe("OPEN");
    expect(election.openedAt).toBeTruthy();
  });

  it("rejects starting an OPEN election again with its exact state error", async () => {
    const service = new ElectionService(new FakeElectionRepository(), roleVerifier("SYSTEM"));
    await service.systemAction("opaque-session-token", electionId, "start");
    await expect(service.systemAction("opaque-session-token", electionId, "start"))
      .rejects.toMatchObject({ code: "LOCKED", message: "Election is not in DRAFT status" });
  });

  it("rejects malformed start route ids before calling the service", async () => {
    const service = new ElectionService(new FakeElectionRepository(), roleVerifier("SYSTEM"));
    const response = await handleElectionSystemAction(
      new NextRequest("https://portal.example/api/elections/not-a-uuid/start", {
        method: "POST",
        headers: { origin: "https://portal.example", host: "portal.example" },
      }),
      "not-a-uuid",
      "start",
      service,
    );
    await expect(response.json()).resolves.toEqual({ error: "Invalid election details" });
    expect(response.status).toBe(400);
  });

  it("maps only explicit readiness, state, and not-found database errors", () => {
    expect(mapElectionDatabaseError("23514", "At least one active FOH candidate is required"))
      .toMatchObject({ code: "VALIDATION", message: "At least one active FOH candidate is required" });
    expect(mapElectionDatabaseError("55000", "Election is not in DRAFT status"))
      .toMatchObject({ code: "LOCKED", message: "Election is not in DRAFT status" });
    expect(mapElectionDatabaseError("P0002", "anything"))
      .toMatchObject({ code: "NOT_FOUND", message: "Election not found" });
    expect(mapElectionDatabaseError("23514", "Sensitive database detail"))
      .toMatchObject({ code: "VALIDATION", message: "Invalid election details" });
  });

  it("blocks HR from every SYSTEM election action", async () => {
    const service = new ElectionService(new FakeElectionRepository(), roleVerifier("HR"));
    for (const action of ["start", "close", "reopen", "reset"] as const) {
      await expect(service.systemAction("opaque-session-token", electionId, action))
        .rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });

  it("blocks unauthenticated SYSTEM election actions", async () => {
    const service = new ElectionService(new FakeElectionRepository(), roleVerifier(null));
    await expect(service.systemAction(undefined, electionId, "start"))
      .rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("preserves database source-state transition failures", async () => {
    const repository = new FakeElectionRepository();
    repository.systemAction = async () => {
      throw new ElectionError("LOCKED", "Election is not in the required source state");
    };
    const service = new ElectionService(repository, roleVerifier("SYSTEM"));
    await expect(service.systemAction("opaque-session-token", electionId, "close"))
      .rejects.toMatchObject({ code: "LOCKED" });
  });
});
