"use client";

import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  LoaderCircle,
  LockKeyhole,
  Scale,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form-field";
import { Modal } from "@/components/ui/modal";
import { Alert, Badge, Card, Skeleton, Toast } from "@/components/ui/surfaces";

type Election = {
  id: string;
  month: number;
  name: string;
  openedAt: string;
  year: number;
};

type ActiveTieBreak = {
  id: string;
  originalElectionId: string;
  originalElectionName: string;
  electionMonth: number;
  electionYear: number;
  category: Category;
  roundNumber: number;
  openedAt: string;
};

type Category = "FOH" | "BOH";

type Candidate = {
  category: Category;
  department: string;
  id: string;
  name: string;
};

type FormValues = {
  department: string;
  mobileNumber: string;
  name: string;
  otherDepartment: string;
};

type FormErrors = Partial<Record<keyof FormValues, string>>;
type PageState = "checking" | "unavailable" | "tie-select" | "verify" | "candidates" | "already-voted" | "success" | "error";

const departments = [
  "Administration",
  "Butler Services",
  "Engineering",
  "Finance",
  "Food & Beverage",
  "Front Office",
  "Guest Relations",
  "Housekeeping",
  "Human Resources",
  "Information Technology",
  "Kitchen",
  "Operations",
  "Procurement",
  "Security",
  "Stewarding",
  "Other",
] as const;

const initialForm: FormValues = {
  department: "",
  mobileNumber: "",
  name: "",
  otherDepartment: "",
};

async function readJson<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || "Something went wrong. Please try again.");
  return data;
}

function LoadingPage() {
  return (
    <Card className="mx-auto w-full max-w-xl p-5 sm:p-8" >
      <span className="sr-only">Checking election availability</span>
      <Skeleton className="h-5 w-28" />
      <Skeleton className="mt-6 h-9 w-4/5" />
      <Skeleton className="mt-3 h-5 w-full" />
      <Skeleton className="mt-8 h-12 w-full" />
      <Skeleton className="mt-4 h-12 w-full" />
      <Skeleton className="mt-4 h-12 w-full" />
    </Card>
  );
}

function EmptyState({ detail, title }: { detail: string; title: string }) {
  return (
    <Card className="mx-auto max-w-xl p-7 text-center sm:p-10">
      <div className="mx-auto flex size-12 items-center justify-center rounded-full border border-[#b99a5f]/25 bg-[#b99a5f]/10 text-[#c8a96b]">
        <LockKeyhole aria-hidden="true" className="size-5" strokeWidth={1.6} />
      </div>
      <h1 className="mt-5 font-serif text-3xl text-[#f5efe5] sm:text-4xl">{title}</h1>
      <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-[#aaa295]">{detail}</p>
    </Card>
  );
}

function CandidateCard({ candidate, checked, onChange }: { candidate: Candidate; checked: boolean; onChange: () => void }) {
  return (
    <label className={`group relative flex cursor-pointer items-center gap-4 rounded-2xl border p-4 transition duration-200 sm:p-5 ${checked ? "border-[#b99a5f]/70 bg-[#b99a5f]/10 shadow-[0_12px_35px_rgba(0,0,0,0.2)]" : "border-white/[0.08] bg-[#1a1a18] hover:border-white/20 hover:bg-[#1e1e1b]"}`}>
      <input
        type="radio"
        name={`${candidate.category.toLowerCase()}-candidate`}
        value={candidate.id}
        checked={checked}
        onChange={onChange}
        className="sr-only"
      />
      <div className={`flex size-6 shrink-0 items-center justify-center rounded-full border transition ${checked ? "border-[#c8a96b] bg-[#c8a96b] text-[#171612]" : "border-white/25 text-transparent group-hover:border-white/40"}`}>
        <Check aria-hidden="true" className="size-3.5" strokeWidth={2.6} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-base font-semibold text-[#f4eee3]">{candidate.name}</p>
        <p className="mt-1 truncate text-sm text-[#979083]">{candidate.department}</p>
      </div>
      <Badge>{candidate.category}</Badge>
    </label>
  );
}

function CandidateSkeletons() {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {[0, 1, 2, 3].map((item) => <Skeleton key={item} className="h-[90px]" />)}
    </div>
  );
}

function SelectionSummary({ candidate }: { candidate: Candidate }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-white/[0.08] bg-black/15 p-4">
      <div className="min-w-0">
        <p className="truncate font-semibold text-[#f5efe5]">{candidate.name}</p>
        <p className="mt-1 truncate text-sm text-[#9c9588]">{candidate.department}</p>
      </div>
      <Badge>{candidate.category}</Badge>
    </div>
  );
}

