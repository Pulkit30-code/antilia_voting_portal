import { SystemControlPanel } from "@/components/system-control-panel";
import { requireSystem } from "@/lib/auth/authorization";

export const dynamic = "force-dynamic";

export default async function SystemPage() {
  await requireSystem("/system/login");
  return <SystemControlPanel />;
}
