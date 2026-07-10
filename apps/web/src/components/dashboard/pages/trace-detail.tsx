"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { ArrowLeft, Copy } from "lucide-react";
import type { AgentTrace, AgentTraceSpan } from "@aripabot/core/agent/traces.ts";

import { ErrorPanel, LoadingPanel } from "@/components/dashboard/components/panels";
import { StatusDot } from "@/components/dashboard/components/status-dot";
import { useTraceStream } from "@/components/dashboard/hooks/use-trace-stream";
import { useTraceClock } from "@/components/dashboard/hooks/use-trace-clock";
import { formatCount, formatDateTime } from "@/components/dashboard/lib/format";
import {
  formatDuration,
  spanDurationMs,
  traceDurationMs,
} from "@/components/dashboard/lib/trace-utils";
import { Button } from "@/components/ui/button";
import type { DashboardStatus, TraceResponse } from "@/lib/api-types";
import type { LoadState } from "@/server/dashboard-page-data";

export function TraceDetailPage({
  initialTrace,
  status,
}: {
  initialTrace: LoadState<TraceResponse>;
  status: LoadState<DashboardStatus>;
}) {
  if (initialTrace.status === "loading") return <LoadingPanel label="Loading" />;
  if (initialTrace.status === "error") {
    return (
      <ErrorPanel
        title="Trace unavailable"
        message={initialTrace.error}
        onRetry={() => window.location.reload()}
      />
    );
  }
  return <LiveTraceDetail initial={initialTrace.data} status={status} />;
}

function LiveTraceDetail({
  initial,
  status,
}: {
  initial: TraceResponse;
  status: LoadState<DashboardStatus>;
}) {
  const [trace, setTrace] = useState(initial.trace);
  const receiveTraces = useCallback(
    (updates: AgentTrace[]) => {
      const update = updates.find((candidate) => candidate.id === initial.trace.id);
      if (update) setTrace(update);
    },
    [initial.trace.id],
  );
  useTraceStream(initial.latestSequence, receiveTraces);
  const now = useTraceClock(trace.status === "running");
  const guildName =
    status.status === "ready"
      ? status.data.operations.guilds.find((guild) => guild.guildId === trace.guildId)?.name
      : null;

  return (
    <div className="grid gap-8">
      <div>
        <Link
          href="/traces"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Traces
        </Link>
        <div className="mt-5 flex flex-col gap-4 border-b pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <StatusDot
                tone={
                  trace.status === "failed"
                    ? "danger"
                    : trace.status === "completed"
                      ? "ok"
                      : "neutral"
                }
              />
              <h2 className="text-lg font-semibold tracking-tight">{traceTitle(trace, now)}</h2>
            </div>
            <p className="mt-2 break-all text-sm text-muted-foreground" suppressHydrationWarning>
              {guildName ?? trace.guildId} · #{trace.channelId} · {formatDateTime(trace.startedAt)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3 text-sm tabular-nums">
            <Datum label="Duration" value={formatDuration(traceDurationMs(trace, now))} />
            <Datum
              label="Steps"
              value={formatCount(trace.spans.filter((span) => span.kind === "model").length)}
            />
            <Datum
              label="Tools"
              value={formatCount(trace.spans.filter((span) => span.kind === "tool").length)}
            />
          </div>
        </div>
      </div>

      <TraceTimeline trace={trace} now={now} />

      {trace.error ? (
        <section className="border-l-2 border-destructive pl-4">
          <h2 className="text-sm font-medium">Run failed</h2>
          <p className="mt-1 text-sm text-muted-foreground">{trace.error}</p>
        </section>
      ) : null}

      <TraceContext trace={trace} />

      <section className="grid gap-3 border-t pt-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-medium">Trace ID</h2>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground"
            aria-label="Copy trace ID"
            title="Copy trace ID"
            onClick={() => void navigator.clipboard.writeText(trace.id)}
          >
            <Copy aria-hidden="true" />
          </Button>
        </div>
        <code className="break-all text-xs text-muted-foreground" translate="no">
          {trace.id}
        </code>
      </section>
    </div>
  );
}

