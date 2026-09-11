"use client";

import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Crown,
  Gauge,
  LoaderCircle,
  LockKeyhole,
  Play,
  RefreshCcw,
  RotateCcw,
  Settings,
  ShieldCheck,
  Square,
  UsersRound,
  Utensils,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { AdminLogoutButton } from "@/components/admin-logout-button";
import { TieBreakPanel } from "@/components/tie-break-panel";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Skeleton } from "@/components/ui/surfaces";

type ElectionStatus = "DRAFT" | "OPEN" | "CLOSED";
type ElectionAction = "start" | "close" | "reopen" | "reset";

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

type Candidate = { category: "FOH" | "BOH"; isActive: boolean };
type Hod = { isActive: boolean };
type Counts = { hods: number; foh: number; boh: number };
type ToastState = { id: number; message: string; tone: "success" | "error" };

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

const actionCopy: Record<ElectionAction, { title: string; confirm: string; success: string }> = {
  start: { title: "Start Election", confirm: "Start election", success: "Election is now open." },
  close: { title: "Close Election", confirm: "Close election", success: "Election has been closed." },
  reopen: { title: "Reopen Election", confirm: "Reopen election", success: "Election has been reopened." },
  reset: { title: "Reset Election", confirm: "Reset election", success: "Election reset to a new DRAFT." },
};

async function responseError(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => null) as { error?: unknown } | null;
  return typeof body?.error === "string" ? body.error : fallback;
}

