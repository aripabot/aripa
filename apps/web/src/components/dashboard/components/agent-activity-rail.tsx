"use client";

import Link from "next/link";
import type { AgentTrace, AgentTraceSpan } from "@aripabot/core/agent/traces.ts";

import { useTraceClock } from "@/components/dashboard/hooks/use-trace-clock";
import {
  agentActivityExpiresAt,
  selectAgentActivity,
  type AgentActivity,
} from "@/components/dashboard/lib/agent-activity";
import { formatDuration, traceDurationMs } from "@/components/dashboard/lib/trace-utils";
import type { TraceStreamState } from "@/components/dashboard/hooks/use-trace-stream";
import { cn } from "@/lib/utils";

export function AgentActivityRail({
  traces,
  streamState,
  guildNames,
}: {
  traces: readonly AgentTrace[];
  streamState: TraceStreamState;
  guildNames: ReadonlyMap<string, string | null>;
}) {
  const running = traces.some((trace) => trace.status === "running");
  const clock = useTraceClock(running, agentActivityExpiresAt(traces));
  const activity = selectAgentActivity(traces, clock);
  const href = activity.kind === "idle" ? "/traces" : `/traces/${activity.trace.id}`;

  return (
    <Link
      href={href}
      aria-label="Agent activity"
      className="relative block overflow-hidden rounded-sm border bg-muted/30 px-4 py-4 transition-colors hover:bg-muted/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:px-5"
    >
      <div
        aria-live="polite"
        className="grid min-h-14 items-center gap-4 sm:grid-cols-[minmax(13rem,0.85fr)_minmax(12rem,1.15fr)]"
      >
        <ActivitySummary activity={activity} guildNames={guildNames} />
        <ActivityPath activity={activity} now={clock} />
      </div>
      {activity.kind === "running" ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-0 w-px bg-primary/50 motion-safe:animate-pulse"
        />
      ) : null}
      {streamState === "reconnecting" ? (
        <span className="sr-only">Live activity is reconnecting.</span>
      ) : null}
    </Link>
  );
}

function ActivitySummary({
  activity,
  guildNames,
}: {
  activity: AgentActivity;
  guildNames: ReadonlyMap<string, string | null>;
}) {
  if (activity.kind === "idle") {
    return (
      <div className="min-w-0">
        <p className="text-sm font-medium">{activity.label}</p>
        <p className="mt-1 text-xs text-muted-foreground">Waiting for the next mention</p>
      </div>
    );
  }

  const { trace } = activity;
  const location = `${guildNames.get(trace.guildId) ?? trace.guildId} · #${trace.channelId}`;

  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className={cn(
            "relative size-2 shrink-0 rounded-full",
            activity.kind === "settled" && trace.status === "failed"
              ? "bg-destructive"
              : activity.kind === "running"
                ? "bg-primary"
                : "bg-emerald-500",
          )}
        >
          {activity.kind === "running" ? (
            <span className="absolute inset-0 rounded-full bg-primary/50 motion-safe:animate-ping" />
          ) : null}
        </span>
        <p className="truncate text-sm font-medium">{activity.label}</p>
      </div>
      <p className="mt-1 truncate pl-4 text-xs text-muted-foreground" title={location}>
        {location}
        {activity.kind === "running" && activity.otherRunningCount > 0
          ? ` · ${activity.otherRunningCount} other ${activity.otherRunningCount === 1 ? "run" : "runs"} active`
          : null}
      </p>
    </div>
  );
}

function ActivityPath({ activity, now }: { activity: AgentActivity; now: number }) {
  if (activity.kind === "idle") {
    return (
      <div aria-hidden="true" className="flex items-center gap-2 opacity-45">
        <span className="size-2 rounded-full border border-muted-foreground/40" />
        <span className="h-px flex-1 bg-border" />
        <span className="size-2 rounded-full border border-muted-foreground/40" />
        <span className="h-px flex-1 bg-border" />
        <span className="size-2 rounded-full border border-muted-foreground/40" />
      </div>
    );
  }

  const currentSpanId = activity.kind === "running" ? activity.activeSpan?.id : undefined;

  return (
    <div className="min-w-0">
      <div aria-hidden="true" className="flex items-center">
        {activity.visibleSpans.map((span, index) => (
          <ActivityNode
            key={span.id}
            span={span}
            current={span.id === currentSpanId}
            showConnector={index > 0}
          />
        ))}
        {activity.kind === "running" && activity.visibleSpans.length === 0 ? (
          <span className="relative size-2.5 shrink-0 rounded-full bg-primary ring-4 ring-primary/10">
            <span className="absolute inset-0 rounded-full bg-primary/50 motion-safe:animate-ping" />
          </span>
        ) : null}
      </div>
      <p className="mt-2 text-xs text-muted-foreground tabular-nums" suppressHydrationWarning>
        {formatDuration(traceDurationMs(activity.trace, now))}
      </p>
    </div>
  );
}

function ActivityNode({
  span,
  current,
  showConnector,
}: {
  span: AgentTraceSpan;
  current: boolean;
  showConnector: boolean;
}) {
  return (
    <>
      {showConnector ? (
        <span
          className={cn(
            "relative h-px min-w-4 flex-1 overflow-hidden bg-border",
            current &&
              "after:absolute after:inset-0 after:-translate-x-full after:bg-gradient-to-r after:from-transparent after:via-primary/70 after:to-transparent after:motion-safe:animate-[activity-flow_1.8s_ease-in-out_infinite]",
          )}
        />
      ) : null}
      <span
        className={cn(
          "relative size-2.5 shrink-0 rounded-full transition-colors",
          span.status === "failed"
            ? "bg-destructive"
            : current
              ? "bg-primary ring-4 ring-primary/10"
              : span.status === "completed"
                ? "bg-foreground/55"
                : "bg-muted-foreground/35",
        )}
      >
        {current ? (
          <span className="absolute inset-0 rounded-full bg-primary/50 motion-safe:animate-ping" />
        ) : null}
      </span>
    </>
  );
}
