import { describe, expect, test } from "vitest";
import { GuildConfigStore } from "@/config/guild-config-store.ts";
import { warnMember } from "@/actions/moderation/warn.ts";
import { createModerationHarness, guildId, logChannelId, targetUserId } from "./_helpers.ts";

describe("warnMember", () => {
  test("warns a member, DMs them, and writes to the configured log channel", async () => {
    const store = new GuildConfigStore(":memory:");

    try {
      store.setLogChannel(guildId, logChannelId);
      store.setModLogEnabled(guildId, true);

      const harness = createModerationHarness({
        actionName: "warn",
        args: [`<@${targetUserId}>`, "spamming"],
      });

      await warnMember(harness.context, { guildConfigStore: store });

      expect(harness.replies).toEqual([
        `Warned <@${targetUserId}> (\`${targetUserId}\`). Reason: spamming`,
      ]);
      expect(harness.dmMessages).toHaveLength(1);
      expect(harness.modLogMessages).toHaveLength(1);
    } finally {
      store.close();
    }
  });

  test("supports a dry run without DMing the user", async () => {
    const store = new GuildConfigStore(":memory:");

    try {
      store.setLogChannel(guildId, logChannelId);
      store.setModLogEnabled(guildId, true);

      const harness = createModerationHarness({
        actionName: "warn",
        args: [`<@${targetUserId}>`, "spamming", "--dryrun"],
      });

      await warnMember(harness.context, { guildConfigStore: store });

      expect(harness.replies).toEqual([
        `Dry run: would warn <@${targetUserId}> (\`${targetUserId}\`). Reason: spamming`,
      ]);
      expect(harness.dmMessages).toHaveLength(0);
      expect(harness.modLogMessages).toHaveLength(1);
      expect(harness.modLogMessages[0]).toMatchObject({
        allowedMentions: {
          parse: [],
          users: [],
          roles: [],
        },
        embeds: [
          expect.objectContaining({
            data: expect.objectContaining({
              title: "Warn (Dry Run)",
              color: 0xf59e0b,
              footer: expect.objectContaining({
                text: "Test Guild",
              }),
              fields: expect.arrayContaining([
                expect.objectContaining({
                  name: "Dry Run",
                  value: "Yes",
                }),
                expect.objectContaining({
                  name: "User",
                  value: `<@${targetUserId}> (\`${targetUserId}\`)`,
                }),
                expect.objectContaining({
                  name: "Moderator",
                  value: "<@444444444444444444> (`444444444444444444`)",
                }),
                expect.objectContaining({
                  name: "Reason",
                  value: "spamming",
                }),
                expect.objectContaining({
                  name: "DM",
                  value: "skipped",
                }),
              ]),
            }),
          }),
        ],
      });
    } finally {
      store.close();
    }
  });

  test("denies warning a member whose role outranks the invoker", async () => {
    const store = new GuildConfigStore(":memory:");

    try {
      const harness = createModerationHarness({
        actionName: "warn",
        args: [`<@${targetUserId}>`, "spamming"],
        invokerTopRolePosition: 5,
        targetTopRolePosition: 10,
      });

      await warnMember(harness.context, { guildConfigStore: store });

      expect(harness.dmMessages).toHaveLength(0);
      expect(harness.modLogMessages).toHaveLength(0);
      expect(harness.replies).toEqual([
        `You cannot warn <@${targetUserId}> (\`${targetUserId}\`) because their highest role is equal to or above yours.`,
      ]);
    } finally {
      store.close();
    }
  });
});
