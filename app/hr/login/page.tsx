import { Crown, ShieldCheck } from "lucide-react";
import { redirect } from "next/navigation";

import { AdminLoginForm } from "@/components/admin-login-form";
import { getCurrentSession } from "@/lib/auth/authorization";

export const dynamic = "force-dynamic";

export default async function HrLoginPage() {
  const session = await getCurrentSession();
  if (session) redirect("/hr");

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#0e0e0d] px-5 py-10 sm:px-8">
      <div aria-hidden="true" className="absolute inset-0 bg-[radial-gradient(circle_at_20%_15%,rgba(185,154,95,0.12),transparent_28%),radial-gradient(circle_at_85%_85%,rgba(185,154,95,0.07),transparent_32%)]" />
      <div aria-hidden="true" className="absolute inset-0 opacity-[0.025] [background-image:linear-gradient(rgba(255,255,255,.6)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.6)_1px,transparent_1px)] [background-size:72px_72px]" />

      <section className="relative z-10 w-full max-w-[460px] animate-[fadeIn_.45s_ease-out]">
        <div className="mb-7 flex items-center justify-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-xl border border-[#b99a5f]/30 bg-[#b99a5f]/10 text-[#d6ba7e] shadow-[0_10px_30px_rgba(0,0,0,.2)]">
            <Crown aria-hidden="true" className="size-5" strokeWidth={1.5} />
          </div>
          <div>
            <p className="font-serif text-xl tracking-[0.04em] text-[#f7f1e7]">ANTILIA</p>
            <p className="text-[9px] font-semibold uppercase tracking-[0.28em] text-[#8d8578]">Voting Portal</p>
          </div>
        </div>

        <div className="rounded-2xl border border-white/[0.09] bg-[#181816]/95 p-6 shadow-[0_30px_100px_rgba(0,0,0,.5)] backdrop-blur-xl sm:p-9">
          <div className="mb-8">
            <div className="mb-5 flex size-10 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.04] text-[#c4a667]">
              <ShieldCheck aria-hidden="true" className="size-5" strokeWidth={1.6} />
            </div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#b99a5f]">Restricted access</p>
            <h1 className="mt-2 font-serif text-3xl leading-tight text-[#f7f2e9] sm:text-[2.15rem]">Welcome back</h1>
            <p className="mt-3 text-sm leading-6 text-[#9e968a]">Sign in to administer the Antilia monthly HOD election.</p>
          </div>

          <AdminLoginForm role="HR" redirectTo="/hr" theme="dark" />

          <div className="mt-7 flex items-center justify-center gap-2 border-t border-white/[0.07] pt-6 text-xs text-[#777064]">
            <ShieldCheck aria-hidden="true" className="size-3.5" strokeWidth={1.6} />
            <span>Protected administrative session</span>
          </div>
        </div>
        <p className="mt-6 text-center text-[11px] tracking-wide text-[#625d54]">Antilia · Mumbai</p>
      </section>
    </main>
  );
}