function TraceTimeline({ trace, now }: { trace: AgentTrace; now: number }) {
  const [selectedId, setSelectedId] = useState<string | null>(trace.spans.at(0)?.id ?? null);
  const selected = trace.spans.find((span) => span.id === selectedId) ?? trace.spans.at(0) ?? null;
  const totalMs = Math.max(traceDurationMs(trace, now), 1);

  return (
    <section className="grid gap-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-medium">Timeline</h2>
        <span className="text-xs text-muted-foreground tabular-nums">
          {formatDuration(totalMs)}
        </span>
      </div>
      {trace.spans.length === 0 ? (
        <p className="border-y py-5 text-sm text-muted-foreground">
          Waiting for the first model step.
        </p>
      ) : (
        <div className="grid gap-5">
          <div className="grid gap-2 border-y py-4">
            {trace.spans.map((span) => {
              const offsetMs = Math.max(
                0,
                Date.parse(span.startedAt) - Date.parse(trace.startedAt),
              );
              const left = Math.min((offsetMs / totalMs) * 100, 98);
              const width = Math.max((spanDurationMs(span, now) / totalMs) * 100, 1.5);
              return (
                <button
                  key={span.id}
                  type="button"
                  className="group grid grid-cols-[7.5rem_minmax(0,1fr)_4.5rem] items-center gap-3 rounded-sm px-1 py-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => setSelectedId(span.id)}
                >
                  <span className="truncate text-xs text-muted-foreground">{spanLabel(span)}</span>
                  <span className="relative h-2 bg-muted">
                    <span
                      className={`absolute inset-y-0 rounded-sm transition-opacity ${spanBarClass(span)} ${selected?.id === span.id ? "opacity-100" : "opacity-65 group-hover:opacity-90"}`}
                      style={{ left: `${left}%`, width: `${Math.min(width, 100 - left)}%` }}
                    />
                  </span>
                  <span className="text-right text-xs text-muted-foreground tabular-nums">
                    {formatDuration(spanDurationMs(span, now))}
                  </span>
                </button>
              );
            })}
          </div>
          {selected ? (
            <SpanInspector span={selected} privateTrace={trace.private} now={now} />
          ) : null}
        </div>
      )}
    </section>
  );
}

function SpanInspector({
  span,
  privateTrace,
  now,
}: {
  span: AgentTraceSpan;
  privateTrace: boolean;
  now: number;
}) {
  const detail = span.result ?? span.detail;
  return (
    <div className="grid gap-4 bg-muted/35 p-4 sm:grid-cols-[10rem_minmax(0,1fr)] sm:p-5">
      <div>
        <p className="text-sm font-medium">{spanLabel(span)}</p>
        <p className="mt-1 text-xs text-muted-foreground tabular-nums">
          {formatDuration(spanDurationMs(span, now))}
        </p>
      </div>
      <div className="min-w-0">
        {span.error ? <p className="text-sm text-destructive">{span.error}</p> : null}
        {span.usage ? (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
            <Datum label="Input" value={formatOptionalCount(span.usage.inputTokens)} />
            <Datum label="Output" value={formatOptionalCount(span.usage.outputTokens)} />
            <Datum label="Reasoning" value={formatOptionalCount(span.usage.reasoningTokens)} />
            <Datum label="Cached" value={formatOptionalCount(span.usage.cachedInputTokens)} />
          </dl>
        ) : null}
        {detail !== null ? (
          <pre
            className="mt-4 max-h-72 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-5"
            translate="no"
          >
            {JSON.stringify(detail, null, 2)}
          </pre>
        ) : privateTrace ? (
          <p className="text-sm text-muted-foreground">Details are hidden by private logs.</p>
        ) : null}
      </div>
    </div>
  );
}

