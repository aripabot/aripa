"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ConfirmActionButton } from "@/components/dashboard/components/confirm-action-button";
import {
  DeploymentDetail,
  DockerCommandOutput,
} from "@/components/dashboard/components/docker-display";
import { ErrorPanel, LoadingPanel } from "@/components/dashboard/components/panels";
import { StatusText } from "@/components/dashboard/components/status-dot";
import type { StatusTone } from "@/components/dashboard/components/status-dot";
import { formatDateTime } from "@/components/dashboard/lib/format";
import { runDockerDeploymentCommand } from "@/lib/api";
import type {
  DockerDeploymentAction,
  DockerDeploymentCommandResponse,
  DockerDeploymentStatus,
} from "@/lib/api-types";
import { readableError } from "@/lib/errors";
import type { LoadState } from "@/server/dashboard-page-data";

export function DockerDeploymentsPage({
  deployment,
  onRefresh,
  onStatusChange,
}: {
  deployment: LoadState<DockerDeploymentStatus>;
  onRefresh: () => void;
  onStatusChange: (status: DockerDeploymentStatus) => void;
}) {
  const [runningAction, setRunningAction] = useState<DockerDeploymentAction | null>(null);
  const [commandResult, setCommandResult] = useState<DockerDeploymentCommandResponse | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function runAction(action: DockerDeploymentAction) {
    setRunningAction(action);
    setMessage(null);
    setCommandResult(null);
    try {
      const result = await runDockerDeploymentCommand({ action });
      setCommandResult(result);
      onStatusChange(result.status);
      setMessage(
        result.exitCode === 0
          ? action === "start"
            ? "Deployment started"
            : "Deployment stopped"
          : `Command failed with exit code ${result.exitCode}`,
      );
    } catch (error) {
      setMessage(readableError(error));
    } finally {
      setRunningAction(null);
    }
  }

  if (deployment.status === "loading") {
    return <LoadingPanel label="Loading" />;
  }

  if (deployment.status === "error") {
    return (
      <ErrorPanel title="Deployment unavailable" message={deployment.error} onRetry={onRefresh} />
    );
  }

  const startScript = deployment.data.scripts.find((script) => script.action === "start");
  const stopScript = deployment.data.scripts.find((script) => script.action === "stop");
  const missingScripts = deployment.data.scripts.filter((script) => !script.available);
  const running = deployment.data.state === "running";

  return (
    <div className="grid max-w-2xl gap-8">
      <section className="grid gap-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-baseline gap-2.5">
            <StatusText tone={dockerTone(deployment.data.state)} className="font-medium">
              {deployment.data.stateLabel}
            </StatusText>
            <span className="truncate text-sm text-muted-foreground">{deployment.data.detail}</span>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 shrink-0 text-muted-foreground hover:text-foreground"
            aria-label="Refresh"
            title="Refresh"
            onClick={onRefresh}
          >
            <RefreshCw aria-hidden="true" />
          </Button>
        </div>

        <div className="grid gap-5 border-y py-5 sm:grid-cols-3">
          <DeploymentDetail
            label="Container"
            value={deployment.data.containerName}
            detail={deployment.data.containerId ?? undefined}
          />
          <DeploymentDetail
            label="Image"
            value={deployment.data.imageName}
            detail={deployment.data.imageId ?? undefined}
          />
          <DeploymentDetail
            label="Started"
            value={
              deployment.data.startedAt ? formatDateTime(deployment.data.startedAt) : "Not running"
            }
          />
        </div>
      </section>

      <section className="grid gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <ConfirmActionButton
            title={running ? "Restart deployment" : "Start deployment"}
            description={
              running
                ? "The bot goes offline briefly while the container restarts."
                : "Builds the image if needed and starts the container."
            }
            confirmLabel={running ? "Restart" : "Start"}
            disabled={runningAction !== null || startScript?.available !== true}
            onConfirm={() => void runAction("start")}
            trigger={
              <Button
                type="button"
                disabled={runningAction !== null || startScript?.available !== true}
              >
                {runningAction === "start" ? "Starting…" : running ? "Restart" : "Start"}
              </Button>
            }
          />
          <ConfirmActionButton
            title="Stop deployment"
            description="The bot goes offline until the deployment is started again."
            confirmLabel="Stop deployment"
            disabled={runningAction !== null || stopScript?.available !== true}
            onConfirm={() => void runAction("stop")}
            trigger={
              <Button
                type="button"
                variant="outline"
                disabled={runningAction !== null || stopScript?.available !== true}
              >
                {runningAction === "stop" ? "Stopping…" : "Stop"}
              </Button>
            }
          />
          {message ? (
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {message}
            </p>
          ) : null}
        </div>
        {missingScripts.length > 0 ? (
          <p className="text-sm text-muted-foreground">
            {missingScripts.map((script) => script.label).join(" and ")} unavailable on this
            machine.
          </p>
        ) : null}
      </section>

      {commandResult ? <DockerCommandOutput result={commandResult} /> : null}
    </div>
  );
}

function dockerTone(state: DockerDeploymentStatus["state"]): StatusTone {
  switch (state) {
    case "running":
      return "ok";
    case "stopped":
      return "danger";
    case "unknown":
      return "neutral";
  }
}
