import type { DashboardLogEntry, LogEntryLevel } from "@/lib/api-types";

export const logLevels: LogEntryLevel[] = [
  "trace",
  "debug",
  "info",
  "warn",
  "error",
  "fatal",
  "unknown",
];

export function appendLogEntry(
  entries: DashboardLogEntry[],
  entry: DashboardLogEntry,
  entryKeys: Set<string>,
): DashboardLogEntry[] {
  const entryKey = logEntryKey(entry);
  if (entryKeys.has(entryKey)) {
    return entries;
  }

  const nextEntries = [...entries, entry].slice(-800);

  if (nextEntries.length === entries.length + 1) {
    entryKeys.add(entryKey);
    return nextEntries;
  }

  entryKeys.clear();
  for (const nextEntry of nextEntries) {
    entryKeys.add(logEntryKey(nextEntry));
  }

  return nextEntries;
}

export function newestFirstLogEntries(entries: readonly DashboardLogEntry[]): DashboardLogEntry[] {
  return entries.slice(-200).reverse();
}

export function logEntryKey(entry: DashboardLogEntry): string {
  return `${entry.sourceId}:${entry.timestamp ?? ""}:${entry.raw}`;
}

export function filterAndSummarizeLogs(
  entries: readonly DashboardLogEntry[],
  filters: { activeSourceId: string; level: LogEntryLevel | "all"; queryText: string },
): {
  summary: { errors: number; warnings: number };
  visibleEntries: DashboardLogEntry[];
} {
  let errors = 0;
  let warnings = 0;
  const visibleEntries: DashboardLogEntry[] = [];

  for (const entry of entries) {
    if (entry.level === "error" || entry.level === "fatal") {
      errors += 1;
    } else if (entry.level === "warn") {
      warnings += 1;
    }

    if (filters.level !== "all" && entry.level !== filters.level) {
      continue;
    }

    if (filters.activeSourceId !== "all" && entry.sourceId !== filters.activeSourceId) {
      continue;
    }

    if (
      filters.queryText &&
      !`${entry.message} ${entry.raw} ${entry.sourceName}`.toLowerCase().includes(filters.queryText)
    ) {
      continue;
    }

    visibleEntries.push(entry);
  }

  return { summary: { errors, warnings }, visibleEntries };
}

export function levelLabel(level: LogEntryLevel): string {
  switch (level) {
    case "trace":
      return "Trace";
    case "debug":
      return "Debug";
    case "info":
      return "Info";
    case "warn":
      return "Warn";
    case "error":
      return "Error";
    case "fatal":
      return "Fatal";
    case "unknown":
      return "Raw";
  }
}

export async function copyLogEntries(entries: readonly DashboardLogEntry[]): Promise<void> {
  await navigator.clipboard.writeText(formatLogEntries(entries));
}

export function downloadLogEntries(entries: readonly DashboardLogEntry[]): void {
  const blob = new Blob([formatLogEntries(entries)], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = `aripa-logs-${new Date().toISOString().replace(/[:.]/g, "-")}.log`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function formatLogEntries(entries: readonly DashboardLogEntry[]): string {
  return entries
    .map((entry) => {
      const timestamp = entry.timestamp ?? "no-time";
      return `[${timestamp}] [${entry.sourceName}] [${levelLabel(entry.level)}] ${entry.raw}`;
    })
    .join("\n");
}
