import { describe, expect, test } from "vitest";
import { showAvatar } from "@aripabot/bot/actions/utilities/avatar.ts";
import type { ActionContext } from "@aripabot/core/bot/action.ts";

describe("showAvatar", () => {
  test("shows the invoking user's avatar by default", async () => {
    const replies: unknown[] = [];
    const context = createContext(replies);

    await showAvatar(context);

    expect(replies).toHaveLength(1);
    expect(replies[0]).toMatchObject({
      embeds: [
        expect.objectContaining({
          data: expect.objectContaining({
            title: "Avatar: test-user",
            image: expect.objectContaining({
              url: "https://example.com/avatar.png",
            }),
          }),
        }),
      ],
    });
  });
});

function createContext(replies: unknown[]): ActionContext {
  const user = {
    id: "user-1",
    username: "test-user",
    tag: "test-user",
    displayAvatarURL: () => "https://example.com/avatar.png",
  };

  return {
    client: {
      users: {
        fetch: async () => user,
      },
    } as never,
    message: {
      author: user,
      guildId: "guild-1",
      inGuild: () => true,
      reply: async (options: unknown) => {
        replies.push(options);
        return options;
      },
      channelId: "channel-1",
      id: "message-1",
    } as never,
    args: [],
    argTokens: [],
    tokens: [],
    rawArgs: "",
    prefix: "-",
    actionName: "avatar",
    actions: {} as never,
    isAgent: false,
    agentReplies: [],
    invoker: {} as never,
    log: createLog(),
    reply: async (content: string) => {
      replies.push(content);
      return content;
    },
  } as never;
}

function createLog() {
  return {
    withError() {
      return this;
    },
    withMetadata() {
      return this;
    },
    warn() {},
  } as never;
}
