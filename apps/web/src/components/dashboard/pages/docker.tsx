"use client";

import { useState } from "react";
import { Play, RefreshCw, Square } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmActionButton } from "@/components/dashboard/components/confirm-action-button";
import {
  DeploymentMetric,
  DockerCommandOutput,
} from "@/components/dashboard/components/docker-display";
import { ErrorPanel, LoadingPanel } from "@/components/dashboard/components/panels";
import { formatDateTime } from "@/components/dashboard/lib/format";
import { runDockerDeploymentCommand } from "@/lib/api";
import type {
  DockerDeploymentAction,
  DockerDeploymentCommandResponse,
  DockerDeploymentStatus,
} from "@/lib/api-types";
import { readableError } from "@/lib/errors";
import type { LoadState } from "@/server/dashboard-page-data";

type BadgeTone = "success" | "danger" | "muted";

const badgeToneClasses: Record<BadgeTone, string> = {
  success: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  danger: "bg-red-500/10 text-red-700 dark:text-red-300",
  muted: "bg-muted text-muted-foreground",
};

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
          ? `${dockerActionLabel(action)} completed.`
          : `${dockerActionLabel(action)} exited with code ${result.exitCode}.`,
      );
    } catch (error) {
      setMessage(readableError(error));
    } finally {
      setRunningAction(null);
    }
  }

  if (deployment.status === "loading") {
    return <LoadingPanel label="Loading Docker deployment" />;
  }

  if (deployment.status === "error") {
    return (
      <ErrorPanel
        title="Docker deployment unavailable"
        message={deployment.error}
        onRetry={onRefresh}
      />
    );
  }

  const startScript = deployment.data.scripts.find((script) => script.action === "start");
  const stopScript = deployment.data.scripts.find((script) => script.action === "stop");
  const running = deployment.data.state === "running";

  return (
    <div className="grid gap-5">
      <section className="overflow-hidden rounded-lg border bg-card">
        <div className="flex flex-col gap-4 border-b p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <span
                className={`inline-flex items-center gap-2 rounded-md px-2.5 py-1 text-sm font-medium ${dockerStateClass(
                  deployment.data.state,
                )}`}
              >
                <span className="size-2 rounded-full bg-current" aria-hidden="true" />
                {deployment.data.stateLabel}
              </span>
              <p className="break-words text-sm text-muted-foreground">{deployment.data.detail}</p>
            </div>
          </div>
          <Button type="button" variant="outline" onClick={onRefresh}>
            <RefreshCw aria-hidden="true" />
            Refresh
          </Button>
        </div>

        <div className="grid divide-y sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-4">
          <DeploymentMetric label="Status" value={deployment.data.stateLabel} detail="" />
          <DeploymentMetric
            label="Container"
            value={deployment.data.containerName}
            detail={
              deployment.data.containerId ? `ID ${deployment.data.containerId}` : "Not created"
            }
          />
          <DeploymentMetric
            label="Image"
            value={deployment.data.imageName}
            detail={deployment.data.imageId ? `ID ${deployment.data.imageId}` : "Not built"}
          />
          <DeploymentMetric
            label="Started"
            value={
              deployment.data.startedAt ? formatDateTime(deployment.data.startedAt) : "Not started"
            }
            detail=""
          />
        </div>
      </section>

      <section className="grid gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Deployment Controls</CardTitle>
            <CardDescription>Start, restart, or stop the local Docker deployment.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {message ? (
              <p className="rounded-md border bg-background px-3 py-2 text-sm" aria-live="polite">
                {message}
              </p>
            ) : null}
            <div className="flex flex-col gap-3 sm:flex-row">
              <ConfirmActionButton
                title={running ? "Restart Deployment" : "Start Deployment"}
                description={
                  running
                    ? "Restart the Docker deployment now. The bot may be briefly unavailable."
                    : "Start the Docker deployment now."
                }
                confirmLabel={running ? "Restart Deployment" : "Start Deployment"}
                disabled={runningAction !== null || startScript?.available !== true}
                onConfirm={() => void runAction("start")}
                trigger={
                  <Button
                    type="button"
                    disabled={runningAction !== null || startScript?.available !== true}
                  >
                    <Play aria-hidden="true" />
                    {runningAction === "start"
                      ? "Starting…"
                      : running
                        ? "Restart Deployment"
                        : "Start Deployment"}
                  </Button>
                }
              />
              <ConfirmActionButton
                title="Stop Deployment"
                description="Stop the Docker deployment now. Aripa will be offline until it is started again."
                confirmLabel="Stop Deployment"
                disabled={runningAction !== null || stopScript?.available !== true}
                onConfirm={() => void runAction("stop")}
                trigger={
                  <Button
                    type="button"
                    variant="outline"
                    disabled={runningAction !== null || stopScript?.available !== true}
                  >
                    <Square aria-hidden="true" />
                    {runningAction === "stop" ? "Stopping…" : "Stop Deployment"}
                  </Button>
                }
              />
            </div>
            <div className="grid gap-2">
              {deployment.data.scripts.map((script) => (
                <div
                  key={script.action}
                  className="flex flex-col gap-2 rounded-md border bg-background p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{script.label}</p>
                  </div>
                  <span
                    className={`w-fit rounded-sm px-1.5 py-0.5 text-xs ${script.available ? "bg-muted text-foreground" : "bg-muted text-muted-foreground"}`}
                  >
                    {script.available ? "Available" : "Missing"}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </section>

      {commandResult ? <DockerCommandOutput result={commandResult} /> : null}
    </div>
  );
}

function badgeToneClass(tone: BadgeTone): string {
  return badgeToneClasses[tone];
}

function dockerStateClass(state: DockerDeploymentStatus["state"]): string {
  switch (state) {
    case "running":
      return badgeToneClass("success");
    case "stopped":
      return badgeToneClass("danger");
    case "unknown":
      return badgeToneClass("muted");
  }
}

function dockerActionLabel(action: DockerDeploymentAction): string {
  switch (action) {
    case "start":
      return "Start Deployment";
    case "stop":
      return "Stop Deployment";
  }
}
