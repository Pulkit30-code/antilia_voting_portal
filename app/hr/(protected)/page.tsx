import { ArrowUpRight, CalendarDays, Clock3, ShieldCheck } from "lucide-react";

export default function HrDashboardPage() {
  return (
    <div className="animate-[fadeIn_.35s_ease-out]">
      <div className="mb-7 sm:mb-8">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#b99a5f]">Overview</p>
        <h2 className="mt-2 font-serif text-3xl leading-tight text-[#f6f0e7] sm:text-4xl">Good to see you.</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[#938b7f]">Your election workspace is ready. Management tools will appear here in the next stage.</p>
      </div>

      <section aria-labelledby="election-status-heading" className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#181816] shadow-[0_24px_70px_rgba(0,0,0,.24)]">
        <div className="flex flex-col gap-5 border-b border-white/[0.07] p-5 sm:flex-row sm:items-center sm:justify-between sm:p-7">
          <div>
            <div className="flex items-center gap-2 text-[#b99a5f]">
              <CalendarDays aria-hidden="true" className="size-4" strokeWidth={1.7} />
              <p className="text-[10px] font-bold uppercase tracking-[0.19em]">Current election</p>
            </div>
            <h3 id="election-status-heading" className="mt-3 font-serif text-2xl text-[#eee8de]">Monthly HOD Election</h3>
          </div>
          <span className="inline-flex w-fit items-center gap-2 rounded-full border border-[#b99a5f]/25 bg-[#b99a5f]/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.15em] text-[#d5b97b]">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-[#d5b97b]" /> Awaiting setup
          </span>
        </div>

        <div className="grid gap-px bg-white/[0.07] sm:grid-cols-3">
          {[
            { icon: Clock3, label: "Election window", value: "Not scheduled" },
            { icon: ShieldCheck, label: "Ballot status", value: "Not open" },
            { icon: ArrowUpRight, label: "Next action", value: "Configure election" },
          ].map((item) => (
            <div key={item.label} className="bg-[#181816] p-5 sm:p-6">
              <item.icon aria-hidden="true" className="size-4 text-[#857c6e]" strokeWidth={1.6} />
              <p className="mt-5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#777064]">{item.label}</p>
              <p className="mt-1.5 text-sm font-medium text-[#dcd5ca]">{item.value}</p>
            </div>
          ))}
        </div>
      </section>

      <div className="mt-5 rounded-2xl border border-dashed border-white/[0.1] bg-white/[0.018] px-5 py-8 text-center sm:mt-6 sm:px-8 sm:py-10">
        <p className="font-serif text-lg text-[#c9c1b5]">More dashboard insights are coming next.</p>
        <p className="mt-1.5 text-sm text-[#746d63]">This shell is ready for HOD, candidate, election and results modules.</p>
      </div>
    </div>
  );
}
