import { describe, expect, test } from "vitest";
import { GuildConfigStore } from "@aripabot/core/config/guild-config-store.ts";
import { banMember } from "@aripabot/bot/actions/moderation/ban.ts";
import { cleanbanMember } from "@aripabot/bot/actions/moderation/cleanban.ts";
import { unbanMember } from "@aripabot/bot/actions/moderation/unban.ts";
import { createModerationHarness, guildId, logChannelId, targetUserId } from "./_helpers.ts";

describe("banMember", () => {
  test("bans a user and sends a DM", async () => {
    const store = new GuildConfigStore(":memory:");

    try {
      store.setLogChannel(guildId, logChannelId);
      store.setModLogEnabled(guildId, true);

      const harness = createModerationHarness({
        actionName: "ban",
        args: [`<@${targetUserId}>`, "spamming"],
      });

      await banMember(harness.context, { guildConfigStore: store });

      expect(harness.banCalls).toHaveLength(1);
      expect(harness.dmMessages).toHaveLength(1);
      expect(harness.eventLog).toEqual(["dm", "ban"]);
      expect(harness.modLogMessages).toHaveLength(1);
    } finally {
      store.close();
    }
  });

  test("uses the configured guild ban message in the DM", async () => {
    const store = new GuildConfigStore(":memory:");

    try {
      store.setBanMessage(guildId, "You are banned from this server.");

      const harness = createModerationHarness({
        actionName: "ban",
        args: [`<@${targetUserId}>`, "spamming"],
      });

      await banMember(harness.context, { guildConfigStore: store });

      expect(harness.dmMessages).toEqual([
        {
          content: ["You are banned from this server.", "Reason: spamming"].join("\n"),
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

  test("supports a dry run without banning or DMing the user", async () => {
    const store = new GuildConfigStore(":memory:");

    try {
      store.setLogChannel(guildId, logChannelId);
      store.setModLogEnabled(guildId, true);

      const harness = createModerationHarness({
        actionName: "ban",
        args: [`<@${targetUserId}>`, "spamming", "--dryrun"],
      });

      await banMember(harness.context, { guildConfigStore: store });

      expect(harness.banCalls).toHaveLength(0);
      expect(harness.dmMessages).toHaveLength(0);
      expect(harness.replies).toEqual([
        `Dry run: would ban <@${targetUserId}> (\`${targetUserId}\`). Reason: spamming`,
      ]);
      expect(harness.modLogMessages).toHaveLength(1);
    } finally {
      store.close();
    }
  });

  test("sends the DM before attempting the ban", async () => {
    const store = new GuildConfigStore(":memory:");

    try {
      const harness = createModerationHarness({
        actionName: "ban",
        args: [`<@${targetUserId}>`, "spamming"],
        banFails: true,
      });

      await expect(banMember(harness.context, { guildConfigStore: store })).rejects.toThrow(
        "Ban failed",
      );
      expect(harness.dmMessages).toHaveLength(1);
      expect(harness.eventLog).toEqual(["dm", "ban"]);
    } finally {
      store.close();
    }
  });

  test("denies banning a member whose role outranks the invoker", async () => {
    const store = new GuildConfigStore(":memory:");

    try {
      const harness = createModerationHarness({
        actionName: "ban",
        args: [`<@${targetUserId}>`, "spamming"],
        invokerTopRolePosition: 5,
        targetTopRolePosition: 10,
      });

      await banMember(harness.context, { guildConfigStore: store });

      expect(harness.banCalls).toHaveLength(0);
      expect(harness.replies).toEqual([
        `You cannot ban <@${targetUserId}> (\`${targetUserId}\`) because their highest role is equal to or above yours.`,
      ]);
    } finally {
      store.close();
    }
  });

  test("still succeeds when mod-log delivery fails after the ban", async () => {
    const store = new GuildConfigStore(":memory:");

    try {
      store.setLogChannel(guildId, logChannelId);
      store.setModLogEnabled(guildId, true);

      const harness = createModerationHarness({
        actionName: "ban",
        args: [`<@${targetUserId}>`, "spamming"],
        modLogSendFails: true,
      });

      await banMember(harness.context, { guildConfigStore: store });

      expect(harness.banCalls).toHaveLength(1);
      expect(harness.replies).toEqual([
        `Banned <@${targetUserId}> (\`${targetUserId}\`). Reason: spamming`,
      ]);
    } finally {
      store.close();
    }
  });

  test("cleanban deletes messages from the requested window across guild channels", async () => {
    const store = new GuildConfigStore(":memory:");
    const deleted: string[] = [];

    try {
      const recentMessage = {
        id: "m1",
        author: { id: targetUserId },
        createdTimestamp: Date.now() - 6 * 24 * 60 * 60 * 1_000,
        delete: async () => {
          deleted.push("m1");
        },
      };
      const oldMessage = {
        id: "m2",
        author: { id: targetUserId },
        createdTimestamp: Date.now() - 8 * 24 * 60 * 60 * 1_000,
        delete: async () => {
          deleted.push("m2");
        },
      };
      const otherChannelRecentMessage = {
        id: "m3",
        author: { id: targetUserId },
        createdTimestamp: Date.now() - 1_000,
        delete: async () => {
          deleted.push("m3");
        },
      };
      const harness = createModerationHarness({
        actionName: "cleanban",
        args: ["7", `<@${targetUserId}>`, "spam"],
        guildMessageBatches: {
          "111111111111111111": [
            new Map([
              ["m1", recentMessage],
              ["m2", oldMessage],
            ]),
          ],
          "222222222222222223": [new Map([["m3", otherChannelRecentMessage]])],
        },
      });

      await cleanbanMember(harness.context, { guildConfigStore: store });

      expect(deleted).toEqual(["m3", "m1"]);
      expect(harness.bulkDeleteCalls).toEqual([
        {
          channelId: "222222222222222223",
          messageIds: ["m3"],
          filterOld: true,
        },
        {
          channelId: "111111111111111111",
          messageIds: ["m1"],
          filterOld: true,
        },
      ]);
      expect(harness.banCalls).toEqual([
        expect.objectContaining({
          id: targetUserId,
          options: expect.objectContaining({
            deleteMessageSeconds: 0,
          }),
        }),
      ]);
      expect(harness.dmMessages).toEqual([
        {
          content: [
            `You were banned from ${harness.context.message.guild?.name}.`,
            "Messages deleted: 7 days",
            "Reason: spam",
          ].join("\n"),
          allowedMentions: {
            parse: [],
            users: [],
            roles: [],
          },
        },
      ]);
      expect(harness.replies).toEqual([
        "Scanning for messages. This may take some time.",
        `Banned <@${targetUserId}> (\`${targetUserId}\`) and deleted 2 messages from the last 7 days. Reason: spam`,
      ]);
    } finally {
      store.close();
    }
  });

  test("unbans a user", async () => {
    const store = new GuildConfigStore(":memory:");

    try {
      const harness = createModerationHarness({
        actionName: "unban",
        args: [`<@${targetUserId}>`],
      });

      await unbanMember(harness.context, { guildConfigStore: store });

      expect(harness.unbanCalls).toEqual([
        expect.objectContaining({
          id: targetUserId,
        }),
      ]);
    } finally {
      store.close();
    }
  });

  test("supports a dry-run unban without changing Discord state", async () => {
    const store = new GuildConfigStore(":memory:");

    try {
      const harness = createModerationHarness({
        actionName: "unban",
        args: [`<@${targetUserId}>`, "-d"],
      });

      await unbanMember(harness.context, { guildConfigStore: store });

      expect(harness.unbanCalls).toHaveLength(0);
      expect(harness.replies).toEqual([
        `Dry run: would unban <@${targetUserId}> (\`${targetUserId}\`).`,
      ]);
    } finally {
      store.close();
    }
  });
});
