import { DashboardRoute } from "@/app/_components/dashboard-route";
import { loadDashboardReleases, loadDashboardStatus } from "@/server/dashboard-page-data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function UpdatesPage() {
  const [status, releases] = await Promise.all([loadDashboardStatus(), loadDashboardReleases()]);

  return <DashboardRoute view="updates" initialData={{ status, releases }} />;
}
