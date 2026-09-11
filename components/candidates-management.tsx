"use client";

import {
  AlertTriangle,
  Check,
  ChevronDown,
  CircleOff,
  LoaderCircle,
  LockKeyhole,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  UserRoundPlus,
  UsersRound,
  X,
} from "lucide-react";
import { useCallback, useDeferredValue, useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form-field";
import { Modal } from "@/components/ui/modal";
import { Skeleton } from "@/components/ui/surfaces";

type CandidateCategory = "FOH" | "BOH";
type ElectionStatus = "DRAFT" | "OPEN" | "CLOSED";

type Election = {
  id: string;
  name: string;
  month: number;
  year: number;
  status: ElectionStatus;
};

type Candidate = {
  id: string;
  electionId: string;
  name: string;
  department: string;
  category: CandidateCategory;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

type CandidateFormValues = Pick<Candidate, "name" | "department" | "category" | "electionId">;
type FormErrors = Partial<Record<keyof CandidateFormValues | "form", string>>;
type CategoryFilter = "all" | CandidateCategory;
type ToastState = { id: number; message: string; tone: "success" | "error" };
type Confirmation = { action: "status" | "remove"; candidate: Candidate };

const EMPTY_FORM: CandidateFormValues = { name: "", department: "", category: "FOH", electionId: "" };

async function responseError(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => null) as { error?: unknown } | null;
  return typeof body?.error === "string" ? body.error : fallback;
}

function StatusBadge({ active }: { active: boolean }) {
  return (
    <span className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${active ? "border-[#78977a]/30 bg-[#78977a]/10 text-[#bcd5bd]" : "border-white/10 bg-white/[0.04] text-[#938b7f]"}`}>
      <span aria-hidden="true" className={`size-1.5 rounded-full ${active ? "bg-[#8fb391]" : "bg-[#777064]"}`} />
      {active ? "Active" : "Inactive"}
    </span>
  );
}

function CategoryBadge({ category }: { category: CandidateCategory }) {
  return <span className={`inline-flex rounded-lg border px-2.5 py-1 text-[10px] font-bold tracking-[0.14em] ${category === "FOH" ? "border-[#7f98ba]/30 bg-[#7f98ba]/10 text-[#b7c9e1]" : "border-[#b99a5f]/30 bg-[#b99a5f]/10 text-[#d7ba7e]"}`}>{category}</span>;
}

function LoadingState() {
  return (
    <div aria-label="Loading candidates" aria-busy="true" className="space-y-px">
      {[0, 1, 2, 3].map((row) => (
        <div key={row} className="grid gap-4 border-b border-white/[0.06] p-5 last:border-0 lg:grid-cols-[1.1fr_1fr_70px_90px_1fr_140px] lg:items-center">
          <Skeleton className="h-5 w-36" /><Skeleton className="h-4 w-28" /><Skeleton className="h-7 w-14" /><Skeleton className="h-7 w-20" /><Skeleton className="h-4 w-32" /><Skeleton className="h-9 w-32" />
        </div>
      ))}
    </div>
  );
}

function EmptyState({ filtered, canAdd, onAdd, onReset }: { filtered: boolean; canAdd: boolean; onAdd: () => void; onReset: () => void }) {
  return (
    <div className="flex min-h-72 flex-col items-center justify-center px-5 py-12 text-center">
      <span className="flex size-12 items-center justify-center rounded-xl border border-[#b99a5f]/20 bg-[#b99a5f]/10 text-[#c7a969]">{filtered ? <Search aria-hidden="true" className="size-5" /> : <UsersRound aria-hidden="true" className="size-5" />}</span>
      <h3 className="mt-5 font-serif text-xl text-[#eee8de]">{filtered ? "No matching candidates" : "No candidates yet"}</h3>
      <p className="mt-2 max-w-sm text-sm leading-6 text-[#8e867a]">{filtered ? "Try a different search, category or election filter." : canAdd ? "Add the first candidate to a DRAFT election." : "Create a DRAFT election before adding candidates."}</p>
      {filtered ? <Button className="mt-6 min-h-11" variant="secondary" onClick={onReset}>Clear filters</Button> : canAdd ? <Button className="mt-6 min-h-11" onClick={onAdd}><Plus aria-hidden="true" className="size-4" /> Add candidate</Button> : null}
    </div>
  );
}

export function CandidatesManagement() {
  const router = useRouter();
  const [elections, setElections] = useState<Election[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [electionFilter, setElectionFilter] = useState("all");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Candidate | null>(null);
  const [values, setValues] = useState<CandidateFormValues>(EMPTY_FORM);
  const [errors, setErrors] = useState<FormErrors>({});
  const [saving, setSaving] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [acting, setActing] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);

  const electionById = useMemo(() => new Map(elections.map((election) => [election.id, election])), [elections]);
  const draftElections = useMemo(() => elections.filter((election) => election.status === "DRAFT"), [elections]);
  const selectedElection = electionFilter === "all" ? null : electionById.get(electionFilter) ?? null;
  const selectionLocked = selectedElection !== null && selectedElection.status !== "DRAFT";
  const canAdd = draftElections.length > 0 && !selectionLocked;

  const notify = useCallback((message: string, tone: ToastState["tone"]) => setToast({ id: Date.now(), message, tone }), []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const retryLoad = () => {
    setLoading(true);
    setLoadError("");
    setReloadKey((current) => current + 1);
  };

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
        const candidateGroups = await Promise.all(body.elections.map(async (election) => {
          const candidateResponse = await fetch(`/api/candidates?electionId=${encodeURIComponent(election.id)}`, { cache: "no-store", credentials: "same-origin" });
          if (candidateResponse.status === 401) {
            router.replace("/hr/login");
            return [];
          }
          if (!candidateResponse.ok) throw new Error(await responseError(candidateResponse, `Unable to load candidates for ${election.name}.`));
          const candidateBody = await candidateResponse.json() as { candidates?: Candidate[] };
          if (!Array.isArray(candidateBody.candidates)) throw new Error(`Candidates for ${election.name} could not be read.`);
          return candidateBody.candidates;
        }));
        return { elections: body.elections, candidates: candidateGroups.flat() };
      })
      .then((data) => {
        if (!cancelled && data) {
          setElections(data.elections);
          setCandidates(data.candidates);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : "Unable to load candidates.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [reloadKey, router]);

  const filteredCandidates = useMemo(() => {
    const search = deferredQuery.trim().toLocaleLowerCase();
    return candidates.filter((candidate) => {
      const election = electionById.get(candidate.electionId);
      const matchesSearch = !search || [candidate.name, candidate.department, candidate.category, election?.name ?? ""].some((value) => value.toLocaleLowerCase().includes(search));
      const matchesCategory = categoryFilter === "all" || candidate.category === categoryFilter;
      const matchesElection = electionFilter === "all" || candidate.electionId === electionFilter;
      return matchesSearch && matchesCategory && matchesElection;
    });
  }, [candidates, categoryFilter, deferredQuery, electionById, electionFilter]);

  const openAdd = () => {
    if (!canAdd) return;
    const defaultElection = selectedElection?.status === "DRAFT" ? selectedElection : draftElections[0];
    setEditing(null);
    setValues({ ...EMPTY_FORM, electionId: defaultElection?.id ?? "" });
    setErrors({});
    setFormOpen(true);
  };

  const openEdit = (candidate: Candidate) => {
    const election = electionById.get(candidate.electionId);
    if (!election || election.status !== "DRAFT") {
      notify("Candidate changes are locked because this election is not in DRAFT.", "error");
      return;
    }
    setEditing(candidate);
    setValues({ name: candidate.name, department: candidate.department, category: candidate.category, electionId: candidate.electionId });
    setErrors({});
    setFormOpen(true);
  };

  const closeForm = () => {
    if (saving) return;
    setFormOpen(false);
    setErrors({});
  };

  const updateField = (field: keyof CandidateFormValues, value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined, form: undefined }));
  };

  const validate = (): FormErrors => {
    const next: FormErrors = {};
    if (!values.name.trim()) next.name = "Name is required.";
    if (!values.department.trim()) next.department = "Department is required.";
    if (values.category !== "FOH" && values.category !== "BOH") next.category = "Select FOH or BOH.";
    const election = electionById.get(values.electionId);
    if (!election) next.electionId = "Select an election.";
    else if (election.status !== "DRAFT") next.electionId = "Candidate changes require a DRAFT election.";
    return next;
  };

  const submitForm = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const validationErrors = validate();
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }
    setSaving(true);
    setErrors({});
    try {
      const response = await fetch(editing ? `/api/candidates/${editing.id}` : "/api/candidates", {
        method: editing ? "PATCH" : "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      if (response.status === 401) {
        router.replace("/hr/login");
        return;
      }
      if (!response.ok) {
        const message = await responseError(response, `Unable to ${editing ? "update" : "add"} candidate.`);
        setErrors(response.status === 409 && message.toLocaleLowerCase().includes("draft") ? { electionId: message, form: "This election is locked. Refresh to see its latest status." } : { form: message });
        return;
      }
      const body = await response.json() as { candidate: Candidate };
      setCandidates((current) => editing ? current.map((candidate) => candidate.id === body.candidate.id ? body.candidate : candidate) : [body.candidate, ...current]);
      setFormOpen(false);
      notify(editing ? "Candidate updated successfully." : "Candidate added successfully.", "success");
    } catch {
      setErrors({ form: "Unable to reach the server. Please try again." });
    } finally {
      setSaving(false);
    }
  };

  const requestAction = (action: Confirmation["action"], candidate: Candidate) => {
    const election = electionById.get(candidate.electionId);
    if (!election || election.status !== "DRAFT") {
      notify("Candidate changes are locked because this election is not in DRAFT.", "error");
      return;
    }
    setConfirmation({ action, candidate });
  };

  const runConfirmedAction = async () => {
    if (!confirmation) return;
    const { action, candidate } = confirmation;
    setActing(true);
    try {
      const endpoint = action === "status" ? `/api/candidates/${candidate.id}/status` : `/api/candidates/${candidate.id}?electionId=${encodeURIComponent(candidate.electionId)}`;
      const response = await fetch(endpoint, {
        method: action === "status" ? "PATCH" : "DELETE",
        credentials: "same-origin",
        headers: action === "status" ? { "Content-Type": "application/json" } : undefined,
        body: action === "status" ? JSON.stringify({ electionId: candidate.electionId, isActive: !candidate.isActive }) : undefined,
      });
      if (response.status === 401) {
        router.replace("/hr/login");
        return;
      }
      if (!response.ok) throw new Error(await responseError(response, action === "remove" ? "Unable to remove candidate." : "Unable to update candidate status."));
      if (action === "remove") {
        setCandidates((current) => current.filter((item) => item.id !== candidate.id));
        notify(`${candidate.name} was removed.`, "success");
      } else {
        const body = await response.json() as { candidate: Candidate };
        setCandidates((current) => current.map((item) => item.id === body.candidate.id ? body.candidate : item));
        notify(`${candidate.name} is now ${body.candidate.isActive ? "active" : "inactive"}.`, "success");
      }
      setConfirmation(null);
    } catch (error) {
      notify(error instanceof Error ? error.message : "The action could not be completed.", "error");
      setConfirmation(null);
    } finally {
      setActing(false);
    }
  };

  const resetFilters = () => {
    setQuery("");
    setCategoryFilter("all");
    setElectionFilter("all");
  };

  return (
    <div className="animate-[fadeIn_.35s_ease-out]">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#b99a5f]">Administration</p>
          <h2 className="mt-2 font-serif text-3xl leading-tight text-[#f6f0e7] sm:text-4xl">Candidate management</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[#938b7f]">Configure FOH and BOH candidates while an election is in DRAFT.</p>
        </div>
        <Button className="shrink-0" onClick={openAdd} disabled={!canAdd} title={selectionLocked ? "Selected election is locked" : draftElections.length === 0 ? "A DRAFT election is required" : undefined}><Plus aria-hidden="true" className="size-4" /> Add candidate</Button>
      </div>

      {selectionLocked ? (
        <div role="status" className="mt-6 flex gap-3 rounded-2xl border border-[#b99a5f]/25 bg-[#b99a5f]/8 p-4 text-[#dfcfaf]">
          <LockKeyhole aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <div><p className="text-sm font-semibold">Candidate changes are locked</p><p className="mt-1 text-sm leading-6 text-[#a99b82]">{selectedElection.name} is {selectedElection.status}. Candidates can only be added, edited, activated, deactivated or removed while an election is DRAFT.</p></div>
        </div>
      ) : null}

      <section aria-labelledby="candidate-list-heading" className="mt-7 overflow-hidden rounded-2xl border border-white/[0.08] bg-[#181816]/92 shadow-[0_24px_80px_rgba(0,0,0,0.28)] sm:mt-8">
        <div className="flex flex-col gap-4 border-b border-white/[0.07] p-4 sm:p-5 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="flex items-center gap-2.5"><UserRoundPlus aria-hidden="true" className="size-4 text-[#b99a5f]" strokeWidth={1.7} /><h3 id="candidate-list-heading" className="font-serif text-xl text-[#eee8de]">Candidates</h3></div>
            <p className="mt-1.5 text-xs text-[#777064]">{candidates.length} total · {candidates.filter((candidate) => candidate.isActive).length} active</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:flex">
            <label className="relative block sm:col-span-2 xl:w-72"><span className="sr-only">Search candidates</span><Search aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[#777064]" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name or department" className="min-h-11 w-full rounded-xl border border-white/10 bg-[#11110f] py-2.5 pl-10 pr-4 text-sm text-[#f2ece2] outline-none transition placeholder:text-[#6f695f] focus:border-[#b99a5f]/60 focus:ring-4 focus:ring-[#b99a5f]/10" /></label>
            <label className="relative block xl:w-36"><span className="sr-only">Filter by category</span><select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value as CategoryFilter)} className="min-h-11 w-full appearance-none rounded-xl border border-white/10 bg-[#11110f] px-3.5 pr-10 text-sm text-[#d8d1c5] outline-none focus:border-[#b99a5f]/60 focus:ring-4 focus:ring-[#b99a5f]/10"><option value="all">All categories</option><option value="FOH">FOH</option><option value="BOH">BOH</option></select><ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3.5 top-1/2 size-4 -translate-y-1/2 text-[#777064]" /></label>
            <label className="relative block xl:w-56"><span className="sr-only">Filter by election</span><select value={electionFilter} onChange={(event) => setElectionFilter(event.target.value)} className="min-h-11 w-full appearance-none rounded-xl border border-white/10 bg-[#11110f] px-3.5 pr-10 text-sm text-[#d8d1c5] outline-none focus:border-[#b99a5f]/60 focus:ring-4 focus:ring-[#b99a5f]/10"><option value="all">All elections</option>{elections.map((election) => <option key={election.id} value={election.id}>{election.name} · {election.status}</option>)}</select><ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3.5 top-1/2 size-4 -translate-y-1/2 text-[#777064]" /></label>
          </div>
        </div>

        {loading ? <LoadingState /> : loadError ? (
          <div role="alert" className="flex min-h-72 flex-col items-center justify-center px-5 py-12 text-center"><span className="flex size-12 items-center justify-center rounded-xl border border-[#b85e50]/25 bg-[#b85e50]/10 text-[#e19a8c]"><AlertTriangle aria-hidden="true" className="size-5" /></span><h3 className="mt-5 font-serif text-xl text-[#eee8de]">Candidates could not be loaded</h3><p className="mt-2 max-w-md text-sm leading-6 text-[#aa8d86]">{loadError}</p><Button className="mt-6 min-h-11" variant="secondary" onClick={retryLoad}><RefreshCw aria-hidden="true" className="size-4" /> Try again</Button></div>
        ) : filteredCandidates.length === 0 ? (
          <EmptyState filtered={Boolean(query.trim()) || categoryFilter !== "all" || electionFilter !== "all"} canAdd={canAdd} onAdd={openAdd} onReset={resetFilters} />
        ) : (
          <>
            <div className="hidden lg:block">
              <table className="w-full table-fixed text-left">
                <thead className="border-b border-white/[0.07] bg-white/[0.018] text-[9px] font-bold uppercase tracking-[0.16em] text-[#756e63]"><tr><th className="w-[18%] px-5 py-3.5">Name</th><th className="w-[17%] px-5 py-3.5">Department</th><th className="w-[9%] px-5 py-3.5">Category</th><th className="w-[12%] px-5 py-3.5">Status</th><th className="w-[25%] px-5 py-3.5">Election</th><th className="w-[19%] px-5 py-3.5 text-right">Actions</th></tr></thead>
                <tbody className="divide-y divide-white/[0.06]">{filteredCandidates.map((candidate) => {
                  const election = electionById.get(candidate.electionId);
                  const locked = election?.status !== "DRAFT";
                  return <tr key={candidate.id} className="transition hover:bg-white/[0.018]"><td className="px-5 py-4"><span className="block truncate text-sm font-semibold text-[#ece5da]">{candidate.name}</span></td><td className="px-5 py-4"><span className="block truncate text-sm text-[#b0a89b]">{candidate.department}</span></td><td className="px-5 py-4"><CategoryBadge category={candidate.category} /></td><td className="px-5 py-4"><StatusBadge active={candidate.isActive} /></td><td className="px-5 py-4"><span className="block truncate text-sm text-[#b0a89b]">{election?.name ?? "Unknown election"}</span><span className={`mt-1 block text-[9px] font-bold uppercase tracking-[0.12em] ${locked ? "text-[#a99062]" : "text-[#788f79]"}`}>{election?.status ?? "Unavailable"}</span></td><td className="px-5 py-4"><div className="flex justify-end gap-1">
                    <button type="button" disabled={locked} onClick={() => openEdit(candidate)} aria-label={`Edit ${candidate.name}`} title={locked ? "Locked: election is not DRAFT" : "Edit candidate"} className="rounded-lg p-2.5 text-[#9b9387] transition hover:bg-white/[0.055] hover:text-[#eee7dc] disabled:cursor-not-allowed disabled:opacity-35"><Pencil aria-hidden="true" className="size-4" /></button>
                    <button type="button" disabled={locked} onClick={() => requestAction("status", candidate)} aria-label={`${candidate.isActive ? "Deactivate" : "Activate"} ${candidate.name}`} title={locked ? "Locked: election is not DRAFT" : candidate.isActive ? "Deactivate candidate" : "Activate candidate"} className="rounded-lg p-2.5 text-[#9b9387] transition hover:bg-white/[0.055] hover:text-[#e6c386] disabled:cursor-not-allowed disabled:opacity-35">{candidate.isActive ? <CircleOff aria-hidden="true" className="size-4" /> : <Check aria-hidden="true" className="size-4" />}</button>
                    <button type="button" disabled={locked} onClick={() => requestAction("remove", candidate)} aria-label={`Remove ${candidate.name}`} title={locked ? "Locked: election is not DRAFT" : "Remove candidate"} className="rounded-lg p-2.5 text-[#9b9387] transition hover:bg-[#b85e50]/10 hover:text-[#e49a8d] disabled:cursor-not-allowed disabled:opacity-35"><Trash2 aria-hidden="true" className="size-4" /></button>
                  </div></td></tr>;
                })}</tbody>
              </table>
            </div>

            <div className="divide-y divide-white/[0.07] lg:hidden">{filteredCandidates.map((candidate) => {
              const election = electionById.get(candidate.electionId);
              const locked = election?.status !== "DRAFT";
              return <article key={candidate.id} className="p-5"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><h4 className="truncate text-base font-semibold text-[#eee7dc]">{candidate.name}</h4><p className="mt-1 truncate text-sm text-[#9c9488]">{candidate.department}</p></div><StatusBadge active={candidate.isActive} /></div><div className="mt-4 flex items-center gap-2"><CategoryBadge category={candidate.category} /><span className="truncate text-xs text-[#90887b]">{election?.name ?? "Unknown election"}</span>{locked ? <LockKeyhole aria-label="Election locked" className="size-3.5 shrink-0 text-[#a99062]" /> : null}</div><div className="mt-5 grid grid-cols-3 gap-2 border-t border-white/[0.07] pt-4">
                <button type="button" disabled={locked} onClick={() => openEdit(candidate)} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-white/[0.04] text-xs font-semibold text-[#cbc3b7] disabled:cursor-not-allowed disabled:opacity-35"><Pencil aria-hidden="true" className="size-3.5" /> Edit</button>
                <button type="button" disabled={locked} onClick={() => requestAction("status", candidate)} className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-white/[0.04] px-1 text-xs font-semibold text-[#cbc3b7] disabled:cursor-not-allowed disabled:opacity-35">{candidate.isActive ? <CircleOff aria-hidden="true" className="size-3.5" /> : <Check aria-hidden="true" className="size-3.5" />}{candidate.isActive ? "Deactivate" : "Activate"}</button>
                <button type="button" disabled={locked} onClick={() => requestAction("remove", candidate)} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#b85e50]/8 text-xs font-semibold text-[#cf8b80] disabled:cursor-not-allowed disabled:opacity-35"><Trash2 aria-hidden="true" className="size-3.5" /> Remove</button>
              </div>{locked ? <p className="mt-3 text-xs text-[#a99062]">Locked · Election is {election?.status ?? "unavailable"}</p> : null}</article>;
            })}</div>
          </>
        )}
      </section>

      <Modal open={formOpen} onClose={closeForm} title={editing ? "Edit candidate" : "Add candidate"}>
        <form onSubmit={submitForm} noValidate className="mt-6 space-y-5">
          <Input id="candidate-name" label="Name" value={values.name} onChange={(event) => updateField("name", event.target.value)} error={errors.name} placeholder="Enter full name" autoComplete="name" disabled={saving} maxLength={160} required autoFocus />
          <Input id="candidate-department" label="Department" value={values.department} onChange={(event) => updateField("department", event.target.value)} error={errors.department} placeholder="e.g. Front Office" disabled={saving} maxLength={160} required />
          <Select id="candidate-category" label="Category" value={values.category} onChange={(event) => updateField("category", event.target.value)} error={errors.category} disabled={saving} required><option value="FOH">FOH · Front of House</option><option value="BOH">BOH · Back of House</option></Select>
          <Select id="candidate-election" label="Election" value={values.electionId} onChange={(event) => updateField("electionId", event.target.value)} error={errors.electionId} hint={editing ? "A candidate cannot be moved to another election." : "Only DRAFT elections accept candidate changes."} disabled={saving || Boolean(editing)} required><option value="">Select an election</option>{draftElections.map((election) => <option key={election.id} value={election.id}>{election.name} · DRAFT</option>)}</Select>
          {errors.form ? <div role="alert" className="flex gap-2.5 rounded-xl border border-[#b85e50]/30 bg-[#b85e50]/10 p-3.5 text-sm leading-5 text-[#efb6ac]"><AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />{errors.form}</div> : null}
          <div className="flex flex-col-reverse gap-3 border-t border-white/[0.07] pt-5 sm:flex-row sm:justify-end"><Button type="button" variant="ghost" onClick={closeForm} disabled={saving}>Cancel</Button><Button type="submit" disabled={saving}>{saving ? <><LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> Saving…</> : editing ? "Save changes" : "Add candidate"}</Button></div>
        </form>
      </Modal>

      <Modal open={Boolean(confirmation)} onClose={() => acting ? undefined : setConfirmation(null)} title={confirmation?.action === "remove" ? "Remove candidate?" : `${confirmation?.candidate.isActive ? "Deactivate" : "Activate"} candidate?`}>
        {confirmation ? <div className="mt-5"><p className="text-sm leading-6 text-[#aaa296]">{confirmation.action === "remove" ? <>Remove <strong className="font-semibold text-[#eee7dc]">{confirmation.candidate.name}</strong> from this DRAFT election?</> : <><strong className="font-semibold text-[#eee7dc]">{confirmation.candidate.name}</strong> will become {confirmation.candidate.isActive ? "inactive" : "active"} for this election.</>}</p><div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end"><Button variant="ghost" onClick={() => setConfirmation(null)} disabled={acting}>Cancel</Button><Button className={confirmation.action === "remove" ? "bg-[#a85246] text-white hover:bg-[#b85e50]" : ""} variant={confirmation.action === "remove" ? "secondary" : "primary"} onClick={() => void runConfirmedAction()} disabled={acting}>{acting ? <><LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> Working…</> : confirmation.action === "remove" ? "Remove candidate" : confirmation.candidate.isActive ? "Deactivate" : "Activate"}</Button></div></div> : null}
      </Modal>

      {toast ? <div key={toast.id} role={toast.tone === "error" ? "alert" : "status"} className={`fixed inset-x-4 bottom-5 z-50 mx-auto flex max-w-md items-center gap-3 rounded-xl border px-4 py-3 text-sm shadow-2xl animate-[rise_.25s_ease-out] ${toast.tone === "success" ? "border-[#78977a]/35 bg-[#20261f] text-[#d6e6d6]" : "border-[#b85e50]/35 bg-[#2a1f1c] text-[#f0c0b7]"}`}>{toast.tone === "success" ? <Check aria-hidden="true" className="size-4 shrink-0" /> : <AlertTriangle aria-hidden="true" className="size-4 shrink-0" />}<span className="flex-1">{toast.message}</span><button type="button" aria-label="Dismiss notification" onClick={() => setToast(null)} className="rounded-lg p-1 opacity-70 hover:bg-white/5 hover:opacity-100"><X aria-hidden="true" className="size-4" /></button></div> : null}
    </div>
  );
}
