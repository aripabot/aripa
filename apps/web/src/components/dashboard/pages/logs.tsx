"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type * as React from "react";
import { Clipboard, Download, Filter, Pause, Play, RefreshCw, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LogEntryRow } from "@/components/dashboard/components/log-entry-row";
import { LogMetric } from "@/components/dashboard/components/log-metric";
import { EmptyPanel, ErrorPanel, LoadingPanel } from "@/components/dashboard/components/panels";
import { formatCount } from "@/components/dashboard/lib/format";
import {
  appendLogEntry,
  copyLogEntries,
  downloadLogEntries,
  filterAndSummarizeLogs,
  levelLabel,
  logEntryKey,
  logLevels,
  newestFirstLogEntries,
} from "@/components/dashboard/lib/log-utils";
import type { DashboardLogEntry, LogEntryLevel, LogsResponse } from "@/lib/api-types";
import type { LoadState } from "@/server/dashboard-page-data";

export function LogsPage({
  logs,
  onRefresh,
}: {
  logs: LoadState<LogsResponse>;
  onRefresh: () => void;
}) {
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState<LogEntryLevel | "all">("all");
  const [sourceId, setSourceId] = useState("all");
  const [liveTail, setLiveTail] = useState(true);
  const [entries, setEntries] = useState<DashboardLogEntry[]>([]);
  const entryKeysRef = useRef<Set<string> | null>(null);
  const [streamState, setStreamState] = useState<"idle" | "live" | "paused" | "reconnecting">(
    "idle",
  );

  useEffect(() => {
    if (logs.status === "ready") {
      setEntries(logs.data.entries);
      const entryKeys = ensureEntryKeys(entryKeysRef);
      entryKeys.clear();
      for (const entry of logs.data.entries) {
        entryKeys.add(logEntryKey(entry));
      }
    }
  }, [logs]);

  const dockerSourceId = useMemo(() => {
    if (logs.status !== "ready") {
      return null;
    }

    return (
      logs.data.sources.find((source) => source.kind === "docker" && source.available)?.id ?? null
    );
  }, [logs]);

  useEffect(() => {
    if (dockerSourceId === null) {
      setStreamState("idle");
      return;
    }

    if (!liveTail) {
      setStreamState("paused");
      return;
    }

    const eventSource = new EventSource(
      `/api/log-stream?source=${encodeURIComponent(dockerSourceId)}`,
    );

    eventSource.addEventListener("open", () => setStreamState("live"));
    eventSource.addEventListener("log", (event) => {
      const entry = JSON.parse(event.data) as DashboardLogEntry;
      setEntries((current) => appendLogEntry(current, entry, ensureEntryKeys(entryKeysRef)));
    });
    eventSource.addEventListener("stream-error", () => setStreamState("reconnecting"));
    eventSource.addEventListener("done", () => setStreamState("reconnecting"));
    eventSource.addEventListener("error", () => setStreamState("reconnecting"));

    return () => {
      eventSource.close();
    };
  }, [dockerSourceId, liveTail]);

  const availableSources = useMemo(
    () => (logs.status === "ready" ? logs.data.sources.filter((source) => source.available) : []),
    [logs],
  );
  const activeSourceId =
    sourceId === "all" || availableSources.some((source) => source.id === sourceId)
      ? sourceId
      : "all";
  const queryText = query.trim().toLowerCase();
  const { summary, visibleEntries } = useMemo(
    () => filterAndSummarizeLogs(entries, { activeSourceId, level, queryText }),
    [activeSourceId, entries, level, queryText],
  );
  const shownEntries = useMemo(() => newestFirstLogEntries(visibleEntries), [visibleEntries]);

  if (logs.status === "loading") {
    return <LoadingPanel label="Loading logs" />;
  }

  if (logs.status === "error") {
    return <ErrorPanel title="Logs unavailable" message={logs.error} onRetry={onRefresh} />;
  }

  return (
    <div className="grid gap-5">
      <section className="overflow-hidden rounded-lg border bg-card">
        <div className="grid gap-4 border-b p-4 lg:grid-cols-[1.2fr_2fr] lg:items-center">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-2 rounded-md bg-foreground px-2.5 py-1 text-sm font-medium text-background">
                <span className="size-2 rounded-full bg-current" aria-hidden="true" />
                {logCaptureLabel(availableSources.length, streamState)}
              </span>
              <span className="text-sm text-muted-foreground">
                {formatCount(entries.length)} recent entries
              </span>
            </div>
            <p className="mt-2 break-words text-sm text-muted-foreground">
              {primaryLogDetail(logs.data)}
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <LogMetric label="Errors" value={summary.errors} tone="error" />
            <LogMetric label="Warnings" value={summary.warnings} tone="warn" />
            <LogMetric label="Sources" value={availableSources.length} tone="default" />
          </div>
        </div>
        <div className="grid gap-3 p-4 lg:grid-cols-[minmax(16rem,1fr)_12rem_auto_auto] lg:items-center">
          <div className="relative min-w-0">
            <Search
              aria-hidden="true"
              className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              aria-label="Search Logs"
              name="log-search"
              autoComplete="off"
              className="pl-9"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search logs…"
              spellCheck={false}
            />
          </div>
          <Select value={level} onValueChange={(value) => setLevel(value as LogEntryLevel | "all")}>
            <SelectTrigger aria-label="Filter by Level">
              <Filter aria-hidden="true" />
              <SelectValue placeholder="Level" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Levels</SelectItem>
              {logLevels.map((item) => (
                <SelectItem key={item} value={item}>
                  {levelLabel(item)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="outline"
            aria-pressed={liveTail}
            onClick={() => setLiveTail((current) => !current)}
          >
            {liveTail ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
            {liveTail ? "Pause" : "Tail"}
          </Button>
          <Button type="button" variant="outline" onClick={onRefresh}>
            <RefreshCw aria-hidden="true" />
            Refresh
          </Button>
        </div>
      </section>

      {availableSources.length === 0 ? (
        <EmptyPanel
          title="No Logs Available"
          message="Run Aripa in Docker, or start the local process with stdout written to a file."
        />
      ) : (
        <section className="min-w-0 overflow-hidden rounded-lg border bg-card">
          <div className="border-b p-4">
            <Tabs value={activeSourceId} onValueChange={setSourceId}>
              <TabsList className="h-auto max-w-full flex-wrap justify-start">
                <TabsTrigger value="all">All Logs</TabsTrigger>
                {availableSources.map((source) => (
                  <TabsTrigger key={source.id} value={source.id}>
                    {sourceTabLabel(source.name)}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>
          <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-pretty">Runtime Events</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Showing {formatCount(shownEntries.length)} of {formatCount(visibleEntries.length)}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => void copyLogEntries(shownEntries)}
                disabled={shownEntries.length === 0}
              >
                <Clipboard aria-hidden="true" />
                Copy
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => downloadLogEntries(shownEntries)}
                disabled={shownEntries.length === 0}
              >
                <Download aria-hidden="true" />
                Download
              </Button>
            </div>
          </div>

          {shownEntries.length === 0 ? (
            <div className="p-4">
              <EmptyPanel
                title="No Matching Entries"
                message="Adjust the search, level, or source filters."
              />
            </div>
          ) : (
            <div className="max-h-[42rem] overflow-auto overscroll-contain">
              <div className="min-w-[52rem] divide-y">
                {shownEntries.map((entry) => (
                  <LogEntryRow key={entry.id} entry={entry} />
                ))}
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function ensureEntryKeys(ref: React.MutableRefObject<Set<string> | null>): Set<string> {
  ref.current ??= new Set();
  return ref.current;
}

function logCaptureLabel(
  sourceCount: number,
  streamState: "idle" | "live" | "paused" | "reconnecting",
): string {
  if (sourceCount === 0) {
    return "No Stream Available";
  }

  switch (streamState) {
    case "live":
      return "Live Logs";
    case "paused":
      return "Tail Paused";
    case "reconnecting":
      return "Reconnecting";
    case "idle":
      return "Capturing Logs";
  }
}

function primaryLogDetail(logs: LogsResponse): string {
  const docker = logs.sources.find((source) => source.kind === "docker" && source.available);
  const process = logs.sources.find((source) => source.kind === "process" && source.available);
  const fileCount = logs.sources.filter(
    (source) => source.kind === "file" && source.available,
  ).length;

  if (docker) {
    return `Reading Docker output from ${docker.detail}.`;
  }

  if (process) {
    return `Reading captured output from ${process.detail}.`;
  }

  if (fileCount > 0) {
    return `Reading ${formatCount(fileCount)} local log ${fileCount === 1 ? "file" : "files"}.`;
  }

  return "Start Aripa with a captured log source to inspect runtime events here.";
}

function sourceTabLabel(name: string): string {
  if (name === "Docker" || name === "Local Process") {
    return name;
  }

  return name.split("/").at(-1) ?? name;
}
