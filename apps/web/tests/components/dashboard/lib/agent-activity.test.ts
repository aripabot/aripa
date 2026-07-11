import { describe, expect, test } from "vitest";
import type { AgentTrace, AgentTraceSpan } from "@aripabot/core/agent/traces.ts";

import {
  activityLabel,
  agentActivityExpiresAt,
  selectAgentActivity,
} from "@/components/dashboard/lib/agent-activity";

const now = Date.parse("2026-07-11T10:00:10.000Z");

describe("selectAgentActivity", () => {
  test("returns a stable idle state without traces", () => {
    expect(selectAgentActivity([], now)).toEqual({ kind: "idle", label: "Aripa is ready" });
  });

  test("features the most recently updated running trace", () => {
    const older = trace({ id: "older", sequence: 4 });
    const latest = trace({
      id: "latest",
      sequence: 8,
      spans: [span({ id: "search", kind: "tool", name: "search_web" })],
    });

    const activity = selectAgentActivity([older, latest], now);

    expect(activity).toMatchObject({
      kind: "running",
      label: "Aripa is searching the web",
      trace: { id: "latest" },
      activeSpan: { id: "search" },
      otherRunningCount: 1,
    });
  });

  test("keeps only the five most recent spans in the rail", () => {
    const spans = Array.from({ length: 7 }, (_, index) =>
      span({ id: `span-${index}`, status: "completed" }),
    );
    const activity = selectAgentActivity([trace({ spans })], now);

    expect(activity.kind).toBe("running");
    if (activity.kind !== "running") return;
    expect(activity.visibleSpans.map(({ id }) => id)).toEqual([
      "span-2",
      "span-3",
      "span-4",
      "span-5",
      "span-6",
    ]);
  });

  test("briefly preserves completion before returning to idle", () => {
    const endedAt = "2026-07-11T10:00:05.000Z";
    const completed = trace({
      status: "completed",
      endedAt,
    });

    expect(selectAgentActivity([completed], now)).toMatchObject({
      kind: "settled",
      label: "Reply sent",
    });
    expect(selectAgentActivity([completed], now + 4_000)).toEqual({
      kind: "idle",
      label: "Aripa is ready",
    });
    expect(agentActivityExpiresAt([completed])).toBe(Date.parse(endedAt) + 8_000);
  });

  test("shows a recent failure distinctly", () => {
    const failed = trace({
      status: "failed",
      endedAt: "2026-07-11T10:00:05.000Z",
    });

    expect(selectAgentActivity([failed], now)).toMatchObject({
      kind: "settled",
      label: "Run failed",
    });
  });
});

describe("activityLabel", () => {
  test.each([
    [span({ kind: "model" }), "Aripa is thinking"],
    [span({ kind: "reply" }), "Aripa is sending a reply"],
    [span({ kind: "tool", name: "request_context" }), "Aripa is reading recent messages"],
    [span({ kind: "tool", name: "run_action" }), "Aripa is running an action"],
    [span({ kind: "tool", name: "User confirmation" }), "Aripa is waiting for confirmation"],
    [span({ kind: "tool", name: "lookup_members" }), "Aripa is using lookup members"],
  ])("maps trace spans to concise copy", (value, expected) => {
    expect(activityLabel(value)).toBe(expected);
  });
});

function trace(overrides: Partial<AgentTrace> = {}): AgentTrace {
  return {
    id: "trace",
    guildId: "guild",
    channelId: "channel",
    messageId: "message",
    userId: "user",
    private: false,
    context: null,
    startedAt: "2026-07-11T10:00:00.000Z",
    endedAt: null,
    status: "running",
    reply: null,
    error: null,
    spans: [],
    sequence: 1,
    ...overrides,
  };
}

function span(overrides: Partial<AgentTraceSpan> = {}): AgentTraceSpan {
  return {
    id: "span",
    kind: "model",
    name: "model",
    stepNumber: 0,
    parentSpanId: null,
    startedAt: "2026-07-11T10:00:01.000Z",
    endedAt: null,
    status: "running",
    detail: null,
    result: null,
    usage: null,
    error: null,
    ...overrides,
  };
}
