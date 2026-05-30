import { describe, expect, test } from "vitest";
import { GuildConfigStore } from "@aripabot/core/config/guild-config-store.ts";
import { sendModLog } from "@aripabot/core/moderation/mod-log.ts";

describe("sendModLog", () => {
  test("returns false when no log channel is configured", async () => {
    const store = new GuildConfigStore(":memory:");

    try {
      const sent = await sendModLog({
        client: { channels: { fetch: async () => null } } as never,
        guildId: "guild-1",
        content: "log message",
        log: createLog(),
        store,
      });

      expect(sent).toBe(false);
    } finally {
      store.close();
    }
  });

  test("returns false when a log channel is configured but logs are disabled", async () => {
    const store = new GuildConfigStore(":memory:");

    try {
      store.setLogChannel("guild-1", "111111111111111111");

      const sent = await sendModLog({
        client: {
          channels: {
            fetch: async () => {
              throw new Error("Should not fetch channel when logs are disabled.");
            },
          },
        } as never,
        guildId: "guild-1",
        content: "log message",
        log: createLog(),
        store,
      });

      expect(sent).toBe(false);
    } finally {
      store.close();
    }
  });

  test("sends to the configured text channel when logs are enabled without persisting the log", async () => {
    const store = new GuildConfigStore(":memory:");
    const sentMessages: unknown[] = [];

    try {
      store.setLogChannel("guild-1", "111111111111111111");
      store.setModLogEnabled("guild-1", true);

      const sent = await sendModLog({
        client: {
          channels: {
            fetch: async () => ({
              isTextBased: () => true,
              send: async (message: unknown) => {
                sentMessages.push(message);
              },
            }),
          },
        } as never,
        guildId: "guild-1",
        content: "log message",
        log: createLog(),
        store,
      });

      expect(sent).toBe(true);
      expect(sentMessages).toEqual([
        {
          content: "log message",
          allowedMentions: {
            parse: [],
            users: [],
            roles: [],
          },
        },
      ]);
    } finally {
      store.close();
    }
  });

  test("returns false instead of throwing when sending the log message fails", async () => {
    const store = new GuildConfigStore(":memory:");

    try {
      store.setLogChannel("guild-1", "111111111111111111");
      store.setModLogEnabled("guild-1", true);

      const sent = await sendModLog({
        client: {
          channels: {
            fetch: async () => ({
              isTextBased: () => true,
              send: async () => {
                throw new Error("send failed");
              },
            }),
          },
        } as never,
        guildId: "guild-1",
        content: "log message",
        log: createLog(),
        store,
      });

      expect(sent).toBe(false);
    } finally {
      store.close();
    }
  });
});

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
