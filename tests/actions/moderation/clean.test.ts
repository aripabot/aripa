import { describe, expect, test } from "vitest";
import { GuildConfigStore } from "@/config/guild-config-store.ts";
import { cleanMessages } from "@/actions/moderation/clean.ts";
import {
  createModerationHarness,
  guildId,
  logChannelId,
  targetUserId,
  type FakeMessage,
} from "./_helpers.ts";

describe("cleanMessages", () => {
  test("deletes recent messages from the target user", async () => {
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
              deleted.push("m2");
            },
          },
        ],
      ]);

      const harness = createModerationHarness({
        actionName: "clean",
        args: ["user", `<@${targetUserId}>`, "2"],
        messageBatches: [batch],
      });

      await cleanMessages(harness.context, { guildConfigStore: store });

      expect(deleted).toEqual(["m1", "m2"]);
      expect(harness.modLogMessages).toHaveLength(1);
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
      });

      await cleanMessages(harness.context, { guildConfigStore: store });

      expect(deleted).toEqual(["m1"]);
      expect(harness.modLogMessages).toHaveLength(1);
      expect(harness.replies).toEqual([
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
        `I could not find any recent messages from <@${targetUserId}> (\`${targetUserId}\`) here.`,
      ]);
    } finally {
      store.close();
    }
  });
});
