"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type * as React from "react";
import { Clipboard, Download, Pause, Play, RefreshCw, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LogEntryRow } from "@/components/dashboard/components/log-entry-row";
import { EmptyPanel, ErrorPanel, LoadingPanel } from "@/components/dashboard/components/panels";
import { StatusText } from "@/components/dashboard/components/status-dot";
import type { StatusTone } from "@/components/dashboard/components/status-dot";
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

type StreamState = "idle" | "live" | "paused" | "reconnecting";

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
  const [streamState, setStreamState] = useState<StreamState>("idle");

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
    return <LoadingPanel label="Loading" />;
  }

  if (logs.status === "error") {
    return <ErrorPanel title="Logs unavailable" message={logs.error} onRetry={onRefresh} />;
  }

  if (availableSources.length === 0) {
    return (
      <EmptyPanel
        title="No log sources"
        message="Logs appear here once the bot runs in Docker or writes output to a file."
      />
    );
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <StatusText tone={streamTone(streamState)} className="text-muted-foreground">
          {streamLabel(streamState)}
        </StatusText>
        <p className="text-sm text-muted-foreground tabular-nums">
          {summaryLine(visibleEntries.length, summary)}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-56">
          <Search
            aria-hidden="true"
            className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            aria-label="Search logs"
            name="log-search"
            autoComplete="off"
            className="h-9 pl-9"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search"
            spellCheck={false}
          />
        </div>
        <Select value={level} onValueChange={(value) => setLevel(value as LogEntryLevel | "all")}>
          <SelectTrigger aria-label="Level" className="h-9 w-32">
            <SelectValue placeholder="Level" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All levels</SelectItem>
            {logLevels.map((item) => (
              <SelectItem key={item} value={item}>
                {levelLabel(item)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {availableSources.length > 1 ? (
          <Select value={activeSourceId} onValueChange={setSourceId}>
            <SelectTrigger aria-label="Source" className="h-9 w-40">
              <SelectValue placeholder="Source" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sources</SelectItem>
              {availableSources.map((source) => (
                <SelectItem key={source.id} value={source.id}>
                  {sourceLabel(source.name)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-9 text-muted-foreground hover:text-foreground"
            aria-pressed={liveTail}
            aria-label={liveTail ? "Pause live tail" : "Resume live tail"}
            title={liveTail ? "Pause live tail" : "Resume live tail"}
            onClick={() => setLiveTail((current) => !current)}
          >
            {liveTail ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-9 text-muted-foreground hover:text-foreground"
            aria-label="Refresh"
            title="Refresh"
            onClick={onRefresh}
          >
            <RefreshCw aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-9 text-muted-foreground hover:text-foreground"
            aria-label="Copy shown entries"
            title="Copy shown entries"
            onClick={() => void copyLogEntries(shownEntries)}
            disabled={shownEntries.length === 0}
          >
            <Clipboard aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-9 text-muted-foreground hover:text-foreground"
            aria-label="Download shown entries"
            title="Download shown entries"
            onClick={() => downloadLogEntries(shownEntries)}
            disabled={shownEntries.length === 0}
          >
            <Download aria-hidden="true" />
          </Button>
        </div>
      </div>

      {shownEntries.length === 0 ? (
        <EmptyPanel title="No matching entries" message="Try a different search or filter." />
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <div className="max-h-[42rem] overflow-auto overscroll-contain">
            <div className="divide-y">
              {shownEntries.map((entry) => (
                <LogEntryRow key={entry.id} entry={entry} />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ensureEntryKeys(ref: React.MutableRefObject<Set<string> | null>): Set<string> {
  ref.current ??= new Set();
  return ref.current;
}

function streamTone(streamState: StreamState): StatusTone {
  switch (streamState) {
    case "live":
      return "ok";
    case "paused":
      return "neutral";
    case "reconnecting":
      return "warning";
    case "idle":
      return "neutral";
  }
}

function streamLabel(streamState: StreamState): string {
  switch (streamState) {
    case "live":
      return "Live";
    case "paused":
      return "Paused";
    case "reconnecting":
      return "Reconnecting";
    case "idle":
      return "Captured output";
  }
}

function summaryLine(shown: number, summary: { errors: number; warnings: number }): string {
  const parts = [`${formatCount(shown)} entries`];
  if (summary.errors > 0) {
    parts.push(`${formatCount(summary.errors)} errors`);
  }
  if (summary.warnings > 0) {
    parts.push(`${formatCount(summary.warnings)} warnings`);
  }
  return parts.join(" · ");
}

function sourceLabel(name: string): string {
  if (name === "Docker" || name === "Local Process") {
    return name;
  }

  return name.split("/").at(-1) ?? name;
}
