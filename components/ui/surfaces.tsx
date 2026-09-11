import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import type { ReactNode } from "react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-white/[0.08] bg-[#181816]/92 shadow-[0_24px_80px_rgba(0,0,0,0.32)] ${className}`}>
      {children}
    </div>
  );
}

export function Badge({ children, tone = "gold" }: { children: ReactNode; tone?: "gold" | "neutral" }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] ${tone === "gold" ? "border-[#b99a5f]/35 bg-[#b99a5f]/10 text-[#d7ba7e]" : "border-white/10 bg-white/5 text-[#aaa294]"}`}>
      {children}
    </span>
  );
}

export function Alert({ children, tone = "info", title }: { children: ReactNode; tone?: "info" | "error" | "success"; title: string }) {
  const Icon = tone === "error" ? AlertCircle : tone === "success" ? CheckCircle2 : Info;
  const palette = tone === "error"
    ? "border-[#b85e50]/30 bg-[#b85e50]/10 text-[#f2c2b9]"
    : tone === "success"
      ? "border-[#78977a]/30 bg-[#78977a]/10 text-[#cfe1cf]"
      : "border-[#b99a5f]/25 bg-[#b99a5f]/8 text-[#dfcfaf]";
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`flex gap-3 rounded-xl border p-4 ${palette}`}>
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" strokeWidth={1.8} />
      <div>
        <p className="text-sm font-semibold text-current">{title}</p>
        <div className="mt-1 text-sm leading-6 opacity-80">{children}</div>
      </div>
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-xl bg-white/[0.07] ${className}`} />;
}

export function Toast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div role="status" className="fixed inset-x-4 bottom-5 z-50 mx-auto flex max-w-md items-center justify-between gap-3 rounded-xl border border-[#b99a5f]/30 bg-[#20201c] px-4 py-3 text-sm text-[#eee7da] shadow-2xl animate-[rise_.25s_ease-out]">
      <span>{message}</span>
      <button type="button" aria-label="Dismiss notification" onClick={onDismiss} className="rounded-lg p-1 text-[#a69d8d] hover:bg-white/5 hover:text-white">
        <X className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}
