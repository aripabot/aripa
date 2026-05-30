import { describe, expect, test } from "vitest";
import { GuildConfigStore } from "@aripabot/core/config/guild-config-store.ts";
import { cleanMessages } from "@aripabot/bot/actions/moderation/clean.ts";
import {
  createModerationHarness,
  guildId,
  logChannelId,
  targetUserId,
  type FakeMessage,
} from "./_helpers.ts";

describe("cleanMessages", () => {
  const scanningAcknowledgement = "Scanning for messages. This may take some time.";

  test("deletes recent messages from the target user across guild channels", async () => {
    const store = new GuildConfigStore(":memory:");
    const deleted: string[] = [];

    try {
      store.setLogChannel(guildId, logChannelId);
      store.setModLogEnabled(guildId, true);

      const now = Date.now();
      const firstChannelBatch = new Map<string, FakeMessage>([
        [
          "m1",
          {
            id: "m1",
            author: { id: targetUserId },
            createdTimestamp: now - 3_000,
            delete: async () => {
              deleted.push("m1");
            },
          },
        ],
        [
          "m2",
          {
            id: "m2",
            author: { id: targetUserId },
            createdTimestamp: now - 1_000,
            delete: async () => {
              deleted.push("m2");
            },
          },
        ],
      ]);
      const secondChannelBatch = new Map<string, FakeMessage>([
        [
          "m3",
          {
            id: "m3",
            author: { id: targetUserId },
            createdTimestamp: now - 2_000,
            delete: async () => {
              deleted.push("m3");
            },
          },
        ],
      ]);

      const harness = createModerationHarness({
        actionName: "clean",
        args: ["user", `<@${targetUserId}>`, "2"],
        guildMessageBatches: {
          "111111111111111111": [firstChannelBatch],
          "222222222222222223": [secondChannelBatch],
        },
      });

      await cleanMessages(harness.context, { guildConfigStore: store });

      expect(deleted).toEqual(["m2", "m3"]);
      expect(harness.bulkDeleteCalls).toEqual([
        {
          channelId: "111111111111111111",
          messageIds: ["m2"],
          filterOld: true,
        },
        {
          channelId: "222222222222222223",
          messageIds: ["m3"],
          filterOld: true,
        },
      ]);
      expect(harness.modLogMessages).toHaveLength(1);
      expect(harness.replies).toEqual([
        scanningAcknowledgement,
        `Deleted 2 messages from <@${targetUserId}> (\`${targetUserId}\`).`,
      ]);
    } finally {
      store.close();
    }
  });

  test("supports a dry run without deleting messages", async () => {
    const store = new GuildConfigStore(":memory:");
    const deleted: string[] = [];

    try {
      const batch = new Map<string, FakeMessage>([
        [
          "m1",
          {
            id: "m1",
            author: { id: targetUserId },
            delete: async () => {
              deleted.push("m1");
            },
          },
        ],
      ]);

      const harness = createModerationHarness({
        actionName: "clean",
        args: ["user", `<@${targetUserId}>`, "1", "--dryrun"],
        messageBatches: [batch],
      });

      await cleanMessages(harness.context, { guildConfigStore: store });

      expect(deleted).toEqual([]);
      expect(harness.replies).toEqual([
        scanningAcknowledgement,
        `Dry run: would delete 1 message from <@${targetUserId}> (\`${targetUserId}\`).`,
      ]);
    } finally {
      store.close();
    }
  });

  test("logs and reports partial deletion failures", async () => {
    const store = new GuildConfigStore(":memory:");
    const deleted: string[] = [];

    try {
      store.setLogChannel(guildId, logChannelId);
      store.setModLogEnabled(guildId, true);

      const batch = new Map<string, FakeMessage>([
        [
          "m1",
          {
            id: "m1",
            author: { id: targetUserId },
            delete: async () => {
              deleted.push("m1");
            },
          },
        ],
        [
          "m2",
          {
            id: "m2",
            author: { id: targetUserId },
            delete: async () => {
              throw new Error("already deleted");
            },
          },
        ],
      ]);

      const harness = createModerationHarness({
        actionName: "clean",
        args: ["user", `<@${targetUserId}>`, "2"],
        messageBatches: [batch],
        useBulkDelete: false,
      });

      await cleanMessages(harness.context, { guildConfigStore: store });

      expect(deleted).toEqual(["m1"]);
      expect(harness.modLogMessages).toHaveLength(1);
      expect(harness.replies).toEqual([
        scanningAcknowledgement,
        `Deleted 1 message from <@${targetUserId}> (\`${targetUserId}\`). 1 message could not be deleted.`,
      ]);
    } finally {
      store.close();
    }
  });

  test("stops scanning after the recent-history cap", async () => {
    const store = new GuildConfigStore(":memory:");
    const nonMatchingBatch = new Map<string, FakeMessage>(
      Array.from({ length: 100 }, (_, index) => {
        const id = `m${index + 1}`;
        return [
          id,
          {
            id,
            author: { id: "777777777777777777" },
            delete: async () => {},
          },
        ];
      }),
    );

    try {
      const harness = createModerationHarness({
        actionName: "clean",
        args: ["user", `<@${targetUserId}>`, "1"],
        messageBatches: Array.from({ length: 12 }, () => new Map(nonMatchingBatch)),
      });

      await cleanMessages(harness.context, { guildConfigStore: store });

      expect(harness.messageFetchCalls).toHaveLength(10);
      expect(harness.replies).toEqual([
        scanningAcknowledgement,
        `I could not find any recent messages from <@${targetUserId}> (\`${targetUserId}\`) in this server.`,
      ]);
    } finally {
      store.close();
    }
  });

  test("skips channels the bot cannot clean", async () => {
    const store = new GuildConfigStore(":memory:");
    const deleted: string[] = [];

    try {
      const visibleBatch = new Map<string, FakeMessage>([
        [
          "m1",
          {
            id: "m1",
            author: { id: targetUserId },
            createdTimestamp: Date.now(),
            delete: async () => {
              deleted.push("m1");
            },
          },
        ],
      ]);
      const blockedBatch = new Map<string, FakeMessage>([
        [
          "m2",
          {
            id: "m2",
            author: { id: targetUserId },
            createdTimestamp: Date.now(),
            delete: async () => {
              deleted.push("m2");
            },
          },
        ],
      ]);

      const harness = createModerationHarness({
        actionName: "clean",
        args: ["user", `<@${targetUserId}>`, "2"],
        guildMessageBatches: {
          "111111111111111111": [visibleBatch],
          "222222222222222223": [blockedBatch],
        },
        blockedCleanChannelIds: ["222222222222222223"],
      });

      await cleanMessages(harness.context, { guildConfigStore: store });

      expect(deleted).toEqual(["m1"]);
      expect(harness.messageFetchCalls).toEqual([
        {
          channelId: "111111111111111111",
          limit: 100,
        },
      ]);
    } finally {
      store.close();
    }
  });

  test("does not send the scanning acknowledgement for agent calls", async () => {
    const store = new GuildConfigStore(":memory:");

    try {
      const batch = new Map<string, FakeMessage>([
        [
          "m1",
          {
            id: "m1",
            author: { id: targetUserId },
            createdTimestamp: Date.now(),
            delete: async () => {},
          },
        ],
      ]);

      const harness = createModerationHarness({
        actionName: "clean",
        args: ["user", `<@${targetUserId}>`, "1"],
        messageBatches: [batch],
        isAgent: true,
      });

      await cleanMessages(harness.context, { guildConfigStore: store });

      expect(harness.replies).toEqual([
        `Deleted 1 message from <@${targetUserId}> (\`${targetUserId}\`).`,
      ]);
    } finally {
      store.close();
    }
  });
});
