"use client";

import type { DashboardLogEntry, LogEntryLevel } from "@/lib/api-types";
import { formatTime } from "@/components/dashboard/lib/format";
import { levelLabel } from "@/components/dashboard/lib/log-utils";

export function LogEntryRow({ entry }: { entry: DashboardLogEntry }) {
  const metadata = entry.metadata ? JSON.stringify(entry.metadata, null, 2) : null;

  return (
    <article className="grid grid-cols-[4.5rem_3.5rem_minmax(0,1fr)] gap-3 px-4 py-2 text-sm [contain-intrinsic-size:37px] [content-visibility:auto] sm:grid-cols-[4.5rem_3.5rem_8rem_minmax(0,1fr)]">
      <time
        className="font-mono text-xs leading-5 text-muted-foreground"
        dateTime={entry.timestamp ?? undefined}
      >
        {entry.timestamp ? formatTime(entry.timestamp) : "—"}
      </time>
      <span className={`font-mono text-xs leading-5 ${logLevelClass(entry.level)}`}>
        {levelLabel(entry.level)}
      </span>
      <span className="hidden truncate text-xs leading-5 text-muted-foreground sm:block">
        {entry.sourceName}
      </span>
      <div className="min-w-0">
        <p className="break-words font-mono text-xs leading-5" translate="no">
          {entry.message}
        </p>
        {metadata ? (
          <details className="mt-1">
            <summary className="cursor-pointer text-xs text-muted-foreground">Details</summary>
            <pre
              className="mt-2 overflow-auto rounded-md bg-muted/50 p-3 text-xs leading-5"
              translate="no"
            >
              {metadata}
            </pre>
          </details>
        ) : null}
      </div>
    </article>
  );
}

function logLevelClass(level: LogEntryLevel): string {
  switch (level) {
    case "fatal":
    case "error":
      return "text-red-600 dark:text-red-400";
    case "warn":
      return "text-amber-600 dark:text-amber-400";
    case "info":
      return "text-foreground";
    case "debug":
    case "trace":
    case "unknown":
      return "text-muted-foreground";
  }
}
