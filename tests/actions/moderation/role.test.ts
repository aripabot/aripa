import { describe, expect, test } from "vitest";
import { GuildConfigStore } from "@/config/guild-config-store.ts";
import { updateMemberRole } from "@/actions/moderation/role.ts";
import {
  createModerationHarness,
  guildId,
  logChannelId,
  roleId,
  targetUserId,
} from "./_helpers.ts";

describe("updateMemberRole", () => {
  test("adds a role to a member", async () => {
    const store = new GuildConfigStore(":memory:");

    try {
      store.setLogChannel(guildId, logChannelId);
      store.setModLogEnabled(guildId, true);

      const harness = createModerationHarness({
        actionName: "role",
        args: ["add", `<@${targetUserId}>`, `<@&${roleId}>`],
      });

      await updateMemberRole(harness.context, { guildConfigStore: store });

      expect(harness.roleAddCalls).toHaveLength(1);
      expect(harness.modLogMessages).toHaveLength(1);
    } finally {
      store.close();
    }
  });

  test("removes a role from a member", async () => {
    const store = new GuildConfigStore(":memory:");

    try {
      const harness = createModerationHarness({
        actionName: "role",
        args: ["remove", `<@${targetUserId}>`, `<@&${roleId}>`],
      });

      await updateMemberRole(harness.context, { guildConfigStore: store });

      expect(harness.roleRemoveCalls).toHaveLength(1);
    } finally {
      store.close();
    }
  });

  test("supports a dry run without changing the member role", async () => {
    const store = new GuildConfigStore(":memory:");

    try {
      const harness = createModerationHarness({
        actionName: "role",
        args: ["add", `<@${targetUserId}>`, `<@&${roleId}>`, "--dryrun"],
      });

      await updateMemberRole(harness.context, { guildConfigStore: store });

      expect(harness.roleAddCalls).toHaveLength(0);
      expect(harness.replies).toEqual([
        `Dry run: would add <@&${roleId}> (\`${roleId}\`) to <@${targetUserId}> (\`${targetUserId}\`).`,
      ]);
    } finally {
      store.close();
    }
  });

  test("denies assigning a role that outranks the invoker", async () => {
    const store = new GuildConfigStore(":memory:");

    try {
      const harness = createModerationHarness({
        actionName: "role",
        args: ["add", `<@${targetUserId}>`, `<@&${roleId}>`],
        invokerTopRolePosition: 5,
        targetTopRolePosition: 1,
        rolePosition: 10,
      });

      await updateMemberRole(harness.context, { guildConfigStore: store });

      expect(harness.roleAddCalls).toHaveLength(0);
      expect(harness.replies).toEqual([
        `You cannot manage <@&${roleId}> (\`${roleId}\`) because it is equal to or above your highest role.`,
      ]);
    } finally {
      store.close();
    }
  });
});
