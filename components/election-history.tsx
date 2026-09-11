"use client";

import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Crown,
  History,
  Medal,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  UserCheck,
  UserRoundX,
  UsersRound,
  Vote,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { Button } from "@/components/ui/button";
import { ResultsExportActions } from "@/components/results-export-actions";
import { Skeleton } from "@/components/ui/surfaces";

type ElectionStatus = "DRAFT" | "OPEN" | "CLOSED";
type Category = "FOH" | "BOH";

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

type CandidateResult = {
  candidateId: string;
  name: string;
  department: string;
  category: Category;
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

type ElectionResults = Record<Category, CategoryResult>;

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

type TieBreakStatus = "DRAFT" | "OPEN" | "CLOSED";
type TieBreak = {
  id: string;
  originalElectionId: string;
  category: Category;
  roundNumber: number;
  status: TieBreakStatus;
  openedAt: string | null;
  closedAt: string | null;
  candidateCount?: number;
  voteCount?: number;
  tieDetected?: boolean;
  winnerCandidateId?: string | null;
};

type TieBreakResult = {
  candidateId: string;
  name: string;
  voteCount: number;
  rank: number;
  isLeader: boolean;
};

type TieBreakDetail = TieBreak & {
  results: TieBreakResult[];
  tieDetected: boolean;
  winnerCandidateId: string | null;
};

type ElectionSummary = {
  results: ElectionResults;
  turnout: Turnout;
};

type ElectionDetail = ElectionSummary & {
  ballots: HodBallot[];
  tieBreaks: TieBreakDetail[];
};

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

async function responseError(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => null) as { error?: unknown } | null;
  return typeof body?.error === "string" ? body.error : fallback;
}

async function readJson<T>(url: string, fallback: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store", credentials: "same-origin" });
  if (response.status === 401) throw new Error("SESSION_EXPIRED");
  if (!response.ok) throw new Error(await responseError(response, fallback));
  return response.json() as Promise<T>;
}

function monthName(month: number): string {
  return MONTHS[month - 1] ?? "Unknown";
}

