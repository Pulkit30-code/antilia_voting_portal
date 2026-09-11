import { Crown, ShieldCheck } from "lucide-react";
import { notFound, redirect } from "next/navigation";

import { BootstrapPasscodeForm } from "@/components/bootstrap-passcode-form";
import { authService } from "@/lib/auth/service";
import { isSetupModeEnabled } from "@/lib/auth/setup-mode";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  if (!isSetupModeEnabled()) notFound();
  const status = await authService.getBootstrapStatus();
  if (status.completed) redirect("/system/login");

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#0e0e0d] px-5 py-10 sm:px-8">
      <div aria-hidden="true" className="absolute inset-0 bg-[radial-gradient(circle_at_20%_15%,rgba(185,154,95,0.12),transparent_28%),radial-gradient(circle_at_85%_85%,rgba(185,154,95,0.07),transparent_32%)]" />
      <section className="relative z-10 w-full max-w-[520px] animate-[fadeIn_.45s_ease-out]">
        <div className="mb-7 flex items-center justify-center gap-3">
          <span className="flex size-11 items-center justify-center rounded-xl border border-[#b99a5f]/30 bg-[#b99a5f]/10 text-[#d6ba7e]">
            <Crown aria-hidden="true" className="size-5" strokeWidth={1.5} />
          </span>
          <span>
            <span className="block font-serif text-xl tracking-[0.04em] text-[#f7f1e7]">ANTILIA</span>
            <span className="block text-[9px] font-semibold uppercase tracking-[0.28em] text-[#8d8578]">Voting Portal</span>
          </span>
        </div>
        <div className="rounded-2xl border border-white/[0.09] bg-[#181816]/95 p-6 shadow-[0_30px_100px_rgba(0,0,0,.5)] sm:p-9">
          <ShieldCheck aria-hidden="true" className="size-6 text-[#c4a667]" />
          <p className="mt-5 text-[10px] font-bold uppercase tracking-[0.2em] text-[#b99a5f]">One-time setup</p>
          <h1 className="mt-2 font-serif text-3xl text-[#f7f2e9]">Initialize access</h1>
          <p className="mb-8 mt-3 text-sm leading-6 text-[#9e968a]">Create the first HR and SYSTEM passcodes. They must be different and difficult to guess.</p>
          <BootstrapPasscodeForm />
        </div>
      </section>
    </main>
  );
}
