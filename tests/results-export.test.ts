import ExcelJS from "exceljs";
import { NextRequest } from "next/server";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { ADMIN_SESSION_COOKIE } from "@/lib/auth/constants";
import { ElectionError, type Election } from "@/lib/elections/service";
import { handleElectionExport } from "@/lib/reporting/export-http";
import { type ElectionResults, type HodBallot, type Turnout } from "@/lib/reporting/service";

const electionId = "40000000-0000-4000-8000-000000000001";
const election: Election = {
  id: electionId,
  name: "September HOD Election",
  month: 9,
  year: 2026,
  status: "CLOSED",
  openedAt: "2026-09-10T09:00:00.000Z",
  closedAt: "2026-09-10T11:00:00.000Z",
  createdAt: "2026-09-01T09:00:00.000Z",
  updatedAt: "2026-09-10T11:00:00.000Z",
};

const results: ElectionResults = {
  FOH: {
    candidates: [{ candidateId: "foh-1", name: "FOH Winner", department: "Front Office", category: "FOH", isActive: true, voteCount: 7, categoryVoteCount: 10, votePercentage: 70, rank: 1, isTiedForFirst: false, isCurrentLeader: true }],
    tieDetected: false,
    provisionalWinnerCandidateId: "foh-1",
    finalWinnerCandidateId: null,
    winnerCandidateId: "foh-1",
  },
  BOH: {
    candidates: [{ candidateId: "boh-1", name: "BOH Winner", department: "Kitchen", category: "BOH", isActive: true, voteCount: 6, categoryVoteCount: 10, votePercentage: 60, rank: 1, isTiedForFirst: false, isCurrentLeader: true }],
    tieDetected: false,
    provisionalWinnerCandidateId: "boh-1",
    finalWinnerCandidateId: null,
    winnerCandidateId: "boh-1",
  },
};

const turnout: Turnout = {
  electionId,
  totalEligibleHods: 12,
  completedHods: 10,
  pendingHods: 2,
  turnoutPercentage: 83.3,
};

const ballots: HodBallot[] = [{
  electionId,
  hodId: "hod-1",
  hodName: "Finance HOD",
  department: "Finance",
  hasVoted: true,
  fohCandidateId: "foh-1",
  fohCandidateName: "FOH Winner",
  bohCandidateId: "boh-1",
  bohCandidateName: "BOH Winner",
  submittedAt: "2026-09-10T10:00:00.000Z",
}];

function request(token?: string) {
  const headers = token ? { cookie: `${ADMIN_SESSION_COOKIE}=${token}` } : undefined;
  return new NextRequest(`https://portal.example/api/elections/${electionId}/export/csv`, { headers });
}

function services(allowedToken: string) {
  let privateReads = 0;
  const authorize = (token: string | undefined) => {
    if (token !== allowedToken) throw new ElectionError("UNAUTHENTICATED", "Authentication required");
    privateReads += 1;
  };
  return {
    elections: {
      async get(token: string | undefined) { authorize(token); return election; },
    },
    reporting: {
      async results(token: string | undefined) { authorize(token); return results; },
      async turnout(token: string | undefined) { authorize(token); return turnout; },
      async hodBallots(token: string | undefined) { authorize(token); return ballots; },
    },
    privateReads: () => privateReads,
  };
}

describe("results exports", () => {
  it.each([
    ["HR", "hr-token", "csv", "text/csv"],
    ["SYSTEM", "system-token", "xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    ["SYSTEM", "system-token", "pdf", "application/pdf"],
  ] as const)("allows %s to download %s", async (_role, token, format, contentType) => {
    const fake = services(token);
    const response = await handleElectionExport(request(token), electionId, format, fake.elections, fake.reporting);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain(contentType);
    expect(response.headers.get("content-disposition")).toBe(`attachment; filename="Antilia_Voting_September_2026.${format}"`);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(fake.privateReads()).toBe(4);

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (format === "csv") {
      const csv = new TextDecoder().decode(bytes);
      expect(csv).toContain("Election summary");
      expect(csv).toContain("Candidate results");
      expect(csv).toContain("HOD participation");
      expect(csv).toContain("FOH Winner");
      expect(csv).toContain("BOH Winner");
      expect(csv).toContain("2026-09-10T09:00:00.000Z");
      expect(csv).toContain("Finance HOD");
    } else if (format === "xlsx") {
      expect(new TextDecoder().decode(bytes.slice(0, 2))).toBe("PK");
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(bytes as unknown as Parameters<typeof workbook.xlsx.load>[0]);
      expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["Summary", "Candidate Results", "HOD Participation"]);
      expect(workbook.getWorksheet("Summary")?.getCell("B6").value).toBe("September HOD Election");
      expect(workbook.getWorksheet("Candidate Results")?.getCell("C6").value).toBe("FOH Winner");
      expect(workbook.getWorksheet("HOD Participation")?.getCell("D6").value).toBe("FOH Winner");
    } else {
      expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
      const document = await PDFDocument.load(bytes);
      expect(document.getPageCount()).toBeGreaterThanOrEqual(1);
      expect(document.getTitle()).toContain("September HOD Election");
    }
  });

  it("blocks public downloads before private data is returned", async () => {
    const fake = services("private-token");
    const response = await handleElectionExport(request(), electionId, "csv", fake.elections, fake.reporting);
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(fake.privateReads()).toBe(0);
  });

  it("rejects unsupported formats", async () => {
    const fake = services("hr-token");
    const response = await handleElectionExport(request("hr-token"), electionId, "json", fake.elections, fake.reporting);
    expect(response.status).toBe(400);
    expect(fake.privateReads()).toBe(0);
  });
});
