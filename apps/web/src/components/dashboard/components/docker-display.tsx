"use client";

import { formatTime } from "@/components/dashboard/lib/format";
import type { DockerDeploymentCommandResponse } from "@/lib/api-types";

export function DeploymentDetail({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="min-w-0">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-0.5 truncate text-sm" translate="no" title={value}>
        {value}
      </p>
      {detail ? (
        <p className="truncate font-mono text-xs text-muted-foreground" translate="no">
          {detail}
        </p>
      ) : null}
    </div>
  );
}

export function DockerCommandOutput({ result }: { result: DockerDeploymentCommandResponse }) {
  const output = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n\n");

  return (
    <section className="grid gap-3 border-t pt-6">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-sm font-medium">Output</h2>
        <p className="text-sm text-muted-foreground">
          {result.exitCode === 0
            ? `Finished at ${formatTime(result.completedAt)}`
            : `Failed with exit code ${result.exitCode}`}
        </p>
      </div>
      {output ? (
        <pre
          className="max-h-96 overflow-auto rounded-lg border bg-muted/40 p-4 font-mono text-xs leading-5"
          translate="no"
        >
          {output}
        </pre>
      ) : (
        <p className="text-sm text-muted-foreground">The command finished without output.</p>
      )}
    </section>
  );
}
