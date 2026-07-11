import { DashboardRoute } from "@/app/_components/dashboard-route";
import { DashboardAuthScreen } from "@/components/dashboard/dashboard-auth-screen";
import { DashboardOverviewClient } from "@/components/dashboard/dashboard-overview-client";
import { getDashboardPageAuthState } from "@/server/dashboard-auth-next";
import { loadDashboardStatus, loadDashboardTraces } from "@/server/dashboard-page-data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function OverviewPage() {
  const authState = await getDashboardPageAuthState();

  if (authState.status !== "authenticated") {
    return <DashboardAuthScreen authState={authState} />;
  }

  const [status, traces] = await Promise.all([loadDashboardStatus(), loadDashboardTraces()]);

  return (
    <DashboardRoute>
      <DashboardOverviewClient status={status} traces={traces} />
    </DashboardRoute>
  );
}
