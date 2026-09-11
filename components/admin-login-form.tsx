"use client";

import { FormEvent, useState } from "react";
import { AlertCircle, ArrowRight, LoaderCircle, LockKeyhole } from "lucide-react";

type AdminLoginFormProps = {
  role: "HR" | "SYSTEM";
  redirectTo?: string;
  theme?: "dark" | "light";
};

export function AdminLoginForm({ role, redirectTo, theme = "light" }: AdminLoginFormProps) {
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const response = await fetch(`/api/auth/${role.toLowerCase()}/login`, {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passcode }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        setError(body?.error ?? "Invalid credentials.");
        setPasscode("");
        return;
      }

      setPasscode("");
      if (redirectTo) {
        const sessionResponse = await fetch("/api/auth/session", {
          cache: "no-store",
          credentials: "same-origin",
        });
        const session = (await sessionResponse.json().catch(() => null)) as
          | { authenticated?: boolean; role?: "HR" | "SYSTEM" }
          | null;
        if (!sessionResponse.ok || !session?.authenticated || session.role !== role) {
          setError("Unable to establish a secure session. Please try again.");
          return;
        }

        window.location.replace(redirectTo);
      } else {
        window.location.reload();
      }
    } catch {
      setError("Unable to sign in. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="space-y-5" onSubmit={submit}>
      <div>
        <label className={`mb-2.5 block text-xs font-semibold uppercase tracking-[0.16em] ${theme === "dark" ? "text-[#b6ad9e]" : "text-neutral-600"}`} htmlFor={`${role}-passcode`}>
          {role === "HR" ? "HR" : "System"} passcode
        </label>
        <div className="relative">
          <LockKeyhole aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-[#827a6e]" strokeWidth={1.7} />
          <input
            id={`${role}-passcode`}
            type="password"
            autoComplete="current-password"
            required
            maxLength={256}
            value={passcode}
            onChange={(event) => setPasscode(event.target.value)}
            placeholder="Enter your secure passcode"
            aria-describedby={error ? `${role}-login-error` : undefined}
            className={`min-h-14 w-full rounded-xl py-3 pl-11 pr-4 text-[15px] outline-none transition focus:ring-4 ${theme === "dark" ? "border border-white/10 bg-black/20 text-[#f5efe5] placeholder:text-[#6f685e] hover:border-white/15 focus:border-[#b99a5f]/60 focus:ring-[#b99a5f]/10" : "border border-neutral-300 bg-white text-neutral-900 placeholder:text-neutral-400 hover:border-neutral-400 focus:border-neutral-700 focus:ring-neutral-900/10"}`}
          />
        </div>
      </div>

      {error ? (
        <p id={`${role}-login-error`} role="alert" className="flex items-center gap-2 rounded-xl border border-[#b85e50]/25 bg-[#b85e50]/10 px-3.5 py-3 text-sm text-[#f0beb5]">
          <AlertCircle aria-hidden="true" className="size-4 shrink-0" />
          <span>{error}</span>
        </p>
      ) : null}

      <button
        type="submit"
        disabled={submitting}
        className={`flex min-h-14 w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold tracking-wide transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-65 ${theme === "dark" ? "bg-[#b99a5f] text-[#15130f] shadow-[0_14px_35px_rgba(185,154,95,0.16)] hover:bg-[#c8a96b] focus-visible:ring-[#d3b87d] focus-visible:ring-offset-[#171715]" : "bg-neutral-900 text-white hover:bg-neutral-800 focus-visible:ring-neutral-900 focus-visible:ring-offset-white"}`}
      >
        {submitting ? (
          <><LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> Verifying access…</>
        ) : (
          <>Sign in securely <ArrowRight aria-hidden="true" className="size-4" /></>
        )}
      </button>
    </form>
  );
}
