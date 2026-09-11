"use client";

import {
  AlertTriangle,
  CalendarDays,
  Check,
  ChevronDown,
  Clock3,
  Eye,
  FileLock2,
  LoaderCircle,
  LockKeyhole,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  UsersRound,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";

import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form-field";
import { Modal } from "@/components/ui/modal";
import { Skeleton } from "@/components/ui/surfaces";

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

type Hod = { isActive: boolean };
type ElectionFormValues = { name: string; month: string; year: string };
type FormErrors = Partial<Record<keyof ElectionFormValues | "form", string>>;
type StatusFilter = "all" | ElectionStatus;
type ToastState = { id: number; message: string; tone: "success" | "error" };
type SnapshotNotice = { electionName: string; count: number };

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const currentDate = new Date();
const EMPTY_FORM: ElectionFormValues = {
  name: "",
  month: String(currentDate.getMonth() + 1),
  year: String(currentDate.getFullYear()),
};

async function responseError(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => null) as { error?: unknown } | null;
  return typeof body?.error === "string" ? body.error : fallback;
}

function formatDate(value: string | null): string {
  if (!value) return "Not yet";
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function monthName(month: number): string {
  return MONTHS[month - 1] ?? "Unknown";
}

function StatusBadge({ status }: { status: ElectionStatus }) {
  const palette = status === "DRAFT"
    ? "border-[#7f98ba]/30 bg-[#7f98ba]/10 text-[#b7c9e1]"
    : status === "OPEN"
      ? "border-[#78977a]/30 bg-[#78977a]/10 text-[#bcd5bd]"
      : "border-white/10 bg-white/[0.04] text-[#aaa296]";

  return (
    <span className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${palette}`}>
      <span aria-hidden="true" className={`size-1.5 rounded-full ${status === "DRAFT" ? "bg-[#8da7ca]" : status === "OPEN" ? "bg-[#8fb391]" : "bg-[#80786d]"}`} />
      {status}
    </span>
  );
}

function LoadingState() {
  return (
    <div aria-label="Loading elections" aria-busy="true" className="space-y-px">
      {[0, 1, 2, 3].map((row) => (
        <div key={row} className="grid gap-4 border-b border-white/[0.06] p-5 last:border-0 xl:grid-cols-[1.5fr_.75fr_.5fr_1fr_1fr_150px] xl:items-center">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-7 w-20" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-9 w-32" />
        </div>
      ))}
    </div>
  );
}

function EmptyState({ filtered, onCreate, onReset }: { filtered: boolean; onCreate: () => void; onReset: () => void }) {
  return (
    <div className="flex min-h-72 flex-col items-center justify-center px-5 py-12 text-center">
      <span className="flex size-12 items-center justify-center rounded-xl border border-[#b99a5f]/20 bg-[#b99a5f]/10 text-[#c7a969]">
        {filtered ? <Search aria-hidden="true" className="size-5" /> : <CalendarDays aria-hidden="true" className="size-5" />}
      </span>
      <h3 className="mt-5 font-serif text-xl text-[#eee8de]">{filtered ? "No matching elections" : "No elections yet"}</h3>
      <p className="mt-2 max-w-sm text-sm leading-6 text-[#8e867a]">
        {filtered ? "Try a different search, status, or year." : "Create the first monthly election. It will remain in DRAFT until SYSTEM opens it."}
      </p>
      {filtered ? (
        <Button className="mt-6 min-h-11" variant="secondary" onClick={onReset}>Clear filters</Button>
      ) : (
        <Button className="mt-6 min-h-11" onClick={onCreate}><Plus aria-hidden="true" className="size-4" /> Create election</Button>
      )}
    </div>
  );
}

export function ElectionsManagement() {
  const router = useRouter();
  const [elections, setElections] = useState<Election[]>([]);
  const [activeHodCount, setActiveHodCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [yearFilter, setYearFilter] = useState("all");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Election | null>(null);
  const [values, setValues] = useState<ElectionFormValues>(EMPTY_FORM);
  const [errors, setErrors] = useState<FormErrors>({});
  const [saving, setSaving] = useState(false);
  const [cancelling, setCancelling] = useState<Election | null>(null);
  const [acting, setActing] = useState(false);
  const [details, setDetails] = useState<Election | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [snapshotNotice, setSnapshotNotice] = useState<SnapshotNotice | null>(null);
  const [snapshotCounts, setSnapshotCounts] = useState<Record<string, number>>({});

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
    void Promise.all([
      fetch("/api/elections", { cache: "no-store", credentials: "same-origin" }),
      fetch("/api/hods", { cache: "no-store", credentials: "same-origin" }),
    ]).then(async ([electionResponse, hodResponse]) => {
      if (electionResponse.status === 401 || hodResponse.status === 401) {
        router.replace("/hr/login");
        return null;
      }
      if (!electionResponse.ok) throw new Error(await responseError(electionResponse, "Unable to load elections."));
      if (!hodResponse.ok) throw new Error(await responseError(hodResponse, "Unable to read the active HOD snapshot count."));
      const electionBody = await electionResponse.json() as { elections?: Election[] };
      const hodBody = await hodResponse.json() as { hods?: Hod[] };
      if (!Array.isArray(electionBody.elections)) throw new Error("The election list could not be read.");
      if (!Array.isArray(hodBody.hods)) throw new Error("The HOD list could not be read.");
      return {
        elections: electionBody.elections,
        activeHodCount: hodBody.hods.filter((hod) => hod.isActive).length,
      };
    }).then((data) => {
      if (!cancelled && data) {
        setElections(data.elections);
        setActiveHodCount(data.activeHodCount);
      }
    }).catch((error: unknown) => {
      if (!cancelled) setLoadError(error instanceof Error ? error.message : "Unable to load elections.");
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [reloadKey, router]);

  const years = useMemo(() => [...new Set(elections.map((election) => election.year))].sort((a, b) => b - a), [elections]);

  const filteredElections = useMemo(() => {
    const search = deferredQuery.trim().toLocaleLowerCase();
    return elections.filter((election) => {
      const matchesSearch = !search || [election.name, monthName(election.month), String(election.year), election.status]
        .some((value) => value.toLocaleLowerCase().includes(search));
      const matchesStatus = statusFilter === "all" || election.status === statusFilter;
      const matchesYear = yearFilter === "all" || election.year === Number(yearFilter);
      return matchesSearch && matchesStatus && matchesYear;
    });
  }, [deferredQuery, elections, statusFilter, yearFilter]);

  const retryLoad = () => {
    setLoading(true);
    setLoadError("");
    setReloadKey((current) => current + 1);
  };

  const openCreate = () => {
    setEditing(null);
    setValues(EMPTY_FORM);
    setErrors({});
    setFormOpen(true);
  };

  const openEdit = (election: Election) => {
    if (election.status !== "DRAFT") {
      notify(`${election.name} is locked because it is ${election.status}.`, "error");
      return;
    }
    setEditing(election);
    setValues({ name: election.name, month: String(election.month), year: String(election.year) });
    setErrors({});
    setFormOpen(true);
  };

  const closeForm = () => {
    if (saving) return;
    setFormOpen(false);
    setErrors({});
  };

  const updateField = (field: keyof ElectionFormValues, value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined, form: undefined }));
  };

  const validate = (): FormErrors => {
    const next: FormErrors = {};
    const month = Number(values.month);
    const year = Number(values.year);
    if (!values.name.trim()) next.name = "Name is required.";
    else if (values.name.trim().length > 200) next.name = "Name must be 200 characters or fewer.";
    if (!Number.isInteger(month) || month < 1 || month > 12) next.month = "Select a valid month.";
    if (!Number.isInteger(year) || year < 2000 || year > 2200) next.year = "Enter a year from 2000 to 2200.";
    if (!next.month && !next.year && elections.some((election) => election.id !== editing?.id && election.month === month && election.year === year)) {
      next.month = "An election already exists for this month and year.";
      next.year = "Choose a different month or year.";
    }
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
      let snapshotCount = activeHodCount;
      if (!editing) {
        const hodResponse = await fetch("/api/hods", { cache: "no-store", credentials: "same-origin" });
        if (hodResponse.status === 401) {
          router.replace("/hr/login");
          return;
        }
        if (!hodResponse.ok) throw new Error(await responseError(hodResponse, "Unable to confirm the HOD snapshot count."));
        const hodBody = await hodResponse.json() as { hods?: Hod[] };
        if (!Array.isArray(hodBody.hods)) throw new Error("The HOD list could not be read.");
        snapshotCount = hodBody.hods.filter((hod) => hod.isActive).length;
        setActiveHodCount(snapshotCount);
      }

      const response = await fetch(editing ? `/api/elections/${editing.id}` : "/api/elections", {
        method: editing ? "PATCH" : "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: values.name, month: Number(values.month), year: Number(values.year) }),
      });
      if (response.status === 401) {
        router.replace("/hr/login");
        return;
      }
      if (!response.ok) {
        const message = await responseError(response, `Unable to ${editing ? "update" : "create"} election.`);
        if (response.status === 409 && message.toLocaleLowerCase().includes("month")) {
          setErrors({ month: "An election already exists for this month and year.", year: "Choose a different month or year.", form: message });
        } else if (response.status === 409) {
          setErrors({ form: `${message} Refresh the page to see the latest status.` });
        } else {
          setErrors({ form: message });
        }
        return;
      }
      const body = await response.json() as { election?: Election };
      if (!body.election) throw new Error("The saved election could not be read.");
      const saved = body.election;
      setElections((current) => editing
        ? current.map((election) => election.id === saved.id ? saved : election)
        : [saved, ...current]);
      setFormOpen(false);
      if (editing) {
        notify("DRAFT election updated successfully.", "success");
      } else {
        const count = snapshotCount ?? 0;
        setSnapshotCounts((current) => ({ ...current, [saved.id]: count }));
        setSnapshotNotice({ electionName: saved.name, count });
        notify(`Election created in DRAFT with ${count} active HOD${count === 1 ? "" : "s"} copied to its snapshot.`, "success");
      }
    } catch (error) {
      setErrors({ form: error instanceof Error ? error.message : "Unable to reach the server. Please try again." });
    } finally {
      setSaving(false);
    }
  };

  const openDetails = async (election: Election) => {
    setDetails(election);
    setDetailsLoading(true);
    try {
      const response = await fetch(`/api/elections/${election.id}`, { cache: "no-store", credentials: "same-origin" });
      if (response.status === 401) {
        router.replace("/hr/login");
        return;
      }
      if (!response.ok) throw new Error(await responseError(response, "Unable to load election details."));
      const body = await response.json() as { election?: Election };
      if (!body.election) throw new Error("The election details could not be read.");
      setDetails(body.election);
      setElections((current) => current.map((item) => item.id === body.election!.id ? body.election! : item));
    } catch (error) {
      setDetails(null);
      notify(error instanceof Error ? error.message : "Unable to load election details.", "error");
    } finally {
      setDetailsLoading(false);
    }
  };

  const cancelElection = async () => {
    if (!cancelling || cancelling.status !== "DRAFT") return;
    setActing(true);
    try {
      const response = await fetch(`/api/elections/${cancelling.id}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (response.status === 401) {
        router.replace("/hr/login");
        return;
      }
      if (!response.ok) throw new Error(await responseError(response, "Unable to cancel election."));
      setElections((current) => current.filter((election) => election.id !== cancelling.id));
      notify(`${cancelling.name} was cancelled.`, "success");
      setCancelling(null);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unable to cancel election.", "error");
      setCancelling(null);
    } finally {
      setActing(false);
    }
  };

  const resetFilters = () => {
    setQuery("");
    setStatusFilter("all");
    setYearFilter("all");
  };

  return (
    <div className="animate-[fadeIn_.35s_ease-out]">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#b99a5f]">Administration</p>
          <h2 className="mt-2 font-serif text-3xl leading-tight text-[#f6f0e7] sm:text-4xl">Election management</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[#938b7f]">Create monthly election workspaces and manage their details while they are in DRAFT.</p>
        </div>
        <Button className="shrink-0" onClick={openCreate}><Plus aria-hidden="true" className="size-4" /> Create election</Button>
      </div>

      {snapshotNotice ? (
        <div role="status" className="mt-6 flex items-start gap-3 rounded-2xl border border-[#78977a]/30 bg-[#78977a]/10 p-4 text-[#d2e4d2]">
          <UsersRound aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">HOD voter snapshot created</p>
            <p className="mt-1 text-sm leading-6 text-[#a9bea9]">{snapshotNotice.count} active HOD{snapshotNotice.count === 1 ? " was" : "s were"} copied into {snapshotNotice.electionName}.</p>
          </div>
          <button type="button" aria-label="Dismiss snapshot notice" onClick={() => setSnapshotNotice(null)} className="rounded-lg p-1 text-[#9bb09b] hover:bg-white/5 hover:text-white"><X aria-hidden="true" className="size-4" /></button>
        </div>
      ) : null}

      <section aria-labelledby="election-list-heading" className="mt-7 overflow-hidden rounded-2xl border border-white/[0.08] bg-[#181816]/92 shadow-[0_24px_80px_rgba(0,0,0,0.28)] sm:mt-8">
        <div className="flex flex-col gap-4 border-b border-white/[0.07] p-4 sm:p-5 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="flex items-center gap-2.5"><CalendarDays aria-hidden="true" className="size-4 text-[#b99a5f]" strokeWidth={1.7} /><h3 id="election-list-heading" className="font-serif text-xl text-[#eee8de]">Monthly elections</h3></div>
            <p className="mt-1.5 text-xs text-[#777064]">{elections.length} total · {elections.filter((election) => election.status === "DRAFT").length} editable drafts</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:flex">
            <label className="relative block sm:col-span-2 xl:w-72">
              <span className="sr-only">Search elections</span>
              <Search aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[#777064]" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, month or year" className="min-h-11 w-full rounded-xl border border-white/10 bg-[#11110f] py-2.5 pl-10 pr-4 text-sm text-[#f2ece2] outline-none transition placeholder:text-[#6f695f] focus:border-[#b99a5f]/60 focus:ring-4 focus:ring-[#b99a5f]/10" />
            </label>
            <label className="relative block xl:w-40">
              <span className="sr-only">Filter by status</span>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)} className="min-h-11 w-full appearance-none rounded-xl border border-white/10 bg-[#11110f] px-3.5 pr-10 text-sm text-[#d8d1c5] outline-none focus:border-[#b99a5f]/60 focus:ring-4 focus:ring-[#b99a5f]/10"><option value="all">All statuses</option><option value="DRAFT">Draft</option><option value="OPEN">Open</option><option value="CLOSED">Closed</option></select>
              <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3.5 top-1/2 size-4 -translate-y-1/2 text-[#777064]" />
            </label>
            <label className="relative block xl:w-36">
              <span className="sr-only">Filter by year</span>
              <select value={yearFilter} onChange={(event) => setYearFilter(event.target.value)} className="min-h-11 w-full appearance-none rounded-xl border border-white/10 bg-[#11110f] px-3.5 pr-10 text-sm text-[#d8d1c5] outline-none focus:border-[#b99a5f]/60 focus:ring-4 focus:ring-[#b99a5f]/10"><option value="all">All years</option>{years.map((year) => <option key={year} value={year}>{year}</option>)}</select>
              <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3.5 top-1/2 size-4 -translate-y-1/2 text-[#777064]" />
            </label>
          </div>
        </div>

        {loading ? <LoadingState /> : loadError ? (
          <div role="alert" className="flex min-h-72 flex-col items-center justify-center px-5 py-12 text-center">
            <span className="flex size-12 items-center justify-center rounded-xl border border-[#b85e50]/25 bg-[#b85e50]/10 text-[#e19a8c]"><AlertTriangle aria-hidden="true" className="size-5" /></span>
            <h3 className="mt-5 font-serif text-xl text-[#eee8de]">Elections could not be loaded</h3>
            <p className="mt-2 max-w-md text-sm leading-6 text-[#aa8d86]">{loadError}</p>
            <Button className="mt-6 min-h-11" variant="secondary" onClick={retryLoad}><RefreshCw aria-hidden="true" className="size-4" /> Try again</Button>
          </div>
        ) : filteredElections.length === 0 ? (
          <EmptyState filtered={Boolean(query.trim()) || statusFilter !== "all" || yearFilter !== "all"} onCreate={openCreate} onReset={resetFilters} />
        ) : (
          <>
            <div className="hidden xl:block">
              <table className="w-full table-fixed text-left">
                <thead className="border-b border-white/[0.07] bg-white/[0.018] text-[9px] font-bold uppercase tracking-[0.15em] text-[#756e63]"><tr><th className="w-[23%] px-5 py-3.5">Name</th><th className="w-[11%] px-5 py-3.5">Period</th><th className="w-[10%] px-5 py-3.5">Status</th><th className="w-[18%] px-5 py-3.5">Opened</th><th className="w-[18%] px-5 py-3.5">Closed</th><th className="w-[20%] px-5 py-3.5 text-right">Actions</th></tr></thead>
                <tbody className="divide-y divide-white/[0.06]">{filteredElections.map((election) => {
                  const locked = election.status !== "DRAFT";
                  return <tr key={election.id} className="transition hover:bg-white/[0.018]">
                    <td className="px-5 py-4"><span className="block truncate text-sm font-semibold text-[#ece5da]">{election.name}</span>{locked ? <span className="mt-1 flex items-center gap-1 text-[10px] text-[#a99062]"><LockKeyhole aria-hidden="true" className="size-3" /> Locked</span> : <span className="mt-1 block text-[10px] text-[#718b73]">Editable</span>}</td>
                    <td className="px-5 py-4 text-sm text-[#b0a89b]">{monthName(election.month)} <span className="tabular-nums">{election.year}</span></td>
                    <td className="px-5 py-4"><StatusBadge status={election.status} /></td>
                    <td className="px-5 py-4 text-xs leading-5 text-[#a49c90]">{formatDate(election.openedAt)}</td>
                    <td className="px-5 py-4 text-xs leading-5 text-[#a49c90]">{formatDate(election.closedAt)}</td>
                    <td className="px-5 py-4"><div className="flex justify-end gap-1">
                      <button type="button" onClick={() => void openDetails(election)} aria-label={`View ${election.name}`} title="View election details" className="rounded-lg p-2.5 text-[#9b9387] transition hover:bg-white/[0.055] hover:text-[#eee7dc]"><Eye aria-hidden="true" className="size-4" /></button>
                      <button type="button" disabled={locked} onClick={() => openEdit(election)} aria-label={`Edit ${election.name}`} title={locked ? `Locked: election is ${election.status}` : "Edit DRAFT election"} className="rounded-lg p-2.5 text-[#9b9387] transition hover:bg-white/[0.055] hover:text-[#eee7dc] disabled:cursor-not-allowed disabled:opacity-30"><Pencil aria-hidden="true" className="size-4" /></button>
                      <button type="button" disabled={locked} onClick={() => setCancelling(election)} aria-label={`Cancel ${election.name}`} title={locked ? `Locked: election is ${election.status}` : "Cancel DRAFT election"} className="rounded-lg p-2.5 text-[#9b9387] transition hover:bg-[#b85e50]/10 hover:text-[#e49a8d] disabled:cursor-not-allowed disabled:opacity-30"><Trash2 aria-hidden="true" className="size-4" /></button>
                    </div></td>
                  </tr>;
                })}</tbody>
              </table>
            </div>

            <div className="divide-y divide-white/[0.07] xl:hidden">{filteredElections.map((election) => {
              const locked = election.status !== "DRAFT";
              return <article key={election.id} className="p-5">
                <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h4 className="truncate text-base font-semibold text-[#eee7dc]">{election.name}</h4><p className="mt-1 text-sm text-[#9c9488]">{monthName(election.month)} {election.year}</p></div><StatusBadge status={election.status} /></div>
                <dl className="mt-5 grid grid-cols-2 gap-3 rounded-xl border border-white/[0.06] bg-black/10 p-3.5"><div><dt className="text-[9px] font-bold uppercase tracking-[0.14em] text-[#70695f]">Opened</dt><dd className="mt-1.5 text-xs leading-5 text-[#aaa296]">{formatDate(election.openedAt)}</dd></div><div><dt className="text-[9px] font-bold uppercase tracking-[0.14em] text-[#70695f]">Closed</dt><dd className="mt-1.5 text-xs leading-5 text-[#aaa296]">{formatDate(election.closedAt)}</dd></div></dl>
                {locked ? <div className="mt-4 flex items-start gap-2 rounded-xl border border-[#b99a5f]/20 bg-[#b99a5f]/7 p-3 text-xs leading-5 text-[#b9a57c]"><LockKeyhole aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" /> Locked · OPEN and CLOSED elections cannot be edited or cancelled.</div> : null}
                <div className="mt-4 grid grid-cols-3 gap-2 border-t border-white/[0.07] pt-4">
                  <button type="button" onClick={() => void openDetails(election)} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-white/[0.04] text-xs font-semibold text-[#cbc3b7]"><Eye aria-hidden="true" className="size-3.5" /> View</button>
                  <button type="button" disabled={locked} onClick={() => openEdit(election)} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-white/[0.04] text-xs font-semibold text-[#cbc3b7] disabled:cursor-not-allowed disabled:opacity-30"><Pencil aria-hidden="true" className="size-3.5" /> Edit</button>
                  <button type="button" disabled={locked} onClick={() => setCancelling(election)} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#b85e50]/8 text-xs font-semibold text-[#cf8b80] disabled:cursor-not-allowed disabled:opacity-30"><Trash2 aria-hidden="true" className="size-3.5" /> Cancel</button>
                </div>
              </article>;
            })}</div>
          </>
        )}
      </section>

      <Modal open={formOpen} onClose={closeForm} title={editing ? "Edit DRAFT election" : "Create election"}>
        <form onSubmit={submitForm} noValidate className="mt-6 space-y-5">
          {!editing ? <div className="flex gap-3 rounded-xl border border-[#7f98ba]/25 bg-[#7f98ba]/8 p-3.5 text-sm leading-5 text-[#b8cae1]"><FileLock2 aria-hidden="true" className="mt-0.5 size-4 shrink-0" /><span>New elections always start as <strong className="font-semibold">DRAFT</strong>. {activeHodCount ?? 0} currently active HOD{activeHodCount === 1 ? "" : "s"} will be copied into the voter snapshot.</span></div> : null}
          <Input id="election-name" label="Election name" value={values.name} onChange={(event) => updateField("name", event.target.value)} error={errors.name} placeholder="e.g. September 2026 Best Employee" disabled={saving} maxLength={200} required autoFocus />
          <div className="grid gap-5 sm:grid-cols-2">
            <Select id="election-month" label="Month" value={values.month} onChange={(event) => updateField("month", event.target.value)} error={errors.month} disabled={saving} required>{MONTHS.map((month, index) => <option key={month} value={index + 1}>{month}</option>)}</Select>
            <Input id="election-year" label="Year" type="number" inputMode="numeric" min={2000} max={2200} step={1} value={values.year} onChange={(event) => updateField("year", event.target.value)} error={errors.year} disabled={saving} required />
          </div>
          {errors.form ? <div role="alert" className="flex gap-2.5 rounded-xl border border-[#b85e50]/30 bg-[#b85e50]/10 p-3.5 text-sm leading-5 text-[#efb6ac]"><AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />{errors.form}</div> : null}
          <div className="flex flex-col-reverse gap-3 border-t border-white/[0.07] pt-5 sm:flex-row sm:justify-end"><Button type="button" variant="ghost" onClick={closeForm} disabled={saving}>Cancel</Button><Button type="submit" disabled={saving}>{saving ? <><LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> Saving…</> : editing ? "Save changes" : "Create DRAFT election"}</Button></div>
        </form>
      </Modal>

      <Modal open={Boolean(details)} onClose={() => detailsLoading ? undefined : setDetails(null)} title="Election details">
        {details ? <div className="mt-6">
          <div className="flex items-start justify-between gap-4"><div><p className="font-serif text-xl text-[#eee8de]">{details.name}</p><p className="mt-1 text-sm text-[#8f877b]">{monthName(details.month)} {details.year}</p></div><StatusBadge status={details.status} /></div>
          {details.status !== "DRAFT" ? <div className="mt-5 flex gap-3 rounded-xl border border-[#b99a5f]/25 bg-[#b99a5f]/8 p-3.5 text-[#dfcfaf]"><LockKeyhole aria-hidden="true" className="mt-0.5 size-4 shrink-0" /><div><p className="text-sm font-semibold">Election locked</p><p className="mt-1 text-xs leading-5 text-[#a99b82]">This {details.status} election can be viewed, but HR details cannot be edited or cancelled.</p></div></div> : null}
          <dl className="mt-5 grid gap-px overflow-hidden rounded-xl border border-white/[0.07] bg-white/[0.07] sm:grid-cols-2">
            {[{ icon: CalendarDays, label: "Election period", value: `${monthName(details.month)} ${details.year}` }, { icon: ShieldCheck, label: "Status", value: details.status }, { icon: Clock3, label: "Opened at", value: formatDate(details.openedAt) }, { icon: Clock3, label: "Closed at", value: formatDate(details.closedAt) }].map((item) => <div key={item.label} className="bg-[#151513] p-4"><item.icon aria-hidden="true" className="size-4 text-[#857c6e]" /><dt className="mt-3 text-[9px] font-bold uppercase tracking-[0.14em] text-[#70695f]">{item.label}</dt><dd className="mt-1.5 text-sm text-[#cbc3b7]">{item.value}</dd></div>)}
          </dl>
          {snapshotCounts[details.id] !== undefined ? <div className="mt-4 flex items-center gap-3 rounded-xl border border-[#78977a]/25 bg-[#78977a]/8 p-3.5 text-sm text-[#bed2be]"><UsersRound aria-hidden="true" className="size-4" /> {snapshotCounts[details.id]} active HOD{snapshotCounts[details.id] === 1 ? "" : "s"} copied at creation</div> : null}
          <div className="mt-6 flex justify-end border-t border-white/[0.07] pt-5"><Button variant="secondary" onClick={() => setDetails(null)} disabled={detailsLoading}>{detailsLoading ? <><LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> Refreshing…</> : "Close"}</Button></div>
        </div> : null}
      </Modal>

      <Modal open={Boolean(cancelling)} onClose={() => acting ? undefined : setCancelling(null)} title="Cancel DRAFT election?">
        {cancelling ? <div className="mt-5"><p className="text-sm leading-6 text-[#aaa296]">Cancel <strong className="font-semibold text-[#eee7dc]">{cancelling.name}</strong>? It will be removed from this workspace and its month/year will become available again.</p><div className="mt-4 flex gap-2 rounded-xl border border-[#b85e50]/25 bg-[#b85e50]/8 p-3 text-xs leading-5 text-[#dca69c]"><AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" /> Only DRAFT elections can be cancelled. This does not add any SYSTEM controls.</div><div className="mt-6 flex flex-col-reverse gap-3 border-t border-white/[0.07] pt-5 sm:flex-row sm:justify-end"><Button variant="ghost" onClick={() => setCancelling(null)} disabled={acting}>Keep election</Button><Button className="bg-[#a85246] text-white hover:bg-[#b85e50]" variant="secondary" onClick={() => void cancelElection()} disabled={acting}>{acting ? <><LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> Cancelling…</> : "Cancel election"}</Button></div></div> : null}
      </Modal>

      {toast ? <div key={toast.id} role={toast.tone === "error" ? "alert" : "status"} className={`fixed inset-x-4 bottom-5 z-50 mx-auto flex max-w-md items-center gap-3 rounded-xl border px-4 py-3 text-sm shadow-2xl animate-[rise_.25s_ease-out] ${toast.tone === "success" ? "border-[#78977a]/35 bg-[#20261f] text-[#d6e6d6]" : "border-[#b85e50]/35 bg-[#2a1f1c] text-[#f0c0b7]"}`}>{toast.tone === "success" ? <Check aria-hidden="true" className="size-4 shrink-0" /> : <AlertTriangle aria-hidden="true" className="size-4 shrink-0" />}<span className="flex-1">{toast.message}</span><button type="button" aria-label="Dismiss notification" onClick={() => setToast(null)} className="rounded-lg p-1 opacity-70 hover:bg-white/5 hover:opacity-100"><X aria-hidden="true" className="size-4" /></button></div> : null}
    </div>
  );
}
