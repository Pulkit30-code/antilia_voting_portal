"use client";

import {
  AlertTriangle,
  Check,
  ChevronDown,
  CircleOff,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  UserRoundCog,
  UsersRound,
  X,
} from "lucide-react";
import { useCallback, useDeferredValue, useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form-field";
import { Modal } from "@/components/ui/modal";
import { Skeleton } from "@/components/ui/surfaces";

type Hod = {
  id: string;
  name: string;
  mobileNumber: string;
  department: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

type HodFormValues = Pick<Hod, "name" | "mobileNumber" | "department">;
type FormErrors = Partial<Record<keyof HodFormValues | "form", string>>;
type StatusFilter = "all" | "active" | "inactive";
type ToastState = { id: number; message: string; tone: "success" | "error" };
type Confirmation = { action: "status" | "remove"; hod: Hod };

const EMPTY_FORM: HodFormValues = { name: "", mobileNumber: "", department: "" };
const MOBILE_DIGITS = /^\d{8,15}$/;

function normalizedMobile(value: string): string {
  return value.trim().replace(/^00/, "").replace(/[^0-9]/g, "");
}

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

function EmptyState({ filtered, onAdd, onReset }: { filtered: boolean; onAdd: () => void; onReset: () => void }) {
  return (
    <div className="flex min-h-72 flex-col items-center justify-center px-5 py-12 text-center">
      <span className="flex size-12 items-center justify-center rounded-xl border border-[#b99a5f]/20 bg-[#b99a5f]/10 text-[#c7a969]">
        {filtered ? <Search aria-hidden="true" className="size-5" /> : <UsersRound aria-hidden="true" className="size-5" />}
      </span>
      <h3 className="mt-5 font-serif text-xl text-[#eee8de]">{filtered ? "No matching HODs" : "No HODs yet"}</h3>
      <p className="mt-2 max-w-sm text-sm leading-6 text-[#8e867a]">
        {filtered ? "Try a different search or status filter." : "Add your first Head of Department to get started."}
      </p>
      <Button className="mt-6 min-h-11" variant={filtered ? "secondary" : "primary"} onClick={filtered ? onReset : onAdd}>
        {filtered ? "Clear filters" : <><Plus aria-hidden="true" className="size-4" /> Add HOD</>}
      </Button>
    </div>
  );
}

function LoadingState() {
  return (
    <div aria-label="Loading HODs" aria-busy="true" className="space-y-px">
      {[0, 1, 2, 3].map((row) => (
        <div key={row} className="grid gap-4 border-b border-white/[0.06] p-5 last:border-0 md:grid-cols-[1.25fr_1fr_1fr_100px_150px] md:items-center">
          <Skeleton className="h-5 w-36" />
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-7 w-20" />
          <Skeleton className="h-9 w-32" />
        </div>
      ))}
    </div>
  );
}

export function HodsManagement() {
  const router = useRouter();
  const [hods, setHods] = useState<Hod[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Hod | null>(null);
  const [values, setValues] = useState<HodFormValues>(EMPTY_FORM);
  const [errors, setErrors] = useState<FormErrors>({});
  const [saving, setSaving] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [acting, setActing] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);

  const notify = useCallback((message: string, tone: ToastState["tone"]) => {
    setToast({ id: Date.now(), message, tone });
  }, []);

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
    void fetch("/api/hods", { cache: "no-store", credentials: "same-origin" })
      .then(async (response) => {
        if (response.status === 401) {
          router.replace("/hr/login");
          return null;
        }
        if (!response.ok) throw new Error(await responseError(response, "Unable to load HODs."));
        const body = await response.json() as { hods?: Hod[] };
        if (!Array.isArray(body.hods)) throw new Error("The HOD list could not be read.");
        return body.hods;
      })
      .then((nextHods) => {
        if (!cancelled && nextHods) setHods(nextHods);
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : "Unable to load HODs.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey, router]);

  const filteredHods = useMemo(() => {
    const search = deferredQuery.trim().toLocaleLowerCase();
    return hods.filter((hod) => {
      const matchesStatus = filter === "all" || (filter === "active" ? hod.isActive : !hod.isActive);
      const matchesSearch = !search || [hod.name, hod.mobileNumber, hod.department].some((value) => value.toLocaleLowerCase().includes(search));
      return matchesStatus && matchesSearch;
    });
  }, [deferredQuery, filter, hods]);

  const openAdd = () => {
    setEditing(null);
    setValues(EMPTY_FORM);
    setErrors({});
    setFormOpen(true);
  };

  const openEdit = (hod: Hod) => {
    setEditing(hod);
    setValues({ name: hod.name, mobileNumber: hod.mobileNumber, department: hod.department });
    setErrors({});
    setFormOpen(true);
  };

  const closeForm = () => {
    if (saving) return;
    setFormOpen(false);
    setErrors({});
  };

  const updateField = (field: keyof HodFormValues, value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined, form: undefined }));
  };

  const validate = (): FormErrors => {
    const next: FormErrors = {};
    if (!values.name.trim()) next.name = "Name is required.";
    if (!values.mobileNumber.trim()) {
      next.mobileNumber = "Mobile number is required.";
    } else {
      const mobile = normalizedMobile(values.mobileNumber);
      if (!MOBILE_DIGITS.test(mobile)) {
        next.mobileNumber = "Enter a valid mobile number with 8 to 15 digits.";
      } else if (hods.some((hod) => hod.id !== editing?.id && normalizedMobile(hod.mobileNumber) === mobile)) {
        next.mobileNumber = "This mobile number is already assigned to another HOD.";
      }
    }
    if (!values.department.trim()) next.department = "Department is required.";
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
      const endpoint = editing ? `/api/hods/${editing.id}` : "/api/hods";
      const response = await fetch(endpoint, {
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
        const message = await responseError(response, `Unable to ${editing ? "update" : "add"} HOD.`);
        if (response.status === 409 && message.toLocaleLowerCase().includes("mobile")) {
          setErrors({ mobileNumber: "This mobile number is already assigned to another HOD." });
        } else {
          setErrors({ form: message });
        }
        return;
      }
      const body = await response.json() as { hod: Hod };
      setHods((current) => editing ? current.map((hod) => hod.id === body.hod.id ? body.hod : hod) : [body.hod, ...current]);
      setFormOpen(false);
      notify(editing ? "HOD updated successfully." : "HOD added successfully.", "success");
    } catch {
      setErrors({ form: "Unable to reach the server. Please try again." });
    } finally {
      setSaving(false);
    }
  };

  const runConfirmedAction = async () => {
    if (!confirmation) return;
    const { action, hod } = confirmation;
    setActing(true);
    try {
      const response = await fetch(action === "status" ? `/api/hods/${hod.id}/status` : `/api/hods/${hod.id}`, {
        method: action === "status" ? "PATCH" : "DELETE",
        credentials: "same-origin",
        headers: action === "status" ? { "Content-Type": "application/json" } : undefined,
        body: action === "status" ? JSON.stringify({ isActive: !hod.isActive }) : undefined,
      });
      if (response.status === 401) {
        router.replace("/hr/login");
        return;
      }
      if (!response.ok) throw new Error(await responseError(response, action === "remove" ? "Unable to remove HOD." : "Unable to update HOD status."));

      if (action === "remove") {
        setHods((current) => current.filter((item) => item.id !== hod.id));
        notify(`${hod.name} was removed.`, "success");
      } else {
        const body = await response.json() as { hod: Hod };
        setHods((current) => current.map((item) => item.id === body.hod.id ? body.hod : item));
        notify(`${hod.name} is now ${body.hod.isActive ? "active" : "inactive"}.`, "success");
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
    setFilter("all");
  };

  return (
    <div className="animate-[fadeIn_.35s_ease-out]">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#b99a5f]">Administration</p>
          <h2 className="mt-2 font-serif text-3xl leading-tight text-[#f6f0e7] sm:text-4xl">HOD management</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[#938b7f]">Manage Heads of Department and their access to Antilia elections.</p>
        </div>
        <Button className="shrink-0" onClick={openAdd}><Plus aria-hidden="true" className="size-4" /> Add HOD</Button>
      </div>

      <section aria-labelledby="hod-list-heading" className="mt-7 overflow-hidden rounded-2xl border border-white/[0.08] bg-[#181816]/92 shadow-[0_24px_80px_rgba(0,0,0,0.28)] sm:mt-8">
        <div className="flex flex-col gap-4 border-b border-white/[0.07] p-4 sm:p-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2.5">
              <UserRoundCog aria-hidden="true" className="size-4 text-[#b99a5f]" strokeWidth={1.7} />
              <h3 id="hod-list-heading" className="font-serif text-xl text-[#eee8de]">Heads of Department</h3>
            </div>
            <p className="mt-1.5 text-xs text-[#777064]">{hods.length} total · {hods.filter((hod) => hod.isActive).length} active</p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <label className="relative block sm:w-72">
              <span className="sr-only">Search HODs</span>
              <Search aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[#777064]" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, mobile or department" className="min-h-11 w-full rounded-xl border border-white/10 bg-[#11110f] py-2.5 pl-10 pr-4 text-sm text-[#f2ece2] outline-none transition placeholder:text-[#6f695f] focus:border-[#b99a5f]/60 focus:ring-4 focus:ring-[#b99a5f]/10" />
            </label>
            <label className="relative block sm:w-40">
              <span className="sr-only">Filter by status</span>
              <select value={filter} onChange={(event) => setFilter(event.target.value as StatusFilter)} className="min-h-11 w-full appearance-none rounded-xl border border-white/10 bg-[#11110f] px-3.5 pr-10 text-sm text-[#d8d1c5] outline-none transition focus:border-[#b99a5f]/60 focus:ring-4 focus:ring-[#b99a5f]/10">
                <option value="all">All statuses</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
              <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3.5 top-1/2 size-4 -translate-y-1/2 text-[#777064]" />
            </label>
          </div>
        </div>

        {loading ? <LoadingState /> : loadError ? (
          <div role="alert" className="flex min-h-72 flex-col items-center justify-center px-5 py-12 text-center">
            <span className="flex size-12 items-center justify-center rounded-xl border border-[#b85e50]/25 bg-[#b85e50]/10 text-[#e19a8c]"><AlertTriangle aria-hidden="true" className="size-5" /></span>
            <h3 className="mt-5 font-serif text-xl text-[#eee8de]">HODs could not be loaded</h3>
            <p className="mt-2 max-w-md text-sm leading-6 text-[#aa8d86]">{loadError}</p>
            <Button className="mt-6 min-h-11" variant="secondary" onClick={retryLoad}><RefreshCw aria-hidden="true" className="size-4" /> Try again</Button>
          </div>
        ) : filteredHods.length === 0 ? (
          <EmptyState filtered={Boolean(query.trim()) || filter !== "all"} onAdd={openAdd} onReset={resetFilters} />
        ) : (
          <>
            <div className="hidden md:block">
              <table className="w-full table-fixed text-left">
                <thead className="border-b border-white/[0.07] bg-white/[0.018] text-[9px] font-bold uppercase tracking-[0.17em] text-[#756e63]">
                  <tr><th className="w-[24%] px-5 py-3.5 lg:px-6">Name</th><th className="w-[20%] px-5 py-3.5">Mobile number</th><th className="w-[22%] px-5 py-3.5">Department</th><th className="w-[13%] px-5 py-3.5">Status</th><th className="w-[21%] px-5 py-3.5 text-right lg:px-6">Actions</th></tr>
                </thead>
                <tbody className="divide-y divide-white/[0.06]">
                  {filteredHods.map((hod) => (
                    <tr key={hod.id} className="transition hover:bg-white/[0.018]">
                      <td className="px-5 py-4 lg:px-6"><span className="block truncate text-sm font-semibold text-[#ece5da]">{hod.name}</span></td>
                      <td className="px-5 py-4 text-sm tabular-nums text-[#b0a89b]">{hod.mobileNumber}</td>
                      <td className="px-5 py-4"><span className="block truncate text-sm text-[#b0a89b]">{hod.department}</span></td>
                      <td className="px-5 py-4"><StatusBadge active={hod.isActive} /></td>
                      <td className="px-5 py-4 lg:px-6">
                        <div className="flex justify-end gap-1">
                          <button type="button" onClick={() => openEdit(hod)} aria-label={`Edit ${hod.name}`} title="Edit HOD" className="rounded-lg p-2.5 text-[#9b9387] transition hover:bg-white/[0.055] hover:text-[#eee7dc]"><Pencil aria-hidden="true" className="size-4" /></button>
                          <button type="button" onClick={() => setConfirmation({ action: "status", hod })} aria-label={`${hod.isActive ? "Deactivate" : "Activate"} ${hod.name}`} title={hod.isActive ? "Deactivate HOD" : "Activate HOD"} className={`rounded-lg p-2.5 transition hover:bg-white/[0.055] ${hod.isActive ? "text-[#9b9387] hover:text-[#e6c386]" : "text-[#7fa081] hover:text-[#abd0ad]"}`}>{hod.isActive ? <CircleOff aria-hidden="true" className="size-4" /> : <Check aria-hidden="true" className="size-4" />}</button>
                          <button type="button" onClick={() => setConfirmation({ action: "remove", hod })} aria-label={`Remove ${hod.name}`} title="Remove HOD" className="rounded-lg p-2.5 text-[#9b9387] transition hover:bg-[#b85e50]/10 hover:text-[#e49a8d]"><Trash2 aria-hidden="true" className="size-4" /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="divide-y divide-white/[0.07] md:hidden">
              {filteredHods.map((hod) => (
                <article key={hod.id} className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0"><h4 className="truncate text-base font-semibold text-[#eee7dc]">{hod.name}</h4><p className="mt-1 truncate text-sm text-[#9c9488]">{hod.department}</p></div>
                    <StatusBadge active={hod.isActive} />
                  </div>
                  <p className="mt-4 text-sm tabular-nums text-[#b9b1a5]">{hod.mobileNumber}</p>
                  <div className="mt-5 grid grid-cols-3 gap-2 border-t border-white/[0.07] pt-4">
                    <button type="button" onClick={() => openEdit(hod)} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-white/[0.04] text-xs font-semibold text-[#cbc3b7]"><Pencil aria-hidden="true" className="size-3.5" /> Edit</button>
                    <button type="button" onClick={() => setConfirmation({ action: "status", hod })} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-white/[0.04] px-1 text-xs font-semibold text-[#cbc3b7]">{hod.isActive ? <CircleOff aria-hidden="true" className="size-3.5" /> : <Check aria-hidden="true" className="size-3.5" />}{hod.isActive ? "Deactivate" : "Activate"}</button>
                    <button type="button" onClick={() => setConfirmation({ action: "remove", hod })} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#b85e50]/8 text-xs font-semibold text-[#cf8b80]"><Trash2 aria-hidden="true" className="size-3.5" /> Remove</button>
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
      </section>

      <Modal open={formOpen} onClose={closeForm} title={editing ? "Edit HOD" : "Add HOD"}>
        <form onSubmit={submitForm} noValidate className="mt-6 space-y-5">
          <Input id="hod-name" label="Name" value={values.name} onChange={(event) => updateField("name", event.target.value)} error={errors.name} placeholder="Enter full name" autoComplete="name" disabled={saving} maxLength={160} required autoFocus />
          <Input id="hod-mobile" label="Mobile number" type="tel" inputMode="tel" value={values.mobileNumber} onChange={(event) => updateField("mobileNumber", event.target.value)} error={errors.mobileNumber} hint="8 to 15 digits; country code is supported." placeholder="e.g. +91 98765 43210" autoComplete="tel" disabled={saving} required />
          <Input id="hod-department" label="Department" value={values.department} onChange={(event) => updateField("department", event.target.value)} error={errors.department} placeholder="e.g. Front Office" disabled={saving} maxLength={160} required />
          {errors.form ? <div role="alert" className="flex gap-2.5 rounded-xl border border-[#b85e50]/30 bg-[#b85e50]/10 p-3.5 text-sm leading-5 text-[#efb6ac]"><AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />{errors.form}</div> : null}
          <div className="flex flex-col-reverse gap-3 border-t border-white/[0.07] pt-5 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={closeForm} disabled={saving}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? <><LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> Saving…</> : editing ? "Save changes" : "Add HOD"}</Button>
          </div>
        </form>
      </Modal>

      <Modal open={Boolean(confirmation)} onClose={() => acting ? undefined : setConfirmation(null)} title={confirmation?.action === "remove" ? "Remove HOD?" : `${confirmation?.hod.isActive ? "Deactivate" : "Activate"} HOD?`}>
        {confirmation ? (
          <div className="mt-5">
            <p className="text-sm leading-6 text-[#aaa296]">{confirmation.action === "remove" ? <>Remove <strong className="font-semibold text-[#eee7dc]">{confirmation.hod.name}</strong>? This is only possible when the HOD is not protected by election history.</> : <><strong className="font-semibold text-[#eee7dc]">{confirmation.hod.name}</strong> will become {confirmation.hod.isActive ? "inactive and unable to participate in new elections" : "active and eligible for future elections"}.</>}</p>
            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <Button variant="ghost" onClick={() => setConfirmation(null)} disabled={acting}>Cancel</Button>
              <Button className={confirmation.action === "remove" ? "bg-[#a85246] text-white hover:bg-[#b85e50]" : ""} variant={confirmation.action === "remove" ? "secondary" : "primary"} onClick={() => void runConfirmedAction()} disabled={acting}>{acting ? <><LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> Working…</> : confirmation.action === "remove" ? "Remove HOD" : confirmation.hod.isActive ? "Deactivate" : "Activate"}</Button>
            </div>
          </div>
        ) : null}
      </Modal>

      {toast ? (
        <div key={toast.id} role={toast.tone === "error" ? "alert" : "status"} className={`fixed inset-x-4 bottom-5 z-50 mx-auto flex max-w-md items-center gap-3 rounded-xl border px-4 py-3 text-sm shadow-2xl animate-[rise_.25s_ease-out] ${toast.tone === "success" ? "border-[#78977a]/35 bg-[#20261f] text-[#d6e6d6]" : "border-[#b85e50]/35 bg-[#2a1f1c] text-[#f0c0b7]"}`}>
          {toast.tone === "success" ? <Check aria-hidden="true" className="size-4 shrink-0" /> : <AlertTriangle aria-hidden="true" className="size-4 shrink-0" />}
          <span className="flex-1">{toast.message}</span>
          <button type="button" aria-label="Dismiss notification" onClick={() => setToast(null)} className="rounded-lg p-1 opacity-70 hover:bg-white/5 hover:opacity-100"><X aria-hidden="true" className="size-4" /></button>
        </div>
      ) : null}
    </div>
  );
}