function formatDate(value: string | null): string {
  if (!value) return "Not recorded";
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatPercent(value: number): string {
  return `${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 }).format(value)}%`;
}

function winnerFor(category: CategoryResult): CandidateResult | null {
  return category.candidates.find((candidate) => candidate.candidateId === category.winnerCandidateId) ?? null;
}

function Winner({ category, compact = false }: { category: CategoryResult; compact?: boolean }) {
  const winner = winnerFor(category);
  if (winner) {
    return (
      <div className="min-w-0">
        <p className={`${compact ? "text-xs" : "text-sm"} truncate font-semibold text-[#eee7dc]`}>{winner.name}</p>
        <p className="mt-0.5 truncate text-[10px] text-[#81796e]">{winner.department}</p>
      </div>
    );
  }
  return (
    <span className={`inline-flex items-center gap-1.5 ${compact ? "text-xs" : "text-sm"} text-[#bca77d]`}>
      <AlertTriangle aria-hidden="true" className="size-3.5 shrink-0" />
      {category.tieDetected ? "Tie unresolved" : "No winner"}
    </span>
  );
}

function StatusBadge({ status }: { status: ElectionStatus | TieBreakStatus }) {
  const closed = status === "CLOSED";
  const open = status === "OPEN";
  return (
    <span className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${closed ? "border-white/10 bg-white/[0.04] text-[#aaa296]" : open ? "border-[#78977a]/30 bg-[#78977a]/10 text-[#bcd5bd]" : "border-[#7f98ba]/30 bg-[#7f98ba]/10 text-[#b7c9e1]"}`}>
      <span aria-hidden="true" className={`size-1.5 rounded-full ${closed ? "bg-[#80786d]" : open ? "bg-[#8fb391]" : "bg-[#8da7ca]"}`} />
      {status}
    </span>
  );
}

function LoadingState() {
  return (
    <div aria-label="Loading election history" aria-busy="true" className="divide-y divide-white/[0.06]">
      {[0, 1, 2, 3].map((row) => (
        <div key={row} className="grid gap-4 p-5 xl:grid-cols-[1.15fr_.65fr_1fr_1fr_.6fr_1fr_1fr_40px] xl:items-center">
          <Skeleton className="h-5 w-44" />
          <Skeleton className="h-7 w-20" />
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-9 w-9" />
        </div>
      ))}
    </div>
  );
}

function Metric({ icon, label, value, note }: { icon: ReactNode; label: string; value: string; note: string }) {
  return (
    <div className="rounded-2xl border border-white/[0.08] bg-[#181816]/92 p-5 shadow-[0_20px_60px_rgba(0,0,0,.22)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[9px] font-bold uppercase tracking-[0.17em] text-[#766f65]">{label}</p>
          <p className="mt-2 font-serif text-3xl text-[#f0eade]">{value}</p>
          <p className="mt-1 text-xs text-[#81796e]">{note}</p>
        </div>
        <span className="flex size-10 items-center justify-center rounded-xl border border-[#b99a5f]/18 bg-[#b99a5f]/8 text-[#c2a363]">{icon}</span>
      </div>
    </div>
  );
}

function CandidateResults({ category, results }: { category: Category; results: CategoryResult }) {
  const winner = winnerFor(results);
  return (
    <section className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#151513]">
      <div className="flex items-center justify-between gap-3 border-b border-white/[0.07] px-4 py-4 sm:px-5">
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-xl bg-[#b99a5f]/10 text-[#c9aa6a]"><Medal aria-hidden="true" className="size-4" /></span>
          <div><h4 className="text-sm font-semibold text-[#ece5da]">{category} results</h4><p className="mt-0.5 text-[10px] text-[#756e64]">{results.candidates.length} candidates</p></div>
        </div>
        {results.tieDetected ? <span className="rounded-full border border-[#b99a5f]/25 bg-[#b99a5f]/8 px-2.5 py-1 text-[10px] font-semibold text-[#c8b184]">Tie recorded</span> : null}
      </div>
      {results.candidates.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-[#81796e]">No candidate results recorded.</p>
      ) : (
        <div className="divide-y divide-white/[0.06]">
          {results.candidates.map((candidate) => {
            const isWinner = winner?.candidateId === candidate.candidateId;
            return (
              <div key={candidate.candidateId} className={`p-4 sm:px-5 ${isWinner ? "bg-[#b99a5f]/[0.045]" : ""}`}>
                <div className="flex items-center gap-3">
                  <span className={`flex size-8 shrink-0 items-center justify-center rounded-lg text-xs font-semibold tabular-nums ${isWinner ? "bg-[#b99a5f]/15 text-[#d8bd82]" : "bg-white/[0.045] text-[#8e867b]"}`}>{candidate.rank}</span>
                  <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="truncate text-sm font-semibold text-[#e8e1d6]">{candidate.name}</p>{isWinner ? <Crown aria-label="Winner" className="size-3.5 text-[#d2b16e]" /> : null}</div><p className="mt-0.5 truncate text-[10px] text-[#797268]">{candidate.department}</p></div>
                  <div className="text-right"><p className="text-sm font-semibold tabular-nums text-[#e7dfd3]">{candidate.voteCount}</p><p className="mt-0.5 text-[10px] tabular-nums text-[#797268]">{formatPercent(candidate.votePercentage)}</p></div>
                </div>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[0.055]"><div className={`h-full rounded-full ${isWinner ? "bg-[#b99a5f]" : "bg-[#625e57]"}`} style={{ width: `${Math.max(0, Math.min(candidate.votePercentage, 100))}%` }} /></div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function HistoryDetail({ election, detail, loading, error, onClose, onRetry }: {
  election: Election;
  detail: ElectionDetail | null;
  loading: boolean;
  error: string;
  onClose: () => void;
  onRetry: () => void;
}) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", closeOnEscape);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/80 backdrop-blur-sm sm:p-5 lg:p-8" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="history-detail-title" className="flex max-h-[95dvh] w-full max-w-6xl animate-[rise_.22s_ease-out] flex-col overflow-hidden rounded-t-2xl border border-white/10 bg-[#11110f] shadow-2xl sm:max-h-[92dvh] sm:rounded-2xl">
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-white/[0.07] bg-[#171714] px-4 py-4 sm:px-6 sm:py-5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5"><p className="text-[9px] font-bold uppercase tracking-[0.18em] text-[#b99a5f]">Historical election</p><StatusBadge status={election.status} /></div>
            <h2 id="history-detail-title" className="mt-2 truncate font-serif text-2xl text-[#f4ede2] sm:text-3xl">{election.name}</h2>
            <p className="mt-1 text-xs text-[#81796d]">{monthName(election.month)} {election.year} · Closed {formatDate(election.closedAt)}</p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <button type="button" onClick={onClose} aria-label="Close historical election" className="rounded-xl border border-white/[0.08] bg-white/[0.035] p-2.5 text-[#aaa296] transition hover:bg-white/[0.07] hover:text-white"><X aria-hidden="true" className="size-5" /></button>
            {detail ? <ResultsExportActions electionId={election.id} /> : null}
          </div>
        </header>

        <div className="overflow-y-auto overscroll-contain p-4 sm:p-6">
          {loading ? (
            <div aria-busy="true" aria-label="Loading historical election detail" className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[0, 1, 2, 3].map((item) => <Skeleton key={item} className="h-28" />)}</div>
              <div className="grid gap-5 lg:grid-cols-2"><Skeleton className="h-80" /><Skeleton className="h-80" /></div>
              <Skeleton className="h-64" />
            </div>
          ) : error ? (
            <div role="alert" className="flex min-h-80 flex-col items-center justify-center text-center"><span className="flex size-12 items-center justify-center rounded-xl border border-[#b85e50]/25 bg-[#b85e50]/10 text-[#e19a8c]"><AlertTriangle aria-hidden="true" className="size-5" /></span><h3 className="mt-5 font-serif text-xl text-[#eee8de]">Details could not be loaded</h3><p className="mt-2 max-w-md text-sm leading-6 text-[#aa8d86]">{error}</p><Button className="mt-6" variant="secondary" onClick={onRetry}><RefreshCw aria-hidden="true" className="size-4" /> Try again</Button></div>
          ) : detail ? (
            <div className="space-y-6">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Metric icon={<Vote aria-hidden="true" className="size-4" />} label="Turnout" value={formatPercent(detail.turnout.turnoutPercentage)} note={`${detail.turnout.completedHods} of ${detail.turnout.totalEligibleHods} HODs voted`} />
                <Metric icon={<Crown aria-hidden="true" className="size-4" />} label="FOH winner" value={winnerFor(detail.results.FOH)?.name ?? "Not resolved"} note={detail.results.FOH.tieDetected ? "Tie recorded" : "Final result"} />
                <Metric icon={<Crown aria-hidden="true" className="size-4" />} label="BOH winner" value={winnerFor(detail.results.BOH)?.name ?? "Not resolved"} note={detail.results.BOH.tieDetected ? "Tie recorded" : "Final result"} />
                <Metric icon={<Sparkles aria-hidden="true" className="size-4" />} label="Tie-breaks" value={String(detail.tieBreaks.length)} note={detail.tieBreaks.length === 1 ? "Round recorded" : "Rounds recorded"} />
              </div>

              <div className="grid gap-5 lg:grid-cols-2"><CandidateResults category="FOH" results={detail.results.FOH} /><CandidateResults category="BOH" results={detail.results.BOH} /></div>

              <section className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#151513]">
                <div className="flex flex-col gap-3 border-b border-white/[0.07] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                  <div className="flex items-center gap-3"><span className="flex size-9 items-center justify-center rounded-xl bg-[#78977a]/10 text-[#9cbd9e]"><UsersRound aria-hidden="true" className="size-4" /></span><div><h3 className="text-sm font-semibold text-[#ece5da]">HOD participation & vote choices</h3><p className="mt-0.5 text-[10px] text-[#756e64]">{detail.turnout.completedHods} voted · {detail.turnout.pendingHods} did not vote</p></div></div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-white/[0.055] sm:w-40"><div className="h-full rounded-full bg-[#78977a]" style={{ width: `${Math.max(0, Math.min(detail.turnout.turnoutPercentage, 100))}%` }} /></div>
                </div>
                {detail.ballots.length === 0 ? <p className="px-5 py-10 text-center text-sm text-[#81796e]">No HOD participation records found.</p> : (
                  <>
                    <div className="hidden md:block"><table className="w-full text-left"><thead className="border-b border-white/[0.07] bg-white/[0.015] text-[9px] font-bold uppercase tracking-[0.15em] text-[#756e63]"><tr><th className="px-5 py-3.5">HOD</th><th className="px-5 py-3.5">Participation</th><th className="px-5 py-3.5">FOH choice</th><th className="px-5 py-3.5">BOH choice</th><th className="px-5 py-3.5">Submitted</th></tr></thead><tbody className="divide-y divide-white/[0.06]">{detail.ballots.map((ballot) => <tr key={ballot.hodId}><td className="px-5 py-4"><p className="text-sm font-semibold text-[#e7e0d5]">{ballot.hodName}</p><p className="mt-0.5 text-[10px] text-[#787168]">{ballot.department}</p></td><td className="px-5 py-4">{ballot.hasVoted ? <span className="inline-flex items-center gap-1.5 text-xs text-[#a9c6aa]"><UserCheck aria-hidden="true" className="size-3.5" /> Voted</span> : <span className="inline-flex items-center gap-1.5 text-xs text-[#91897d]"><UserRoundX aria-hidden="true" className="size-3.5" /> Did not vote</span>}</td><td className="px-5 py-4 text-xs text-[#b7afa3]">{ballot.fohCandidateName ?? "—"}</td><td className="px-5 py-4 text-xs text-[#b7afa3]">{ballot.bohCandidateName ?? "—"}</td><td className="px-5 py-4 text-xs text-[#8f877b]">{ballot.submittedAt ? formatDate(ballot.submittedAt) : "—"}</td></tr>)}</tbody></table></div>
                    <div className="divide-y divide-white/[0.07] md:hidden">{detail.ballots.map((ballot) => <article key={ballot.hodId} className="p-4"><div className="flex items-start justify-between gap-3"><div><h4 className="text-sm font-semibold text-[#e7e0d5]">{ballot.hodName}</h4><p className="mt-0.5 text-[10px] text-[#787168]">{ballot.department}</p></div>{ballot.hasVoted ? <span className="inline-flex items-center gap-1.5 text-xs text-[#a9c6aa]"><UserCheck aria-hidden="true" className="size-3.5" /> Voted</span> : <span className="inline-flex items-center gap-1.5 text-xs text-[#91897d]"><UserRoundX aria-hidden="true" className="size-3.5" /> Pending</span>}</div><dl className="mt-4 grid grid-cols-2 gap-3 rounded-xl bg-black/15 p-3"><div><dt className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#6f685f]">FOH choice</dt><dd className="mt-1.5 text-xs text-[#b7afa3]">{ballot.fohCandidateName ?? "—"}</dd></div><div><dt className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#6f685f]">BOH choice</dt><dd className="mt-1.5 text-xs text-[#b7afa3]">{ballot.bohCandidateName ?? "—"}</dd></div></dl>{ballot.submittedAt ? <p className="mt-3 text-[10px] text-[#7d756b]">Submitted {formatDate(ballot.submittedAt)}</p> : null}</article>)}</div>
                  </>
                )}
              </section>

              <section className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#151513]">
                <div className="flex items-center gap-3 border-b border-white/[0.07] px-4 py-4 sm:px-5"><span className="flex size-9 items-center justify-center rounded-xl bg-[#b99a5f]/10 text-[#c9aa6a]"><ShieldCheck aria-hidden="true" className="size-4" /></span><div><h3 className="text-sm font-semibold text-[#ece5da]">Tie-break history</h3><p className="mt-0.5 text-[10px] text-[#756e64]">Additional rounds linked to this election</p></div></div>
                {detail.tieBreaks.length === 0 ? <div className="flex items-center gap-3 px-5 py-6 text-sm text-[#8c8478]"><CheckCircle2 aria-hidden="true" className="size-4 text-[#86a388]" /> No tie-break was required.</div> : <div className="divide-y divide-white/[0.06]">{detail.tieBreaks.map((tieBreak) => {
                  const winner = tieBreak.results.find((candidate) => candidate.candidateId === tieBreak.winnerCandidateId);
                  return <article key={tieBreak.id} className="p-4 sm:p-5"><div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-semibold text-[#e7e0d5]">{tieBreak.category} · Round {tieBreak.roundNumber}</p><StatusBadge status={tieBreak.status} /></div><p className="mt-2 text-xs text-[#81796e]">Opened {formatDate(tieBreak.openedAt)} · Closed {formatDate(tieBreak.closedAt)}</p></div><div className="sm:text-right"><p className="text-[9px] font-bold uppercase tracking-[0.14em] text-[#756e64]">Round winner</p><p className="mt-1 text-sm font-semibold text-[#d8c08d]">{winner?.name ?? (tieBreak.tieDetected ? "Tie remained" : "Not resolved")}</p></div></div><div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{tieBreak.results.map((candidate) => <div key={candidate.candidateId} className={`flex items-center justify-between rounded-xl border p-3 ${candidate.candidateId === tieBreak.winnerCandidateId ? "border-[#b99a5f]/25 bg-[#b99a5f]/7" : "border-white/[0.06] bg-black/10"}`}><div className="min-w-0"><p className="truncate text-xs font-medium text-[#cfc7bb]">{candidate.name}</p><p className="mt-0.5 text-[9px] text-[#746d63]">Rank {candidate.rank}</p></div><p className="ml-3 text-sm font-semibold tabular-nums text-[#e2d9cc]">{candidate.voteCount}</p></div>)}</div></article>;
                })}</div>}
              </section>

              <dl className="grid gap-px overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.07] sm:grid-cols-2"><div className="bg-[#151513] p-4"><Clock3 aria-hidden="true" className="size-4 text-[#857c6e]" /><dt className="mt-3 text-[9px] font-bold uppercase tracking-[0.14em] text-[#70695f]">Opened at</dt><dd className="mt-1.5 text-sm text-[#cbc3b7]">{formatDate(election.openedAt)}</dd></div><div className="bg-[#151513] p-4"><ShieldCheck aria-hidden="true" className="size-4 text-[#857c6e]" /><dt className="mt-3 text-[9px] font-bold uppercase tracking-[0.14em] text-[#70695f]">Closed at</dt><dd className="mt-1.5 text-sm text-[#cbc3b7]">{formatDate(election.closedAt)}</dd></div></dl>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

export function ElectionHistory() {
  const router = useRouter();
  const [elections, setElections] = useState<Election[]>([]);
  const [summaries, setSummaries] = useState<Record<string, ElectionSummary>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [yearFilter, setYearFilter] = useState("all");
  const [selected, setSelected] = useState<Election | null>(null);
  const [detail, setDetail] = useState<ElectionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");

  const handleError = useCallback((error: unknown, fallback: string) => {
    const message = error instanceof Error ? error.message : fallback;
    if (message === "SESSION_EXPIRED") {
      router.replace("/hr/login");
      return "";
    }
    return message;
  }, [router]);

  useEffect(() => {
    let cancelled = false;
    void readJson<{ elections?: Election[] }>("/api/elections", "Unable to load election history.")
      .then(async (body) => {
        if (!Array.isArray(body.elections)) throw new Error("The election list could not be read.");
        const closed = body.elections
          .filter((election) => election.status === "CLOSED")
          .sort((a, b) => b.year - a.year || b.month - a.month || b.createdAt.localeCompare(a.createdAt));
        const pairs = await Promise.all(closed.map(async (election) => {
          const [resultsBody, turnoutBody] = await Promise.all([
            readJson<{ results?: ElectionResults }>(`/api/elections/${election.id}/results`, `Unable to load results for ${election.name}.`),
            readJson<{ turnout?: Turnout }>(`/api/elections/${election.id}/turnout`, `Unable to load turnout for ${election.name}.`),
          ]);
          if (!resultsBody.results || !turnoutBody.turnout) throw new Error(`Historical reporting for ${election.name} could not be read.`);
          return [election.id, { results: resultsBody.results, turnout: turnoutBody.turnout }] as const;
        }));
        return { closed, summaries: Object.fromEntries(pairs) as Record<string, ElectionSummary> };
      })
      .then((data) => {
        if (!cancelled) {
          setElections(data.closed);
          setSummaries(data.summaries);
        }
      })
      .catch((error: unknown) => { if (!cancelled) setLoadError(handleError(error, "Unable to load election history.")); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [handleError, reloadKey]);

  const years = useMemo(() => [...new Set(elections.map((election) => election.year))].sort((a, b) => b - a), [elections]);
  const filtered = useMemo(() => {
    const search = deferredQuery.trim().toLocaleLowerCase();
    return elections.filter((election) => {
      const summary = summaries[election.id];
      const winnerNames = summary ? [winnerFor(summary.results.FOH)?.name, winnerFor(summary.results.BOH)?.name] : [];
      const matchesSearch = !search || [election.name, monthName(election.month), String(election.year), ...winnerNames]
        .some((value) => value?.toLocaleLowerCase().includes(search));
      return matchesSearch && (yearFilter === "all" || election.year === Number(yearFilter));
    });
  }, [deferredQuery, elections, summaries, yearFilter]);

  const averageTurnout = elections.length
    ? elections.reduce((total, election) => total + (summaries[election.id]?.turnout.turnoutPercentage ?? 0), 0) / elections.length
    : 0;

  const loadDetail = useCallback(async (election: Election) => {
    setSelected(election);
    setDetail(null);
    setDetailError("");
    setDetailLoading(true);
    try {
      const summary = summaries[election.id] ?? await Promise.all([
        readJson<{ results?: ElectionResults }>(`/api/elections/${election.id}/results`, "Unable to load candidate results."),
        readJson<{ turnout?: Turnout }>(`/api/elections/${election.id}/turnout`, "Unable to load turnout."),
      ]).then(([resultsBody, turnoutBody]) => {
        if (!resultsBody.results || !turnoutBody.turnout) throw new Error("Historical reporting could not be read.");
        return { results: resultsBody.results, turnout: turnoutBody.turnout };
      });
      const [ballotBody, tieBreakBody] = await Promise.all([
        readJson<{ hods?: HodBallot[] }>(`/api/elections/${election.id}/ballots`, "Unable to load HOD participation."),
        readJson<{ tieBreaks?: TieBreak[] }>(`/api/tie-breaks?electionId=${encodeURIComponent(election.id)}`, "Unable to load tie-break history."),
      ]);
      if (!Array.isArray(ballotBody.hods) || !Array.isArray(tieBreakBody.tieBreaks)) throw new Error("Historical detail could not be read.");
      const tieBreaks = await Promise.all(tieBreakBody.tieBreaks.map(async (round) => {
        const body = await readJson<{ tieBreak?: TieBreakDetail }>(`/api/tie-breaks/${round.id}`, "Unable to load tie-break detail.");
        if (!body.tieBreak) throw new Error("Tie-break detail could not be read.");
        return body.tieBreak;
      }));
      setDetail({ ...summary, ballots: ballotBody.hods, tieBreaks });
    } catch (error) {
      setDetailError(handleError(error, "Unable to load historical election detail."));
    } finally {
      setDetailLoading(false);
    }
  }, [handleError, summaries]);

  const closeDetail = useCallback(() => {
    setSelected(null);
    setDetail(null);
    setDetailError("");
  }, []);

  const retryHistory = () => {
    setLoading(true);
    setLoadError("");
    setReloadKey((current) => current + 1);
  };

  return (
    <div className="animate-[fadeIn_.35s_ease-out] space-y-6">
      <section className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[radial-gradient(circle_at_top_right,rgba(185,154,95,.12),transparent_35%),#181816] p-5 shadow-[0_24px_80px_rgba(0,0,0,.25)] sm:p-7">
        <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div><div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.19em] text-[#b99a5f]"><History aria-hidden="true" className="size-4" /> Election archive</div><h2 className="mt-3 max-w-2xl font-serif text-3xl leading-tight text-[#f4eee3] sm:text-4xl">Past elections, fully accounted for.</h2><p className="mt-3 max-w-2xl text-sm leading-6 text-[#948c80]">Review certified outcomes, turnout, HOD participation, individual choices, and any tie-break rounds from one place.</p></div>
          <div className="flex shrink-0 items-center gap-3 rounded-xl border border-[#b99a5f]/18 bg-black/15 px-4 py-3"><ShieldCheck aria-hidden="true" className="size-5 text-[#c2a363]" /><div><p className="text-xs font-semibold text-[#d8d0c4]">Read-only archive</p><p className="mt-0.5 text-[10px] text-[#756e64]">Closed records only</p></div></div>
        </div>
      </section>

      {!loading && !loadError ? <section aria-label="History overview" className="grid gap-3 sm:grid-cols-3"><Metric icon={<CalendarDays aria-hidden="true" className="size-4" />} label="Closed elections" value={String(elections.length)} note="Archived monthly records" /><Metric icon={<BarChart3 aria-hidden="true" className="size-4" />} label="Average turnout" value={formatPercent(averageTurnout)} note="Across closed elections" /><Metric icon={<Vote aria-hidden="true" className="size-4" />} label="Votes recorded" value={String(elections.reduce((total, election) => total + (summaries[election.id]?.turnout.completedHods ?? 0), 0))} note="Completed HOD ballots" /></section> : null}

      <section aria-labelledby="history-list-heading" className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#181816]/92 shadow-[0_24px_80px_rgba(0,0,0,.28)]">
        <div className="flex flex-col gap-4 border-b border-white/[0.07] p-4 sm:p-5 xl:flex-row xl:items-center xl:justify-between"><div><div className="flex items-center gap-2.5"><CalendarDays aria-hidden="true" className="size-4 text-[#b99a5f]" /><h3 id="history-list-heading" className="font-serif text-xl text-[#eee8de]">Historical elections</h3></div><p className="mt-1.5 text-xs text-[#777064]">{elections.length} closed record{elections.length === 1 ? "" : "s"}</p></div><div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_140px] xl:w-[460px]"><label className="relative block"><span className="sr-only">Search historical elections</span><Search aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[#777064]" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search election or winner" className="min-h-11 w-full rounded-xl border border-white/10 bg-[#11110f] py-2.5 pl-10 pr-4 text-sm text-[#f2ece2] outline-none transition placeholder:text-[#6f695f] focus:border-[#b99a5f]/60 focus:ring-4 focus:ring-[#b99a5f]/10" /></label><label className="relative block"><span className="sr-only">Filter history by year</span><select value={yearFilter} onChange={(event) => setYearFilter(event.target.value)} className="min-h-11 w-full appearance-none rounded-xl border border-white/10 bg-[#11110f] px-3.5 pr-10 text-sm text-[#d8d1c5] outline-none focus:border-[#b99a5f]/60 focus:ring-4 focus:ring-[#b99a5f]/10"><option value="all">All years</option>{years.map((year) => <option key={year} value={year}>{year}</option>)}</select><ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3.5 top-1/2 size-4 -translate-y-1/2 text-[#777064]" /></label></div></div>

        {loading ? <LoadingState /> : loadError ? <div role="alert" className="flex min-h-72 flex-col items-center justify-center px-5 py-12 text-center"><span className="flex size-12 items-center justify-center rounded-xl border border-[#b85e50]/25 bg-[#b85e50]/10 text-[#e19a8c]"><AlertTriangle aria-hidden="true" className="size-5" /></span><h3 className="mt-5 font-serif text-xl text-[#eee8de]">History could not be loaded</h3><p className="mt-2 max-w-md text-sm leading-6 text-[#aa8d86]">{loadError}</p><Button className="mt-6" variant="secondary" onClick={retryHistory}><RefreshCw aria-hidden="true" className="size-4" /> Try again</Button></div> : filtered.length === 0 ? <div className="flex min-h-72 flex-col items-center justify-center px-5 py-12 text-center"><span className="flex size-12 items-center justify-center rounded-xl border border-[#b99a5f]/20 bg-[#b99a5f]/10 text-[#c7a969]"><History aria-hidden="true" className="size-5" /></span><h3 className="mt-5 font-serif text-xl text-[#eee8de]">{elections.length ? "No matching history" : "No historical elections yet"}</h3><p className="mt-2 max-w-sm text-sm leading-6 text-[#8e867a]">{elections.length ? "Try another search or year." : "Closed elections will appear here with their final results and participation record."}</p>{elections.length ? <Button className="mt-6" variant="secondary" onClick={() => { setQuery(""); setYearFilter("all"); }}>Clear filters</Button> : null}</div> : <>
          <div className="hidden xl:block"><table className="w-full table-fixed text-left"><thead className="border-b border-white/[0.07] bg-white/[0.018] text-[9px] font-bold uppercase tracking-[0.15em] text-[#756e63]"><tr><th className="w-[17%] px-4 py-3.5">Month / year</th><th className="w-[9%] px-4 py-3.5">Status</th><th className="w-[15%] px-4 py-3.5">FOH winner</th><th className="w-[15%] px-4 py-3.5">BOH winner</th><th className="w-[9%] px-4 py-3.5">Turnout</th><th className="w-[16%] px-4 py-3.5">Opened at</th><th className="w-[16%] px-4 py-3.5">Closed at</th><th className="w-[3%] px-2 py-3.5"><span className="sr-only">Open</span></th></tr></thead><tbody className="divide-y divide-white/[0.06]">{filtered.map((election) => { const summary = summaries[election.id]; return <tr key={election.id} className="group cursor-pointer transition hover:bg-white/[0.022]" onClick={() => void loadDetail(election)}><td className="px-4 py-4"><p className="truncate text-sm font-semibold text-[#ece5da]">{monthName(election.month)} {election.year}</p><p className="mt-1 truncate text-[10px] text-[#787168]">{election.name}</p></td><td className="px-4 py-4"><StatusBadge status={election.status} /></td><td className="px-4 py-4"><Winner category={summary.results.FOH} compact /></td><td className="px-4 py-4"><Winner category={summary.results.BOH} compact /></td><td className="px-4 py-4"><p className="text-sm font-semibold tabular-nums text-[#d9d1c5]">{formatPercent(summary.turnout.turnoutPercentage)}</p><p className="mt-0.5 text-[10px] tabular-nums text-[#787168]">{summary.turnout.completedHods}/{summary.turnout.totalEligibleHods}</p></td><td className="px-4 py-4 text-[11px] leading-5 text-[#9b9387]">{formatDate(election.openedAt)}</td><td className="px-4 py-4 text-[11px] leading-5 text-[#9b9387]">{formatDate(election.closedAt)}</td><td className="px-2 py-4"><button type="button" onClick={(event) => { event.stopPropagation(); void loadDetail(election); }} aria-label={`Open ${election.name} history`} className="rounded-lg p-2 text-[#827a6f] transition group-hover:text-[#d7ba7e] hover:bg-white/5"><ArrowRight aria-hidden="true" className="size-4" /></button></td></tr>; })}</tbody></table></div>
          <div className="divide-y divide-white/[0.07] xl:hidden">{filtered.map((election) => { const summary = summaries[election.id]; return <article key={election.id} className="p-4 sm:p-5"><button type="button" onClick={() => void loadDetail(election)} className="w-full text-left"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><h4 className="truncate text-base font-semibold text-[#eee7dc]">{monthName(election.month)} {election.year}</h4><p className="mt-1 truncate text-xs text-[#81796e]">{election.name}</p></div><StatusBadge status={election.status} /></div><div className="mt-4 grid gap-px overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.06] sm:grid-cols-3"><div className="bg-[#141412] p-3.5"><p className="text-[9px] font-bold uppercase tracking-[0.13em] text-[#70695f]">FOH winner</p><div className="mt-2"><Winner category={summary.results.FOH} compact /></div></div><div className="bg-[#141412] p-3.5"><p className="text-[9px] font-bold uppercase tracking-[0.13em] text-[#70695f]">BOH winner</p><div className="mt-2"><Winner category={summary.results.BOH} compact /></div></div><div className="bg-[#141412] p-3.5"><p className="text-[9px] font-bold uppercase tracking-[0.13em] text-[#70695f]">Turnout</p><p className="mt-2 text-sm font-semibold tabular-nums text-[#d9d1c5]">{formatPercent(summary.turnout.turnoutPercentage)} <span className="text-[10px] font-normal text-[#777064]">· {summary.turnout.completedHods}/{summary.turnout.totalEligibleHods}</span></p></div></div><dl className="mt-4 grid grid-cols-2 gap-3"><div><dt className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.13em] text-[#70695f]"><Clock3 aria-hidden="true" className="size-3" /> Opened</dt><dd className="mt-1.5 text-[11px] leading-5 text-[#999185]">{formatDate(election.openedAt)}</dd></div><div><dt className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.13em] text-[#70695f]"><ShieldCheck aria-hidden="true" className="size-3" /> Closed</dt><dd className="mt-1.5 text-[11px] leading-5 text-[#999185]">{formatDate(election.closedAt)}</dd></div></dl><div className="mt-4 flex items-center justify-end gap-2 border-t border-white/[0.07] pt-4 text-xs font-semibold text-[#c5aa72]">View full record <ArrowRight aria-hidden="true" className="size-3.5" /></div></button></article>; })}</div>
        </>}
      </section>

      {selected ? <HistoryDetail election={selected} detail={detail} loading={detailLoading} error={detailError} onClose={closeDetail} onRetry={() => void loadDetail(selected)} /> : null}
    </div>
  );
}
