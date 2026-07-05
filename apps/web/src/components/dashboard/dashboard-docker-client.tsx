"use client";

import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { useLoadState } from "@/components/dashboard/hooks/use-load-state";
import { DockerDeploymentsPage } from "@/components/dashboard/pages/docker";
import { getDockerDeploymentStatus } from "@/lib/api";
import type { DashboardStatus, DockerDeploymentStatus } from "@/lib/api-types";
import type { LoadState } from "@/server/dashboard-page-data";

export function DashboardDockerClient({
  deployment,
  status,
}: {
  deployment: LoadState<DockerDeploymentStatus>;
  status: LoadState<DashboardStatus>;
}) {
  const {
    state: dockerState,
    refresh: refreshDockerDeployment,
    setState: setDockerState,
  } = useLoadState(getDockerDeploymentStatus, deployment);

  return (
    <DashboardShell view="docker-deployments" initialStatus={status}>
      {({ refreshStatus }) => (
        <DockerDeploymentsPage
          deployment={dockerState}
          onRefresh={() => {
            void refreshDockerDeployment();
            void refreshStatus();
          }}
          onStatusChange={(nextStatus) => {
            setDockerState({ status: "ready", data: nextStatus, error: null });
            void refreshStatus();
          }}
        />
      )}
    </DashboardShell>
  );
}
