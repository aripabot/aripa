import { describe, expect, test } from "vitest";
import type { ActionContext } from "@/bot/action.ts";
import { configureLogs } from "@/actions/admin/logs.ts";
import { GuildConfigStore } from "@/config/guild-config-store.ts";

const guildId = "999999999999999999";
const channelId = "111111111111111111";

describe("configureLogs", () => {
  test("setchannel stores a text channel from a channel mention", async () => {
    const store = new GuildConfigStore(":memory:");
    const replies: string[] = [];

    try {
      const context = createContext({
        args: ["setchannel", `<#${channelId}>`],
        replies,
      });

      await configureLogs(context, store);

      expect(store.getGuildConfig(guildId)).toMatchObject({
        logChannelId: channelId,
        modLogsEnabled: false,
      });
      expect(replies).toEqual([
        `Log channel set to <#${channelId}>. Mod logs are currently disabled.`,
      ]);
    } finally {
      store.close();
    }
  });

  test("setchannel none clears the channel and disables logs", async () => {
    const store = new GuildConfigStore(":memory:");
    const replies: string[] = [];

    try {
      store.setLogChannel(guildId, channelId);
      store.setModLogEnabled(guildId, true);

      const context = createContext({
        args: ["setchannel", "none"],
        replies,
      });

      await configureLogs(context, store);

      expect(store.getGuildConfig(guildId)).toMatchObject({
        logChannelId: null,
        modLogsEnabled: false,
      });
      expect(replies).toEqual(["Log channel cleared and mod logs disabled."]);
    } finally {
      store.close();
    }
  });

  test("enable requires a configured channel", async () => {
    const store = new GuildConfigStore(":memory:");
    const replies: string[] = [];

    try {
      const context = createContext({
        args: ["enable"],
        replies,
      });

      await configureLogs(context, store);

      expect(store.isModLogEnabled(guildId)).toBe(false);
      expect(replies[0]).toContain("Set a log channel before enabling logs");
    } finally {
      store.close();
    }
  });

  test("enable works when a configured channel is valid", async () => {
    const store = new GuildConfigStore(":memory:");
    const replies: string[] = [];
    const sentMessages: unknown[] = [];

    try {
      store.setLogChannel(guildId, channelId);

      const context = createContext({
        args: ["enable"],
        replies,
        sentMessages,
      });

      await configureLogs(context, store);

      expect(store.isModLogEnabled(guildId)).toBe(true);
      expect(replies).toEqual([`Mod logs enabled for <#${channelId}>.`]);
      expect(sentMessages).toHaveLength(1);
      expect(sentMessages[0]).toMatchObject({
        embeds: [
          expect.objectContaining({
            data: expect.objectContaining({
              title: "Logs Enabled",
              description: "Mod logs have been enabled in this channel.",
            }),
          }),
        ],
      });
    } finally {
      store.close();
    }
  });

  test("disable turns off logs without clearing the channel", async () => {
    const store = new GuildConfigStore(":memory:");
    const replies: string[] = [];

    try {
      store.setLogChannel(guildId, channelId);
      store.setModLogEnabled(guildId, true);

      const context = createContext({
        args: ["disable"],
        replies,
      });

      await configureLogs(context, store);

      expect(store.getGuildConfig(guildId)).toMatchObject({
        logChannelId: channelId,
        modLogsEnabled: false,
      });
      expect(replies).toEqual(["Mod logs disabled."]);
    } finally {
      store.close();
    }
  });

  test("getchannel returns the channel mention and id", async () => {
    const store = new GuildConfigStore(":memory:");
    const replies: string[] = [];

    try {
      store.setLogChannel(guildId, channelId);

      const context = createContext({
        args: ["getchannel"],
        replies,
      });

      await configureLogs(context, store);

      expect(replies).toEqual([
        `Log channel: <#${channelId}> (\`${channelId}\`). Mod logs are disabled.`,
      ]);
    } finally {
      store.close();
    }
  });

  test("setchannel rejects channels the bot cannot send to", async () => {
    const store = new GuildConfigStore(":memory:");
    const replies: string[] = [];

    try {
      const context = createContext({
        args: ["setchannel", channelId],
        canSend: false,
        replies,
      });

      await configureLogs(context, store);

      expect(store.getLogChannelId(guildId)).toBeNull();
      expect(replies[0]).toContain("I need");
      expect(replies[0]).toContain("`SendMessages`");
    } finally {
      store.close();
    }
  });

  test("setchannel rejects invalid channel references", async () => {
    const store = new GuildConfigStore(":memory:");
    const replies: string[] = [];

    try {
      const context = createContext({
        args: ["setchannel", "not-a-channel"],
        replies,
      });

      await configureLogs(context, store);

      expect(store.getLogChannelId(guildId)).toBeNull();
      expect(replies).toEqual(['Expected a channel mention or ID, got "not-a-channel".']);
    } finally {
      store.close();
    }
  });
});

interface CreateContextOptions {
  args: string[];
  replies: string[];
  sentMessages?: unknown[];
  canSend?: boolean;
  canEmbed?: boolean;
  textBased?: boolean;
}

function createContext({
  args,
  replies,
  sentMessages = [],
  canSend = true,
  canEmbed = true,
  textBased = true,
}: CreateContextOptions): ActionContext {
  const channel = {
    id: channelId,
    guildId,
    isTextBased: () => textBased,
    send: async (options: unknown) => {
      sentMessages.push(options);
      return options;
    },
    permissionsFor: () => ({
      has: (permission: string) =>
        permission === "ViewChannel" ||
        (permission === "SendMessages" && canSend) ||
        (permission === "EmbedLinks" && canEmbed),
    }),
  };

  return {
    client: {
      user: { id: "bot-id" },
    },
    message: {
      author: { id: "user-id" },
      guildId,
      inGuild: () => true,
      guild: {
        channels: {
          cache: {
            get: (id: string) => (id === channelId ? channel : undefined),
          },
          fetch: async () => null,
        },
      },
    },
    args,
    argTokens: [],
    tokens: [],
    rawArgs: args.join(" "),
    prefix: "-",
    actionName: "logs",
    actions: {} as never,
    isAgent: false,
    agentReplies: [],
    invoker: {} as never,
    log: {
      withMetadata() {
        return this;
      },
      info() {},
    } as never,
    reply: async (content: string) => {
      replies.push(content);
      return content;
    },
  } as never;
}
