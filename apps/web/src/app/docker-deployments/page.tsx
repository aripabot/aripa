import { DashboardRoute } from "@/app/_components/dashboard-route";
import { loadDashboardStatus, loadDockerDeployment } from "@/server/dashboard-page-data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function DockerDeploymentsPage() {
  const [status, dockerDeployment] = await Promise.all([
    loadDashboardStatus(),
    loadDockerDeployment(),
  ]);

  return <DashboardRoute view="docker-deployments" initialData={{ status, dockerDeployment }} />;
}
