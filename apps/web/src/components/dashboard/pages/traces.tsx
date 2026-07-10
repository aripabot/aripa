"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { ArrowRight, Search } from "lucide-react";
import type { AgentTrace, AgentTraceStatus } from "@aripabot/core/agent/traces.ts";

import { EmptyPanel, ErrorPanel, LoadingPanel } from "@/components/dashboard/components/panels";
import { StatusDot, StatusText } from "@/components/dashboard/components/status-dot";
import { useTraceStream } from "@/components/dashboard/hooks/use-trace-stream";
import { useTraceClock } from "@/components/dashboard/hooks/use-trace-clock";
import { formatCount } from "@/components/dashboard/lib/format";
import {
  formatDuration,
  traceDurationMs,
  traceModel,
  traceToolNames,
  upsertTraces,
} from "@/components/dashboard/lib/trace-utils";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { DashboardStatus, TracesResponse } from "@/lib/api-types";
import type { LoadState } from "@/server/dashboard-page-data";

type StatusFilter = AgentTraceStatus | "all";

export function TracesPage({
  traces,
  status,
  onRefresh,
}: {
  traces: LoadState<TracesResponse>;
  status: LoadState<DashboardStatus>;
  onRefresh: () => void;
}) {
  const [items, setItems] = useState<AgentTrace[]>(
    traces.status === "ready" ? traces.data.traces : [],
  );
  const sequence = traces.status === "ready" ? traces.data.latestSequence : 0;
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const receiveTraces = useCallback((updates: AgentTrace[]) => {
    setItems((current) => upsertTraces(current, updates));
  }, []);
  const streamState = useTraceStream(sequence, receiveTraces);
  const now = useTraceClock(items.some((trace) => trace.status === "running"));
  const guildNames = useMemo(
    () =>
      new Map(
        status.status === "ready"
          ? status.data.operations.guilds.map((guild) => [guild.guildId, guild.name])
          : [],
      ),
    [status],
  );
  const visibleTraces = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter((trace) => {
      if (statusFilter !== "all" && trace.status !== statusFilter) return false;
      if (!needle) return true;
      return [
        trace.id,
        trace.guildId,
        trace.channelId,
        guildNames.get(trace.guildId),
        trace.context?.prompt,
        trace.reply,
        ...traceToolNames(trace),
      ].some((value) => value?.toLowerCase().includes(needle));
    });
  }, [guildNames, items, query, statusFilter]);

  if (traces.status === "loading") return <LoadingPanel label="Loading" />;
  if (traces.status === "error") {
    return <ErrorPanel title="Traces unavailable" message={traces.error} onRetry={onRefresh} />;
  }

  const failedCount = items.filter((trace) => trace.status === "failed").length;
  const runningCount = items.filter((trace) => trace.status === "running").length;

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b pb-5">
        <StatusText tone={streamState === "live" ? "ok" : "warning"}>
          {streamState === "live" ? "Live" : "Reconnecting"}
        </StatusText>
        <p className="text-sm text-muted-foreground tabular-nums">
          {formatCount(items.length)} runs
          {runningCount > 0 ? ` · ${formatCount(runningCount)} active` : ""}
          {failedCount > 0 ? ` · ${formatCount(failedCount)} failed` : ""}
        </p>
      </div>

      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Search
            className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            aria-label="Search traces"
            className="h-9 pl-9"
            placeholder="Search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <Select
          value={statusFilter}
          onValueChange={(value) => setStatusFilter(parseStatusFilter(value))}
        >
          <SelectTrigger aria-label="Status" className="h-9 w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="running">Running</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {visibleTraces.length === 0 ? (
        <EmptyPanel
          title={items.length === 0 ? "No traces yet" : "No matching traces"}
          message={
            items.length === 0
              ? "Agent runs appear here when someone mentions Aripa."
              : "Try a different search or status."
          }
        />
      ) : (
        <div className="divide-y border-y">
          {visibleTraces.map((trace) => (
            <TraceRow
              key={trace.id}
              trace={trace}
              guildName={guildNames.get(trace.guildId) ?? null}
              now={now}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function parseStatusFilter(value: string): StatusFilter {
  switch (value) {
    case "all":
    case "running":
    case "completed":
    case "failed":
      return value;
    default:
      throw new Error(`Unknown trace status: ${value}`);
  }
}

function TraceRow({
  trace,
  guildName,
  now,
}: {
  trace: AgentTrace;
  guildName: string | null;
  now: number;
}) {
  const tools = traceToolNames(trace);
  const model = traceModel(trace);
  const preview = trace.context?.prompt
    .split("\n\n")
    .at(-1)
    ?.replace(/^user \([^)]*\):\s*/, "");

  return (
    <Link
      href={`/traces/${trace.id}`}
      className="group grid gap-2 py-4 transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-3"
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2.5">
          <StatusDot tone={traceTone(trace.status)} />
          <p className="truncate text-sm font-medium">
            {preview || (trace.private ? "Private agent run" : "Agent run")}
          </p>
        </div>
        <p className="mt-1 truncate pl-4 text-sm text-muted-foreground">
          {guildName ?? trace.guildId} · #{trace.channelId}
        </p>
      </div>
      <div className="flex items-center justify-between gap-4 pl-4 text-sm text-muted-foreground sm:justify-end sm:pl-0">
        <div className="text-left sm:text-right">
          <p className="tabular-nums text-foreground">
            {formatDuration(traceDurationMs(trace, now))}
          </p>
          <p className="mt-1 truncate text-xs" title={trace.startedAt}>
            {[model, tools.join(", ")].filter(Boolean).join(" · ") || "No model steps"}
          </p>
        </div>
        <ArrowRight
          className="size-4 shrink-0 transition-transform group-hover:translate-x-0.5"
          aria-hidden="true"
        />
      </div>
    </Link>
  );
}

function traceTone(status: AgentTraceStatus): "ok" | "danger" | "neutral" {
  switch (status) {
    case "running":
      return "neutral";
    case "completed":
      return "ok";
    case "failed":
      return "danger";
  }
}
