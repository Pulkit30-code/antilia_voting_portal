"use client";

import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  CircleDashed,
  Clock3,
  Crown,
  RefreshCw,
  Trophy,
  UserCheck,
  UsersRound,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/surfaces";
import { ResultsExportActions } from "@/components/results-export-actions";
import { TieBreakPanel } from "@/components/tie-break-panel";

type ElectionStatus = "DRAFT" | "OPEN" | "CLOSED";

type Election = {
  id: string;
  name: string;
  month: number;
  year: number;
  status: ElectionStatus;
  openedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type ReportCategory = "FOH" | "BOH";

type CandidateResult = {
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

type CategoryResult = {
  candidates: CandidateResult[];
  tieDetected: boolean;
  provisionalWinnerCandidateId: string | null;
  finalWinnerCandidateId: string | null;
  winnerCandidateId: string | null;
};

type ElectionResults = Record<ReportCategory, CategoryResult>;

type Turnout = {
  electionId: string;
  totalEligibleHods: number;
  completedHods: number;
  pendingHods: number;
  turnoutPercentage: number;
};

type HodBallot = {
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

type ReportData = {
  results: ElectionResults;
  turnout: Turnout;
  hods: HodBallot[];
};

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

async function responseError(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => null) as { error?: unknown } | null;
  return typeof body?.error === "string" ? body.error : fallback;
}

function electionLabel(election: Election): string {
  return `${election.name} · ${MONTHS[election.month - 1] ?? "Unknown"} ${election.year}`;
}

function formatPercentage(value: number): string {
  return `${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 }).format(value)}%`;
}

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function StatusBadge({ status }: { status: ElectionStatus }) {
  return (
    <span className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${status === "OPEN" ? "border-[#78977a]/30 bg-[#78977a]/10 text-[#bcd5bd]" : "border-white/10 bg-white/[0.04] text-[#aaa296]"}`}>
      <span aria-hidden="true" className={`size-1.5 rounded-full ${status === "OPEN" ? "bg-[#8fb391]" : "bg-[#80786d]"}`} />
      {status}
    </span>
  );
}

function ResultsLoading() {
  return (
    <div aria-label="Loading election results" aria-busy="true" role="status" className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((item) => <Skeleton key={item} className="h-32" />)}
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        {[0, 1].map((item) => (
          <div key={item} className="rounded-2xl border border-white/[0.08] bg-[#181816] p-5 sm:p-6">
            <Skeleton className="h-7 w-40" />
            <Skeleton className="mt-3 h-4 w-56 max-w-full" />
            <div className="mt-6 space-y-3"><Skeleton className="h-14" /><Skeleton className="h-14" /><Skeleton className="h-14" /></div>
          </div>
        ))}
      </div>
      <Skeleton className="h-80" />
      <span className="sr-only">Loading results…</span>
    </div>
  );
}

function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex min-h-72 flex-col items-center justify-center rounded-2xl border border-[#b85e50]/25 bg-[#181816] px-6 py-12 text-center shadow-[0_24px_70px_rgba(0,0,0,.2)]">
      <span className="flex size-12 items-center justify-center rounded-xl bg-[#b85e50]/10 text-[#db8f80]"><AlertTriangle aria-hidden="true" className="size-5" /></span>
      <h3 className="mt-5 font-serif text-xl text-[#f2ece3]">Results unavailable</h3>
      <p className="mt-2 max-w-md text-sm leading-6 text-[#978f83]">{message}</p>
      <Button variant="secondary" className="mt-6 min-h-11" onClick={onRetry}><RefreshCw aria-hidden="true" className="size-4" /> Try again</Button>
    </div>
  );
}

function NoElections() {
  return (
    <div className="flex min-h-80 flex-col items-center justify-center rounded-2xl border border-dashed border-white/[0.11] bg-[#181816]/70 px-6 py-12 text-center">
      <span className="flex size-12 items-center justify-center rounded-xl border border-[#b99a5f]/20 bg-[#b99a5f]/10 text-[#c7a969]"><BarChart3 aria-hidden="true" className="size-5" /></span>
      <h3 className="mt-5 font-serif text-xl text-[#eee8de]">No results available yet</h3>
      <p className="mt-2 max-w-md text-sm leading-6 text-[#8e867a]">Results appear here after an election is opened. Draft elections are not included.</p>
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  detail,
  accent = false,
}: {
  icon: typeof UsersRound;
  label: string;
  value: string;
  detail: string;
  accent?: boolean;
}) {
  return (
    <div className={`rounded-2xl border p-5 shadow-[0_18px_55px_rgba(0,0,0,.18)] ${accent ? "border-[#b99a5f]/25 bg-[#b99a5f]/[0.07]" : "border-white/[0.08] bg-[#181816]"}`}>
      <div className="flex items-center justify-between gap-3">
        <span className={`flex size-9 items-center justify-center rounded-xl ${accent ? "bg-[#b99a5f]/15 text-[#d5b97b]" : "bg-white/[0.045] text-[#958d80]"}`}><Icon aria-hidden="true" className="size-[17px]" strokeWidth={1.7} /></span>
        <p className="text-[9px] font-bold uppercase tracking-[0.17em] text-[#777064]">{label}</p>
      </div>
      <p className="mt-5 font-serif text-3xl text-[#f1ebe1]">{value}</p>
      <p className="mt-1 text-xs text-[#827b70]">{detail}</p>
    </div>
  );
}

function CategoryResults({ category, result, closed }: { category: ReportCategory; result: CategoryResult; closed: boolean }) {
  const candidates = [...result.candidates].sort((a, b) => a.rank - b.rank || b.voteCount - a.voteCount || a.name.localeCompare(b.name));
  const winner = result.winnerCandidateId
    ? candidates.find((candidate) => candidate.candidateId === result.winnerCandidateId) ?? null
    : null;
  const leaders = candidates.filter((candidate) => candidate.isCurrentLeader);
  const totalVotes = candidates[0]?.categoryVoteCount ?? 0;
  const title = category === "FOH" ? "Front of House" : "Back of House";
  const unresolvedTie = result.tieDetected && !result.finalWinnerCandidateId;

  return (
    <section aria-labelledby={`${category.toLowerCase()}-ranking-heading`} className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#181816] shadow-[0_24px_70px_rgba(0,0,0,.22)]">
      <div className="border-b border-white/[0.07] p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-[#b99a5f]">{category} ranking</p>
            <h3 id={`${category.toLowerCase()}-ranking-heading`} className="mt-2 font-serif text-2xl text-[#f1ebe1]">{title}</h3>
            <p className="mt-1 text-sm text-[#837c71]">{totalVotes} vote{totalVotes === 1 ? "" : "s"} counted</p>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            {result.tieDetected ? (
              <span className="inline-flex items-center gap-2 rounded-full border border-[#c89158]/30 bg-[#c89158]/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.13em] text-[#e3b77e]"><CircleDashed aria-hidden="true" className="size-3.5" /> {unresolvedTie ? "Tie for first" : "Tie resolved"}</span>
            ) : null}
            {!unresolvedTie && winner ? (
              <span className="inline-flex items-center gap-2 rounded-full border border-[#78977a]/30 bg-[#78977a]/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.13em] text-[#bcd5bd]"><Trophy aria-hidden="true" className="size-3.5" /> {closed ? "Winner" : "Current leader"}</span>
            ) : null}
          </div>
        </div>

        {unresolvedTie && leaders.length > 0 ? (
          <div className="mt-5 rounded-xl border border-[#c89158]/20 bg-[#c89158]/[0.07] px-4 py-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#c99d6b]">Joint leaders</p>
            <p className="mt-1.5 text-sm font-medium text-[#ead8c1]">{leaders.map((candidate) => candidate.name).join(" · ")}</p>
          </div>
        ) : winner ? (
          <div className="mt-5 flex items-center gap-3 rounded-xl border border-[#b99a5f]/20 bg-[#b99a5f]/[0.07] px-4 py-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[#b99a5f]/15 text-[#d5b97b]"><Crown aria-hidden="true" className="size-4" /></span>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#a88d59]">{closed ? "Winner" : "Current leader"}</p>
              <p className="mt-0.5 truncate text-sm font-semibold text-[#eee6d8]">{winner.name}</p>
            </div>
          </div>
        ) : null}
      </div>

      {candidates.length === 0 ? (
        <div className="flex min-h-56 flex-col items-center justify-center px-6 py-10 text-center">
          <UsersRound aria-hidden="true" className="size-5 text-[#6f685e]" />
          <p className="mt-3 text-sm font-medium text-[#aaa296]">No {category} candidates</p>
          <p className="mt-1 text-xs text-[#746d63]">There are no candidates to rank in this category.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-left">
            <thead className="bg-white/[0.018] text-[9px] font-bold uppercase tracking-[0.15em] text-[#777064]">
              <tr><th className="w-16 px-5 py-3.5 sm:px-6">Rank</th><th className="px-3 py-3.5">Candidate</th><th className="px-3 py-3.5 text-right">Votes</th><th className="px-5 py-3.5 text-right sm:px-6">Share</th></tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
              {candidates.map((candidate) => {
                const highlighted = unresolvedTie ? candidate.isTiedForFirst : candidate.candidateId === result.winnerCandidateId;
                return (
                  <tr key={candidate.candidateId} className={highlighted ? "bg-[#b99a5f]/[0.035]" : ""}>
                    <td className="px-5 py-4 sm:px-6"><span className={`inline-flex size-7 items-center justify-center rounded-lg text-xs font-bold ${candidate.rank === 1 ? "bg-[#b99a5f]/15 text-[#d5b97b]" : "bg-white/[0.04] text-[#91897d]"}`}>{candidate.rank}</span></td>
                    <td className="px-3 py-4"><p className="font-medium text-[#e9e2d7]">{candidate.name}</p><p className="mt-0.5 text-xs text-[#7f786d]">{candidate.department}{candidate.isActive ? "" : " · Inactive"}</p></td>
                    <td className="px-3 py-4 text-right text-sm font-semibold tabular-nums text-[#d4cdbf]">{candidate.voteCount}</td>
                    <td className="px-5 py-4 text-right sm:px-6"><span className="font-serif text-lg tabular-nums text-[#eee6d8]">{formatPercentage(candidate.votePercentage)}</span><div className="ml-auto mt-1.5 h-1.5 w-20 overflow-hidden rounded-full bg-white/[0.06]"><div className="h-full rounded-full bg-[#b99a5f]" style={{ width: `${Math.min(100, Math.max(0, candidate.votePercentage))}%` }} /></div></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function BallotTable({ hods }: { hods: HodBallot[] }) {
  const completed = hods.filter((hod) => hod.hasVoted);
  const pending = hods.filter((hod) => !hod.hasVoted);

  return (
    <section aria-labelledby="individual-votes-heading" className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#181816] shadow-[0_24px_70px_rgba(0,0,0,.22)]">
      <div className="flex flex-col gap-3 border-b border-white/[0.07] p-5 sm:flex-row sm:items-end sm:justify-between sm:p-6">
        <div>
          <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-[#b99a5f]">Ballot detail</p>
          <h3 id="individual-votes-heading" className="mt-2 font-serif text-2xl text-[#f1ebe1]">Individual HOD choices</h3>
          <p className="mt-1 text-sm text-[#837c71]">FOH and BOH selections for every eligible HOD.</p>
        </div>
        <div className="flex gap-2 text-[10px] font-bold uppercase tracking-[0.12em]"><span className="rounded-full border border-[#78977a]/25 bg-[#78977a]/10 px-2.5 py-1 text-[#bcd5bd]">{completed.length} completed</span><span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[#aaa296]">{pending.length} pending</span></div>
      </div>

      {hods.length === 0 ? (
        <div className="flex min-h-56 flex-col items-center justify-center px-6 py-10 text-center"><UserCheck aria-hidden="true" className="size-5 text-[#6f685e]" /><p className="mt-3 text-sm font-medium text-[#aaa296]">No eligible HOD ballots</p><p className="mt-1 text-xs text-[#746d63]">The election snapshot does not contain any eligible HODs.</p></div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left">
            <thead className="bg-white/[0.018] text-[9px] font-bold uppercase tracking-[0.15em] text-[#777064]"><tr><th className="px-5 py-3.5 sm:px-6">HOD</th><th className="px-3 py-3.5">Status</th><th className="px-3 py-3.5">FOH choice</th><th className="px-3 py-3.5">BOH choice</th><th className="px-5 py-3.5 text-right sm:px-6">Submitted</th></tr></thead>
            <tbody className="divide-y divide-white/[0.06]">
              {hods.map((hod) => (
                <tr key={hod.hodId} className={hod.hasVoted ? "" : "bg-white/[0.012]"}>
                  <td className="px-5 py-4 sm:px-6"><p className="font-medium text-[#e9e2d7]">{hod.hodName}</p><p className="mt-0.5 text-xs text-[#7f786d]">{hod.department}</p></td>
                  <td className="px-3 py-4"><span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] ${hod.hasVoted ? "border-[#78977a]/25 bg-[#78977a]/10 text-[#bcd5bd]" : "border-white/10 bg-white/[0.04] text-[#aaa296]"}`}>{hod.hasVoted ? <CheckCircle2 aria-hidden="true" className="size-3" /> : <Clock3 aria-hidden="true" className="size-3" />}{hod.hasVoted ? "Completed" : "Pending"}</span></td>
                  <td className={`px-3 py-4 text-sm ${hod.fohCandidateName ? "font-medium text-[#dcd5c9]" : "text-[#70695f]"}`}>{hod.fohCandidateName ?? "Awaiting vote"}</td>
                  <td className={`px-3 py-4 text-sm ${hod.bohCandidateName ? "font-medium text-[#dcd5c9]" : "text-[#70695f]"}`}>{hod.bohCandidateName ?? "Awaiting vote"}</td>
                  <td className="px-5 py-4 text-right text-xs text-[#827b70] sm:px-6">{formatDateTime(hod.submittedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function ResultsDashboard() {
  const router = useRouter();
  const [elections, setElections] = useState<Election[]>([]);
  const [selectedElectionId, setSelectedElectionId] = useState("");
  const [electionsLoading, setElectionsLoading] = useState(true);
  const [electionsError, setElectionsError] = useState("");
  const [report, setReport] = useState<ReportData | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState("");
  const [electionsReloadKey, setElectionsReloadKey] = useState(0);
  const [reportReloadKey, setReportReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/elections", { cache: "no-store", credentials: "same-origin" })
      .then(async (response) => {
        if (response.status === 401) {
          router.replace("/hr/login");
          return null;
        }
        if (!response.ok) throw new Error(await responseError(response, "Unable to load elections."));
        const body = await response.json() as { elections?: Election[] };
        if (!Array.isArray(body.elections)) throw new Error("The election list could not be read.");
        return body.elections.filter((election) => election.status === "OPEN" || election.status === "CLOSED");
      })
      .then((available) => {
        if (cancelled || !available) return;
        const nextId = available.find((election) => election.status === "OPEN")?.id ?? available[0]?.id ?? "";
        setElections(available);
        setSelectedElectionId(nextId);
        if (nextId) setReportLoading(true);
      })
      .catch((error: unknown) => {
        if (!cancelled) setElectionsError(error instanceof Error ? error.message : "Unable to load elections.");
      })
      .finally(() => {
        if (!cancelled) setElectionsLoading(false);
      });
    return () => { cancelled = true; };
  }, [electionsReloadKey, router]);

  useEffect(() => {
    if (!selectedElectionId) return;
    let cancelled = false;
    void Promise.all([
      fetch(`/api/elections/${selectedElectionId}/results`, { cache: "no-store", credentials: "same-origin" }),
      fetch(`/api/elections/${selectedElectionId}/turnout`, { cache: "no-store", credentials: "same-origin" }),
      fetch(`/api/elections/${selectedElectionId}/ballots`, { cache: "no-store", credentials: "same-origin" }),
    ]).then(async ([resultsResponse, turnoutResponse, ballotsResponse]) => {
      if ([resultsResponse, turnoutResponse, ballotsResponse].some((response) => response.status === 401)) {
        router.replace("/hr/login");
        return null;
      }
      if (!resultsResponse.ok) throw new Error(await responseError(resultsResponse, "Unable to load rankings."));
      if (!turnoutResponse.ok) throw new Error(await responseError(turnoutResponse, "Unable to load turnout."));
      if (!ballotsResponse.ok) throw new Error(await responseError(ballotsResponse, "Unable to load individual ballots."));
      const [resultsBody, turnoutBody, ballotsBody] = await Promise.all([
        resultsResponse.json() as Promise<{ results?: ElectionResults }>,
        turnoutResponse.json() as Promise<{ turnout?: Turnout }>,
        ballotsResponse.json() as Promise<{ hods?: HodBallot[] }>,
      ]);
      if (!resultsBody.results || !turnoutBody.turnout || !Array.isArray(ballotsBody.hods)) {
        throw new Error("The results response could not be read.");
      }
      return { results: resultsBody.results, turnout: turnoutBody.turnout, hods: ballotsBody.hods };
    }).then((data) => {
      if (!cancelled && data) setReport(data);
    }).catch((error: unknown) => {
      if (!cancelled) {
        setReport(null);
        setReportError(error instanceof Error ? error.message : "Unable to load election results.");
      }
    }).finally(() => {
      if (!cancelled) setReportLoading(false);
    });
    return () => { cancelled = true; };
  }, [reportReloadKey, router, selectedElectionId]);

  const selectedElection = useMemo(
    () => elections.find((election) => election.id === selectedElectionId) ?? null,
    [elections, selectedElectionId],
  );
  const pendingHods = report?.hods.filter((hod) => !hod.hasVoted) ?? [];

  const retryElections = () => {
    setElectionsError("");
    setElectionsLoading(true);
    setElectionsReloadKey((value) => value + 1);
  };

  const retryReport = () => {
    setReportError("");
    setReport(null);
    setReportLoading(true);
    setReportReloadKey((value) => value + 1);
  };

  const selectElection = (id: string) => {
    setReportError("");
    setReport(null);
    setReportLoading(true);
    setSelectedElectionId(id);
  };

  return (
    <div className="animate-[fadeIn_.35s_ease-out] space-y-5 sm:space-y-6">
      <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#b99a5f]">Live reporting</p>
          <h2 className="mt-2 font-serif text-3xl leading-tight text-[#f6f0e7] sm:text-4xl">Election results</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[#938b7f]">Review candidate rankings, turnout and individual HOD ballot choices.</p>
        </div>

        {!electionsLoading && !electionsError && elections.length > 0 ? (
          <div className="w-full xl:w-[430px]">
            <label htmlFor="results-election" className="mb-2 block text-[10px] font-bold uppercase tracking-[0.15em] text-[#837c71]">Election</label>
            <div className="flex gap-2">
              <select id="results-election" value={selectedElectionId} onChange={(event) => selectElection(event.target.value)} className="min-h-11 min-w-0 flex-1 rounded-xl border border-white/10 bg-[#1b1b18] px-4 py-2.5 text-sm text-[#f2ece2] outline-none transition focus:border-[#b99a5f]/70 focus:ring-4 focus:ring-[#b99a5f]/10">
                {elections.map((election) => <option key={election.id} value={election.id}>{electionLabel(election)}</option>)}
              </select>
              <Button aria-label="Refresh results" title="Refresh results" variant="secondary" className="min-h-11 px-3.5 py-2.5" onClick={retryReport} disabled={reportLoading}><RefreshCw aria-hidden="true" className={`size-4 ${reportLoading ? "animate-spin" : ""}`} /></Button>
            </div>
          </div>
        ) : null}
      </div>

      {electionsLoading ? <ResultsLoading /> : electionsError ? <LoadError message={electionsError} onRetry={retryElections} /> : elections.length === 0 ? <NoElections /> : reportLoading ? <ResultsLoading /> : reportError ? <LoadError message={reportError} onRetry={retryReport} /> : report && selectedElection ? (
        <>
          <section aria-label="Selected election summary" className="flex flex-col gap-4 rounded-2xl border border-white/[0.08] bg-[#181816] p-5 shadow-[0_20px_60px_rgba(0,0,0,.2)] sm:flex-row sm:items-center sm:justify-between sm:p-6">
            <div><div className="flex flex-wrap items-center gap-3"><h3 className="font-serif text-xl text-[#eee8de] sm:text-2xl">{selectedElection.name}</h3><StatusBadge status={selectedElection.status} /></div><p className="mt-1.5 text-sm text-[#837c71]">{MONTHS[selectedElection.month - 1]} {selectedElection.year} · {selectedElection.status === "OPEN" ? "Results update as ballots are submitted" : `Closed ${formatDateTime(selectedElection.closedAt)}`}</p></div>
            <div className="flex flex-col items-start gap-2 sm:items-end">
              <ResultsExportActions electionId={selectedElection.id} />
              <p className="text-xs text-[#777064]">Private HR / SYSTEM view</p>
            </div>
          </section>

          <section aria-label="Election turnout" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard icon={UsersRound} label="Eligible HODs" value={String(report.turnout.totalEligibleHods)} detail="Election snapshot" />
            <MetricCard icon={UserCheck} label="Completed ballots" value={String(report.turnout.completedHods)} detail="FOH and BOH submitted" />
            <MetricCard icon={Clock3} label="Pending HODs" value={String(report.turnout.pendingHods)} detail={pendingHods.length > 0 ? "Awaiting ballot submission" : "All eligible HODs completed"} />
            <MetricCard icon={BarChart3} label="Turnout" value={formatPercentage(report.turnout.turnoutPercentage)} detail={`${report.turnout.completedHods} of ${report.turnout.totalEligibleHods} ballots`} accent />
          </section>

          {pendingHods.length > 0 ? (
            <section aria-labelledby="pending-hods-heading" className="rounded-2xl border border-white/[0.08] bg-[#181816] p-5 sm:p-6">
              <div className="flex items-start gap-3"><span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-white/[0.045] text-[#9b9387]"><Clock3 aria-hidden="true" className="size-4" /></span><div><h3 id="pending-hods-heading" className="text-sm font-semibold text-[#e7e0d5]">Pending HODs</h3><p className="mt-1 text-xs text-[#817a6f]">{pendingHods.length} eligible HOD{pendingHods.length === 1 ? " has" : "s have"} not submitted a ballot.</p><div className="mt-3 flex flex-wrap gap-2">{pendingHods.map((hod) => <span key={hod.hodId} className="rounded-lg border border-white/[0.08] bg-white/[0.025] px-3 py-1.5 text-xs text-[#bdb5a9]">{hod.hodName}<span className="ml-1.5 text-[#716a60]">· {hod.department}</span></span>)}</div></div></div>
            </section>
          ) : null}

          <div className="grid gap-5 xl:grid-cols-2">
            <CategoryResults category="FOH" result={report.results.FOH} closed={selectedElection.status === "CLOSED"} />
            <CategoryResults category="BOH" result={report.results.BOH} closed={selectedElection.status === "CLOSED"} />
          </div>

          <TieBreakPanel
            electionId={selectedElection.id}
            electionName={selectedElection.name}
            electionStatus={selectedElection.status}
            role="HR"
          />

          <BallotTable hods={report.hods} />
        </>
      ) : null}
    </div>
  );
}
