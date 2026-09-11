"use client";

import {
  AlertCircle,
  CheckCircle2,
  Crown,
  Gauge,
  KeyRound,
  LoaderCircle,
  Settings,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { FormEvent, useState } from "react";

import { AdminLogoutButton } from "@/components/admin-logout-button";

type Role = "HR" | "SYSTEM";
type FormState = {
  currentSystemPasscode: string;
  newPasscode: string;
  confirmation: string;
};

const emptyForm: FormState = {
  currentSystemPasscode: "",
  newPasscode: "",
  confirmation: "",
};

async function responseError(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as
    | { error?: unknown }
    | null;
  return typeof body?.error === "string"
    ? body.error
    : "Unable to change the passcode.";
}

function PasscodeCard({ role }: { role: Role }) {
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  function update(field: keyof FormState, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");
    if (form.newPasscode !== form.confirmation) {
      setError("New passcode and confirmation do not match.");
      setForm(emptyForm);
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch(`/api/auth/passcodes/${role.toLowerCase()}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          newPasscode: form.newPasscode,
          ...(role === "SYSTEM"
            ? { currentSystemPasscode: form.currentSystemPasscode }
            : {}),
        }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      setSuccess(
        role === "HR"
          ? "HR passcode changed. All active HR sessions were signed out."
          : "SYSTEM passcode changed. Other SYSTEM sessions were signed out.",
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to change the passcode.",
      );
    } finally {
      setForm(emptyForm);
      setSubmitting(false);
    }
  }

  return (
    <section className="rounded-2xl border border-white/[0.08] bg-[#181816] p-5 shadow-[0_24px_70px_rgba(0,0,0,.2)] sm:p-7">
      <div className="flex items-start gap-4">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-[#b99a5f]/20 bg-[#b99a5f]/10 text-[#d2b574]">
          <KeyRound aria-hidden="true" className="size-5" />
        </span>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.19em] text-[#b99a5f]">{role} credentials</p>
          <h2 className="mt-1.5 font-serif text-2xl text-[#eee8de]">Change {role} passcode</h2>
          <p className="mt-2 text-sm leading-6 text-[#8e867a]">
            {role === "HR"
              ? "This immediately signs out every active HR session."
              : "Confirm the current SYSTEM passcode. Your session remains active; all other SYSTEM sessions are revoked."}
          </p>
        </div>
      </div>

      <form className="mt-6 space-y-4" onSubmit={submit}>
        {role === "SYSTEM" ? (
          <label className="block">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.13em] text-[#9a9286]">Current SYSTEM passcode</span>
            <input type="password" autoComplete="current-password" required maxLength={256} value={form.currentSystemPasscode} onChange={(event) => update("currentSystemPasscode", event.target.value)} className="min-h-12 w-full rounded-xl border border-white/10 bg-black/20 px-4 text-sm text-[#f5efe5] outline-none transition focus:border-[#b99a5f]/60 focus:ring-4 focus:ring-[#b99a5f]/10" />
          </label>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.13em] text-[#9a9286]">New passcode</span>
            <input type="password" autoComplete="new-password" required minLength={8} maxLength={256} value={form.newPasscode} onChange={(event) => update("newPasscode", event.target.value)} className="min-h-12 w-full rounded-xl border border-white/10 bg-black/20 px-4 text-sm text-[#f5efe5] outline-none transition focus:border-[#b99a5f]/60 focus:ring-4 focus:ring-[#b99a5f]/10" />
          </label>
          <label className="block">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.13em] text-[#9a9286]">Confirm new passcode</span>
            <input type="password" autoComplete="new-password" required minLength={8} maxLength={256} value={form.confirmation} onChange={(event) => update("confirmation", event.target.value)} className="min-h-12 w-full rounded-xl border border-white/10 bg-black/20 px-4 text-sm text-[#f5efe5] outline-none transition focus:border-[#b99a5f]/60 focus:ring-4 focus:ring-[#b99a5f]/10" />
          </label>
        </div>

        {error ? <p role="alert" className="flex gap-2 rounded-xl border border-[#b85e50]/25 bg-[#b85e50]/10 px-4 py-3 text-sm text-[#f0beb5]"><AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />{error}</p> : null}
        {success ? <p role="status" className="flex gap-2 rounded-xl border border-[#78977a]/30 bg-[#78977a]/10 px-4 py-3 text-sm text-[#d4e5d3]"><CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 shrink-0" />{success}</p> : null}

        <button type="submit" disabled={submitting} className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#b99a5f] px-5 py-3 text-sm font-semibold text-[#15130f] transition hover:bg-[#c8a96b] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d3b87d] disabled:cursor-wait disabled:opacity-65">
          {submitting ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : <ShieldCheck aria-hidden="true" className="size-4" />}
          {submitting ? "Updating…" : `Change ${role} passcode`}
        </button>
      </form>
    </section>
  );
}

export function SystemSettingsPanel() {
  return (
    <div className="min-h-screen bg-[#10100f] text-[#f5efe5]">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-white/[0.07] bg-[#141412] lg:flex">
        <div className="flex h-[76px] items-center border-b border-white/[0.07] px-6">
          <Link href="/system" className="flex items-center gap-3 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#b99a5f]">
            <span className="flex size-10 items-center justify-center rounded-xl border border-[#b99a5f]/30 bg-[#b99a5f]/10 text-[#d7ba7e]"><Crown aria-hidden="true" className="size-5" /></span>
            <span><span className="block font-serif text-lg tracking-[0.06em]">ANTILIA</span><span className="block text-[8px] font-semibold uppercase tracking-[0.26em] text-[#817a6e]">Voting Portal</span></span>
          </Link>
        </div>
        <nav aria-label="System navigation" className="flex-1 space-y-1 px-4 py-6">
          <p className="mb-3 px-3 text-[9px] font-bold uppercase tracking-[0.22em] text-[#666057]">System Administration</p>
          <Link href="/system" className="flex min-h-11 items-center gap-3 rounded-xl px-3.5 text-sm font-medium text-[#9d9589] transition hover:bg-white/[0.045] hover:text-[#eee8dd]"><Gauge aria-hidden="true" className="size-[18px]" />System Control</Link>
          <Link href="/system/settings" aria-current="page" className="flex min-h-11 items-center gap-3 rounded-xl bg-[#b99a5f]/12 px-3.5 text-sm font-medium text-[#e3c98f] shadow-[inset_0_0_0_1px_rgba(185,154,95,.13)]"><Settings aria-hidden="true" className="size-[18px]" />Settings<span aria-hidden="true" className="ml-auto size-1.5 rounded-full bg-[#c9ab70]" /></Link>
        </nav>
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-[70px] items-center justify-between border-b border-white/[0.07] bg-[#10100f]/90 px-4 backdrop-blur-xl sm:px-6 lg:h-[76px] lg:px-8">
          <div><p className="text-[9px] font-bold uppercase tracking-[0.18em] text-[#81796d]">System Administration</p><h1 className="mt-0.5 font-serif text-lg sm:text-xl">Settings</h1></div>
          <div className="flex items-center gap-2"><Link href="/system" className="rounded-xl border border-white/[0.08] px-3 py-2 text-xs font-semibold text-[#bdb5a8] hover:bg-white/[0.05] lg:hidden">Control</Link><AdminLogoutButton redirectTo="/system/login" theme="dark" /></div>
        </header>
        <main className="mx-auto w-full max-w-[1000px] p-4 sm:p-6 lg:p-8">
          <div className="mb-7 animate-[fadeIn_.35s_ease-out] sm:mb-8">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#b99a5f]">Access security</p>
            <h2 className="mt-2 font-serif text-3xl text-[#f6f0e7] sm:text-4xl">Administrative passcodes</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#938b7f]">Use at least 8 characters and avoid names, sequences, repeated characters, and common credentials.</p>
          </div>
          <div className="space-y-5"><PasscodeCard role="HR" /><PasscodeCard role="SYSTEM" /></div>
        </main>
      </div>
    </div>
  );
}
