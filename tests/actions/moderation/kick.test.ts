import { describe, expect, test } from "vitest";
import { GuildConfigStore } from "@/config/guild-config-store.ts";
import { kickMember } from "@/actions/moderation/kick.ts";
import { createModerationHarness, guildId, logChannelId, targetUserId } from "./_helpers.ts";

describe("kickMember", () => {
  test("kicks a member, DMs them, and logs the action", async () => {
    const store = new GuildConfigStore(":memory:");

    try {
      store.setLogChannel(guildId, logChannelId);
      store.setModLogEnabled(guildId, true);

      const harness = createModerationHarness({
        actionName: "kick",
        args: [`<@${targetUserId}>`, "bye"],
      });

      await kickMember(harness.context, { guildConfigStore: store });

      expect(harness.kickCalls).toHaveLength(1);
      expect(harness.dmMessages).toHaveLength(1);
      expect(harness.eventLog).toEqual(["kick", "dm"]);
      expect(harness.modLogMessages).toHaveLength(1);
    } finally {
      store.close();
    }
  });

  test("supports a dry run without kicking or DMing the user", async () => {
    const store = new GuildConfigStore(":memory:");

    try {
      store.setLogChannel(guildId, logChannelId);
      store.setModLogEnabled(guildId, true);

      const harness = createModerationHarness({
        actionName: "kick",
        args: [`<@${targetUserId}>`, "bye", "-d"],
      });

      await kickMember(harness.context, { guildConfigStore: store });

      expect(harness.kickCalls).toHaveLength(0);
      expect(harness.dmMessages).toHaveLength(0);
      expect(harness.replies).toEqual([
        `Dry run: would kick <@${targetUserId}> (\`${targetUserId}\`). Reason: bye`,
      ]);
      expect(harness.modLogMessages).toHaveLength(1);
    } finally {
      store.close();
    }
  });

  test("does not DM the user when the kick fails", async () => {
    const store = new GuildConfigStore(":memory:");

    try {
      const harness = createModerationHarness({
        actionName: "kick",
        args: [`<@${targetUserId}>`, "bye"],
        kickFails: true,
      });

      await expect(kickMember(harness.context, { guildConfigStore: store })).rejects.toThrow(
        "Kick failed",
      );
      expect(harness.dmMessages).toHaveLength(0);
      expect(harness.eventLog).toEqual(["kick"]);
    } finally {
      store.close();
    }
  });
});
