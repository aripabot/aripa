import { describe, expect, test } from "vitest";

import {
  appendLogEntry,
  filterAndSummarizeLogs,
  newestFirstLogEntries,
} from "@/components/dashboard/lib/log-utils";
import type { DashboardLogEntry, LogEntryLevel } from "@/lib/api-types";

describe("dashboard log utilities", () => {
  test("returns the same entry array when appending a duplicate stream entry", () => {
    const first = logEntry({ raw: "first" });
    const entries = [first];
    const entryKeys = new Set([entryKey(first)]);

    const nextEntries = appendLogEntry(entries, first, entryKeys);

    expect(nextEntries).toBe(entries);
    expect(entryKeys).toEqual(new Set([entryKey(first)]));
  });

  test("keeps the newest 800 entries and rebuilds tracked keys after trimming", () => {
    const entries = Array.from({ length: 800 }, (_value, index) =>
      logEntry({ raw: `entry-${index}` }),
    );
    const entryKeys = new Set(entries.map(entryKey));
    const incoming = logEntry({ raw: "entry-800" });

    const nextEntries = appendLogEntry(entries, incoming, entryKeys);

    expect(nextEntries).toHaveLength(800);
    expect(nextEntries[0]?.raw).toBe("entry-1");
    expect(nextEntries.at(-1)).toBe(incoming);
    expect(entryKeys.has(entryKey(entries[0]!))).toBe(false);
    expect(entryKeys.has(entryKey(incoming))).toBe(true);
    expect(entryKeys.size).toBe(800);
  });

  test("filters visible entries while summarizing errors and warnings across all entries", () => {
    const entries = [
      logEntry({ level: "info", raw: "ready", sourceId: "docker", sourceName: "Docker" }),
      logEntry({ level: "warn", raw: "slow", sourceId: "docker", sourceName: "Docker" }),
      logEntry({ level: "error", raw: "failed", sourceId: "file", sourceName: "File" }),
      logEntry({ level: "fatal", raw: "panic", sourceId: "file", sourceName: "File" }),
    ];

    const result = filterAndSummarizeLogs(entries, {
      activeSourceId: "docker",
      level: "warn",
      queryText: "slow",
    });

    expect(result.summary).toEqual({ errors: 2, warnings: 1 });
    expect(result.visibleEntries.map((entry) => entry.raw)).toEqual(["slow"]);
  });

  test("returns newest entries first with the display limit applied", () => {
    const entries = Array.from({ length: 205 }, (_value, index) =>
      logEntry({ raw: `entry-${index}` }),
    );

    const visibleEntries = newestFirstLogEntries(entries);

    expect(visibleEntries).toHaveLength(200);
    expect(visibleEntries[0]?.raw).toBe("entry-204");
    expect(visibleEntries.at(-1)?.raw).toBe("entry-5");
  });
});

function logEntry({
  level = "info",
  raw,
  sourceId = "source",
  sourceName = "Source",
}: {
  level?: LogEntryLevel;
  raw: string;
  sourceId?: string;
  sourceName?: string;
}): DashboardLogEntry {
  return {
    id: `${sourceId}:${raw}`,
    sourceId,
    sourceKind: "file",
    sourceName,
    level,
    timestamp: "2026-01-01T00:00:00.000Z",
    message: raw,
    raw,
    metadata: null,
  };
}

function entryKey(entry: DashboardLogEntry): string {
  return `${entry.sourceId}:${entry.timestamp ?? ""}:${entry.raw}`;
}
