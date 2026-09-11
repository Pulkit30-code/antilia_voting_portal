"use client";

import { useState } from "react";
import { LoaderCircle, LogOut } from "lucide-react";

export function AdminLogoutButton({ redirectTo, theme = "light" }: { redirectTo?: string; theme?: "dark" | "light" }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function logout() {
    setError(null);
    setSubmitting(true);
    try {
      const response = await fetch("/api/auth/logout", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!response.ok) {
        setError("Could not sign out. Please try again.");
        return;
      }
      if (redirectTo) {
        window.location.replace(redirectTo);
      } else {
        window.location.reload();
      }
    } catch {
      setError("Could not sign out. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        disabled={submitting}
        onClick={logout}
        className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border px-3.5 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 disabled:cursor-wait disabled:opacity-60 ${theme === "dark" ? "border-white/10 bg-white/[0.045] text-[#d8d1c6] hover:border-[#b99a5f]/35 hover:bg-white/[0.075] hover:text-white focus-visible:ring-[#b99a5f]" : "border-neutral-300 bg-white text-neutral-800 hover:bg-neutral-50 focus-visible:ring-neutral-800"}`}
      >
        {submitting ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : <LogOut aria-hidden="true" className="size-4" strokeWidth={1.7} />}
        <span>{submitting ? "Signing out…" : "Logout"}</span>
      </button>
      {error ? <p role="alert" className="mt-2 text-xs text-[#f0beb5]">{error}</p> : null}
    </div>
  );
}
