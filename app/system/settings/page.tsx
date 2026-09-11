import { SystemSettingsPanel } from "@/components/system-settings-panel";
import { requireSystem } from "@/lib/auth/authorization";

export const dynamic = "force-dynamic";

export default async function SystemSettingsPage() {
  await requireSystem("/system/login");
  return <SystemSettingsPanel />;
}
