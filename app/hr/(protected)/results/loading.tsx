import { Skeleton } from "@/components/ui/surfaces";

export default function ResultsPageLoading() {
  return (
    <div aria-label="Loading results page" role="status">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="mt-4 h-10 w-64 max-w-full" />
      <Skeleton className="mt-3 h-4 w-full max-w-xl" />
      <div className="mt-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((item) => <Skeleton key={item} className="h-32" />)}
      </div>
      <div className="mt-5 grid gap-5 xl:grid-cols-2"><Skeleton className="h-96" /><Skeleton className="h-96" /></div>
      <span className="sr-only">Loading results…</span>
    </div>
  );
}
