import { describe, expect, test } from "vitest";
import { GuildConfigStore } from "@aripabot/core/config/guild-config-store.ts";
import { ActiveMuteStore } from "@aripabot/core/moderation/active-mute-store.ts";
import { muteMember } from "@aripabot/bot/actions/moderation/mute.ts";
import { unmuteMember } from "@aripabot/bot/actions/moderation/unmute.ts";
import {
  createModerationHarness,
  guildId,
  logChannelId,
  roleId,
  targetUserId,
} from "./_helpers.ts";

describe("muteMember", () => {
  test("applies the configured mute role and stores an active mute", async () => {
    const guildConfigStore = new GuildConfigStore(":memory:");
    const activeMuteStore = new ActiveMuteStore(":memory:");
    const scheduledRecords: unknown[] = [];

    try {
      guildConfigStore.setMuteRole(guildId, roleId);
      guildConfigStore.setLogChannel(guildId, logChannelId);
      guildConfigStore.setModLogEnabled(guildId, true);

      const harness = createModerationHarness({
        actionName: "mute",
        args: [`<@${targetUserId}>`, "15m", "being", "loud"],
      });

      await muteMember(harness.context, {
        guildConfigStore,
        activeMuteStore,
        scheduler: {
          schedule: async (record: unknown) => {
            scheduledRecords.push(record);
          },
        } as never,
      });

      expect(harness.roleAddCalls).toHaveLength(1);
      expect(activeMuteStore.get(guildId, targetUserId)).toMatchObject({
        muteRoleId: roleId,
      });
      expect(harness.dmMessages).toHaveLength(1);
      expect(harness.modLogMessages).toHaveLength(1);
      expect(scheduledRecords).toHaveLength(1);
    } finally {
      guildConfigStore.close();
      activeMuteStore.close();
    }
  });

  test("uses Discord timeout mode when configured", async () => {
    const guildConfigStore = new GuildConfigStore(":memory:");
    const activeMuteStore = new ActiveMuteStore(":memory:");

    try {
      guildConfigStore.setMuteMode(guildId, "timeout");

      const harness = createModerationHarness({
        actionName: "mute",
        args: [`<@${targetUserId}>`, "10m", "cool", "off"],
      });

      await muteMember(harness.context, {
        guildConfigStore,
        activeMuteStore,
        scheduler: {} as never,
      });

      expect(harness.timeoutCalls).toEqual([
        expect.objectContaining({
          duration: 600_000,
        }),
      ]);
      expect(activeMuteStore.get(guildId, targetUserId)).toBeNull();
    } finally {
      guildConfigStore.close();
      activeMuteStore.close();
    }
  });

  test("supports a dry run without applying the role mute or storing state", async () => {
    const guildConfigStore = new GuildConfigStore(":memory:");
    const activeMuteStore = new ActiveMuteStore(":memory:");
    const scheduledRecords: unknown[] = [];

    try {
      guildConfigStore.setMuteRole(guildId, roleId);

      const harness = createModerationHarness({
        actionName: "mute",
        args: [`<@${targetUserId}>`, "15m", "being", "loud", "--dryrun"],
      });

      await muteMember(harness.context, {
        guildConfigStore,
        activeMuteStore,
        scheduler: {
          schedule: async (record: unknown) => {
            scheduledRecords.push(record);
          },
        } as never,
      });

      expect(harness.roleAddCalls).toHaveLength(0);
      expect(harness.dmMessages).toHaveLength(0);
      expect(activeMuteStore.get(guildId, targetUserId)).toBeNull();
      expect(scheduledRecords).toHaveLength(0);
      expect(harness.replies).toEqual([
        `Dry run: would mute <@${targetUserId}> (\`${targetUserId}\`) for 15 minutes.`,
      ]);
    } finally {
      guildConfigStore.close();
      activeMuteStore.close();
    }
  });

  test("denies muting a member whose role outranks the invoker", async () => {
    const guildConfigStore = new GuildConfigStore(":memory:");
    const activeMuteStore = new ActiveMuteStore(":memory:");

    try {
      guildConfigStore.setMuteRole(guildId, roleId);

      const harness = createModerationHarness({
        actionName: "mute",
        args: [`<@${targetUserId}>`, "15m", "being", "loud"],
        invokerTopRolePosition: 5,
        targetTopRolePosition: 10,
      });

      await muteMember(harness.context, {
        guildConfigStore,
        activeMuteStore,
        scheduler: {} as never,
      });

      expect(harness.roleAddCalls).toHaveLength(0);
      expect(activeMuteStore.get(guildId, targetUserId)).toBeNull();
      expect(harness.replies).toEqual([
        `You cannot mute <@${targetUserId}> (\`${targetUserId}\`) because their highest role is equal to or above yours.`,
      ]);
    } finally {
      guildConfigStore.close();
      activeMuteStore.close();
    }
  });

  test("denies runtime role mute when the configured mute role grants permissions", async () => {
    const guildConfigStore = new GuildConfigStore(":memory:");
    const activeMuteStore = new ActiveMuteStore(":memory:");

    try {
      guildConfigStore.setMuteRole(guildId, roleId);

      const harness = createModerationHarness({
        actionName: "mute",
        args: [`<@${targetUserId}>`, "15m", "being", "loud"],
        rolePermissions: ["ManageMessages"],
      });

      await muteMember(harness.context, {
        guildConfigStore,
        activeMuteStore,
        scheduler: {} as never,
      });

      expect(harness.roleAddCalls).toHaveLength(0);
      expect(activeMuteStore.get(guildId, targetUserId)).toBeNull();
      expect(harness.replies).toEqual([
        `I cannot use <@&${roleId}> (\`${roleId}\`) as the mute role because it grants permissions. Remove these permissions first: \`ManageMessages\`. A mute role must not grant any permissions.`,
      ]);
    } finally {
      guildConfigStore.close();
      activeMuteStore.close();
    }
  });

  test("rolls back the mute role when persistence fails after applying it", async () => {
    const guildConfigStore = new GuildConfigStore(":memory:");
    const activeMuteStore = new ActiveMuteStore(":memory:");

    try {
      guildConfigStore.setMuteRole(guildId, roleId);

      const harness = createModerationHarness({
        actionName: "mute",
        args: [`<@${targetUserId}>`, "15m", "being", "loud"],
      });

      await expect(
        muteMember(harness.context, {
          guildConfigStore,
          activeMuteStore: {
            ...activeMuteStore,
            upsertReturningPrevious() {
              throw new Error("Database write failed");
            },
          } as never,
          scheduler: {} as never,
        }),
      ).rejects.toThrow("Database write failed");

      expect(harness.roleAddCalls).toHaveLength(1);
      expect(harness.roleRemoveCalls).toHaveLength(1);
      expect(activeMuteStore.get(guildId, targetUserId)).toBeNull();
    } finally {
      guildConfigStore.close();
      activeMuteStore.close();
    }
  });
});