function TraceContext({ trace }: { trace: AgentTrace }) {
  if (!trace.context) {
    return (
      <section className="grid gap-2 border-t pt-5">
        <h2 className="text-sm font-medium">Agent context</h2>
        <p className="text-sm text-muted-foreground">Context is hidden by private logs.</p>
      </section>
    );
  }

  const messages = trace.context.prompt.split("\n\n").filter(Boolean);
  return (
    <section className="grid gap-6 border-t pt-5">
      <div>
        <h2 className="text-sm font-medium">Agent context</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          The exact instructions and conversation sent for this run.
        </p>
      </div>
      <details className="group border-b pb-5">
        <summary className="cursor-pointer list-none text-sm font-medium marker:hidden">
          System instructions
        </summary>
        <pre
          className="mt-4 max-h-[32rem] overflow-auto whitespace-pre-wrap break-words bg-muted/35 p-5 font-sans text-sm leading-6"
          translate="no"
        >
          {trace.context.system}
        </pre>
      </details>
      <div className="grid gap-3">
        <h3 className="text-sm font-medium">Conversation</h3>
        <div className="divide-y border-y">
          {messages.map((message, index) => (
            <ContextMessage key={`${index}:${message.slice(0, 24)}`} message={message} />
          ))}
        </div>
      </div>
      {trace.reply ? (
        <div className="grid gap-3">
          <h3 className="text-sm font-medium">Reply</h3>
          <p className="whitespace-pre-wrap border-l-2 border-primary/50 pl-4 text-sm leading-6">
            {trace.reply}
          </p>
        </div>
      ) : null}
    </section>
  );
}

function ContextMessage({ message }: { message: string }) {
  const parsed = parseContextMessage(message);
  return (
    <article className="grid gap-1 py-4 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-4">
      <p className="truncate text-xs text-muted-foreground" title={parsed.source}>
        {parsed.label}
      </p>
      <p className="whitespace-pre-wrap break-words text-sm leading-6">{parsed.content}</p>
    </article>
  );
}

function parseContextMessage(message: string): {
  label: string;
  source: string;
  content: string;
} {
  const match = message.match(
    /^(?:(CONTEXT ONLY[^\n]*)\n)?(user \((?:[^)]*)\)|assistant):\s*([\s\S]*)$/,
  );
  if (!match) return { label: "Context", source: "Context", content: message };

  const notice = match[1];
  const source = match[2] ?? "Context";
  const content = match[3] ?? "";
  if (notice) return { label: "Background", source, content };
  if (source === "assistant") return { label: "Aripa", source, content };
  const username = source.match(/username: ([^,)]+)/)?.[1];
  return { label: username ? `User · ${username}` : "User", source, content };
}

function Datum({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm tabular-nums">{value}</p>
    </div>
  );
}

function traceTitle(trace: AgentTrace, now: number): string {
  switch (trace.status) {
    case "running":
      return "Running";
    case "completed":
      return `Completed in ${formatDuration(traceDurationMs(trace, now))}`;
    case "failed":
      return `Failed after ${formatDuration(traceDurationMs(trace, now))}`;
  }
}

function spanLabel(span: AgentTraceSpan): string {
  switch (span.kind) {
    case "model":
      return `Step ${(span.stepNumber ?? 0) + 1} · ${span.name}`;
    case "tool":
      return span.name.replaceAll("_", " ");
    case "reply":
      return "Reply";
  }
}

function spanBarClass(span: AgentTraceSpan): string {
  if (span.status === "failed") return "bg-destructive";
  switch (span.kind) {
    case "model":
      return "bg-foreground";
    case "tool":
      return "bg-primary";
    case "reply":
      return "bg-muted-foreground";
  }
}

function formatOptionalCount(value: number | null): string {
  return value === null ? "—" : formatCount(value);
}
