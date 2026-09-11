import { Download } from "lucide-react";

const formats = [
  { extension: "csv", label: "CSV" },
  { extension: "xlsx", label: "Excel" },
  { extension: "pdf", label: "PDF" },
] as const;

export function ResultsExportActions({ electionId }: { electionId: string }) {
  return (
    <div aria-label="Export election results" className="flex flex-wrap items-center gap-2">
      <span className="mr-1 inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-[#777064]">
        <Download aria-hidden="true" className="size-3.5" /> Export
      </span>
      {formats.map((format) => (
        <a
          key={format.extension}
          href={`/api/elections/${encodeURIComponent(electionId)}/export/${format.extension}`}
          className="inline-flex min-h-9 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] px-3 text-xs font-semibold text-[#d8d0c4] transition hover:border-[#b99a5f]/40 hover:bg-[#b99a5f]/10 hover:text-[#ead6a8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#b99a5f]"
        >
          {format.label}
        </a>
      ))}
    </div>
  );
}
