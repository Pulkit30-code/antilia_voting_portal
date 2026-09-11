import type { ReactNode } from "react";

import { HrDashboardShell } from "@/components/hr-dashboard-shell";
import { requireHR } from "@/lib/auth/authorization";

export const dynamic = "force-dynamic";

export default async function ProtectedHrLayout({ children }: { children: ReactNode }) {
  const session = await requireHR("/hr/login");
  return <HrDashboardShell role={session.role}>{children}</HrDashboardShell>;
}
