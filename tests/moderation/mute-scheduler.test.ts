import { describe, expect, test } from "vitest";
import { GuildConfigStore } from "@/config/guild-config-store.ts";
import { ActiveMuteStore } from "@/moderation/active-mute-store.ts";
import { MuteScheduler } from "@/moderation/mute-scheduler.ts";

describe("MuteScheduler", () => {
  test("processes overdue mute expiries on startup", async () => {
    const store = new ActiveMuteStore(":memory:");
    const guildConfigStore = new GuildConfigStore(":memory:");
    const removedRoles: unknown[] = [];

    try {
      store.upsertRoleMute({
        guildId: "guild-1",
        userId: "user-1",
        muteRoleId: "role-1",
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      });

      const scheduler = new MuteScheduler(store, createLog(), guildConfigStore, 30_000, 60_000);

      await scheduler.start({
        guilds: {
          fetch: async () => ({
            members: {
              fetch: async () => ({
                id: "user-1",
                guild: { id: "guild-1" },
                roles: {
                  cache: new Map([["role-1", { id: "role-1" }]]),
                  remove: async (roleId: string, reason?: string) => {
                    removedRoles.push({ roleId, reason });
                  },
                },
              }),
            },
            roles: {
              cache: new Map([["role-1", { id: "role-1" }]]),
              fetch: async () => ({ id: "role-1" }),
            },
          }),
        },
      } as never);

      expect(removedRoles).toEqual([
        {
          roleId: "role-1",
          reason: "Temporary mute expired.",
        },
      ]);
      expect(store.get("guild-1", "user-1")).toBeNull();
      scheduler.stop();
    } finally {
      guildConfigStore.close();
      store.close();
    }
  });

  test("reports failed automatic unmutes to mod logs and keeps the record for retry", async () => {
    const store = new ActiveMuteStore(":memory:");
    const guildConfigStore = new GuildConfigStore(":memory:");
    const modLogMessages: unknown[] = [];

    try {
      guildConfigStore.setLogChannel("guild-1", "log-1");
      guildConfigStore.setModLogEnabled("guild-1", true);

      store.upsertRoleMute({
        guildId: "guild-1",
        userId: "user-1",
        muteRoleId: "role-1",
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      });

      const scheduler = new MuteScheduler(store, createLog(), guildConfigStore, 60_000, 60_000);

      await scheduler.start({
        guilds: {
          fetch: async () => ({
            members: {
              fetch: async () => ({
                id: "user-1",
                guild: { id: "guild-1" },
                roles: {
                  cache: new Map([["role-1", { id: "role-1" }]]),
                  remove: async () => {
                    throw new Error("Missing Permissions");
                  },
                },
              }),
            },
            roles: {
              cache: new Map([["role-1", { id: "role-1" }]]),
              fetch: async () => ({ id: "role-1" }),
            },
          }),
        },
        channels: {
          fetch: async () => ({
            isTextBased: () => true,
            send: async (message: unknown) => {
              modLogMessages.push(message);
              return message;
            },
          }),
        },
      } as never);

      expect(store.get("guild-1", "user-1")).not.toBeNull();
      expect(modLogMessages).toEqual([
        expect.objectContaining({
          allowedMentions: {
            parse: [],
            users: [],
            roles: [],
          },
          embeds: [
            expect.objectContaining({
              data: expect.objectContaining({
                title: "Automatic Unmute Failed",
                color: 0x99aab5,
                fields: expect.arrayContaining([
                  expect.objectContaining({
                    name: "User",
                    value: "<@user-1> (`user-1`)",
                  }),
                  expect.objectContaining({
                    name: "Role",
                    value: "<@&role-1> (`role-1`)",
                  }),
                  expect.objectContaining({
                    name: "Error",
                    value: "Missing Permissions",
                  }),
                  expect.objectContaining({
                    name: "Retrying In",
                    value: "60 seconds",
                  }),
                ]),
              }),
            }),
          ],
        }),
      ]);
      scheduler.stop();
    } finally {
      guildConfigStore.close();
      store.close();
    }
  });

  test("suppresses duplicate automatic-unmute failure reports during retry window", async () => {
    const store = new ActiveMuteStore(":memory:");
    const guildConfigStore = new GuildConfigStore(":memory:");
    const modLogMessages: unknown[] = [];

    try {
      guildConfigStore.setLogChannel("guild-1", "log-1");
      guildConfigStore.setModLogEnabled("guild-1", true);

      store.upsertRoleMute({
        guildId: "guild-1",
        userId: "user-1",
        muteRoleId: "role-1",
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      });

      const scheduler = new MuteScheduler(
        store,
        createLog(),
        guildConfigStore,
        60_000,
        0,
        15 * 60_000,
      );

      await scheduler.start(createFailingUnmuteClient(modLogMessages));
      const record = store.get("guild-1", "user-1");
      expect(record).not.toBeNull();

      await scheduler.processExpiry(record!);

      expect(modLogMessages).toHaveLength(1);
      scheduler.stop();
    } finally {
      guildConfigStore.close();
      store.close();
    }
  });

  test("backs off automatic-unmute retry delays after repeated failures", async () => {
    const store = new ActiveMuteStore(":memory:");
    const guildConfigStore = new GuildConfigStore(":memory:");
    const modLogMessages: unknown[] = [];

    try {
      guildConfigStore.setLogChannel("guild-1", "log-1");
      guildConfigStore.setModLogEnabled("guild-1", true);

      store.upsertRoleMute({
        guildId: "guild-1",
        userId: "user-1",
        muteRoleId: "role-1",
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      });

      const scheduler = new MuteScheduler(
        store,
        createLog(),
        guildConfigStore,
        60_000,
        0,
        0,
        15 * 60_000,
        0.2,
        () => 0.5,
      );

      await scheduler.start(createFailingUnmuteClient(modLogMessages));
      const record = store.get("guild-1", "user-1");
      expect(record).not.toBeNull();

      await scheduler.processExpiry(record!);

      expect(modLogMessages.map((message) => fieldValue(message, "Retrying In"))).toEqual([
        "60 seconds",
        "120 seconds",
      ]);
      scheduler.stop();
    } finally {
      guildConfigStore.close();
      store.close();
    }
  });

  test("still attempts automatic unmute when the fetched member role cache is stale", async () => {
    const store = new ActiveMuteStore(":memory:");
    const guildConfigStore = new GuildConfigStore(":memory:");
    const removedRoles: unknown[] = [];

    try {
      store.upsertRoleMute({
        guildId: "guild-1",
        userId: "user-1",
        muteRoleId: "role-1",
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      });

      const scheduler = new MuteScheduler(store, createLog(), guildConfigStore, 60_000, 60_000);

      await scheduler.start({
        guilds: {
          fetch: async () => ({
            members: {
              fetch: async () => ({
                id: "user-1",
                guild: { id: "guild-1" },
                roles: {
                  cache: new Map(),
                  remove: async (roleId: string, reason?: string) => {
                    removedRoles.push({ roleId, reason });
                  },
                },
              }),
            },
            roles: {
              cache: new Map([["role-1", { id: "role-1" }]]),
              fetch: async () => ({ id: "role-1" }),
            },
          }),
        },
      } as never);

      expect(removedRoles).toEqual([
        {
          roleId: "role-1",
          reason: "Temporary mute expired.",
        },
      ]);
      expect(store.get("guild-1", "user-1")).toBeNull();
      scheduler.stop();
    } finally {
      guildConfigStore.close();
      store.close();
    }
  });
});

function createFailingUnmuteClient(modLogMessages: unknown[]) {
  return {
    guilds: {
      fetch: async () => ({
        members: {
          fetch: async () => ({
            id: "user-1",
            guild: { id: "guild-1" },
            roles: {
              cache: new Map([["role-1", { id: "role-1" }]]),
              remove: async () => {
                throw new Error("Missing Permissions");
              },
            },
          }),
        },
        roles: {
          cache: new Map([["role-1", { id: "role-1" }]]),
          fetch: async () => ({ id: "role-1" }),
        },
      }),
    },
    channels: {
      fetch: async () => ({
        isTextBased: () => true,
        send: async (message: unknown) => {
          modLogMessages.push(message);
          return message;
        },
      }),
    },
  } as never;
}

function fieldValue(message: unknown, name: string): string | undefined {
  const field = (message as any).embeds?.[0]?.data?.fields?.find(
    (entry: { name?: string }) => entry.name === name,
  );

  return field?.value;
}

function createLog() {
  return {
    withError() {
      return this;
    },
    withMetadata() {
      return this;
    },
    warn() {},
    info() {},
  } as never;
}
