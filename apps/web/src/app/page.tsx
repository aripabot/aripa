import { DashboardRoute } from "@/app/_components/dashboard-route";
import { loadDashboardStatus } from "@/server/dashboard-page-data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function OverviewPage() {
  const status = await loadDashboardStatus();

  return <DashboardRoute view="overview" initialData={{ status }} />;
}
