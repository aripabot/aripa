"use client";

import type { DashboardLogEntry, LogEntryLevel } from "@/lib/api-types";
import { formatTime } from "@/components/dashboard/lib/format";
import { levelLabel } from "@/components/dashboard/lib/log-utils";

export function LogEntryRow({ entry }: { entry: DashboardLogEntry }) {
  const metadata = entry.metadata ? JSON.stringify(entry.metadata, null, 2) : null;

  return (
    <article className="grid grid-cols-[9rem_5.5rem_8rem_minmax(0,1fr)] gap-3 px-4 py-3 text-sm [contain-intrinsic-size:88px] [content-visibility:auto]">
      <time className="text-xs text-muted-foreground" dateTime={entry.timestamp ?? undefined}>
        {entry.timestamp ? formatTime(entry.timestamp) : "No Time"}
      </time>
      <div>
        <span
          className={`rounded-sm px-1.5 py-0.5 text-xs font-medium ${logLevelClass(entry.level)}`}
        >
          {levelLabel(entry.level)}
        </span>
      </div>
      <p className="truncate text-xs text-muted-foreground">{entry.sourceName}</p>
      <div className="min-w-0">
        <p className="break-words font-mono text-xs leading-5" translate="no">
          {entry.message}
        </p>
        {metadata ? (
          <details className="mt-2">
            <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
              Details
            </summary>
            <pre
              className="mt-2 overflow-auto rounded-md bg-background p-3 text-xs leading-5"
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
      return "bg-red-500/10 text-red-700 dark:text-red-300";
    case "warn":
      return "bg-amber-500/10 text-amber-700 dark:text-amber-300";
    case "info":
      return "bg-sky-500/10 text-sky-700 dark:text-sky-300";
    case "debug":
    case "trace":
      return "bg-muted text-muted-foreground";
    case "unknown":
      return "bg-background text-muted-foreground";
  }
}
