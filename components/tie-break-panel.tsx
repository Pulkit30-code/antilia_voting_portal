"use client";

import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Clock3,
  LoaderCircle,
  LockKeyhole,
  Play,
  Plus,
  RefreshCw,
  Square,
  Trophy,
  UsersRound,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Alert, Skeleton, Toast } from "@/components/ui/surfaces";

type Category = "FOH" | "BOH";
type TieBreakStatus = "DRAFT" | "OPEN" | "CLOSED";
type AdminRole = "HR" | "SYSTEM";

type TieBreakResult = {
  candidateId: string;
  name: string;
  voteCount: number;
  rank: number;
  isLeader: boolean;
};

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
  tieDetected: boolean;
  winnerCandidateId: string | null;
  results?: TieBreakResult[];
};

type ElectionResults = Record<Category, { tieDetected: boolean }>;
type PendingAction = { kind: "create"; category: Category } | { kind: "open" | "close"; tieBreak: TieBreak };

async function responseError(response: Response, fallback: string) {
  const body = await response.json().catch(() => null) as { error?: unknown } | null;
  return typeof body?.error === "string" ? body.error : fallback;
}

function formatDateTime(value: string | null) {
  if (!value) return "Not yet";
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function StatusBadge({ status }: { status: TieBreakStatus }) {
  const palette = status === "OPEN"
    ? "border-[#78977a]/30 bg-[#78977a]/10 text-[#c5ddc6]"
    : status === "DRAFT"
      ? "border-[#8298b4]/30 bg-[#8298b4]/10 text-[#bed0e6]"
      : "border-white/10 bg-white/[0.04] text-[#aaa296]";
  return <span className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${palette}`}><span className={`size-1.5 rounded-full ${status === "OPEN" ? "bg-[#8fb391]" : status === "DRAFT" ? "bg-[#93aaca]" : "bg-[#80786d]"}`} />{status}</span>;
}

function TieBreakCard({
  eligibleHods,
  electionName,
  onAction,
  role,
  tieBreak,
}: {
  eligibleHods: number;
  electionName: string;
  onAction: (action: PendingAction) => void;
  role: AdminRole;
  tieBreak: TieBreak;
}) {
  const results = tieBreak.results ?? [];
  const votesCast = results.reduce((total, result) => total + result.voteCount, 0);
  const winner = results.find((result) => result.candidateId === tieBreak.winnerCandidateId) ?? null;
  const leaders = results.filter((result) => result.isLeader);

  return (
    <article className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#181816] shadow-[0_20px_60px_rgba(0,0,0,.2)]">
      <div className="flex flex-col gap-4 border-b border-white/[0.07] p-5 sm:flex-row sm:items-start sm:justify-between sm:p-6">
        <div>
          <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-[#b99a5f]">{tieBreak.category} tie-break · Round {tieBreak.roundNumber}</p>
          <h4 className="mt-2 font-serif text-xl text-[#f1ebe1]">{electionName}</h4>
          <p className="mt-1 text-xs text-[#817a6f]">Original election</p>
        </div>
        <StatusBadge status={tieBreak.status} />
      </div>

      <dl className="grid grid-cols-2 gap-px bg-white/[0.06] sm:grid-cols-4">
        <div className="bg-[#181816] p-4"><dt className="text-[9px] font-bold uppercase tracking-[0.13em] text-[#716a60]">Category</dt><dd className="mt-1.5 text-sm font-semibold text-[#ddd5c8]">{tieBreak.category}</dd></div>
        <div className="bg-[#181816] p-4"><dt className="text-[9px] font-bold uppercase tracking-[0.13em] text-[#716a60]">Eligible HODs</dt><dd className="mt-1.5 text-sm font-semibold tabular-nums text-[#ddd5c8]">{eligibleHods}</dd></div>
        <div className="bg-[#181816] p-4"><dt className="text-[9px] font-bold uppercase tracking-[0.13em] text-[#716a60]">Votes cast</dt><dd className="mt-1.5 text-sm font-semibold tabular-nums text-[#ddd5c8]">{votesCast}</dd></div>
        <div className="bg-[#181816] p-4"><dt className="text-[9px] font-bold uppercase tracking-[0.13em] text-[#716a60]">Winner</dt><dd className="mt-1.5 truncate text-sm font-semibold text-[#ddd5c8]">{winner?.name ?? (tieBreak.status === "CLOSED" && tieBreak.tieDetected ? "Still tied" : "Pending")}</dd></div>
      </dl>

      <div className="p-5 sm:p-6">
        <div className="flex items-center justify-between gap-4">
          <div><p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#81796d]">Tied candidates</p><p className="mt-1 text-xs text-[#6f685e]">Only these candidates appear on the tie-break ballot.</p></div>
          <UsersRound aria-hidden="true" className="size-4 text-[#9a8a6c]" />
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {results.map((result) => (
            <div key={result.candidateId} className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 ${result.isLeader && tieBreak.status === "CLOSED" ? "border-[#b99a5f]/25 bg-[#b99a5f]/[0.07]" : "border-white/[0.07] bg-white/[0.02]"}`}>
              <span className="truncate text-sm font-medium text-[#ddd6ca]">{result.name}</span>
              <span className="shrink-0 text-xs tabular-nums text-[#8f877b]">{result.voteCount} vote{result.voteCount === 1 ? "" : "s"}</span>
            </div>
          ))}
        </div>

        {tieBreak.status === "CLOSED" && tieBreak.tieDetected ? (
          <div className="mt-4 flex gap-3 rounded-xl border border-[#c89158]/25 bg-[#c89158]/[0.08] p-4 text-[#e3b77e]"><CircleDashed aria-hidden="true" className="mt-0.5 size-4 shrink-0" /><div><p className="text-sm font-semibold">Repeated tie</p><p className="mt-1 text-xs leading-5 opacity-80">{leaders.map((candidate) => candidate.name).join(" · ")} remain tied after this round.</p></div></div>
        ) : winner ? (
          <div className="mt-4 flex items-center gap-3 rounded-xl border border-[#78977a]/25 bg-[#78977a]/[0.08] p-4 text-[#c5ddc6]"><Trophy aria-hidden="true" className="size-4" /><p className="text-sm"><strong>{winner.name}</strong> won this tie-break.</p></div>
        ) : null}

        <div className="mt-4 flex flex-col gap-2 border-t border-white/[0.06] pt-4 text-xs text-[#777064] sm:flex-row sm:items-center sm:justify-between">
          <span className="flex items-center gap-2"><Clock3 aria-hidden="true" className="size-3.5" />Opened {formatDateTime(tieBreak.openedAt)}</span>
          {role === "SYSTEM" ? (
            tieBreak.status === "DRAFT" ? <Button className="min-h-10 px-4 py-2 text-xs" onClick={() => onAction({ kind: "open", tieBreak })}><Play aria-hidden="true" className="size-3.5" /> Open tie-break</Button>
              : tieBreak.status === "OPEN" ? <Button variant="secondary" className="min-h-10 px-4 py-2 text-xs" onClick={() => onAction({ kind: "close", tieBreak })}><Square aria-hidden="true" className="size-3.5" /> Close tie-break</Button>
                : null
          ) : <span className="flex items-center gap-1.5"><LockKeyhole aria-hidden="true" className="size-3.5" />View only</span>}
        </div>
      </div>
    </article>
  );
}

