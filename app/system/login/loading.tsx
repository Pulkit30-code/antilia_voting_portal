export default function SystemLoginLoading() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#0e0e0d] px-5">
      <div aria-label="Loading System Access" className="w-full max-w-[460px] animate-pulse rounded-2xl border border-white/[0.08] bg-[#181816] p-8">
        <div className="h-11 w-36 rounded-xl bg-white/[0.06]" />
        <div className="mt-8 h-4 w-28 rounded-lg bg-white/[0.06]" />
        <div className="mt-3 h-9 w-64 rounded-lg bg-white/[0.06]" />
        <div className="mt-8 h-14 rounded-xl bg-white/[0.06]" />
        <div className="mt-5 h-14 rounded-xl bg-white/[0.06]" />
      </div>
    </main>
  );
}