function formatDate(value: string | null): string {
  if (!value) return "Not yet";
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function StatusBadge({ status }: { status: ElectionStatus }) {
  const palette = status === "DRAFT"
    ? "border-[#8298b4]/30 bg-[#8298b4]/10 text-[#bed0e6]"
    : status === "OPEN"
      ? "border-[#78977a]/35 bg-[#78977a]/10 text-[#c5ddc6]"
      : "border-white/10 bg-white/[0.045] text-[#b8b0a4]";
  return (
    <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] ${palette}`}>
      <span aria-hidden="true" className={`size-1.5 rounded-full ${status === "OPEN" ? "bg-[#8fb391]" : status === "DRAFT" ? "bg-[#93aaca]" : "bg-[#80786d]"}`} />
      {status}
    </span>
  );
}

function DashboardSkeleton() {
  return (
    <div aria-label="Loading System Control" aria-busy="true" className="space-y-5">
      <div className="rounded-2xl border border-white/[0.08] bg-[#181816] p-6 sm:p-8">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="mt-4 h-9 w-72 max-w-full" />
        <Skeleton className="mt-3 h-4 w-40" />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((item) => <Skeleton key={item} className="h-32" />)}
      </div>
    </div>
  );
}

export function SystemControlPanel() {
  const router = useRouter();
  const [election, setElection] = useState<Election | null>(null);
  const [counts, setCounts] = useState<Counts>({ hods: 0, foh: 0, boh: 0 });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [confirmation, setConfirmation] = useState<ElectionAction | null>(null);
  const [resetPhrase, setResetPhrase] = useState("");
  const [acting, setActing] = useState(false);
  const [actionError, setActionError] = useState("");
  const [toast, setToast] = useState<ToastState | null>(null);

  const notify = useCallback((message: string, tone: ToastState["tone"]) => {
    setToast({ id: Date.now(), message, tone });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 5000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    let cancelled = false;

    void fetch("/api/elections", { cache: "no-store", credentials: "same-origin" })
      .then(async (response) => {
        if (response.status === 401 || response.status === 403) {
          router.replace("/system/login");
          return null;
        }
        if (!response.ok) throw new Error(await responseError(response, "Unable to load the current election."));
        const body = await response.json() as { elections?: Election[] };
        if (!Array.isArray(body.elections)) throw new Error("The election list could not be read.");
        const latest = body.elections[0] ?? null;
        if (!latest) return { election: null, counts: { hods: 0, foh: 0, boh: 0 } };

        const [hodResponse, candidateResponse] = await Promise.all([
          fetch("/api/hods", { cache: "no-store", credentials: "same-origin" }),
          fetch(`/api/candidates?electionId=${encodeURIComponent(latest.id)}`, { cache: "no-store", credentials: "same-origin" }),
        ]);
        if ([hodResponse.status, candidateResponse.status].some((status) => status === 401 || status === 403)) {
          router.replace("/system/login");
          return null;
        }
        if (!hodResponse.ok) throw new Error(await responseError(hodResponse, "Unable to load eligible HODs."));
        if (!candidateResponse.ok) throw new Error(await responseError(candidateResponse, "Unable to load candidates."));
        const hodBody = await hodResponse.json() as { hods?: Hod[] };
        const candidateBody = await candidateResponse.json() as { candidates?: Candidate[] };
        if (!Array.isArray(hodBody.hods) || !Array.isArray(candidateBody.candidates)) {
          throw new Error("Election readiness details could not be read.");
        }
        const activeCandidates = candidateBody.candidates.filter((candidate) => candidate.isActive);
        return {
          election: latest,
          counts: {
            hods: hodBody.hods.filter((hod) => hod.isActive).length,
            foh: activeCandidates.filter((candidate) => candidate.category === "FOH").length,
            boh: activeCandidates.filter((candidate) => candidate.category === "BOH").length,
          },
        };
      })
      .then((data) => {
        if (!cancelled && data) {
          setElection(data.election);
          setCounts(data.counts);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : "Unable to load System Control.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [reloadKey, router]);

  const startWarnings = [
    counts.hods === 0 ? "No eligible HODs are available." : null,
    counts.foh === 0 ? "No active FOH candidates are available." : null,
    counts.boh === 0 ? "No active BOH candidates are available." : null,
  ].filter((warning): warning is string => warning !== null);

  const retryLoad = () => {
    setLoading(true);
    setLoadError("");
    setReloadKey((current) => current + 1);
  };

  const openConfirmation = (action: ElectionAction) => {
    setActionError("");
    setResetPhrase("");
    setConfirmation(action);
  };

  const closeConfirmation = useCallback(() => {
    if (acting) return;
    setConfirmation(null);
    setActionError("");
    setResetPhrase("");
  }, [acting]);

  const performAction = async () => {
    if (!election || !confirmation) return;
    const action = confirmation;
    setActing(true);
    setActionError("");
    try {
      const response = await fetch(`/api/elections/${election.id}/${action}`, {
        method: "POST",
        credentials: "same-origin",
      });
      if (response.status === 401 || response.status === 403) {
        router.replace("/system/login");
        return;
      }
      if (!response.ok) throw new Error(await responseError(response, `Unable to ${action} the election.`));
      const body = await response.json() as { election?: Election };
      if (!body.election) throw new Error("The updated election could not be read.");
      setElection(body.election);
      setConfirmation(null);
      setResetPhrase("");
      notify(actionCopy[action].success, "success");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "The election action could not be completed.");
    } finally {
      setActing(false);
    }
  };

  const primaryAction: ElectionAction | null = election?.status === "DRAFT"
    ? "start"
    : election?.status === "OPEN"
      ? "close"
      : election?.status === "CLOSED"
        ? "reopen"
        : null;

  return (
    <div className="min-h-screen bg-[#10100f] text-[#f5efe5]">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-white/[0.07] bg-[#141412] lg:flex">
        <div className="flex h-[76px] items-center border-b border-white/[0.07] px-6">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-xl border border-[#b99a5f]/30 bg-[#b99a5f]/10 text-[#d7ba7e]"><Crown aria-hidden="true" className="size-5" strokeWidth={1.5} /></span>
            <span><span className="block font-serif text-lg tracking-[0.06em] text-[#f5efe5]">ANTILIA</span><span className="block text-[8px] font-semibold uppercase tracking-[0.26em] text-[#817a6e]">Voting Portal</span></span>
          </div>
        </div>
        <nav aria-label="System navigation" className="flex-1 space-y-1 px-4 py-6">
          <p className="mb-3 px-3 text-[9px] font-bold uppercase tracking-[0.22em] text-[#666057]">System Administration</p>
          <div aria-current="page" className="flex min-h-11 items-center gap-3 rounded-xl bg-[#b99a5f]/12 px-3.5 text-sm font-medium text-[#e3c98f] shadow-[inset_0_0_0_1px_rgba(185,154,95,.13)]">
            <Gauge aria-hidden="true" className="size-[18px]" strokeWidth={1.9} /><span>System Control</span><span aria-hidden="true" className="ml-auto size-1.5 rounded-full bg-[#c9ab70]" />
          </div>
          <Link href="/system/settings" className="flex min-h-11 items-center gap-3 rounded-xl px-3.5 text-sm font-medium text-[#9d9589] transition hover:bg-white/[0.045] hover:text-[#eee8dd]"><Settings aria-hidden="true" className="size-[18px]" /><span>Settings</span></Link>
        </nav>
        <div className="border-t border-white/[0.07] p-4">
          <div className="flex items-center gap-3 rounded-xl border border-white/[0.07] bg-white/[0.025] p-3.5">
            <span className="flex size-9 items-center justify-center rounded-lg bg-[#b99a5f]/12 text-[#d2b574]"><ShieldCheck aria-hidden="true" className="size-4" /></span>
            <span><span className="block text-sm font-medium text-[#e7e0d4]">System Access</span><span className="block text-[10px] uppercase tracking-[0.12em] text-[#777064]">Secure session</span></span>
          </div>
        </div>
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-[70px] items-center justify-between border-b border-white/[0.07] bg-[#10100f]/90 px-4 backdrop-blur-xl sm:px-6 lg:h-[76px] lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-[#b99a5f]/25 bg-[#b99a5f]/10 text-[#d7ba7e] lg:hidden"><Crown aria-hidden="true" className="size-4" /></span>
            <div className="min-w-0"><p className="text-[9px] font-bold uppercase tracking-[0.18em] text-[#81796d]">System Administration</p><h1 className="mt-0.5 truncate font-serif text-lg text-[#f4eee4] sm:text-xl">System Control</h1></div>
          </div>
          <div className="flex items-center gap-2"><Link href="/system/settings" className="rounded-xl border border-white/[0.08] p-2.5 text-[#bdb5a8] hover:bg-white/[0.05] lg:hidden" aria-label="System settings"><Settings aria-hidden="true" className="size-4" /></Link><AdminLogoutButton redirectTo="/system/login" theme="dark" /></div>
        </header>

        <main className="mx-auto w-full max-w-[1280px] p-4 sm:p-6 lg:p-8">
          <div className="mb-7 animate-[fadeIn_.35s_ease-out] sm:mb-8">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#b99a5f]">Protected controls</p>
            <h2 className="mt-2 font-serif text-3xl leading-tight text-[#f6f0e7] sm:text-4xl">Election command centre</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#938b7f]">Review readiness and manage the state of the latest monthly election.</p>
          </div>

          {loading ? <DashboardSkeleton /> : loadError ? (
            <section className="rounded-2xl border border-[#b85e50]/25 bg-[#b85e50]/8 p-6">
              <AlertTriangle aria-hidden="true" className="size-5 text-[#e0a398]" />
              <h3 className="mt-4 font-serif text-xl text-[#f1ddd9]">System Control could not load</h3>
              <p role="alert" className="mt-2 text-sm text-[#c89e96]">{loadError}</p>
              <Button variant="secondary" className="mt-5 min-h-11" onClick={retryLoad}><RefreshCcw aria-hidden="true" className="size-4" /> Try again</Button>
            </section>
          ) : !election ? (
            <section className="flex min-h-72 flex-col items-center justify-center rounded-2xl border border-dashed border-white/[0.1] bg-white/[0.018] p-8 text-center">
              <CalendarDays aria-hidden="true" className="size-7 text-[#b99a5f]" />
              <h3 className="mt-5 font-serif text-2xl text-[#eee8de]">No election available</h3>
              <p className="mt-2 max-w-md text-sm leading-6 text-[#8e867a]">Create a monthly election in HR Administration before using System Control.</p>
            </section>
          ) : (
            <div className="animate-[fadeIn_.35s_ease-out] space-y-5 sm:space-y-6">
              <section className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#181816] shadow-[0_24px_70px_rgba(0,0,0,.24)]">
                <div className="flex flex-col gap-5 border-b border-white/[0.07] p-5 sm:flex-row sm:items-start sm:justify-between sm:p-7 lg:p-8">
                  <div>
                    <div className="flex items-center gap-2 text-[#b99a5f]"><CalendarDays aria-hidden="true" className="size-4" strokeWidth={1.7} /><p className="text-[10px] font-bold uppercase tracking-[0.19em]">Current election</p></div>
                    <h3 className="mt-3 font-serif text-2xl text-[#f2ece2] sm:text-3xl">{election.name}</h3>
                    <p className="mt-2 text-sm text-[#938b7f]">{MONTHS[election.month - 1]} {election.year}</p>
                  </div>
                  <StatusBadge status={election.status} />
                </div>

                <dl className="grid gap-px bg-white/[0.07] sm:grid-cols-2">
                  <div className="bg-[#181816] p-5 sm:p-6"><dt className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#777064]"><Clock3 aria-hidden="true" className="size-4" />Opened at</dt><dd className="mt-2 text-sm font-medium text-[#dcd5ca]">{formatDate(election.openedAt)}</dd></div>
                  <div className="bg-[#181816] p-5 sm:p-6"><dt className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#777064]"><LockKeyhole aria-hidden="true" className="size-4" />Closed at</dt><dd className="mt-2 text-sm font-medium text-[#dcd5ca]">{formatDate(election.closedAt)}</dd></div>
                </dl>
              </section>

              <section aria-labelledby="readiness-heading">
                <div className="mb-3"><p className="text-[10px] font-bold uppercase tracking-[0.19em] text-[#777064]">Readiness</p><h3 id="readiness-heading" className="mt-1 font-serif text-xl text-[#e9e2d7]">Election population</h3></div>
                <dl className="grid gap-3 sm:grid-cols-3">
                  {[
                    { label: "Eligible HODs", value: counts.hods, icon: UsersRound },
                    { label: "FOH candidates", value: counts.foh, icon: Utensils },
                    { label: "BOH candidates", value: counts.boh, icon: Utensils },
                  ].map((item) => (
                    <div key={item.label} className={`rounded-2xl border bg-[#181816] p-5 shadow-[0_18px_45px_rgba(0,0,0,.18)] ${item.value === 0 ? "border-[#b85e50]/25" : "border-white/[0.08]"}`}>
                      <div className="flex items-start justify-between"><item.icon aria-hidden="true" className="size-4 text-[#9a8a6c]" strokeWidth={1.7} />{item.value > 0 ? <CheckCircle2 aria-hidden="true" className="size-4 text-[#7f9f80]" /> : <AlertTriangle aria-hidden="true" className="size-4 text-[#c77b6e]" />}</div>
                      <dd className="mt-5 font-serif text-3xl text-[#f0e9df]">{item.value}</dd><dt className="mt-1 text-xs font-semibold uppercase tracking-[0.12em] text-[#81796d]">{item.label}</dt>
                    </div>
                  ))}
                </dl>
              </section>

              <section className="rounded-2xl border border-white/[0.08] bg-[#181816] p-5 shadow-[0_24px_70px_rgba(0,0,0,.2)] sm:p-7">
                <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
                  <div><p className="text-[10px] font-bold uppercase tracking-[0.19em] text-[#b99a5f]">State action</p><h3 className="mt-2 font-serif text-xl text-[#eee8de]">Manage election status</h3><p className="mt-1.5 text-sm leading-6 text-[#8e867a]">Every action requires confirmation and is enforced by System Access.</p></div>
                  <div className="flex flex-col gap-3 sm:flex-row md:justify-end">
                    {primaryAction ? (
                      <Button onClick={() => openConfirmation(primaryAction)}>
                        {primaryAction === "start" ? <Play aria-hidden="true" className="size-4" /> : primaryAction === "close" ? <Square aria-hidden="true" className="size-4" /> : <RotateCcw aria-hidden="true" className="size-4" />}
                        {actionCopy[primaryAction].title}
                      </Button>
                    ) : null}
                    <Button variant="secondary" onClick={() => openConfirmation("reset")}><RefreshCcw aria-hidden="true" className="size-4" /> Reset Election</Button>
                  </div>
                </div>
              </section>

              <TieBreakPanel
                electionId={election.id}
                electionName={election.name}
                electionStatus={election.status}
                role="SYSTEM"
              />
            </div>
          )}
        </main>
      </div>

      <Modal open={confirmation !== null} onClose={closeConfirmation} title={confirmation ? actionCopy[confirmation].title : "Confirm action"}>
        {confirmation === "start" ? (
          <div className="mt-5 space-y-4">
            <p className="text-sm leading-6 text-[#aaa296]">Starting <strong className="font-semibold text-[#eee7dc]">{election?.name}</strong> opens voting immediately.</p>
            {startWarnings.length > 0 ? (
              <div role="alert" className="rounded-xl border border-[#b85e50]/30 bg-[#b85e50]/10 p-4 text-[#e8b1a7]">
                <div className="flex gap-3"><AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" /><div><p className="text-sm font-semibold">Election is not ready to start</p><ul className="mt-2 space-y-1 text-sm leading-5">{startWarnings.map((warning) => <li key={warning}>• {warning}</li>)}</ul></div></div>
              </div>
            ) : (
              <div className="flex gap-3 rounded-xl border border-[#78977a]/25 bg-[#78977a]/8 p-4 text-sm leading-6 text-[#bed2be]"><CheckCircle2 aria-hidden="true" className="mt-1 size-4 shrink-0" /><span>Readiness checks passed. Eligible HODs can vote after this election opens.</span></div>
            )}
          </div>
        ) : confirmation === "close" ? (
          <p className="mt-5 text-sm leading-6 text-[#aaa296]">Close <strong className="font-semibold text-[#eee7dc]">{election?.name}</strong>? Voting will stop immediately and the close time will be recorded.</p>
        ) : confirmation === "reopen" ? (
          <p className="mt-5 text-sm leading-6 text-[#aaa296]">Reopen <strong className="font-semibold text-[#eee7dc]">{election?.name}</strong>? Eligible HODs who have not voted will be able to participate again.</p>
        ) : confirmation === "reset" ? (
          <div className="mt-5 space-y-4">
            <div role="alert" className="rounded-xl border border-[#b85e50]/35 bg-[#b85e50]/10 p-4 text-[#e9b3aa]">
              <div className="flex gap-3"><AlertTriangle aria-hidden="true" className="mt-0.5 size-5 shrink-0" /><div><p className="text-sm font-bold uppercase tracking-[0.08em]">Strong warning</p><p className="mt-2 text-sm leading-6">Reset clears votes from the current election workspace by replacing it with a new DRAFT. The backend preserves the original votes, results, and audit history in the archived election.</p></div></div>
            </div>
            <div><label htmlFor="reset-confirmation" className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-[#9a9286]">Type RESET to confirm</label><input id="reset-confirmation" value={resetPhrase} onChange={(event) => setResetPhrase(event.target.value)} autoComplete="off" className="min-h-12 w-full rounded-xl border border-white/10 bg-black/20 px-4 text-sm text-[#f5efe5] outline-none transition focus:border-[#b85e50]/60 focus:ring-4 focus:ring-[#b85e50]/10" /></div>
          </div>
        ) : null}

        {actionError ? <p role="alert" className="mt-4 rounded-xl border border-[#b85e50]/25 bg-[#b85e50]/10 px-4 py-3 text-sm text-[#eab5ac]">{actionError}</p> : null}

        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={closeConfirmation} disabled={acting}>Cancel</Button>
          <Button
            onClick={() => void performAction()}
            disabled={acting || (confirmation === "start" && startWarnings.length > 0) || (confirmation === "reset" && resetPhrase !== "RESET")}
            className={confirmation === "reset" ? "bg-[#a9574b] text-white hover:bg-[#b96357] disabled:bg-[#5e3e39]" : ""}
          >
            {acting ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : confirmation === "reset" ? <AlertTriangle aria-hidden="true" className="size-4" /> : <ShieldCheck aria-hidden="true" className="size-4" />}
            {acting ? "Applying…" : confirmation ? actionCopy[confirmation].confirm : "Confirm"}
          </Button>
        </div>
      </Modal>

      {toast ? (
        <div role={toast.tone === "error" ? "alert" : "status"} className={`fixed inset-x-4 bottom-5 z-50 mx-auto flex max-w-md items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm shadow-2xl animate-[rise_.25s_ease-out] ${toast.tone === "success" ? "border-[#78977a]/30 bg-[#20261f] text-[#d6e6d5]" : "border-[#b85e50]/30 bg-[#2a1f1d] text-[#efc0b7]"}`}>
          <span>{toast.message}</span><button type="button" aria-label="Dismiss notification" onClick={() => setToast(null)} className="rounded-lg p-1 opacity-70 hover:bg-white/5 hover:opacity-100"><X aria-hidden="true" className="size-4" /></button>
        </div>
      ) : null}
    </div>
  );
}
