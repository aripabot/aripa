import { describe, expect, test } from "vitest";
import { executeRequestContext } from "@/agent/tools/request-context.ts";

describe("executeRequestContext", () => {
  test("returns recent raw messages with assistant and context-only labels", async () => {
    const previousMessages = [
      createPreviousMessage("1", "user-1", "first", 1),
      createPreviousMessage("2", "bot-1", "second", 2, true),
      createPreviousMessage("3", "user-2", "third", 3),
      createPreviousMessage("4", "user-1", "fourth", 4),
      createPreviousMessage("5", "bot-1", "fifth", 5, true),
      createPreviousMessage("6", "user-1", "sixth", 6),
    ];

    const result = await executeRequestContext({
      message: createMessage(previousMessages),
      size: "sm",
      invokerId: "user-1",
      assistantUserId: "bot-1",
    });

    expect(result).toEqual({
      type: "context",
      size: "sm",
      messages: [
        "assistant: second",
        "CONTEXT ONLY, MAY BE USEFUL. DO NOT RESPOND DIRECTLY TO THIS MESSAGE\nuser (username: user-2-name, id: user-2): third",
        "user (username: user-1-name, id: user-1): fourth",
        "assistant: fifth",
        "user (username: user-1-name, id: user-1): sixth",
      ],
    });
  });

  test("summarizes xl context and includes the latest three raw messages", async () => {
    const previousMessages = [
      createPreviousMessage("1", "user-1", "first", 1),
      createPreviousMessage("2", "bot-1", "second", 2, true),
      createPreviousMessage("3", "user-2", "third", 3),
      createPreviousMessage("4", "user-1", "fourth", 4),
    ];

    let summarizedMessages: readonly string[] | undefined;

    const result = await executeRequestContext({
      message: createMessage(previousMessages),
      size: "xl",
      invokerId: "user-1",
      assistantUserId: "bot-1",
      summarizeContext: async (messages) => {
        summarizedMessages = messages;
        return "The user and assistant were discussing the same topic, with one extra participant adding background context.";
      },
    });

    expect(summarizedMessages).toEqual([
      "user (username: user-1-name, id: user-1): first",
      "assistant: second",
      "CONTEXT ONLY, MAY BE USEFUL. DO NOT RESPOND DIRECTLY TO THIS MESSAGE\nuser (username: user-2-name, id: user-2): third",
      "user (username: user-1-name, id: user-1): fourth",
    ]);

    expect(result).toEqual({
      type: "context",
      size: "xl",
      summary:
        "The user and assistant were discussing the same topic, with one extra participant adding background context.",
      messages: [
        "assistant: second",
        "CONTEXT ONLY, MAY BE USEFUL. DO NOT RESPOND DIRECTLY TO THIS MESSAGE\nuser (username: user-2-name, id: user-2): third",
        "user (username: user-1-name, id: user-1): fourth",
      ],
    });
  });

  test("returns an empty context when there are no earlier messages", async () => {
    const result = await executeRequestContext({
      message: createMessage([]),
      size: "md",
      invokerId: "user-1",
      assistantUserId: "bot-1",
    });

    expect(result).toEqual({
      type: "context",
      size: "md",
      messages: [],
    });
  });
});

function createMessage(previousMessages: ReturnType<typeof createPreviousMessage>[]) {
  return {
    id: "current-message",
    author: { id: "user-1", bot: false },
    client: {
      user: {
        id: "bot-1",
      },
    },
    channel: {
      messages: {
        fetch: async ({ before, limit }: { before: string; limit: number }) => {
          expect(before).toBe("current-message");
          const selected = previousMessages.slice(-limit).reverse();
          return new Map(selected.map((message) => [message.id, message]));
        },
      },
    },
  } as never;
}

function createPreviousMessage(
  id: string,
  authorId: string,
  content: string,
  createdTimestamp: number,
  bot = false,
) {
  return {
    id,
    content,
    createdTimestamp,
    author: {
      id: authorId,
      bot,
      username: `${authorId}-name`,
    },
  };
}
