"use client";

import { Terminal } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatTime } from "@/components/dashboard/lib/format";
import type { DockerDeploymentCommandResponse } from "@/lib/api-types";

export function DeploymentMetric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="min-w-0 p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 truncate text-lg font-semibold tracking-normal" translate="no">
        {value}
      </p>
      {detail ? (
        <p className="mt-1 truncate text-sm text-muted-foreground" translate="no">
          {detail}
        </p>
      ) : null}
    </div>
  );
}

export function DockerCommandOutput({ result }: { result: DockerDeploymentCommandResponse }) {
  const output = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n\n");

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <CardTitle>Deployment Output</CardTitle>
            <CardDescription>Completed at {formatTime(result.completedAt)}.</CardDescription>
          </div>
          <span
            className={`w-fit rounded-sm px-1.5 py-0.5 text-xs ${
              result.exitCode === 0
                ? "bg-muted text-foreground"
                : "bg-red-500/10 text-red-700 dark:text-red-300"
            }`}
          >
            Exit {result.exitCode}
          </span>
        </div>
      </CardHeader>
      <CardContent>
        {output ? (
          <pre
            className="max-h-96 overflow-auto rounded-md bg-background p-3 font-mono text-xs leading-5"
            translate="no"
          >
            {output}
          </pre>
        ) : (
          <div className="flex items-start gap-3 rounded-md border bg-background p-3">
            <Terminal aria-hidden="true" className="mt-0.5 size-4 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">The command completed without output.</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
