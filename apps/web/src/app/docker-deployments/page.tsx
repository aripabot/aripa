import { DashboardRoute } from "@/app/_components/dashboard-route";
import { DashboardAuthScreen } from "@/components/dashboard/dashboard-auth-screen";
import { DashboardDockerClient } from "@/components/dashboard/dashboard-docker-client";
import { getDashboardPageAuthState } from "@/server/dashboard-auth-next";
import { loadDashboardStatus, loadDockerDeployment } from "@/server/dashboard-page-data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function DockerDeploymentsPage() {
  const authState = await getDashboardPageAuthState();

  if (authState.status !== "authenticated") {
    return <DashboardAuthScreen authState={authState} />;
  }

  const [status, dockerDeployment] = await Promise.all([
    loadDashboardStatus(),
    loadDockerDeployment(),
  ]);

  return (
    <DashboardRoute>
      <DashboardDockerClient status={status} deployment={dockerDeployment} />
    </DashboardRoute>
  );
}
