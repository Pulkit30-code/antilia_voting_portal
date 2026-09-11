import { describe, expect, it } from "vitest";

import { AuthenticationError } from "@/lib/auth/errors";
import {
  HodError,
  HodService,
  normalizeMobileNumber,
  type Hod,
  type HodRepository,
} from "@/lib/hods/service";

const baseHod: Hod = {
  id: "10000000-0000-4000-8000-000000000001",
  name: "Test HOD",
  mobileNumber: "919876543210",
  department: "Test Department",
  isActive: true,
  createdAt: "2026-09-10T10:00:00.000Z",
  updatedAt: "2026-09-10T10:00:00.000Z",
};

class FakeHodRepository implements HodRepository {
  records = [baseHod];
  lastInput: Record<string, unknown> | null = null;
  removedId: string | null = null;

  async list() {
    return this.records;
  }

  async create(_tokenHash: Uint8Array, input: Parameters<HodRepository["create"]>[1]) {
    this.lastInput = input;
    return { ...baseHod, ...input };
  }

  async update(
    _tokenHash: Uint8Array,
    id: string,
    input: Parameters<HodRepository["update"]>[2],
  ) {
    this.lastInput = input;
    return { ...baseHod, ...input, id };
  }

  async setActive(_tokenHash: Uint8Array, id: string, isActive: boolean) {
    this.lastInput = { isActive };
    return { ...baseHod, id, isActive };
  }

  async remove(_tokenHash: Uint8Array, id: string) {
    this.removedId = id;
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

describe("HOD management service", () => {
  it("allows HR to list HODs", async () => {
    const service = new HodService(new FakeHodRepository(), roleVerifier("HR"));
    await expect(service.list("opaque-session-token")).resolves.toEqual([baseHod]);
  });

  it("allows SYSTEM to inherit HR HOD permissions", async () => {
    const service = new HodService(new FakeHodRepository(), roleVerifier("SYSTEM"));
    await expect(service.list("opaque-session-token")).resolves.toEqual([baseHod]);
  });

  it("rejects unauthenticated HOD access", async () => {
    const service = new HodService(new FakeHodRepository(), roleVerifier(null));
    await expect(service.list(undefined)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("normalizes a mobile number before creating the HOD", async () => {
    const repository = new FakeHodRepository();
    const service = new HodService(repository, roleVerifier("HR"));
    await service.create("opaque-session-token", {
      name: "  Test HOD  ",
      mobileNumber: " 00 91-98765 43210 ",
      department: " Operations ",
    });
    expect(repository.lastInput).toEqual({
      name: "Test HOD",
      mobileNumber: "919876543210",
      department: "Operations",
      isActive: true,
    });
  });

  it("normalizes equivalent mobile formats to the same database key", () => {
    expect(normalizeMobileNumber("+91 98765-43210")).toBe("919876543210");
    expect(normalizeMobileNumber("0091 98765 43210")).toBe("919876543210");
  });

  it("edits only the master HOD profile fields", async () => {
    const repository = new FakeHodRepository();
    const service = new HodService(repository, roleVerifier("HR"));
    const result = await service.update("opaque-session-token", baseHod.id, {
      name: "Updated HOD",
      mobileNumber: "+91 90000 00000",
      department: "Updated Department",
    });
    expect(result).toMatchObject({
      name: "Updated HOD",
      mobileNumber: "919000000000",
      department: "Updated Department",
      isActive: true,
    });
  });

  it("activates and deactivates a HOD", async () => {
    const repository = new FakeHodRepository();
    const service = new HodService(repository, roleVerifier("HR"));
    await expect(service.setActive("opaque-session-token", baseHod.id, false))
      .resolves.toMatchObject({ isActive: false });
    await expect(service.setActive("opaque-session-token", baseHod.id, true))
      .resolves.toMatchObject({ isActive: true });
  });

  it("removes an unreferenced HOD through the protected repository operation", async () => {
    const repository = new FakeHodRepository();
    const service = new HodService(repository, roleVerifier("SYSTEM"));
    await service.remove("opaque-session-token", baseHod.id);
    expect(repository.removedId).toBe(baseHod.id);
  });

  it("preserves a safe database conflict instead of masking election-history protection", async () => {
    const repository = new FakeHodRepository();
    repository.remove = async () => {
      throw new HodError("LOCKED", "HOD with election history cannot be removed");
    };
    const service = new HodService(repository, roleVerifier("HR"));
    await expect(service.remove("opaque-session-token", baseHod.id))
      .rejects.toMatchObject({ code: "LOCKED" });
  });
});
