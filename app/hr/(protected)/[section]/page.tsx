import { Construction } from "lucide-react";
import { notFound } from "next/navigation";

const sections = {
  hods: { title: "HODs", description: "HOD management will be added in the next step." },
  candidates: { title: "Candidates", description: "Candidate management will be added in a future step." },
  elections: { title: "Elections", description: "Election management will be added in a future step." },
  results: { title: "Results", description: "Election results will be added in a future step." },
  history: { title: "History", description: "Election history will be added in a future step." },
} as const;

export default async function HrSectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const content = sections[section as keyof typeof sections];
  if (!content) notFound();

  return (
    <section className="flex min-h-[calc(100vh-134px)] animate-[fadeIn_.35s_ease-out] items-center justify-center py-10">
      <div className="w-full max-w-xl rounded-2xl border border-dashed border-white/[0.11] bg-[#181816]/70 px-6 py-14 text-center shadow-[0_24px_70px_rgba(0,0,0,.18)] sm:px-10 sm:py-20">
        <span className="mx-auto flex size-12 items-center justify-center rounded-xl border border-[#b99a5f]/20 bg-[#b99a5f]/10 text-[#c5a668]">
          <Construction aria-hidden="true" className="size-5" strokeWidth={1.6} />
        </span>
        <p className="mt-6 text-[10px] font-bold uppercase tracking-[0.2em] text-[#b99a5f]">Coming next</p>
        <h2 className="mt-2 font-serif text-3xl text-[#f1ebe1]">{content.title}</h2>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-[#8e867a]">{content.description}</p>
      </div>
    </section>
  );
}
