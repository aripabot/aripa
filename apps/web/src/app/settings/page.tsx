import { DashboardRoute } from "@/app/_components/dashboard-route";
import { DashboardAuthScreen } from "@/components/dashboard/dashboard-auth-screen";
import { DashboardSettingsClient } from "@/components/dashboard/dashboard-settings-client";
import { getDashboardPageAuthState } from "@/server/dashboard-auth-next";
import { loadDashboardStatus } from "@/server/dashboard-page-data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function SettingsPage() {
  const authState = await getDashboardPageAuthState();

  if (authState.status !== "authenticated") {
    return <DashboardAuthScreen authState={authState} />;
  }

  const status = await loadDashboardStatus();

  return (
    <DashboardRoute>
      <DashboardSettingsClient status={status} />
    </DashboardRoute>
  );
}
