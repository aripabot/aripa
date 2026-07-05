import { DashboardRoute } from "@/app/_components/dashboard-route";
import { DashboardAuthScreen } from "@/components/dashboard/dashboard-auth-screen";
import { DashboardUpdatesClient } from "@/components/dashboard/dashboard-updates-client";
import { getDashboardPageAuthState } from "@/server/dashboard-auth-next";
import { loadDashboardReleases, loadDashboardStatus } from "@/server/dashboard-page-data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function UpdatesPage() {
  const authState = await getDashboardPageAuthState();

  if (authState.status !== "authenticated") {
    return <DashboardAuthScreen authState={authState} />;
  }

  const [status, releases] = await Promise.all([loadDashboardStatus(), loadDashboardReleases()]);

  return (
    <DashboardRoute>
      <DashboardUpdatesClient status={status} releases={releases} />
    </DashboardRoute>
  );
}