export function TieBreakPanel({ electionId, electionName, electionStatus, role }: { electionId: string; electionName: string; electionStatus: "DRAFT" | "OPEN" | "CLOSED"; role: AdminRole }) {
  const router = useRouter();
  const [tieBreaks, setTieBreaks] = useState<TieBreak[]>([]);
  const [eligibleHods, setEligibleHods] = useState(0);
  const [tiedCategories, setTiedCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [acting, setActing] = useState(false);
  const [actionError, setActionError] = useState("");
  const [toast, setToast] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const tieResponse = await fetch(`/api/tie-breaks?electionId=${encodeURIComponent(electionId)}`, { cache: "no-store", credentials: "same-origin" });
      if (tieResponse.status === 401 || tieResponse.status === 403) {
        router.replace(role === "SYSTEM" ? "/system/login" : "/hr/login");
        return;
      }
      if (!tieResponse.ok) throw new Error(await responseError(tieResponse, "Unable to load tie-breaks."));
      const tieBody = await tieResponse.json() as { tieBreaks?: TieBreak[] };
      if (!Array.isArray(tieBody.tieBreaks)) throw new Error("The tie-break list could not be read.");

      const detailResponses = await Promise.all(tieBody.tieBreaks.map((item) => fetch(`/api/tie-breaks/${item.id}`, { cache: "no-store", credentials: "same-origin" })));
      const details = await Promise.all(detailResponses.map(async (response, index) => {
        if (!response.ok) throw new Error(await responseError(response, "Unable to load tie-break details."));
        const body = await response.json() as { tieBreak?: TieBreak };
        if (!body.tieBreak) throw new Error("Tie-break details could not be read.");
        return { ...body.tieBreak, voteCount: tieBody.tieBreaks?.[index]?.voteCount };
      }));
      setTieBreaks(details);

      if (electionStatus !== "DRAFT") {
        const [resultsResponse, turnoutResponse] = await Promise.all([
          fetch(`/api/elections/${electionId}/results`, { cache: "no-store", credentials: "same-origin" }),
          fetch(`/api/elections/${electionId}/turnout`, { cache: "no-store", credentials: "same-origin" }),
        ]);
        if (!resultsResponse.ok) throw new Error(await responseError(resultsResponse, "Unable to check tied results."));
        if (!turnoutResponse.ok) throw new Error(await responseError(turnoutResponse, "Unable to load eligible HOD count."));
        const resultsBody = await resultsResponse.json() as { results?: ElectionResults };
        const turnoutBody = await turnoutResponse.json() as { turnout?: { totalEligibleHods?: number } };
        if (!resultsBody.results || typeof turnoutBody.turnout?.totalEligibleHods !== "number") throw new Error("Tie-break eligibility details could not be read.");
        setTiedCategories((["FOH", "BOH"] as const).filter((category) => resultsBody.results?.[category].tieDetected));
        setEligibleHods(turnoutBody.turnout.totalEligibleHods);
      } else {
        setTiedCategories([]);
        setEligibleHods(0);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load tie-breaks.");
    } finally {
      setLoading(false);
    }
  }, [electionId, electionStatus, role, router]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load, reloadKey]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 4500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const creatableCategories = useMemo(() => tiedCategories.filter((category) =>
    !tieBreaks.some((item) => item.category === category && (item.status === "DRAFT" || item.status === "OPEN")),
  ), [tieBreaks, tiedCategories]);

  const performAction = async () => {
    if (!pendingAction || acting) return;
    setActing(true);
    setActionError("");
    try {
      const response = pendingAction.kind === "create"
        ? await fetch("/api/tie-breaks", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ electionId, category: pendingAction.category }) })
        : await fetch(`/api/tie-breaks/${pendingAction.tieBreak.id}/${pendingAction.kind}`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (response.status === 401 || response.status === 403) {
        router.replace(role === "SYSTEM" ? "/system/login" : "/hr/login");
        return;
      }
      if (!response.ok) throw new Error(await responseError(response, "Unable to update tie-break."));
      const message = pendingAction.kind === "create" ? `${pendingAction.category} tie-break created.` : `Tie-break ${pendingAction.kind === "open" ? "opened" : "closed"}.`;
      setPendingAction(null);
      setToast(message);
      setReloadKey((value) => value + 1);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "Unable to update tie-break.");
    } finally {
      setActing(false);
    }
  };

  const actionTitle = pendingAction?.kind === "create" ? "Create tie-break" : pendingAction?.kind === "open" ? "Open tie-break" : "Close tie-break";
  const actionCategory = pendingAction?.kind === "create" ? pendingAction.category : pendingAction?.tieBreak.category;

  return (
    <section aria-labelledby={`tie-break-heading-${role.toLowerCase()}`} className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div><p className="text-[10px] font-bold uppercase tracking-[0.19em] text-[#b99a5f]">Tie-breaks</p><h3 id={`tie-break-heading-${role.toLowerCase()}`} className="mt-1 font-serif text-2xl text-[#e9e2d7]">Tie-break status & results</h3><p className="mt-1.5 text-sm text-[#8e867a]">{role === "SYSTEM" ? "Create and control a vote when the original election ends in a tie." : "View tie-break progress and final results. Controls are restricted to SYSTEM."}</p></div>
        {!loading && !error ? <Button variant="ghost" className="min-h-10 px-3 py-2 text-xs" onClick={() => setReloadKey((value) => value + 1)}><RefreshCw aria-hidden="true" className="size-3.5" /> Refresh</Button> : null}
      </div>

      {loading ? <div aria-label="Loading tie-breaks" aria-busy="true" className="grid gap-4 xl:grid-cols-2"><Skeleton className="h-80" /><Skeleton className="h-80" /></div>
        : error ? <Alert tone="error" title="Tie-breaks unavailable"><span>{error}</span><button type="button" className="mt-2 block font-semibold underline underline-offset-4" onClick={() => setReloadKey((value) => value + 1)}>Try again</button></Alert>
          : <>
            {role === "SYSTEM" && electionStatus === "CLOSED" && creatableCategories.length > 0 ? (
              <div className="flex flex-col gap-4 rounded-2xl border border-[#b99a5f]/25 bg-[#b99a5f]/[0.07] p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
                <div className="flex gap-3"><span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#b99a5f]/15 text-[#d5b97b]"><AlertTriangle aria-hidden="true" className="size-4" /></span><div><p className="text-sm font-semibold text-[#eadfc9]">First-place tie detected</p><p className="mt-1 text-xs leading-5 text-[#9c927f]">Create a separate tie-break ballot. Original election votes and results will remain unchanged.</p></div></div>
                <div className="flex shrink-0 flex-wrap gap-2">{creatableCategories.map((category) => <Button key={category} className="min-h-10 px-4 py-2 text-xs" onClick={() => setPendingAction({ kind: "create", category })}><Plus aria-hidden="true" className="size-3.5" /> Create {category} tie-break</Button>)}</div>
              </div>
            ) : null}

            {tieBreaks.length > 0 ? <div className="grid gap-4 xl:grid-cols-2">{tieBreaks.map((tieBreak) => <TieBreakCard key={tieBreak.id} tieBreak={tieBreak} electionName={electionName} eligibleHods={eligibleHods} role={role} onAction={setPendingAction} />)}</div>
              : <div className="flex min-h-48 flex-col items-center justify-center rounded-2xl border border-dashed border-white/[0.1] bg-white/[0.018] p-7 text-center"><CheckCircle2 aria-hidden="true" className="size-6 text-[#81796d]" /><p className="mt-4 text-sm font-semibold text-[#c5beb2]">No tie-break rounds</p><p className="mt-1 max-w-md text-xs leading-5 text-[#746d63]">{electionStatus === "CLOSED" && tiedCategories.length > 0 ? "SYSTEM can create the required tie-break above." : "No tie-break is required for this election."}</p></div>}
          </>}

      <Modal open={pendingAction !== null} onClose={() => { if (!acting) { setPendingAction(null); setActionError(""); } }} title={actionTitle}>
        <p className="mt-4 text-sm leading-6 text-[#aaa296]">{pendingAction?.kind === "create" ? `Create a ${actionCategory} tie-break containing only the tied leaders from ${electionName}?` : pendingAction?.kind === "open" ? `Open the ${actionCategory} tie-break for eligible HOD voting?` : `Close the ${actionCategory} tie-break and calculate its result?`}</p>
        {pendingAction?.kind === "create" ? <div className="mt-4 flex gap-3 rounded-xl border border-[#78977a]/25 bg-[#78977a]/[0.08] p-4 text-sm leading-6 text-[#bed2be]"><LockKeyhole aria-hidden="true" className="mt-1 size-4 shrink-0" /><span>The original election ballots and result totals are preserved.</span></div> : null}
        {actionError ? <div className="mt-4"><Alert tone="error" title="Action unsuccessful">{actionError}</Alert></div> : null}
        <div className="mt-6 grid gap-3 sm:grid-cols-2"><Button variant="secondary" onClick={() => setPendingAction(null)} disabled={acting}>Cancel</Button><Button onClick={() => void performAction()} disabled={acting}>{acting ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : pendingAction?.kind === "close" ? <Square aria-hidden="true" className="size-4" /> : pendingAction?.kind === "open" ? <Play aria-hidden="true" className="size-4" /> : <Plus aria-hidden="true" className="size-4" />}{acting ? "Working…" : actionTitle}</Button></div>
      </Modal>
      {toast ? <Toast message={toast} onDismiss={() => setToast("")} /> : null}
    </section>
  );
}
