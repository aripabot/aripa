import type { AgentTrace, AgentTraceSpan } from "@aripabot/core/agent/traces.ts";

const RECENT_ACTIVITY_MS = 8_000;
const VISIBLE_SPAN_COUNT = 5;

export type AgentActivity =
  | {
      kind: "idle";
      label: "Aripa is ready";
    }
  | {
      kind: "running";
      label: string;
      trace: AgentTrace;
      activeSpan: AgentTraceSpan | null;
      visibleSpans: AgentTraceSpan[];
      otherRunningCount: number;
    }
  | {
      kind: "settled";
      label: "Reply sent" | "Run failed";
      trace: AgentTrace;
      visibleSpans: AgentTraceSpan[];
    };

export function selectAgentActivity(traces: readonly AgentTrace[], now: number): AgentActivity {
  const running = traces
    .filter((trace) => trace.status === "running")
    .sort((left, right) => right.sequence - left.sequence);
  const trace = running.at(0);

  if (trace) {
    const activeSpan = trace.spans.findLast((span) => span.status === "running") ?? null;
    return {
      kind: "running",
      label: activeSpan ? activityLabel(activeSpan) : "Aripa is getting started",
      trace,
      activeSpan,
      visibleSpans: visibleSpans(trace),
      otherRunningCount: running.length - 1,
    };
  }

  const latest = traces.toSorted((left, right) => right.sequence - left.sequence).at(0);
  if (!latest || !latest.endedAt || now - Date.parse(latest.endedAt) > RECENT_ACTIVITY_MS) {
    return { kind: "idle", label: "Aripa is ready" };
  }

  return {
    kind: "settled",
    label: latest.status === "failed" ? "Run failed" : "Reply sent",
    trace: latest,
    visibleSpans: visibleSpans(latest),
  };
}

export function agentActivityExpiresAt(traces: readonly AgentTrace[]): number | null {
  const latest = traces.toSorted((left, right) => right.sequence - left.sequence).at(0);
  return latest?.endedAt ? Date.parse(latest.endedAt) + RECENT_ACTIVITY_MS : null;
}

export function activityLabel(span: AgentTraceSpan): string {
  switch (span.kind) {
    case "model":
      return "Aripa is thinking";
    case "reply":
      return "Aripa is sending a reply";
    case "tool":
      return toolActivityLabel(span.name);
  }
}

function toolActivityLabel(name: string): string {
  switch (name) {
    case "search_web":
      return "Aripa is searching the web";
    case "request_context":
      return "Aripa is reading recent messages";
    case "run_action":
      return "Aripa is running an action";
    case "User confirmation":
      return "Aripa is waiting for confirmation";
  }

  const words = name.replaceAll("_", " ").trim().toLowerCase();
  return words ? `Aripa is using ${words}` : "Aripa is running a tool";
}

function visibleSpans(trace: AgentTrace): AgentTraceSpan[] {
  return trace.spans.slice(-VISIBLE_SPAN_COUNT);
}
