"use client";

import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  LoaderCircle,
  LockKeyhole,
} from "lucide-react";
import Link from "next/link";
import { FormEvent, useState } from "react";

type BootstrapFields = {
  hrPasscode: string;
  hrConfirmation: string;
  systemPasscode: string;
  systemConfirmation: string;
};

const emptyFields: BootstrapFields = {
  hrPasscode: "",
  hrConfirmation: "",
  systemPasscode: "",
  systemConfirmation: "",
};

async function responseError(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as
    | { error?: unknown }
    | null;
  return typeof body?.error === "string"
    ? body.error
    : "Unable to initialize access.";
}

export function BootstrapPasscodeForm() {
  const [fields, setFields] = useState(emptyFields);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [complete, setComplete] = useState(false);

  function update(field: keyof BootstrapFields, value: string) {
    setFields((current) => ({ ...current, [field]: value }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (
      fields.hrPasscode !== fields.hrConfirmation ||
      fields.systemPasscode !== fields.systemConfirmation
    ) {
      setError("Each passcode must match its confirmation.");
      setFields(emptyFields);
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/auth/bootstrap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          hrPasscode: fields.hrPasscode,
          systemPasscode: fields.systemPasscode,
        }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      setComplete(true);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to initialize access.",
      );
    } finally {
      setFields(emptyFields);
      setSubmitting(false);
    }
  }

  if (complete) {
    return (
      <div className="space-y-5" role="status">
        <div className="flex gap-3 rounded-xl border border-[#78977a]/30 bg-[#78977a]/10 p-4 text-[#d4e5d3]">
          <CheckCircle2 aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
          <div>
            <p className="font-semibold">Administrative access initialized</p>
            <p className="mt-1 text-sm leading-6 text-[#aec4ad]">
              Setup is now locked. Continue through the normal sign-in pages.
            </p>
          </div>
        </div>
        <Link
          href="/system/login"
          className="flex min-h-14 w-full items-center justify-center gap-2 rounded-xl bg-[#b99a5f] px-4 py-3 text-sm font-semibold text-[#15130f] transition hover:bg-[#c8a96b] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d3b87d]"
        >
          Continue to System sign in <ArrowRight aria-hidden="true" className="size-4" />
        </Link>
      </div>
    );
  }

  return (
    <form className="space-y-6" onSubmit={submit}>
      {(["hr", "system"] as const).map((role) => (
        <fieldset key={role} className="space-y-3">
          <legend className="text-xs font-semibold uppercase tracking-[0.16em] text-[#b6ad9e]">
            {role.toUpperCase()} passcode
          </legend>
          {(["Passcode", "Confirmation"] as const).map((kind) => {
            const field = `${role}${kind}` as keyof BootstrapFields;
            const id = `bootstrap-${role}-${kind.toLowerCase()}`;
            return (
              <div className="relative" key={field}>
                <LockKeyhole aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-[#827a6e]" />
                <input
                  id={id}
                  aria-label={`${role.toUpperCase()} ${kind.toLowerCase()}`}
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  maxLength={256}
                  value={fields[field]}
                  onChange={(event) => update(field, event.target.value)}
                  placeholder={kind === "Passcode" ? "At least 8 characters" : "Confirm passcode"}
                  className="min-h-13 w-full rounded-xl border border-white/10 bg-black/20 py-3 pl-11 pr-4 text-sm text-[#f5efe5] outline-none transition placeholder:text-[#6f685e] hover:border-white/15 focus:border-[#b99a5f]/60 focus:ring-4 focus:ring-[#b99a5f]/10"
                />
              </div>
            );
          })}
        </fieldset>
      ))}

      {error ? (
        <p role="alert" className="flex gap-2 rounded-xl border border-[#b85e50]/25 bg-[#b85e50]/10 px-4 py-3 text-sm text-[#f0beb5]">
          <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={submitting}
        className="flex min-h-14 w-full items-center justify-center gap-2 rounded-xl bg-[#b99a5f] px-4 py-3 text-sm font-semibold text-[#15130f] transition hover:bg-[#c8a96b] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d3b87d] disabled:cursor-wait disabled:opacity-65"
      >
        {submitting ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : <LockKeyhole aria-hidden="true" className="size-4" />}
        {submitting ? "Initializing…" : "Initialize secure access"}
      </button>
      <p className="text-center text-xs leading-5 text-[#777064]">
        Values are hashed on the server and are never returned after submission.
      </p>
    </form>
  );
}
