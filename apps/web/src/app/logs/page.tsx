import { DashboardRoute } from "@/app/_components/dashboard-route";
import { DashboardAuthScreen } from "@/components/dashboard/dashboard-auth-screen";
import { DashboardLogsClient } from "@/components/dashboard/dashboard-logs-client";
import { getDashboardPageAuthState } from "@/server/dashboard-auth-next";
import { loadDashboardLogs, loadDashboardStatus } from "@/server/dashboard-page-data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function LogsPage() {
  const authState = await getDashboardPageAuthState();

  if (authState.status !== "authenticated") {
    return <DashboardAuthScreen authState={authState} />;
  }

  const [status, logs] = await Promise.all([loadDashboardStatus(), loadDashboardLogs()]);

  return (
    <DashboardRoute>
      <DashboardLogsClient status={status} logs={logs} />
    </DashboardRoute>
  );
}
