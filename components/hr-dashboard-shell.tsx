"use client";

import {
  BarChart3,
  CalendarRange,
  Crown,
  History,
  LayoutDashboard,
  Menu,
  Sparkles,
  UserRoundCog,
  UsersRound,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { AdminLogoutButton } from "@/components/admin-logout-button";
import type { AdminRole } from "@/lib/auth/types";

const navigation = [
  { label: "Dashboard", href: "/hr", icon: LayoutDashboard },
  { label: "HODs", href: "/hr/hods", icon: UserRoundCog },
  { label: "Candidates", href: "/hr/candidates", icon: UsersRound },
  { label: "Elections", href: "/hr/elections", icon: CalendarRange },
  { label: "Results", href: "/hr/results", icon: BarChart3 },
  { label: "History", href: "/hr/history", icon: History },
] as const;

function Brand() {
  return (
    <Link href="/hr" className="flex items-center gap-3 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#b99a5f]">
      <span className="flex size-10 items-center justify-center rounded-xl border border-[#b99a5f]/30 bg-[#b99a5f]/10 text-[#d7ba7e]">
        <Crown aria-hidden="true" className="size-5" strokeWidth={1.5} />
      </span>
      <span>
        <span className="block font-serif text-lg tracking-[0.06em] text-[#f5efe5]">ANTILIA</span>
        <span className="block text-[8px] font-semibold uppercase tracking-[0.26em] text-[#817a6e]">Voting Portal</span>
      </span>
    </Link>
  );
}

function Navigation({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav aria-label="HR navigation" className="space-y-1">
      {navigation.map((item) => {
        const active = item.href === "/hr" ? pathname === item.href : pathname.startsWith(item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={`group flex min-h-11 items-center gap-3 rounded-xl px-3.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#b99a5f] ${active ? "bg-[#b99a5f]/12 text-[#e3c98f] shadow-[inset_0_0_0_1px_rgba(185,154,95,.13)]" : "text-[#9d9589] hover:bg-white/[0.045] hover:text-[#eee8dd]"}`}
          >
            <Icon aria-hidden="true" className="size-[18px]" strokeWidth={active ? 1.9 : 1.6} />
            <span>{item.label}</span>
            {active ? <span aria-hidden="true" className="ml-auto size-1.5 rounded-full bg-[#c9ab70]" /> : null}
          </Link>
        );
      })}
    </nav>
  );
}

export function HrDashboardShell({ children, role }: { children: ReactNode; role: AdminRole }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const activeItem = navigation.find((item) => item.href === "/hr" ? pathname === "/hr" : pathname.startsWith(item.href));

  useEffect(() => {
    if (!mobileOpen) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setMobileOpen(false);
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [mobileOpen]);

  return (
    <div className="min-h-screen bg-[#10100f] text-[#f5efe5]">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-white/[0.07] bg-[#141412] lg:flex">
        <div className="flex h-[76px] items-center border-b border-white/[0.07] px-6"><Brand /></div>
        <div className="flex-1 overflow-y-auto px-4 py-6">
          <p className="mb-3 px-3 text-[9px] font-bold uppercase tracking-[0.22em] text-[#666057]">Administration</p>
          <Navigation />
        </div>
        <div className="border-t border-white/[0.07] p-4">
          <div className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-3.5">
            <div className="flex items-center gap-3">
              <span className="flex size-9 items-center justify-center rounded-lg bg-[#b99a5f]/12 text-[#d2b574]"><Sparkles aria-hidden="true" className="size-4" /></span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-[#e7e0d4]">{role} Administrator</span>
                <span className="block text-[10px] uppercase tracking-[0.12em] text-[#777064]">Secure session</span>
              </span>
            </div>
          </div>
        </div>
      </aside>

      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button type="button" aria-label="Close navigation" className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <aside className="relative flex h-full w-[min(84vw,300px)] animate-[fadeIn_.2s_ease-out] flex-col border-r border-white/10 bg-[#141412] shadow-2xl">
            <div className="flex h-[70px] items-center justify-between border-b border-white/[0.07] px-5">
              <Brand />
              <button type="button" aria-label="Close menu" onClick={() => setMobileOpen(false)} className="rounded-lg p-2 text-[#aaa296] hover:bg-white/5 hover:text-white"><X aria-hidden="true" className="size-5" /></button>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-6"><Navigation onNavigate={() => setMobileOpen(false)} /></div>
          </aside>
        </div>
      ) : null}

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-[70px] items-center justify-between border-b border-white/[0.07] bg-[#10100f]/90 px-4 backdrop-blur-xl sm:px-6 lg:h-[76px] lg:px-8">
          <div className="flex items-center gap-3">
            <button type="button" aria-label="Open navigation" aria-expanded={mobileOpen} onClick={() => setMobileOpen(true)} className="rounded-xl border border-white/[0.08] bg-white/[0.035] p-2.5 text-[#cfc7ba] hover:bg-white/[0.07] lg:hidden">
              <Menu aria-hidden="true" className="size-5" />
            </button>
            <div>
              <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-[#81796d]">HR Administration</p>
              <h1 className="mt-0.5 font-serif text-lg text-[#f4eee4] sm:text-xl">{activeItem?.label ?? "Dashboard"}</h1>
            </div>
          </div>
          <AdminLogoutButton redirectTo="/hr/login" theme="dark" />
        </header>

        <main className="mx-auto w-full max-w-[1440px] p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
