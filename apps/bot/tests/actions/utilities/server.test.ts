import { describe, expect, test } from "vitest";
import { showServerInfo } from "@aripabot/bot/actions/utilities/server.ts";
import type { ActionContext } from "@aripabot/core/bot/action.ts";

describe("showServerInfo", () => {
  test("shows the current server info in an embed", async () => {
    const replies: unknown[] = [];
    const context = createContext(replies);

    await showServerInfo(context);

    expect(replies).toHaveLength(1);
    expect(replies[0]).toMatchObject({
      embeds: [
        expect.objectContaining({
          data: expect.objectContaining({
            title: "Server Info: Guild",
          }),
        }),
      ],
    });
  });
});

function createContext(replies: unknown[]): ActionContext {
  return {
    client: {} as never,
    message: {
      author: { id: "user-1" },
      guildId: "guild-1",
      guild: {
        id: "guild-1",
        name: "Guild",
        createdAt: new Date("2024-01-01T00:00:00.000Z"),
        memberCount: 42,
        premiumTier: 2,
        premiumSubscriptionCount: 5,
        description: "Guild description",
        iconURL: () => "https://example.com/icon.png",
        fetchOwner: async () => ({
          id: "owner-1",
          user: { tag: "owner#0001" },
        }),
        channels: {
          cache: new Map([
            ["1", {}],
            ["2", {}],
          ]),
        },
        roles: {
          cache: new Map([
            ["1", {}],
            ["2", {}],
            ["3", {}],
          ]),
        },
        emojis: { cache: new Map([["1", {}]]) },
      },
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
    actionName: "server",
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
