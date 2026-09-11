import { Skeleton } from "@/components/ui/surfaces";

export default function HrDashboardLoading() {
  return (
    <div aria-label="Loading HR dashboard" role="status">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="mt-4 h-10 w-64 max-w-full" />
      <Skeleton className="mt-3 h-4 w-full max-w-xl" />
      <div className="mt-8 rounded-2xl border border-white/[0.07] bg-[#181816] p-6">
        <div className="flex items-center justify-between gap-6">
          <div className="flex-1"><Skeleton className="h-3 w-28" /><Skeleton className="mt-4 h-8 w-52 max-w-full" /></div>
          <Skeleton className="h-8 w-28 rounded-full" />
        </div>
        <div className="mt-8 grid gap-4 sm:grid-cols-3"><Skeleton className="h-28" /><Skeleton className="h-28" /><Skeleton className="h-28" /></div>
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
