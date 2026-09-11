import { Skeleton } from "@/components/ui/surfaces";

export default function HrLoginLoading() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#0e0e0d] px-5 py-10">
      <div className="w-full max-w-[460px]">
        <Skeleton className="mx-auto mb-7 h-11 w-36" />
        <div className="rounded-2xl border border-white/[0.08] bg-[#181816] p-6 sm:p-9">
          <Skeleton className="mb-5 size-10" />
          <Skeleton className="h-3 w-28" />
          <Skeleton className="mt-4 h-9 w-48" />
          <Skeleton className="mt-3 h-4 w-full" />
          <Skeleton className="mt-9 h-14 w-full" />
          <Skeleton className="mt-5 h-14 w-full" />
        </div>
      </div>
    </main>
  );
}
