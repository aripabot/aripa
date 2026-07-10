import { describe, expect, test } from "vitest";

import { AgentTraceStore } from "@aripabot/core/agent/traces.ts";

describe("AgentTraceStore", () => {
  test("reconstructs a completed trace and exposes incremental events", () => {
    let timestamp = Date.parse("2026-07-10T12:00:00.000Z");
    const store = new AgentTraceStore(":memory:", {
      now: () => new Date((timestamp += 25)),
    });

    const traceId = store.startTrace({
      guildId: "guild-1",
      channelId: "channel-1",
      messageId: "message-1",
      userId: "user-1",
      private: false,
      system: "Exact system prompt",
      prompt: "user: Exact conversation",
    });
    const firstSequence = store.latestSequence();
    const spanId = store.startSpan({
      traceId,
      kind: "model",
      name: "gpt-5",
      stepNumber: 0,
    });
    store.finishSpan({
      traceId,
      spanId,
      status: "completed",
      detail: { finishReason: "stop" },
      usage: {
        inputTokens: 12,
        outputTokens: 4,
        reasoningTokens: 2,
        cachedInputTokens: 3,
      },
    });
    store.finishTrace({ traceId, status: "completed", reply: "Done." });

    expect(store.getTrace(traceId)).toMatchObject({
      id: traceId,
      status: "completed",
      context: { system: "Exact system prompt", prompt: "user: Exact conversation" },
      reply: "Done.",
      spans: [
        {
          id: spanId,
          kind: "model",
          name: "gpt-5",
          status: "completed",
          usage: { inputTokens: 12, outputTokens: 4 },
        },
      ],
    });
    expect(store.listEventsAfter(firstSequence)).toHaveLength(3);
    expect(store.listTraces()).toHaveLength(1);
  });

  test("discards context and reply content for private traces", () => {
    const store = new AgentTraceStore(":memory:");
    const traceId = store.startTrace({
      guildId: "guild-1",
      channelId: "channel-1",
      messageId: "message-1",
      userId: "user-1",
      private: true,
      system: "secret system prompt",
      prompt: "secret conversation",
    });
    store.finishTrace({ traceId, status: "completed" });

    expect(store.getTrace(traceId)).toMatchObject({
      private: true,
      context: null,
      reply: null,
    });
    expect(JSON.stringify(store.listEventsAfter(0))).not.toContain("secret");
  });
});
