import { Skeleton } from "@/components/ui/surfaces";

export default function HistoryLoading() {
  return (
    <div aria-label="Loading election history" aria-busy="true" className="space-y-6">
      <Skeleton className="h-52 w-full" />
      <div className="grid gap-3 sm:grid-cols-3">
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
      </div>
      <Skeleton className="h-96 w-full" />
    </div>
  );
}
