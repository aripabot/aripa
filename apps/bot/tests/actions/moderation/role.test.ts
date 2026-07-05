import { describe, expect, test } from "vitest";
import { GuildConfigStore } from "@aripabot/core/config/guild-config-store.ts";
import { updateMemberRole } from "@aripabot/bot/actions/moderation/role.ts";
import {
  createModerationHarness,
  guildId,
  logChannelId,
  roleId,
  targetUserId,
} from "./_helpers.ts";

describe("updateMemberRole", () => {
  test("searches candidate roles by name", async () => {
    const store = new GuildConfigStore(":memory:");

    try {
      const harness = createModerationHarness({
        actionName: "role",
        args: ["search", "mod"],
      });

      harness.guildRolesCache.set(
        "111111111111111112",
        createSearchRole("111111111111111112", "Mods", 12),
      );
      harness.guildRolesCache.set(
        "111111111111111113",
        createSearchRole("111111111111111113", "Helper Mod", 8),
      );
      harness.guildRolesCache.set(
        "111111111111111114",
        createSearchRole("111111111111111114", "Artists", 20),
      );

      await updateMemberRole(harness.context, { guildConfigStore: store });

      expect(harness.replies).toEqual([
        [
          'Roles matching "mod":',
          "- Mods | ID: `111111111111111112` | Mention: <@&111111111111111112>",
          "- Helper Mod | ID: `111111111111111113` | Mention: <@&111111111111111113>",
        ].join("\n"),
      ]);
    } finally {
      store.close();
    }
  });

  test("searches multi-word role names", async () => {
    const store = new GuildConfigStore(":memory:");

    try {
      const harness = createModerationHarness({
        actionName: "role",
        args: ["search", "event", "team"],
      });

      harness.guildRolesCache.set(
        "111111111111111115",
        createSearchRole("111111111111111115", "Event Team", 10),
      );

      await updateMemberRole(harness.context, { guildConfigStore: store });

      expect(harness.replies).toEqual([
        [
          'Roles matching "event team":',
          "- Event Team | ID: `111111111111111115` | Mention: <@&111111111111111115>",
        ].join("\n"),
      ]);
    } finally {
      store.close();
    }
  });

  test("reports when role search has no matches", async () => {
    const store = new GuildConfigStore(":memory:");

    try {
      const harness = createModerationHarness({
        actionName: "role",
        args: ["search", "missing"],
      });

      await updateMemberRole(harness.context, { guildConfigStore: store });

      expect(harness.replies).toEqual(['No roles matched "missing".']);
    } finally {
      store.close();
    }
  });

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

function createSearchRole(id: string, name: string, position: number) {
  return {
    id,
    name,
    position,
  };
}