describe("unmuteMember", () => {
  test("removes the stored mute role and clears the active mute", async () => {
    const guildConfigStore = new GuildConfigStore(":memory:");
    const activeMuteStore = new ActiveMuteStore(":memory:");
    const cancelled: unknown[] = [];

    try {
      activeMuteStore.upsertRoleMute({
        guildId,
        userId: targetUserId,
        muteRoleId: roleId,
        expiresAt: null,
      });

      const harness = createModerationHarness({
        actionName: "unmute",
        args: [`<@${targetUserId}>`],
      });

      await unmuteMember(harness.context, {
        guildConfigStore,
        activeMuteStore,
        scheduler: {
          cancel: (nextGuildId: string, nextUserId: string) => {
            cancelled.push({ guildId: nextGuildId, userId: nextUserId });
            activeMuteStore.delete(nextGuildId, nextUserId);
          },
        } as never,
      });

      expect(harness.roleRemoveCalls).toHaveLength(1);
      expect(activeMuteStore.get(guildId, targetUserId)).toBeNull();
      expect(cancelled).toEqual([{ guildId, userId: targetUserId }]);
    } finally {
      guildConfigStore.close();
      activeMuteStore.close();
    }
  });

  test("supports a dry run without clearing mute state", async () => {
    const guildConfigStore = new GuildConfigStore(":memory:");
    const activeMuteStore = new ActiveMuteStore(":memory:");
    const cancelled: unknown[] = [];

    try {
      activeMuteStore.upsertRoleMute({
        guildId,
        userId: targetUserId,
        muteRoleId: roleId,
        expiresAt: null,
      });

      const harness = createModerationHarness({
        actionName: "unmute",
        args: [`<@${targetUserId}>`, "-d"],
      });

      await unmuteMember(harness.context, {
        guildConfigStore,
        activeMuteStore,
        scheduler: {
          cancel: (nextGuildId: string, nextUserId: string) => {
            cancelled.push({ guildId: nextGuildId, userId: nextUserId });
          },
        } as never,
      });

      expect(harness.roleRemoveCalls).toHaveLength(0);
      expect(cancelled).toHaveLength(0);
      expect(activeMuteStore.get(guildId, targetUserId)).not.toBeNull();
      expect(harness.replies).toEqual([
        `Dry run: would unmute <@${targetUserId}> (\`${targetUserId}\`).`,
      ]);
    } finally {
      guildConfigStore.close();
      activeMuteStore.close();
    }
  });
});
