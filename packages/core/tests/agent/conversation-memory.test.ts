import { describe, expect, test } from "vitest";
import {
  ConversationMemoryStore,
  createRawMemoryTurn,
  type RawMemoryTurn,
} from "@aripabot/core/agent/conversation-memory.ts";

describe("ConversationMemoryStore", () => {
  test("records turns and formats context for the current invoker", () => {
    const store = new ConversationMemoryStore();

    store.recordTurn("channel-1", [
      createTurn("m1", "user-1", "hello", 1),
      createTurn("m2", "bot-1", "hi", 2, { bot: true }),
      createTurn("m3", "user-2", "background", 3),
    ]);

    expect(
      store.getContext("channel-1", { invokerId: "user-1", assistantUserId: "bot-1" }),
    ).toMatchObject({
      summary: null,
      formattedTurns: [
        "user (username: user-1-name, id: user-1): hello",
        "assistant: hi",
        "CONTEXT ONLY, MAY BE USEFUL. DO NOT RESPOND DIRECTLY TO THIS MESSAGE\nuser (username: user-2-name, id: user-2): background",
      ],
      lastSeenMessageId: "m3",
    });

    expect(
      store.getContext("channel-1", { invokerId: "user-2", assistantUserId: "bot-1" })
        ?.formattedTurns,
    ).toEqual([
      "CONTEXT ONLY, MAY BE USEFUL. DO NOT RESPOND DIRECTLY TO THIS MESSAGE\nuser (username: user-1-name, id: user-1): hello",
      "assistant: hi",
      "user (username: user-2-name, id: user-2): background",
    ]);
  });

  test("evicts idle entries and caps channels by least-recent use", () => {
    let now = 1_000;
    const store = new ConversationMemoryStore({
      idleTtlMs: 100,
      maxChannels: 2,
      now: () => now,
    });

    store.recordTurn("old", [createTurn("old-1", "user-1", "old", now)]);
    now = 1_050;
    store.recordTurn("kept", [createTurn("kept-1", "user-1", "kept", now)]);
    expect(store.getContext("old", { invokerId: "user-1" })).not.toBeNull();

    now = 1_120;
    store.recordTurn("new", [createTurn("new-1", "user-1", "new", now)]);
    expect(store.getContext("old", { invokerId: "user-1" })).not.toBeNull();
    expect(store.getContext("new", { invokerId: "user-1" })).not.toBeNull();
    expect(store.getTrackedChannelCountForTests()).toBe(2);

    now = 1_300;
    expect(store.getContext("old", { invokerId: "user-1" })).toBeNull();
    expect(store.getTrackedChannelCountForTests()).toBe(0);
  });

  test("detects compaction threshold", () => {
    const store = new ConversationMemoryStore({ maxVerbatimChars: 5 });

    store.recordTurn("channel-1", [createTurn("m1", "user-1", "hello!", 1)]);

    expect(store.needsCompaction("channel-1")).toBe(true);
    expect(store.needsCompaction("missing")).toBe(false);
  });

  test("compacts old turns, merges previous summary, and preserves concurrent appends", async () => {
    const store = new ConversationMemoryStore({
      keepRecentTurns: 1,
      maxSummaryChars: 40,
    });
    const log = createLog();
    let summarizedMessages: readonly string[] = [];
    let previousSummary: string | null | undefined;

    store.recordTurn("channel-1", [
      createTurn("m1", "user-1", "first", 1),
      createTurn("m2", "bot-1", "second", 2, { bot: true }),
      createTurn("m3", "user-1", "third", 3),
    ]);
    await store.compact(
      "channel-1",
      async (messages, options) => {
        summarizedMessages = messages;
        previousSummary = options?.previousSummary;
        store.recordTurn("channel-1", [createTurn("m4", "user-1", "during", 4)]);
        return "A compacted summary that is intentionally longer than forty characters.";
      },
      {
        invokerId: "user-1",
        assistantUserId: "bot-1",
        log,
      },
    );

    expect(summarizedMessages).toEqual([
      "user (username: user-1-name, id: user-1): first",
      "assistant: second",
    ]);
    expect(previousSummary).toBeNull();
    expect(
      store.getContext("channel-1", { invokerId: "user-1", assistantUserId: "bot-1" }),
    ).toMatchObject({
      summary: "A compacted summary that is intentionall",
      formattedTurns: [
        "user (username: user-1-name, id: user-1): third",
        "user (username: user-1-name, id: user-1): during",
      ],
      lastSeenMessageId: "m4",
    });
  });

  test("compaction guard prevents duplicate work", async () => {
    const store = new ConversationMemoryStore({ keepRecentTurns: 1 });
    let calls = 0;

    store.recordTurn("channel-1", [
      createTurn("m1", "user-1", "first", 1),
      createTurn("m2", "user-1", "second", 2),
    ]);

    await Promise.all([
      store.compact(
        "channel-1",
        async () => {
          calls += 1;
          await new Promise((resolve) => setTimeout(resolve, 10));
          return "summary";
        },
        { invokerId: "user-1", log: createLog() },
      ),
      store.compact("channel-1", async () => "duplicate", {
        invokerId: "user-1",
        log: createLog(),
      }),
    ]);

    expect(calls).toBe(1);
  });

  test("failed compaction leaves state intact until hard cap trimming is needed", async () => {
    const store = new ConversationMemoryStore({
      keepRecentTurns: 1,
      hardCapChars: 8,
    });

    store.recordTurn("channel-1", [
      createTurn("m1", "user-1", "12345", 1),
      createTurn("m2", "user-1", "67890", 2),
      createTurn("m3", "user-1", "abc", 3),
    ]);

    await store.compact(
      "channel-1",
      async () => {
        throw new Error("nope");
      },
      { invokerId: "user-1", log: createLog() },
    );

    expect(store.getContext("channel-1", { invokerId: "user-1" })?.formattedTurns).toEqual([
      "user (username: user-1-name, id: user-1): 67890",
      "user (username: user-1-name, id: user-1): abc",
    ]);
  });
});

function createTurn(
  id: string,
  authorId: string,
  content: string,
  createdTimestamp: number,
  options: { bot?: boolean; username?: string } = {},
): RawMemoryTurn {
  return createRawMemoryTurn({
    id,
    content,
    createdTimestamp,
    author: {
      id: authorId,
      bot: options.bot ?? false,
      username: options.username ?? `${authorId}-name`,
    },
  });
}

function createLog() {
  return {
    withMetadata() {
      return this;
    },
    withError() {
      return this;
    },
    warn() {},
  } as never;
}
