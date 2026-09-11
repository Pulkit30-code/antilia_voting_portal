"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";

export default function HrDashboardError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <section className="flex min-h-[calc(100vh-134px)] items-center justify-center py-10">
      <div className="w-full max-w-lg rounded-2xl border border-[#b85e50]/25 bg-[#181816] p-8 text-center shadow-2xl">
        <AlertTriangle aria-hidden="true" className="mx-auto size-7 text-[#db8f80]" strokeWidth={1.6} />
        <h2 className="mt-5 font-serif text-2xl text-[#f2ece3]">Dashboard unavailable</h2>
        <p className="mt-2 text-sm leading-6 text-[#978f83]">We couldn’t load this area. Your session is still protected.</p>
        <button type="button" onClick={reset} className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#b99a5f] px-5 py-2.5 text-sm font-semibold text-[#15130f] hover:bg-[#c8a96b] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d3b87d]">
          <RefreshCw aria-hidden="true" className="size-4" /> Try again
        </button>
      </div>
    </section>
  );
}