export function PublicVotingPortal() {
  const [pageState, setPageState] = useState<PageState>("checking");
  const [election, setElection] = useState<Election | null>(null);
  const [activeTieBreaks, setActiveTieBreaks] = useState<ActiveTieBreak[]>([]);
  const [tieBreak, setTieBreak] = useState<ActiveTieBreak | null>(null);
  const [form, setForm] = useState<FormValues>(initialForm);
  const [errors, setErrors] = useState<FormErrors>({});
  const [isVerifying, setIsVerifying] = useState(false);
  const [isLoadingCandidates, setIsLoadingCandidates] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [fohCandidates, setFohCandidates] = useState<Candidate[]>([]);
  const [bohCandidates, setBohCandidates] = useState<Candidate[]>([]);
  const [fohId, setFohId] = useState("");
  const [bohId, setBohId] = useState("");
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [pageError, setPageError] = useState("");
  const [toast, setToast] = useState("");

  const checkElection = useCallback(async () => {
    try {
      const [electionResponse, tieBreakResponse] = await Promise.all([
        fetch("/api/voting/election", { cache: "no-store" }),
        fetch("/api/voting/tie-breaks", { cache: "no-store" }),
      ]);
      const tieBreakData = await readJson<{ tieBreaks: ActiveTieBreak[] }>(tieBreakResponse);
      if (!Array.isArray(tieBreakData.tieBreaks)) throw new Error("Active tie-breaks could not be read.");
      setActiveTieBreaks(tieBreakData.tieBreaks);
      if (tieBreakData.tieBreaks.length > 0) {
        const selected = tieBreakData.tieBreaks.length === 1 ? tieBreakData.tieBreaks[0] : null;
        setTieBreak(selected);
        setElection(null);
        setPageState(selected ? "verify" : "tie-select");
        return;
      }
      const data = await readJson<{ election: Election }>(electionResponse);
      setElection(data.election);
      setTieBreak(null);
      setPageState("verify");
    } catch (error) {
      if (error instanceof Error && (error.message === "Election is not open" || error.message === "Tie-break is not open")) {
        setPageState("unavailable");
      } else {
        setPageError(error instanceof Error ? error.message : "Unable to check election availability.");
        setPageState("error");
      }
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void checkElection(), 0);
    return () => window.clearTimeout(timer);
  }, [checkElection]);

  function validateForm(): FormErrors {
    const nextErrors: FormErrors = {};
    if (!form.name.trim()) nextErrors.name = "Enter your full name.";
    const digits = form.mobileNumber.replace(/\D/g, "");
    if (digits.length < 8 || digits.length > 15) nextErrors.mobileNumber = "Enter a valid mobile number.";
    if (!form.department) nextErrors.department = "Select your department.";
    if (form.department === "Other" && !form.otherDepartment.trim()) nextErrors.otherDepartment = "Enter your department.";
    return nextErrors;
  }

  async function loadCandidates() {
    setIsLoadingCandidates(true);
    try {
      if (tieBreak) {
        const data = await readJson<{ candidates: Candidate[] }>(await fetch(`/api/voting/tie-breaks/${tieBreak.id}/candidates`, { cache: "no-store" }));
        setFohCandidates(tieBreak.category === "FOH" ? data.candidates : []);
        setBohCandidates(tieBreak.category === "BOH" ? data.candidates : []);
      } else {
        const [fohResponse, bohResponse] = await Promise.all([
          fetch("/api/voting/candidates/foh", { cache: "no-store" }),
          fetch("/api/voting/candidates/boh", { cache: "no-store" }),
        ]);
        const [fohData, bohData] = await Promise.all([
          readJson<{ candidates: Candidate[] }>(fohResponse),
          readJson<{ candidates: Candidate[] }>(bohResponse),
        ]);
        setFohCandidates(fohData.candidates);
        setBohCandidates(bohData.candidates);
      }
    } catch (error) {
      if (error instanceof Error && (error.message === "Election is not open" || error.message === "Tie-break is not open")) {
        setPageState("unavailable");
      } else {
        setPageError(error instanceof Error ? error.message : "Unable to load candidates.");
      }
    } finally {
      setIsLoadingCandidates(false);
    }
  }

  async function verifyHod(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validateForm();
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setIsVerifying(true);
    setPageError("");
    try {
      const department = form.department === "Other" ? form.otherDepartment.trim() : form.department;
      const response = await fetch(tieBreak ? `/api/voting/tie-breaks/${tieBreak.id}/verify` : "/api/voting/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: form.name.trim(), mobileNumber: form.mobileNumber.trim(), department }),
      });
      await readJson<{ verified: true; expiresAt: string }>(response);
      setPageState("candidates");
      await loadCandidates();
      setToast(tieBreak ? `Identity verified. Choose one ${tieBreak.category} candidate.` : "Identity verified. Please select one candidate in each category.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to verify your details.";
      if (message === "Already voted") {
        setPageState("already-voted");
      } else if (message === "Election is not open" || message === "Tie-break is not open") {
        setPageState("unavailable");
      } else {
        setPageError(message === "HOD not verified" ? "We could not verify those details. Check each field and try again." : message);
      }
    } finally {
      setIsVerifying(false);
    }
  }

  function requestConfirmation() {
    if (tieBreak ? !(tieBreak.category === "FOH" ? fohId : bohId) : (!fohId || !bohId)) {
      setPageError(tieBreak ? `Select one ${tieBreak.category} candidate to continue.` : "Select exactly one FOH and one BOH candidate to continue.");
      return;
    }
    setPageError("");
    setConfirmationOpen(true);
  }

  async function submitBallot() {
    const tieBreakCandidateId = tieBreak?.category === "FOH" ? fohId : bohId;
    if (isSubmitting || (tieBreak ? !tieBreakCandidateId : (!fohId || !bohId))) return;
    setIsSubmitting(true);
    setPageError("");
    try {
      await readJson<{ submitted: true }>(await fetch(tieBreak ? `/api/voting/tie-breaks/${tieBreak.id}/vote` : "/api/voting/ballot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(tieBreak ? { candidateId: tieBreakCandidateId } : { fohCandidateId: fohId, bohCandidateId: bohId }),
      }));
      setConfirmationOpen(false);
      setPageState("success");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to submit your ballot.";
      setConfirmationOpen(false);
      if (message === "Already voted") setPageState("already-voted");
      else if (message === "Election is not open" || message === "Tie-break is not open") setPageState("unavailable");
      else {
        setPageError(message);
        setToast("Your ballot was not submitted. Please review and try again.");
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  const selectedFoh = fohCandidates.find((candidate) => candidate.id === fohId);
  const selectedBoh = bohCandidates.find((candidate) => candidate.id === bohId);
  const selectedTieBreakCandidate = tieBreak?.category === "FOH" ? selectedFoh : selectedBoh;
  const activeStep = pageState === "candidates"
    ? 2
    : pageState === "success" || pageState === "already-voted"
      ? 3
      : 1;

  return (
    <div className="min-h-dvh bg-[#0f0f0e] text-[#f5efe5]">
      <header className="sticky top-0 z-30 border-b border-white/[0.07] bg-[#0f0f0e]/90 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="grid size-8 place-items-center rounded-full border border-[#b99a5f]/35 text-[#c8a96b]">
              <Sparkles className="size-3.5" aria-hidden="true" strokeWidth={1.5} />
            </div>
            <div>
              <p className="font-serif text-lg leading-none tracking-wide">Antilia</p>
              <p className="mt-1 text-[9px] font-medium uppercase tracking-[0.24em] text-[#8c8579]">Voting portal</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2">
            <div className="mr-1 hidden items-center gap-2 text-xs text-[#8f887b] xl:flex">
              <ShieldCheck aria-hidden="true" className="size-4 text-[#b99a5f]" strokeWidth={1.7} />
              <span>Private & secure voting</span>
            </div>
            <Link
              href="/hr/login"
              className="inline-flex min-h-9 items-center justify-center whitespace-nowrap rounded-xl border border-white/10 bg-white/[0.035] px-2.5 text-[11px] font-semibold text-[#bcb4a8] transition hover:border-white/20 hover:bg-white/[0.06] hover:text-[#eee8dd] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#b99a5f] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0f0f0e] sm:px-3.5 sm:text-xs"
            >
              HR Access
            </Link>
            <Link
              href="/system/login"
              className="inline-flex min-h-9 items-center justify-center whitespace-nowrap rounded-xl border border-[#b99a5f]/35 bg-[#b99a5f]/10 px-2.5 text-[11px] font-semibold text-[#d7ba7e] transition hover:border-[#b99a5f]/55 hover:bg-[#b99a5f]/15 hover:text-[#ead29e] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#b99a5f] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0f0f0e] sm:px-3.5 sm:text-xs"
            >
              System Access
            </Link>
          </div>
        </div>
      </header>

      <main className="relative isolate overflow-hidden">
        <div aria-hidden="true" className="pointer-events-none absolute left-1/2 top-0 -z-10 h-[520px] w-[520px] -translate-x-1/2 rounded-full bg-[#b99a5f]/[0.045] blur-3xl" />
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-8 sm:px-6 sm:py-12 lg:grid-cols-[260px_minmax(0,1fr)] lg:px-8 lg:py-16">
          <aside className="hidden lg:block">
            <div className="sticky top-28">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#797267]">{tieBreak ? `${tieBreak.category} tie-break` : "Your ballot"}</p>
              <ol className="mt-6 space-y-1">
                {["Verify identity", "Choose candidates", "Submit securely"].map((label, index) => {
                  const step = index + 1;
                  return (
                    <li key={label} className={`flex items-center gap-3 rounded-xl px-3 py-3 text-sm ${step === activeStep ? "bg-white/[0.05] text-[#f1ebdf]" : step < activeStep ? "text-[#aaa294]" : "text-[#68635b]"}`}>
                      <span className={`grid size-7 place-items-center rounded-full border text-xs ${step <= activeStep ? "border-[#b99a5f]/45 text-[#d0b276]" : "border-white/10"}`}>
                        {step < activeStep ? <Check className="size-3.5" aria-hidden="true" /> : step}
                      </span>
                      {label}
                    </li>
                  );
                })}
              </ol>
              <p className="mt-8 border-l border-[#b99a5f]/30 pl-4 text-xs leading-5 text-[#777064]">
                {tieBreak ? "Only HODs eligible in the original election may submit one vote in this tie-break." : "Your selections remain private and are submitted together as one ballot."}
              </p>
            </div>
          </aside>

          <div className="min-w-0">
            {pageState === "checking" ? <LoadingPage /> : null}

            {pageState === "unavailable" ? (
              <EmptyState title="Voting is currently unavailable." detail="There is no open election at this time. Please return when voting has been announced." />
            ) : null}

            {pageState === "tie-select" ? (
              <Card className="mx-auto max-w-2xl overflow-hidden">
                <div className="border-b border-white/[0.07] px-5 py-6 sm:px-8 sm:py-8">
                  <Badge>Active tie-breaks</Badge>
                  <h1 className="mt-4 font-serif text-3xl text-[#f7f1e6] sm:text-4xl">Choose a tie-break ballot</h1>
                  <p className="mt-3 text-sm leading-6 text-[#aaa295]">Each tie-break is a separate vote. Eligible HODs may vote once in each active round.</p>
                </div>
                <div className="space-y-3 p-5 sm:p-8">
                  {activeTieBreaks.map((item) => (
                    <button key={item.id} type="button" onClick={() => { setTieBreak(item); setPageState("verify"); setPageError(""); }} className="flex w-full items-center gap-4 rounded-2xl border border-white/[0.08] bg-[#1a1a18] p-4 text-left transition hover:border-[#b99a5f]/40 hover:bg-[#b99a5f]/[0.06] sm:p-5">
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#b99a5f]/10 text-[#d1b375]"><Scale aria-hidden="true" className="size-4" /></span>
                      <span className="min-w-0 flex-1"><span className="block truncate font-semibold text-[#f0e9df]">{item.originalElectionName}</span><span className="mt-1 block text-xs text-[#8f877a]">{item.category} · Round {item.roundNumber}</span></span>
                      <ArrowRight aria-hidden="true" className="size-4 shrink-0 text-[#8d8068]" />
                    </button>
                  ))}
                </div>
              </Card>
            ) : null}

            {pageState === "already-voted" ? (
              <EmptyState title="Your vote is already recorded." detail="A ballot has already been submitted for this election. For integrity and fairness, another submission is not permitted." />
            ) : null}

            {pageState === "success" ? (
              <Card className="mx-auto max-w-xl p-7 text-center sm:p-10">
                <div className="mx-auto flex size-14 items-center justify-center rounded-full border border-[#78977a]/35 bg-[#78977a]/10 text-[#a8c2a8]">
                  <CheckCircle2 aria-hidden="true" className="size-7" strokeWidth={1.6} />
                </div>
                <Badge tone="neutral"><span>Ballot submitted</span></Badge>
                <h1 className="mt-5 font-serif text-3xl text-[#f7f1e6] sm:text-4xl">Thank you for voting.</h1>
                <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-[#aaa295]">
                  {tieBreak ? `Your ${tieBreak.category} tie-break vote has been securely recorded.` : "Your FOH and BOH selections have been securely recorded. You may now close this page."}
                </p>
                {tieBreak && activeTieBreaks.length > 1 ? <Button variant="secondary" className="mt-6" onClick={() => { setTieBreak(null); setFohId(""); setBohId(""); setForm(initialForm); setPageState("tie-select"); }}>View other tie-breaks</Button> : null}
              </Card>
            ) : null}

            {pageState === "error" ? (
              <Card className="mx-auto max-w-xl p-6 sm:p-8">
                <Alert tone="error" title="We could not load the voting portal">{pageError}</Alert>
                <Button onClick={() => { setPageState("checking"); setPageError(""); void checkElection(); }} fullWidth className="mt-5">Try again</Button>
              </Card>
            ) : null}

            {pageState === "verify" ? (
              <Card className="mx-auto max-w-xl overflow-hidden">
                <div className="border-b border-white/[0.07] px-5 py-6 sm:px-8 sm:py-8">
                  <Badge>{tieBreak ? `${tieBreak.category} tie-break · Round ${tieBreak.roundNumber}` : "HOD voting"}</Badge>
                  <h1 className="mt-4 font-serif text-3xl leading-tight tracking-[-0.02em] text-[#f7f1e6] sm:text-4xl">Verify your identity</h1>
                  <p className="mt-3 text-sm leading-6 text-[#aaa295]">Enter the details registered for the original election to begin your ballot.</p>
                  {election || tieBreak ? <p className="mt-4 text-xs font-medium uppercase tracking-[0.14em] text-[#b99a5f]">{tieBreak?.originalElectionName ?? election?.name}</p> : null}
                </div>
                <form onSubmit={verifyHod} noValidate className="space-y-5 px-5 py-6 sm:px-8 sm:py-8">
                  {pageError ? <Alert tone="error" title="Verification unsuccessful">{pageError}</Alert> : null}
                  <Input
                    id="name"
                    label="Full name"
                    placeholder="As registered for this election"
                    autoComplete="name"
                    maxLength={160}
                    value={form.name}
                    error={errors.name}
                    onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                  />
                  <Input
                    id="mobileNumber"
                    label="Mobile number"
                    placeholder="e.g. +91 98765 43210"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    maxLength={40}
                    value={form.mobileNumber}
                    error={errors.mobileNumber}
                    onChange={(event) => setForm((current) => ({ ...current, mobileNumber: event.target.value }))}
                  />
                  <Select
                    id="department"
                    label="Department"
                    value={form.department}
                    error={errors.department}
                    onChange={(event) => setForm((current) => ({ ...current, department: event.target.value }))}
                  >
                    <option value="" disabled>Select your department</option>
                    {departments.map((department) => <option key={department} value={department}>{department}</option>)}
                  </Select>
                  {form.department === "Other" ? (
                    <Input
                      id="otherDepartment"
                      label="Department name"
                      placeholder="Enter your registered department"
                      maxLength={160}
                      value={form.otherDepartment}
                      error={errors.otherDepartment}
                      onChange={(event) => setForm((current) => ({ ...current, otherDepartment: event.target.value }))}
                    />
                  ) : null}
                  <Button type="submit" fullWidth disabled={isVerifying}>
                    {isVerifying ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : <ShieldCheck aria-hidden="true" className="size-4" />}
                    {isVerifying ? "Verifying…" : "Verify and continue"}
                  </Button>
                  <p className="flex items-start justify-center gap-2 text-center text-[11px] leading-5 text-[#756f65]">
                    <LockKeyhole aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                    Details are used only to verify voting eligibility.
                  </p>
                </form>
              </Card>
            ) : null}

            {pageState === "candidates" ? (
              <div className="mx-auto max-w-3xl animate-[fadeIn_.3s_ease-out]">
                <div className="mb-7">
                  <Badge>Verified ballot</Badge>
                  <h1 className="mt-4 font-serif text-3xl text-[#f7f1e6] sm:text-4xl">{tieBreak ? `Choose one ${tieBreak.category} candidate` : "Choose your candidates"}</h1>
                  <p className="mt-3 max-w-2xl text-sm leading-6 text-[#a59d90]">{tieBreak ? "Only the tied leaders from the original election appear below. Review your choice before submitting." : "Select exactly one Front of House and one Back of House candidate. You can review both choices before submitting."}</p>
                </div>

                {pageError ? <div className="mb-5"><Alert tone="error" title="Action needed">{pageError}</Alert></div> : null}

                {(!tieBreak || tieBreak.category === "FOH") ? <section aria-labelledby="foh-title" className={tieBreak ? "" : "mb-8"}>
                  <div className="mb-4 flex items-end justify-between gap-4">
                    <div>
                      <Badge>FOH</Badge>
                      <h2 id="foh-title" className="mt-2 font-serif text-2xl text-[#f4eee3]">Front of House</h2>
                    </div>
                    <span className="text-xs text-[#7e776c]">Choose one</span>
                  </div>
                  {isLoadingCandidates ? <CandidateSkeletons /> : fohCandidates.length ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {fohCandidates.map((candidate) => <CandidateCard key={candidate.id} candidate={candidate} checked={fohId === candidate.id} onChange={() => { setFohId(candidate.id); setPageError(""); }} />)}
                    </div>
                  ) : <Alert title="No FOH candidates available">Please contact the election administrator.</Alert>}
                </section> : null}

                {(!tieBreak || tieBreak.category === "BOH") ? <section aria-labelledby="boh-title">
                  <div className="mb-4 flex items-end justify-between gap-4">
                    <div>
                      <Badge>BOH</Badge>
                      <h2 id="boh-title" className="mt-2 font-serif text-2xl text-[#f4eee3]">Back of House</h2>
                    </div>
                    <span className="text-xs text-[#7e776c]">Choose one</span>
                  </div>
                  {isLoadingCandidates ? <CandidateSkeletons /> : bohCandidates.length ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {bohCandidates.map((candidate) => <CandidateCard key={candidate.id} candidate={candidate} checked={bohId === candidate.id} onChange={() => { setBohId(candidate.id); setPageError(""); }} />)}
                    </div>
                  ) : <Alert title="No BOH candidates available">Please contact the election administrator.</Alert>}
                </section> : null}

                <div className="mt-8 flex flex-col-reverse gap-3 border-t border-white/[0.07] pt-6 sm:flex-row sm:justify-between">
                  <Button variant="ghost" onClick={() => { setPageState("verify"); setFohId(""); setBohId(""); setPageError(""); }}>
                    <ArrowLeft aria-hidden="true" className="size-4" /> Back
                  </Button>
                  <Button onClick={requestConfirmation} disabled={isLoadingCandidates || (tieBreak ? !(tieBreak.category === "FOH" ? fohCandidates.length : bohCandidates.length) : (!fohCandidates.length || !bohCandidates.length))}>
                    Review ballot <ArrowRight aria-hidden="true" className="size-4" />
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </main>

      <footer className="border-t border-white/[0.06] px-4 py-6 text-center text-[11px] tracking-wide text-[#69635a]">
        Antilia internal election · Your ballot is confidential
      </footer>

      <Modal open={confirmationOpen} onClose={() => { if (!isSubmitting) setConfirmationOpen(false); }} title="Confirm your ballot">
        <p className="mt-3 text-sm leading-6 text-[#a49d90]">Review {tieBreak ? "your selection" : "both selections"} carefully. Your ballot cannot be changed after submission.</p>
        <div className="mt-6 space-y-3">
          {tieBreak ? (selectedTieBreakCandidate ? <SelectionSummary candidate={selectedTieBreakCandidate} /> : null) : <>{selectedFoh ? <SelectionSummary candidate={selectedFoh} /> : null}{selectedBoh ? <SelectionSummary candidate={selectedBoh} /> : null}</>}
        </div>
        <Alert title="Final submission" tone="info"><span>{tieBreak ? `This will record your one permitted vote in this ${tieBreak.category} tie-break.` : "This will record one FOH vote and one BOH vote together."}</span></Alert>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <Button variant="secondary" onClick={() => setConfirmationOpen(false)} disabled={isSubmitting}>Go back</Button>
          <Button onClick={() => void submitBallot()} disabled={isSubmitting}>
            {isSubmitting ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : <LockKeyhole aria-hidden="true" className="size-4" />}
            {isSubmitting ? "Submitting…" : "Submit ballot"}
          </Button>
        </div>
      </Modal>

      {toast ? <Toast message={toast} onDismiss={() => setToast("")} /> : null}
    </div>
  );
}
