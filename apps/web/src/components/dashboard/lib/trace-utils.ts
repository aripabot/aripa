import type { AgentTrace, AgentTraceSpan } from "@aripabot/core/agent/traces.ts";

export function traceDurationMs(trace: AgentTrace, now = Date.now()): number {
  return Math.max(
    0,
    (trace.endedAt ? Date.parse(trace.endedAt) : now) - Date.parse(trace.startedAt),
  );
}

export function spanDurationMs(span: AgentTraceSpan, now = Date.now()): number {
  return Math.max(0, (span.endedAt ? Date.parse(span.endedAt) : now) - Date.parse(span.startedAt));
}

export function formatDuration(durationMs: number): string {
  if (durationMs < 1_000) return `${Math.round(durationMs)} ms`;
  if (durationMs < 10_000) return `${(durationMs / 1_000).toFixed(1)} s`;
  return `${Math.round(durationMs / 1_000)} s`;
}

export function upsertTraces(
  current: readonly AgentTrace[],
  updates: readonly AgentTrace[],
): AgentTrace[] {
  const byId = new Map(current.map((trace) => [trace.id, trace]));
  for (const trace of updates) byId.set(trace.id, trace);
  return [...byId.values()].sort((left, right) => right.startedAt.localeCompare(left.startedAt));
}

export function traceToolNames(trace: AgentTrace): string[] {
  return [...new Set(trace.spans.filter((span) => span.kind === "tool").map((span) => span.name))];
}

export function traceModel(trace: AgentTrace): string | null {
  return trace.spans.find((span) => span.kind === "model")?.name ?? null;
}
