import { AdminLogoutButton } from "@/components/admin-logout-button";
import type { AdminRole } from "@/lib/auth/types";

type AdminAccessPanelProps = {
  area: "HR" | "SYSTEM";
  sessionRole: AdminRole;
};

export function AdminAccessPanel({ area, sessionRole }: AdminAccessPanelProps) {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl items-center px-6 py-12">
      <section className="w-full rounded-2xl border border-neutral-200 bg-white p-8 shadow-sm">
        <p className="text-sm font-medium text-neutral-500">Antilia Voting Portal</p>
        <h1 className="mt-2 text-2xl font-semibold">
          {area === "HR" ? "HR access" : "System access"}
        </h1>
        <p className="mt-3 text-sm text-neutral-600">
          Authenticated as {sessionRole}. Module 1 access is active.
        </p>
        <div className="mt-6">
          <AdminLogoutButton />
        </div>
      </section>
    </main>
  );
}
