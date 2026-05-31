import { DashboardRoute } from "@/app/_components/dashboard-route";
import { loadDashboardLogs, loadDashboardStatus } from "@/server/dashboard-page-data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function LogsPage() {
  const [status, logs] = await Promise.all([loadDashboardStatus(), loadDashboardLogs()]);

  return <DashboardRoute view="logs" initialData={{ status, logs }} />;
}
