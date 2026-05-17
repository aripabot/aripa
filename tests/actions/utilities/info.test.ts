import { describe, expect, test } from "vitest";
import { showUserInfo } from "@/actions/utilities/info.ts";
import type { ActionContext } from "@/bot/action.ts";

describe("showUserInfo", () => {
  test("shows info for the invoking user by default", async () => {
    const replies: unknown[] = [];
    const context = createContext({
      args: [],
      replies,
    });

    await showUserInfo(context);

    expect(replies).toHaveLength(1);
    expect(replies[0]).toMatchObject({
      embeds: [
        expect.objectContaining({
          data: expect.objectContaining({
            title: "User Info: test-user",
          }),
        }),
      ],
    });
  });
});

function createContext({ args, replies }: { args: string[]; replies: unknown[] }): ActionContext {
  const user = {
    id: "user-1",
    username: "test-user",
    tag: "test-user",
    bot: false,
    globalName: "Test User",
    createdAt: new Date("2024-01-01T00:00:00.000Z"),
    displayAvatarURL: () => "https://example.com/avatar.png",
  };

  const member = {
    id: "user-1",
    displayName: "Test User",
    displayColor: 0x5865f2,
    joinedAt: new Date("2024-02-01T00:00:00.000Z"),
    guild: { id: "guild-1", name: "Guild" },
    roles: {
      cache: new Map([
        ["guild-1", { id: "guild-1", position: 0, toString: () => "@everyone" }],
        ["role-1", { id: "role-1", position: 1, toString: () => "<@&role-1>" }],
      ]),
    },
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
      guild: {
        id: "guild-1",
        name: "Guild",
        members: {
          fetch: async () => member,
        },
      },
      inGuild: () => true,
      reply: async (options: unknown) => {
        replies.push(options);
        return options;
      },
      channelId: "channel-1",
      id: "message-1",
    } as never,
    args,
    argTokens: [],
    tokens: [],
    rawArgs: args.join(" "),
    prefix: "-",
    actionName: "info",
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
